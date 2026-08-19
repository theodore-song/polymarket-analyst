import { auditLiquidity } from "../lib/liquidity-audit.js";

const CLOB = "https://clob.polymarket.com";
const MARKET_LIMIT = Math.max(10, Math.min(250, Number(process.env.REWARD_MAKER_MARKETS || 100)));
const HISTORY_DAYS = Math.max(14, Math.min(30, Number(process.env.REWARD_MAKER_HISTORY_DAYS || 30)));
const HORIZON_HOURS = Math.max(1, Math.min(24, Number(process.env.REWARD_MAKER_HORIZON_HOURS || 3)));
const EXIT_COST = Math.max(0, Math.min(0.05, Number(process.env.REWARD_MAKER_EXIT_COST_CENTS || 1) / 100));
const SUMMARY_ONLY = process.env.REWARD_MAKER_SUMMARY === "1";
const HOUR = 3600;

async function fetchJson(url, options = {}, attempts = 4) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000),
        headers: { accept: "application/json", ...(options.headers || {}) } });
      if (response.ok) return response.json();
      lastError = new Error(`${response.status} ${response.statusText}`);
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
  }
  throw lastError || new Error("request failed");
}

function atOrBefore(points, target) {
  let lo = 0, hi = points.length - 1, answer = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t <= target) { answer = points[mid]; lo = mid + 1; }
    else hi = mid - 1;
  }
  return answer;
}

async function fetchHistories(candidates) {
  const tokenIds = [...new Set(candidates.flatMap((candidate) => candidate.clob_token_ids || []).map(String))];
  const history = {};
  for (let index = 0; index < tokenIds.length; index += 20) {
    const batch = tokenIds.slice(index, index + 20);
    const response = await fetchJson(`${CLOB}/batch-prices-history`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ markets: batch, interval: "1m", fidelity: 60 }),
    });
    Object.entries(response.history || {}).forEach(([token, points]) => {
      history[token] = (points || []).map((point) => ({ t: Number(point.t), p: Number(point.p) }))
        .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.p)).sort((a, b) => a.t - b.t);
    });
  }
  return history;
}

function firstTouch(points, start, end, quote) {
  return points.find((point) => point.t > start && point.t <= end && point.p <= quote) || null;
}

function observations(candidate, yesPoints, noPoints) {
  const rows = [], seen = new Set(), cutoff = Date.now() / 1000 - HISTORY_DAYS * 24 * HOUR;
  const yesDistance = Math.max(Number(candidate.tick_size || 0.01), Number(candidate.yes_adjusted_mid) - Number(candidate.yes_quote));
  const noDistance = Math.max(Number(candidate.tick_size || 0.01), Number(candidate.no_adjusted_mid) - Number(candidate.no_quote));
  const size = Number(candidate.reward_min_size), endBuffer = HORIZON_HOURS * HOUR;
  for (const yes of yesPoints) {
    if (yes.t < cutoff || yes.t + endBuffer > Date.now() / 1000) continue;
    const bucket = Math.floor(yes.t / (24 * HOUR));
    if (seen.has(bucket)) continue;
    const no = atOrBefore(noPoints, yes.t + HOUR);
    if (!no || Math.abs(no.t - yes.t) > 2 * HOUR || yes.p <= 0.04 || yes.p >= 0.96 || no.p <= 0.04 || no.p >= 0.96) continue;
    const priorYes = yesPoints.filter((point) => point.t >= yes.t - 24 * HOUR && point.t <= yes.t);
    if (priorYes.length < 12 || Math.max(...priorYes.map((point) => point.p)) - Math.min(...priorYes.map((point) => point.p)) > 0.08) continue;
    const yesQuote = yes.p - yesDistance, noQuote = no.p - noDistance, pairedCost = yesQuote + noQuote;
    if (yesQuote < 0.02 || noQuote < 0.02 || pairedCost >= 0.995) continue;
    const horizonEnd = yes.t + endBuffer;
    const yesTouch = firstTouch(yesPoints, yes.t, horizonEnd, yesQuote);
    const noTouch = firstTouch(noPoints, yes.t, horizonEnd, noQuote);
    const endYes = atOrBefore(yesPoints, horizonEnd), endNo = atOrBefore(noPoints, horizonEnd);
    if (!endYes || !endNo || horizonEnd - Math.min(endYes.t, endNo.t) > 2 * HOUR) continue;
    seen.add(bucket);
    let pnl = 0, status = "unfilled";
    if (yesTouch && noTouch) { pnl = (1 - pairedCost) * size; status = "locked"; }
    else if (yesTouch) { pnl = (endYes.p - yesQuote - EXIT_COST) * size; status = "single-exit"; }
    else if (noTouch) { pnl = (endNo.p - noQuote - EXIT_COST) * size; status = "single-exit"; }
    const firstFillAt = Math.min(yesTouch?.t || Infinity, noTouch?.t || Infinity);
    const activeHours = Number.isFinite(firstFillAt) ? Math.max(0, Math.min(HORIZON_HOURS, (firstFillAt - yes.t) / HOUR)) : HORIZON_HOURS;
    rows.push({ observedAt: yes.t, pnl, status, activeHours, capital: pairedCost * size });
  }
  return rows;
}

