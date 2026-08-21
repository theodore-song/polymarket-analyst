import fs from "node:fs";

const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";
const MARKET_LIMIT = Math.max(100, Math.min(2000, Number(process.env.SHOCK_MARKETS || 500)));
const ACTIVE_SKIP = Math.max(0, Math.min(10000, Number(process.env.SHOCK_ACTIVE_SKIP || 0)));
const EXTERNAL_MARKET_LIMIT = Math.max(100, Math.min(2000, Number(process.env.SHOCK_EXTERNAL_MARKETS || 1000)));
const HISTORY_DAYS = Math.max(14, Math.min(30, Number(process.env.SHOCK_HISTORY_DAYS || 30)));
const CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.SHOCK_CONCURRENCY || 6)));
const COST = Math.max(0, Math.min(0.05, Number(process.env.SHOCK_COST_CENTS || 0.5) / 100));
const MIN_ENTRY_PRICE = Math.max(0.02, Math.min(0.40, Number(process.env.SHOCK_MIN_ENTRY_PRICE || 0.08)));
const MAX_ENTRY_PRICE = Math.max(0.60, Math.min(0.98, Number(process.env.SHOCK_MAX_ENTRY_PRICE || 0.92)));
const CACHE_FILE = String(process.env.SHOCK_CACHE_FILE || "").trim();
const OUTPUT_FILE = String(process.env.SHOCK_OUTPUT_FILE || "").trim();
const SUMMARY_ONLY = process.env.SHOCK_SUMMARY === "1";
const SUMMARY_CANDIDATES = Math.max(0, Math.min(10, Number(process.env.SHOCK_SUMMARY_CANDIDATES || 10)));
const HOUR = 3600;
const HORIZONS = [3, 6, 12, 24];
const WINDOWS = [1, 3, 6, 24];
const MIN_MOVES = [0.005, 0.01, 0.02, 0.04, 0.08];
const CONFIRMATIONS = ["any", "aligned", "opposed", "accelerating"];
const MAX_VOLS = [0.01, 0.02, 0.04, 1];

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
  if (/\b(movie|music|album|celebrity|award|television|gaming|game release)\b/.test(text)) return "Pop Culture";
  return "Other";
}

async function fetchMarkets(limit, universe = "active") {
  const markets = [], seen = new Set();
  if (universe === "closed") {
    let cursor = "";
    while (markets.length < limit) {
      const params = new URLSearchParams({ closed: "true", order: "volumeNum", ascending: "false", limit: "100", include_tag: "true" });
      if (cursor) params.set("after_cursor", cursor);
      const payload = await fetchJson(`${GAMMA}/markets/keyset?${params}`), page = payload?.markets;
      if (!Array.isArray(page) || !page.length) break;
      for (const raw of page) {
        const labels = parseJson(raw.outcomes).map((value) => String(value).trim().toLowerCase());
        const tokens = parseJson(raw.clobTokenIds).map(String), outcomes = parseJson(raw.outcomePrices).map(Number), id = String(raw.id || "");
        const resolved = outcomes.length === 2 && outcomes.every(Number.isFinite)
          && ((outcomes[0] >= 0.99 && outcomes[1] <= 0.01) || (outcomes[1] >= 0.99 && outcomes[0] <= 0.01));
        if (!id || seen.has(id) || !resolved || labels[0] !== "yes" || labels[1] !== "no" || tokens.length !== 2) continue;
        seen.add(id);
        markets.push({ id, token: tokens[0], category: categoryOf(raw), question: raw.question || "",
          eventKey: String(raw.events?.[0]?.id || raw.events?.[0]?.slug || raw.eventId || id) });
        if (markets.length >= limit) break;
      }
      if (page.length < 100 || !payload.next_cursor || payload.next_cursor === cursor) break;
      cursor = payload.next_cursor;
    }
    return markets;
  }
  let cursor = "", skipped = 0;
  while (markets.length < limit) {
    const params = new URLSearchParams({ active: "true", closed: "false", archived: "false", include_tag: "true",
      limit: "100", order: "volume24hr", ascending: "false" });
    if (cursor) params.set("after_cursor", cursor);
    const payload = await fetchJson(`${GAMMA}/markets/keyset?${params}`), page = payload?.markets;
    if (!Array.isArray(page) || !page.length) break;
    for (const raw of page) {
      const labels = parseJson(raw.outcomes).map((value) => String(value).trim().toLowerCase());
      const tokens = parseJson(raw.clobTokenIds).map(String), id = String(raw.id || "");
      if (!id || seen.has(id) || labels[0] !== "yes" || labels[1] !== "no" || tokens.length !== 2) continue;
      if (skipped < ACTIVE_SKIP) { skipped++; continue; }
      seen.add(id);
      markets.push({ id, token: tokens[0], category: categoryOf(raw), question: raw.question || "",
        eventKey: String(raw.events?.[0]?.id || raw.events?.[0]?.slug || raw.eventId || id) });
      if (markets.length >= limit) break;
    }
    if (page.length < 100 || !payload.next_cursor || payload.next_cursor === cursor) break;
    cursor = payload.next_cursor;
  }
  return markets;
}

