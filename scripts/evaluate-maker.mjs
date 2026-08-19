const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";
const MARKET_LIMIT = Math.max(100, Math.min(500, Number(process.env.MAKER_MARKETS || 300)));
const HISTORY_DAYS = Math.max(14, Math.min(30, Number(process.env.MAKER_HISTORY_DAYS || 30)));
const CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.MAKER_CONCURRENCY || 4)));
const EXIT_COST = Math.max(0, Math.min(0.05, Number(process.env.MAKER_EXIT_COST_CENTS || 0.5) / 100));
const SUMMARY_ONLY = process.env.MAKER_SUMMARY === "1";
const HOUR = 3600;

function parseJson(value) {
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value || "[]"); } catch { return []; }
}

async function fetchJson(url, options = {}, attempts = 3) {
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

async function mapLimit(items, limit, task) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      try { output[index] = await task(items[index], index); }
      catch (error) { output[index] = { error: error.message }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

function categoryOf(raw) {
  const text = `${raw.question || ""} ${(raw.tags || []).map((tag) => tag.slug || tag.label || "").join(" ")}`.toLowerCase();
  if (/\b(election|president|politic|senate|congress|parliament|minister|governor|government|nominee|primary)\b/.test(text)) return "Politics";
  if (/\b(bitcoin|crypto|ethereum|btc|eth|solana|xrp|token|stablecoin)\b/.test(text)) return "Crypto";
  if (/\b(nba|nfl|nhl|mlb|soccer|football|baseball|basketball|tennis|ufc|boxing|championship|match|game|tournament|league)\b/.test(text)) return "Sports";
  if (/\b(fed|inflation|gdp|recession|stock|company|economy|tariff|interest rate|unemployment|earnings)\b/.test(text)) return "Economy";
  return "Other";
}

async function fetchMarkets(limit) {
  const markets = [], seen = new Set();
  for (let offset = 0; markets.length < limit && offset < limit * 5; offset += 100) {
    const params = new URLSearchParams({ active: "true", closed: "false", archived: "false", include_tag: "true",
      limit: "100", offset: String(offset), order: "volume24hr", ascending: "false" });
    const page = await fetchJson(`${GAMMA}/markets?${params}`);
    if (!Array.isArray(page) || !page.length) break;
    for (const raw of page) {
      const labels = parseJson(raw.outcomes).map((value) => String(value).trim().toLowerCase());
      const tokens = parseJson(raw.clobTokenIds).map(String), id = String(raw.id || "");
      const reward = (raw.clobRewards || []).reduce((sum, row) => sum + Number(row.rewardsDailyRate || 0), 0);
      if (!id || seen.has(id) || labels[0] !== "yes" || labels[1] !== "no" || tokens.length !== 2 || reward < 1) continue;
      seen.add(id);
      markets.push({ id, tokens, category: categoryOf(raw), question: raw.question || "",
        eventKey: String(raw.events?.[0]?.id || raw.events?.[0]?.slug || raw.eventId || id) });
      if (markets.length >= limit) break;
    }
    if (page.length < 100) break;
  }
  return markets;
}

function chunks(items, size) {
  const output = [];
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
  return output;
}

async function fetchHistories(markets) {
  const tokenRows = markets.flatMap((market) => market.tokens.map((token) => ({ token, marketId: market.id })));
  const tokenChunks = chunks(tokenRows, 20);
  const responses = await mapLimit(tokenChunks, CONCURRENCY, async (chunk) => fetchJson(`${CLOB}/batch-prices-history`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ markets: chunk.map((row) => row.token), interval: "1m", fidelity: 60 })
  }));
  const history = {};
  responses.forEach((response) => {
    if (response?.history) Object.entries(response.history).forEach(([token, points]) => {
      history[token] = (points || []).map((point) => ({ t: Number(point.t), p: Number(point.p) }))
        .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.p)).sort((a, b) => a.t - b.t);
    });
  });
  return { history, failures: responses.filter((response) => response?.error).length,
    failureMessages: [...new Set(responses.filter((response) => response?.error).map((response) => response.error))].slice(0, 5) };
}