function summarize(rows, dailyReward, rewardHaircut) {
  if (!rows.length) return { observations: 0, mean: 0, lower90: 0, pnl: 0, reward: 0, net: 0,
    lockedRate: 0, adverseRate: 0, activeDays: 0, breakEvenRewardDaily: 0 };
  const results = rows.map((row) => {
    const reward = dailyReward * rewardHaircut * row.activeHours / 24;
    return { ...row, reward, net: row.pnl + reward, netReturn: (row.pnl + reward) / Math.max(1, row.capital) };
  });
  const values = results.map((row) => row.netReturn), mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.length > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1) : 0;
  const lower90 = mean - 1.645 * Math.sqrt(variance / values.length);
  const pnl = results.reduce((sum, row) => sum + row.pnl, 0), activeDays = results.reduce((sum, row) => sum + row.activeHours / 24, 0);
  return { observations: rows.length, mean, lower90, pnl,
    reward: results.reduce((sum, row) => sum + row.reward, 0), net: results.reduce((sum, row) => sum + row.net, 0),
    lockedRate: rows.filter((row) => row.status === "locked").length / rows.length,
    adverseRate: rows.filter((row) => row.status === "single-exit").length / rows.length,
    activeDays, breakEvenRewardDaily: Math.max(0, -pnl / Math.max(activeDays, 1e-9)) };
}

function split(rows) {
  const ordered = [...rows].sort((a, b) => a.observedAt - b.observedAt);
  return {
    train: ordered.slice(0, Math.floor(ordered.length * 0.60)),
    validation: ordered.slice(Math.floor(ordered.length * 0.60), Math.floor(ordered.length * 0.80)),
    holdout: ordered.slice(Math.floor(ordered.length * 0.80)),
  };
}

const compact = (stats) => Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, Number.isFinite(value) ? +value.toFixed(5) : value]));
const audit = await auditLiquidity({ marketLimit: MARKET_LIMIT, minHoursToEnd: 48 });
const histories = await fetchHistories(audit.candidates);
const candidates = audit.candidates.map((candidate) => {
  const rows = observations(candidate, histories[String(candidate.clob_token_ids[0])] || [], histories[String(candidate.clob_token_ids[1])] || []);
  const partitions = split(rows), floor = Number(candidate.estimated_reward_floor_daily || 0);
  const stress = Object.fromEntries([0, 0.25, 0.5, 1].map((haircut) => [haircut, {
    all: compact(summarize(rows, floor, haircut)), train: compact(summarize(partitions.train, floor, haircut)),
    validation: compact(summarize(partitions.validation, floor, haircut)), holdout: compact(summarize(partitions.holdout, floor, haircut)),
  }]));
  const conservative = stress[0.25], passesStress = rows.length >= 20 && partitions.validation.length >= 4 && partitions.holdout.length >= 4
    && conservative.all.lower90 > 0 && conservative.train.mean > 0 && conservative.validation.mean > 0 && conservative.holdout.mean > 0;
  return { market_id: candidate.market_id, question: candidate.question, url: candidate.url, category: candidate.category,
    required_capital: candidate.required_capital, estimated_reward_floor_daily: floor,
    reward_share_floor: candidate.reward_share_floor, maximum_one_leg_loss: candidate.maximum_one_leg_loss,
    observations: rows.length, passes_stressed_path_gate: passesStress,
    reward_floor_to_break_even: conservative.all.breakEvenRewardDaily > 0 ? floor / conservative.all.breakEvenRewardDaily : null,
    stress };
}).sort((a, b) => Number(b.passes_stressed_path_gate) - Number(a.passes_stressed_path_gate)
  || Number(b.reward_floor_to_break_even || 0) - Number(a.reward_floor_to_break_even || 0));

const observedCandidates = candidates.filter((candidate) => candidate.observations > 0);
const outputCandidates = SUMMARY_ONLY ? observedCandidates.slice(0, 12).map((candidate) => ({
  market_id: candidate.market_id,
  question: candidate.question,
  estimated_reward_floor_daily: candidate.estimated_reward_floor_daily,
  observations: candidate.observations,
  passes_stressed_path_gate: candidate.passes_stressed_path_gate,
  reward_floor_to_break_even: candidate.reward_floor_to_break_even,
  no_reward: {
    pnl: candidate.stress[0].all.pnl,
    lower90: candidate.stress[0].all.lower90,
    adverseRate: candidate.stress[0].all.adverseRate,
  },
  reward_at_25pct: {
    net: candidate.stress[0.25].all.net,
    lower90: candidate.stress[0.25].all.lower90,
    trainMean: candidate.stress[0.25].train.mean,
    validationMean: candidate.stress[0.25].validation.mean,
    holdoutMean: candidate.stress[0.25].holdout.mean,
  },
})) : candidates;

console.log(JSON.stringify({ generatedAt: new Date().toISOString(), requestedRewardMarkets: MARKET_LIMIT,
  auditedRewardMarkets: audit.reward_markets, shadowQualified: audit.shadow_qualified, evaluatedCandidates: candidates.length,
  candidatesWithHistory: observedCandidates.length,
  stressedPathPassed: candidates.filter((candidate) => candidate.passes_stressed_path_gate).length,
  methodology: { historyDays: HISTORY_DAYS, horizonHours: HORIZON_HOURS, exitCostCents: EXIT_COST * 100,
    rewardStress: "25% of the current public-book reward-share floor", rewardAccrual: "stops at the first simulated fill",
    fillProxy: "hourly CLOB token price touches a resting bid", split: "60% / 20% / 20% chronological path stability",
    limitation: "Repeated paths from a current market are not independent events and cannot authorize capital; this gate only prioritizes live shadow observations." },
  candidates: outputCandidates }, null, 2));