function chunks(items, size) {
  const output = [];
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
  return output;
}

async function fetchHistories(markets, { lookbackDays = HISTORY_DAYS } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const windows = [];
  if (lookbackDays == null) windows.push(null);
  else for (let end = now; end > now - lookbackDays * 86400; end -= 15 * 86400)
    windows.push({ start: Math.max(now - lookbackDays * 86400, end - 15 * 86400), end });
  const jobs = windows.flatMap((window) => chunks(markets, 20).map((chunk) => ({ window, chunk })));
  const responses = await mapLimit(jobs, CONCURRENCY, async ({ window, chunk }) => fetchJson(`${CLOB}/batch-prices-history`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ markets: chunk.map((market) => market.token), fidelity: 60,
      ...(window == null ? { interval: "max" } : { start_ts: window.start, end_ts: window.end }) })
  }));
  const history = {};
  responses.forEach((response) => {
    if (!response?.history) return;
    Object.entries(response.history).forEach(([token, points]) => {
      history[token] = [...(history[token] || []), ...(points || []).map((point) => ({ t: Number(point.t), p: Number(point.p) }))
        .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.p))];
    });
  });
  Object.entries(history).forEach(([token, points]) => {
    history[token] = [...new Map(points.sort((a, b) => a.t - b.t).map((point) => [point.t, point])).values()];
  });
  return { history, failures: responses.filter((response) => response?.error).length };
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

function atOrAfter(points, target) {
  let lo = 0, hi = points.length - 1, answer = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t >= target) { answer = points[mid]; hi = mid - 1; }
    else lo = mid + 1;
  }
  return answer;
}

function stddev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