function atOrBefore(points, target) {
  let result = null;
  for (const point of points) {
    if (point.t > target) break;
    result = point;
  }
  return result;
}

function observations(market, yesPoints, noPoints) {
  const rows = [], seen = new Set();
  for (const yes of yesPoints) {
    const bucket = Math.floor(yes.t / (24 * HOUR));
    if (seen.has(bucket)) continue;
    const no = atOrBefore(noPoints, yes.t + HOUR);
    if (!no || Math.abs(no.t - yes.t) > 2 * HOUR || yes.p < 0.08 || yes.p > 0.92) continue;
    const prior = yesPoints.filter((point) => point.t >= yes.t - 24 * HOUR && point.t <= yes.t);
    const futureYes = yesPoints.filter((point) => point.t > yes.t && point.t <= yes.t + 24 * HOUR);
    const futureNo = noPoints.filter((point) => point.t > yes.t && point.t <= yes.t + 24 * HOUR);
    if (prior.length < 12 || futureYes.length < 12 || futureNo.length < 12) continue;
    const endYes = atOrBefore(yesPoints, yes.t + 24 * HOUR), endNo = atOrBefore(noPoints, yes.t + 24 * HOUR);
    if (!endYes || !endNo || yes.t + 24 * HOUR - Math.min(endYes.t, endNo.t) > 2 * HOUR) continue;
    seen.add(bucket);
    const prices = prior.map((point) => point.p);
    rows.push({ marketId: market.id, eventKey: market.eventKey, category: market.category, observedAt: yes.t,
      yes: yes.p, no: no.p, priorRange: Math.max(...prices) - Math.min(...prices), futureYes, futureNo,
      endYes: endYes.p, endNo: endNo.p });
  }
  return rows;
}

function simulate(row, rule) {
  if (row.priorRange > rule.maxPriorRange || (rule.category !== "All" && row.category !== rule.category)) return null;
  if (rule.band === "mid" && (row.yes < 0.2 || row.yes > 0.8)) return null;
  if (rule.band === "tails" && row.yes >= 0.2 && row.yes <= 0.8) return null;
  const yesQuote = row.yes - rule.gap, noQuote = row.no - rule.gap, reserved = yesQuote + noQuote;
  if (yesQuote < 0.02 || noQuote < 0.02 || reserved >= 0.995) return null;
  const horizonEnd = row.observedAt + rule.horizon * HOUR;
  const futureYes = row.futureYes.filter((point) => point.t <= horizonEnd), futureNo = row.futureNo.filter((point) => point.t <= horizonEnd);
  const endYes = atOrBefore(futureYes, horizonEnd), endNo = atOrBefore(futureNo, horizonEnd);
  if (!endYes || !endNo || horizonEnd - Math.min(endYes.t, endNo.t) > 2 * HOUR) return null;
  const yesFill = futureYes.some((point) => point.p <= yesQuote), noFill = futureNo.some((point) => point.p <= noQuote);
  let pnl = 0, status = "unfilled";
  if (yesFill && noFill) { pnl = 1 - reserved; status = "locked"; }
  else if (yesFill) { pnl = endYes.p - yesQuote - EXIT_COST; status = "single-exit"; }
  else if (noFill) { pnl = endNo.p - noQuote - EXIT_COST; status = "single-exit"; }
  return { marketId: row.marketId, eventKey: row.eventKey, observedAt: row.observedAt, pnl,
    netReturn: pnl / reserved, status };
}

function summary(rows) {
  if (!rows.length) return { attempts: 0, markets: 0, events: 0, pnl: 0, mean: 0, eventMean: 0, lower: 0, upper: 0, lockedRate: 0, adverseRate: 0 };
  const events = new Map();
  rows.forEach((row) => {
    const values = events.get(row.eventKey) || [];
    values.push(row.netReturn); events.set(row.eventKey, values);
  });
  const eventReturns = [...events.values()].map((values) => values.reduce((sum, value) => sum + value, 0) / values.length);
  const eventMean = eventReturns.reduce((sum, value) => sum + value, 0) / eventReturns.length;
  const variance = eventReturns.length > 1 ? eventReturns.reduce((sum, value) => sum + (value - eventMean) ** 2, 0) / (eventReturns.length - 1) : 0;
  const margin = 1.645 * Math.sqrt(variance / Math.max(1, eventReturns.length));
  return { attempts: rows.length, markets: new Set(rows.map((row) => row.marketId)).size, events: eventReturns.length,
    pnl: rows.reduce((sum, row) => sum + row.pnl, 0), mean: rows.reduce((sum, row) => sum + row.netReturn, 0) / rows.length,
    eventMean, lower: eventMean - margin, upper: eventMean + margin,
    lockedRate: rows.filter((row) => row.status === "locked").length / rows.length,
    adverseRate: rows.filter((row) => row.status === "single-exit").length / rows.length };
}

const rules = [];
for (const horizon of [3, 6, 12, 24]) {
  for (const gap of [0.005, 0.01, 0.015, 0.02, 0.025, 0.03, 0.04]) {
    for (const maxPriorRange of [0.02, 0.04, 0.06, 0.08, 0.12, 0.2]) {
      for (const band of ["all", "mid", "tails"]) {
        for (const category of ["All", "Politics", "Sports", "Crypto", "Economy", "Other"])
          rules.push({ id: `h${horizon}_gap${gap}_range${maxPriorRange}_${band}_${category}`, horizon, gap, maxPriorRange, band, category });
      }
    }
  }
}

const markets = await fetchMarkets(MARKET_LIMIT), fetched = await fetchHistories(markets);
const rows = markets.flatMap((market) => observations(market, fetched.history[market.tokens[0]] || [], fetched.history[market.tokens[1]] || []));
const timestamps = rows.map((row) => row.observedAt).sort((a, b) => a - b), trainCut = timestamps[Math.floor(timestamps.length * 0.6)] || 0,
  validationCut = timestamps[Math.floor(timestamps.length * 0.8)] || 0;
const partitions = {
  train: rows.filter((row) => row.observedAt < trainCut && row.observedAt + 24 * HOUR < trainCut),
  validation: rows.filter((row) => row.observedAt >= trainCut && row.observedAt + 24 * HOUR < validationCut),
  holdout: rows.filter((row) => row.observedAt >= validationCut)
};
const evaluated = rules.map((rule) => {
  const train = summary(partitions.train.map((row) => simulate(row, rule)).filter(Boolean));
  const validation = summary(partitions.validation.map((row) => simulate(row, rule)).filter(Boolean));
  const holdout = summary(partitions.holdout.map((row) => simulate(row, rule)).filter(Boolean));
  const trainPassed = train.attempts >= 80 && train.events >= 15 && train.lower > 0;
  const validationPassed = trainPassed && validation.attempts >= 35 && validation.events >= 8 && validation.lower > 0;
  return { rule, train, validation, holdout, trainPassed, validationPassed,
    passesHoldout: validationPassed && holdout.attempts >= 35 && holdout.events >= 8 && holdout.lower > 0 };
});
const candidates = evaluated.filter((candidate) => candidate.validationPassed);

const compact = (stats) => Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, Number.isFinite(value) ? +value.toFixed(5) : value]));
candidates.sort((a, b) => Number(b.passesHoldout) - Number(a.passesHoldout) || b.holdout.lower - a.holdout.lower);
const nearMisses = evaluated.filter((candidate) => candidate.train.attempts >= 80 && candidate.validation.attempts >= 35 && candidate.holdout.attempts >= 35)
  .sort((a, b) => Math.min(b.train.lower, b.validation.lower) - Math.min(a.train.lower, a.validation.lower)).slice(0, 15);