function stableHash(value) {
  let hash = 2166136261;
  for (const char of String(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

function priceBand(price) {
  if (price < 0.25) return "longshot";
  if (price < 0.45) return "lower-mid";
  if (price <= 0.55) return "center";
  if (price <= 0.75) return "upper-mid";
  return "favorite";
}

function observations(market, points) {
  const rows = [], seen = new Set();
  for (const current of points) {
    const bucket = Math.floor(current.t / (3 * HOUR));
    if (seen.has(bucket) || current.p < 0.05 || current.p > 0.95) continue;
    const past = Object.fromEntries(WINDOWS.map((window) => [window, atOrBefore(points, current.t - window * HOUR)]));
    const priorOne = atOrBefore(points, current.t - HOUR), priorTwo = atOrBefore(points, current.t - 2 * HOUR);
    if (WINDOWS.some((window) => !past[window]) || !priorOne || !priorTwo || current.t - past[24].t > 26 * HOUR) continue;
    const prior = points.filter((point) => point.t >= current.t - 24 * HOUR && point.t <= current.t);
    if (prior.length < 12) continue;
    const hourlyReturns = [];
    for (let index = 1; index < prior.length; index++) hourlyReturns.push(prior[index].p - prior[index - 1].p);
    const features = { moves: Object.fromEntries(WINDOWS.map((window) => [window, current.p - past[window].p])),
      oneMove: current.p - priorOne.p, priorOneMove: priorOne.p - priorTwo.p, volatility: stddev(hourlyReturns) };
    let captured = false;
    for (const horizon of HORIZONS) {
      const future = atOrAfter(points, current.t + horizon * HOUR);
      if (!future || future.t - (current.t + horizon * HOUR) > 2 * HOUR) continue;
      rows.push({ marketId: market.id, eventKey: market.eventKey, category: market.category, observedAt: current.t,
        evaluatedAt: future.t, horizon, price: current.p, futurePrice: future.p, ...features });
      captured = true;
    }
    if (captured) seen.add(bucket);
  }
  return rows;
}

function confirmationPass(row, move, confirmation) {
  const direction = Math.sign(move), oneDirection = Math.sign(row.oneMove);
  if (confirmation === "any") return true;
  if (confirmation === "aligned") return direction !== 0 && oneDirection === direction;
  if (confirmation === "opposed") return direction !== 0 && oneDirection === -direction;
  return direction !== 0 && oneDirection === direction && Math.abs(row.oneMove) >= Math.abs(row.priorOneMove);
}

function simulate(row, rule) {
  if (row.horizon !== rule.horizon || row.volatility > rule.maxVol) return null;
  if (rule.category !== "All" && row.category !== rule.category) return null;
  const move = row.moves[rule.window];
  if (Math.abs(move) < rule.minMove || !confirmationPass(row, move, rule.confirmation)) return null;
  const followedSide = Math.sign(move) > 0 ? "YES" : "NO";
  const side = rule.direction === "continue" ? followedSide : followedSide === "YES" ? "NO" : "YES";
  const entry = side === "YES" ? row.price : 1 - row.price, exit = side === "YES" ? row.futurePrice : 1 - row.futurePrice;
  if (entry < MIN_ENTRY_PRICE || entry > MAX_ENTRY_PRICE) return null;
  const band = priceBand(entry);
  if (rule.band !== "All" && band !== rule.band) return null;
  const rawNetReturn = exit / entry - 1 - COST / entry;
  const netReturn = Math.max(-1, Math.min(2, rawNetReturn));
  return { marketId: row.marketId, eventKey: row.eventKey, observedAt: row.observedAt, evaluatedAt: row.evaluatedAt,
    category: row.category, band, side, entry, exit, netReturn };
}

function summary(rows) {
  if (!rows.length) return { attempts: 0, markets: 0, events: 0, mean: 0, eventMean: 0, lower: 0, upper: 0, winRate: 0 };
  const events = new Map();
  rows.forEach((row) => { const bucket = events.get(row.eventKey) || []; bucket.push(row.netReturn); events.set(row.eventKey, bucket); });
  const eventReturns = [...events.values()].map((values) => values.reduce((sum, value) => sum + value, 0) / values.length);
  const eventMean = eventReturns.reduce((sum, value) => sum + value, 0) / eventReturns.length;
  const variance = eventReturns.length > 1 ? eventReturns.reduce((sum, value) => sum + (value - eventMean) ** 2, 0) / (eventReturns.length - 1) : 0;
  const margin = 1.645 * Math.sqrt(variance / Math.max(1, eventReturns.length));
  return { attempts: rows.length, markets: new Set(rows.map((row) => row.marketId)).size, events: eventReturns.length,
    mean: rows.reduce((sum, row) => sum + row.netReturn, 0) / rows.length, eventMean, lower: eventMean - margin, upper: eventMean + margin,
    winRate: rows.filter((row) => row.netReturn > 0).length / rows.length };
}

const baseRules = [];
for (const horizon of HORIZONS) for (const window of WINDOWS) for (const minMove of MIN_MOVES)
  for (const direction of ["continue", "fade"]) for (const confirmation of CONFIRMATIONS) for (const maxVol of MAX_VOLS)
    baseRules.push({ id: `${direction}_h${horizon}_w${window}_m${minMove}_${confirmation}_v${maxVol}`,
      baseId: `${direction}_h${horizon}_w${window}_m${minMove}_${confirmation}_v${maxVol}`, horizon, window, minMove,
      direction, confirmation, maxVol, category: "All", band: "All" });

let markets, fetched;
if (CACHE_FILE && fs.existsSync(CACHE_FILE)) {
  const cached = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  if (Number(cached.activeSkip || 0) !== ACTIVE_SKIP) throw new Error(`Shock cache active-skip mismatch: expected ${ACTIVE_SKIP}`);
  markets = cached.markets || []; fetched = { history: cached.history || {}, failures: Number(cached.failures || 0) };
} else {
  markets = await fetchMarkets(MARKET_LIMIT); fetched = await fetchHistories(markets);
  if (CACHE_FILE) fs.writeFileSync(CACHE_FILE, JSON.stringify({ activeSkip: ACTIVE_SKIP, markets, history: fetched.history, failures: fetched.failures }));
}
const rows = markets.flatMap((market) => observations(market, fetched.history[market.token] || []));
const eventHoldoutRows = rows.filter((row) => stableHash(row.eventKey) % 4 === 0);
const developmentRows = rows.filter((row) => stableHash(row.eventKey) % 4 !== 0);
const timestamps = [...new Set(developmentRows.map((row) => row.observedAt))].sort((a, b) => a - b);
const trainCut = timestamps[Math.floor(timestamps.length * 0.6)] || 0, validationCut = timestamps[Math.floor(timestamps.length * 0.8)] || 0;
const partitions = { train: developmentRows.filter((row) => row.observedAt < trainCut && row.evaluatedAt < trainCut),
  validation: developmentRows.filter((row) => row.observedAt >= trainCut && row.evaluatedAt < validationCut),
  holdout: developmentRows.filter((row) => row.observedAt >= validationCut) };

const partitionByHorizon = Object.fromEntries(Object.entries(partitions).map(([name, partitionRows]) => [name,
  Object.fromEntries(HORIZONS.map((horizon) => [horizon, partitionRows.filter((row) => row.horizon === horizon)]))]));
const simulationCache = Object.fromEntries(Object.keys(partitions).map((name) => [name, new Map()]));
function simulatedRows(rule, partition) {
  const key = rule.baseId || rule.id;
  if (!simulationCache[partition].has(key)) {
    const baseRule = { ...rule, category: "All", band: "All" };
    simulationCache[partition].set(key, (partitionByHorizon[partition][rule.horizon] || []).map((row) => simulate(row, baseRule)).filter(Boolean));
  }
  return simulationCache[partition].get(key).filter((row) => (rule.category === "All" || row.category === rule.category)
    && (rule.band === "All" || row.band === rule.band));
}
function evaluate(rule, partition) { return summary(simulatedRows(rule, partition)); }

const trainWinners = baseRules.map((rule) => ({ rule, train: evaluate(rule, "train") }))
  .filter((candidate) => candidate.train.attempts >= 100 && candidate.train.events >= 20 && candidate.train.lower > 0);
const refinedRules = [];
for (const candidate of trainWinners) {
  for (const category of ["All", "Politics", "Sports", "Crypto", "Economy", "Pop Culture", "Other"])
    for (const band of ["All", "longshot", "lower-mid", "center", "upper-mid", "favorite"])
      refinedRules.push({ ...candidate.rule, id: `${candidate.rule.id}_${category}_${band}`, category, band });
}
const uniqueRefined = [...new Map(refinedRules.map((rule) => [rule.id, rule])).values()];
const validationWinners = uniqueRefined.map((rule) => ({ rule, train: evaluate(rule, "train"), validation: evaluate(rule, "validation") }))
  .filter((candidate) => candidate.train.attempts >= 80 && candidate.train.events >= 15 && candidate.train.lower > 0
    && candidate.validation.attempts >= 35 && candidate.validation.events >= 8 && candidate.validation.lower > 0);
const holdout = validationWinners.map((candidate) => ({ ...candidate, holdout: evaluate(candidate.rule, "holdout") }))
  .map((candidate) => ({ ...candidate, passesHoldout: candidate.holdout.attempts >= 35 && candidate.holdout.events >= 8 && candidate.holdout.lower > 0 }))
  .sort((a, b) => Number(b.passesHoldout) - Number(a.passesHoldout) || b.holdout.lower - a.holdout.lower);

const finalists = holdout.filter((candidate) => candidate.passesHoldout);
finalists.forEach((candidate) => {
  candidate.eventHoldout = summary(eventHoldoutRows.map((row) => simulate(row, candidate.rule)).filter(Boolean));
  candidate.passesEventHoldout = candidate.eventHoldout.attempts >= 35 && candidate.eventHoldout.events >= 8
    && candidate.eventHoldout.mean > 0 && candidate.eventHoldout.lower > 0;
});
let external = { markets: [], histories: {}, failures: 0, rows: [] };
if (finalists.length) {
  const activeEvents = new Set(markets.map((market) => market.eventKey));
  external.markets = (await fetchMarkets(EXTERNAL_MARKET_LIMIT, "closed")).filter((market) => !activeEvents.has(market.eventKey));
  const externalFetched = await fetchHistories(external.markets, { lookbackDays: null });
  external.histories = externalFetched.history;
  external.failures = externalFetched.failures;
  external.rows = external.markets.flatMap((market) => observations(market, external.histories[market.token] || []));
  finalists.forEach((candidate) => {
    candidate.archive = summary(external.rows.map((row) => simulate(row, candidate.rule)).filter(Boolean));
    candidate.passesArchive = candidate.archive.attempts >= 100 && candidate.archive.events >= 20
      && candidate.archive.mean > 0 && candidate.archive.lower > 0;
  });
}

const compact = (stats) => Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, Number.isFinite(value) ? +value.toFixed(5) : value]));
const exactStrategy3Rule = { id: "fade_h12_w3_m0.08_accelerating_v1_All_All", baseId: "fade_h12_w3_m0.08_accelerating_v1",
  horizon: 12, window: 3, minMove: 0.08, direction: "fade", confirmation: "accelerating", maxVol: 1, category: "All", band: "All" };