const broadByGap = evaluated.filter((candidate) => candidate.rule.maxPriorRange === 0.2 && candidate.rule.band === "all" && candidate.rule.category === "All");
const report = { generatedAt: new Date().toISOString(), requestedMarkets: MARKET_LIMIT, rewardMarkets: markets.length,
  marketsWithBothHistories: markets.filter((market) => fetched.history[market.tokens[0]]?.length && fetched.history[market.tokens[1]]?.length).length,
  batchFailures: fetched.failures, batchFailureMessages: fetched.failureMessages, observations: rows.length, testedRules: rules.length,
  methodology: { historyDays: HISTORY_DAYS, quoteHorizonHours: [3, 6, 12, 24], observationSpacingHours: 24, exitCostCents: EXIT_COST * 100,
    split: "60% train / 20% validation / 20% untouched holdout", clusterUnit: "Polymarket event",
    fillProxy: "public CLOB token price touched the resting bid after placement", noFillPnl: 0 },
  partitionRows: Object.fromEntries(Object.entries(partitions).map(([key, value]) => [key, value.length])),
  trainPassed: evaluated.filter((candidate) => candidate.trainPassed).length, validationSelected: candidates.length,
  holdoutPassed: candidates.filter((candidate) => candidate.passesHoldout).length,
  broadByGap: broadByGap.map((candidate) => ({ horizon: candidate.rule.horizon, gap: candidate.rule.gap, train: compact(candidate.train), validation: compact(candidate.validation), holdout: compact(candidate.holdout) })),
  nearMisses: nearMisses.map((candidate) => ({ rule: candidate.rule, train: compact(candidate.train), validation: compact(candidate.validation), holdout: compact(candidate.holdout) })),
  candidates: candidates.slice(0, 30).map((candidate) => ({ rule: candidate.rule, passesHoldout: candidate.passesHoldout,
    train: compact(candidate.train), validation: compact(candidate.validation), holdout: compact(candidate.holdout) })) };
if (SUMMARY_ONLY) {
  const summarizeCandidate = (candidate) => ({ rule: candidate.rule, passesHoldout: candidate.passesHoldout,
    train: { attempts: candidate.train.attempts, events: candidate.train.events, lower: +candidate.train.lower.toFixed(5), eventMean: +candidate.train.eventMean.toFixed(5) },
    validation: { attempts: candidate.validation.attempts, events: candidate.validation.events, lower: +candidate.validation.lower.toFixed(5), eventMean: +candidate.validation.eventMean.toFixed(5) },
    holdout: { attempts: candidate.holdout.attempts, events: candidate.holdout.events, lower: +candidate.holdout.lower.toFixed(5), eventMean: +candidate.holdout.eventMean.toFixed(5), lockedRate: +candidate.holdout.lockedRate.toFixed(4), adverseRate: +candidate.holdout.adverseRate.toFixed(4) } });
  console.log(JSON.stringify({ generatedAt: report.generatedAt, requestedMarkets: report.requestedMarkets,
    rewardMarkets: report.rewardMarkets, marketsWithBothHistories: report.marketsWithBothHistories,
    batchFailures: report.batchFailures, observations: report.observations, testedRules: report.testedRules,
    partitionRows: report.partitionRows, trainPassed: report.trainPassed, validationSelected: report.validationSelected,
    holdoutPassed: report.holdoutPassed,
    broadByGap: broadByGap.map((candidate) => ({ horizon: candidate.rule.horizon, gap: candidate.rule.gap,
      trainLower: +candidate.train.lower.toFixed(5), validationLower: +candidate.validation.lower.toFixed(5),
      holdoutMean: +candidate.holdout.eventMean.toFixed(5), holdoutLower: +candidate.holdout.lower.toFixed(5),
      holdoutLockedRate: +candidate.holdout.lockedRate.toFixed(4), holdoutAdverseRate: +candidate.holdout.adverseRate.toFixed(4) })),
    nearMisses: nearMisses.slice(0, 5).map(summarizeCandidate),
    candidates: candidates.slice(0, 10).map(summarizeCandidate) }, null, 2));
} else console.log(JSON.stringify(report, null, 2));