const exactStrategy3 = { rule: exactStrategy3Rule,
  train: compact(evaluate(exactStrategy3Rule, "train")), validation: compact(evaluate(exactStrategy3Rule, "validation")),
  holdout: compact(evaluate(exactStrategy3Rule, "holdout")),
  eventHoldout: compact(summary(eventHoldoutRows.map((row) => simulate(row, exactStrategy3Rule)).filter(Boolean))) };
const coverageDays = Object.values(fetched.history).map((points) => points.length > 1 ? (points.at(-1).t - points[0].t) / 86400 : 0).sort((a, b) => a - b);
const medianCoverageDays = coverageDays.length ? coverageDays[Math.floor(coverageDays.length / 2)] : 0;
const candidateRow = (candidate) => ({ rule: candidate.rule, passesHoldout: candidate.passesHoldout,
  passesEventHoldout: Boolean(candidate.passesEventHoldout), passesArchive: Boolean(candidate.passesArchive),
  train: compact(candidate.train), validation: compact(candidate.validation), holdout: compact(candidate.holdout),
  eventHoldout: candidate.eventHoldout ? compact(candidate.eventHoldout) : null, archive: candidate.archive ? compact(candidate.archive) : null });
const report = { generatedAt: new Date().toISOString(), requestedMarkets: MARKET_LIMIT, activeMarketsSkipped: ACTIVE_SKIP, markets: markets.length,
  marketsWithHistory: markets.filter((market) => fetched.history[market.token]?.length).length, fetchFailures: fetched.failures,
  medianHistoryCoverageDays: +medianCoverageDays.toFixed(2), maximumHistoryCoverageDays: +(coverageDays.at(-1) || 0).toFixed(2),
  observations: rows.length, testedBaseRules: baseRules.length, trainWinners: trainWinners.length, testedRefinements: uniqueRefined.length,
  validationWinners: validationWinners.length, holdoutPassed: holdout.filter((candidate) => candidate.passesHoldout).length,
  eventHoldoutObservations: eventHoldoutRows.length, eventHoldoutEvents: new Set(eventHoldoutRows.map((row) => row.eventKey)).size,
  eventHoldoutPassed: finalists.filter((candidate) => candidate.passesEventHoldout).length,
  externalRequestedMarkets: finalists.length ? EXTERNAL_MARKET_LIMIT : 0, externalMarkets: external.markets.length,
  externalMarketsWithHistory: external.markets.filter((market) => external.histories[market.token]?.length).length,
  externalFetchFailures: external.failures, externalObservations: external.rows.length,
  archivePassed: finalists.filter((candidate) => candidate.passesArchive).length,
  methodology: { requestedHistoryDays: HISTORY_DAYS, medianHistoryCoverageDays: +medianCoverageDays.toFixed(2),
    maximumHistoryCoverageDays: +(coverageDays.at(-1) || 0).toFixed(2), observationSpacingHours: 3, horizons: HORIZONS, windows: WINDOWS,
    costCents: COST * 100, entryPriceRange: [MIN_ENTRY_PRICE, MAX_ENTRY_PRICE], returnWinsorization: [-1, 2],
    eventSplit: "25% deterministic event-disjoint holdout reserved before search",
    split: "Remaining events use 60% train / 20% validation / 20% untouched chronological holdout with future-mark purge",
    clusterUnit: "Polymarket event", refinementSource: "Only base rules with a positive train lower bound are refined by category and entry band",
    limitation: "Current active-market selection is survivorship biased; any holdout winner still requires resolved-market external validation" },
  partitions: Object.fromEntries(Object.entries(partitions).map(([key, value]) => [key, value.length])), exactStrategy3,
  candidates: holdout.slice(0, 30).map(candidateRow) };

const output = SUMMARY_ONLY ? { generatedAt: report.generatedAt, activeMarketsSkipped: report.activeMarketsSkipped, markets: report.markets,
  marketsWithHistory: report.marketsWithHistory, fetchFailures: report.fetchFailures, observations: report.observations,
  medianHistoryCoverageDays: report.medianHistoryCoverageDays, maximumHistoryCoverageDays: report.maximumHistoryCoverageDays,
  testedBaseRules: report.testedBaseRules, trainWinners: report.trainWinners, testedRefinements: report.testedRefinements,
  validationWinners: report.validationWinners, holdoutPassed: report.holdoutPassed,
  eventHoldoutObservations: report.eventHoldoutObservations, eventHoldoutEvents: report.eventHoldoutEvents,
  eventHoldoutPassed: report.eventHoldoutPassed, externalRequestedMarkets: report.externalRequestedMarkets,
  externalMarkets: report.externalMarkets, externalMarketsWithHistory: report.externalMarketsWithHistory,
  externalFetchFailures: report.externalFetchFailures, externalObservations: report.externalObservations,
  archivePassed: report.archivePassed, partitions: report.partitions, exactStrategy3: report.exactStrategy3,
  candidates: report.candidates.slice(0, SUMMARY_CANDIDATES) } : report;
const serialized = JSON.stringify(output, null, 2);
if (OUTPUT_FILE) fs.writeFileSync(OUTPUT_FILE, serialized + "\n");
else console.log(serialized);
