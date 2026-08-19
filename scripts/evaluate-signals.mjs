const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";
const MARKET_LIMIT = Math.max(10, Math.min(500, Number(process.env.EVAL_MARKETS || 80)));
const CONCURRENCY = Math.max(1, Math.min(12, Number(process.env.EVAL_CONCURRENCY || 6)));
const HORIZONS = [...new Set(String(process.env.EVAL_HORIZONS || "6,12,24,72").split(",")
  .map(Number).filter((value) => Number.isFinite(value) && value >= 1 && value <= 168))].sort((a, b) => a - b);
const COST_CENTS = Math.max(0, Math.min(5, Number(process.env.EVAL_COST_CENTS || 0.5)));
const HOUR = 3600;

const CATEGORY_RULES = [
  ["Politics", ["politics", "election", "elections", "us-politics", "geopolitics", "trump", "government", "congress", "policy", "democrats", "republicans"]],
  ["Crypto", ["crypto", "bitcoin", "ethereum", "btc", "eth", "solana", "defi", "stablecoin", "xrp"]],
  ["Sports", ["sports", "soccer", "football", "nba", "nfl", "mlb", "nhl", "tennis", "basketball", "baseball", "ufc", "boxing", "golf", "f1"]],
  ["Economy", ["economy", "business", "fed", "inflation", "interest-rates", "gdp", "jobs", "recession", "stocks", "earnings", "tariffs"]],
  ["Pop Culture", ["pop-culture", "entertainment", "movies", "music", "tv", "awards", "celebrity", "gaming", "ai"]],
];

function parseJson(value) {
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value || "[]"); } catch { return []; }
}

function categoryOf(raw) {
  const tags = (Array.isArray(raw.tags) ? raw.tags : []).map((tag) => String(tag.slug || tag.label || "").toLowerCase());
  return CATEGORY_RULES.find(([, keys]) => tags.some((tag) => keys.includes(tag)))?.[0] || "Other";
}

async function fetchJson(url, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { accept: "application/json" } });
      if (response.ok) return response.json();
      lastError = new Error(`${response.status} ${response.statusText}`);
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
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

function signalAt(points, index) {
  const current = points[index], hour = atOrBefore(points, current.t - HOUR);
  const day = atOrBefore(points, current.t - 24 * HOUR), week = atOrBefore(points, current.t - 7 * 24 * HOUR);
  if (!hour || !day || !week || current.t - week.t > 8 * 24 * HOUR) return null;
  const hourMove = current.p - hour.p, dayMove = current.p - day.p, weekMove = current.p - week.p;
  const daySign = Math.sign(dayMove), weekSign = Math.sign(weekMove), hourSign = Math.sign(hourMove);
  const trend = daySign && daySign === weekSign && Math.abs(dayMove) >= 0.006 && Math.abs(weekMove) >= 0.012
    && Math.abs(dayMove) <= 0.08 && Math.abs(weekMove) <= 0.18
    && (!hourSign || hourSign === daySign || Math.abs(hourMove) < 0.008);
  const reversal = daySign && Math.abs(dayMove) >= 0.04 && Math.abs(dayMove) <= 0.18
    && hourSign === -daySign && Math.abs(hourMove) >= 0.004
    && (!weekSign || weekSign !== daySign || Math.abs(weekMove) < Math.abs(dayMove) * 1.6);
  if (!trend && !reversal) return null;
  const sign = reversal ? -daySign : daySign;
  return { type: reversal ? "reversal" : "trend", side: sign > 0 ? "YES" : "NO", hourMove, dayMove, weekMove };
}

function priceBand(price) {
  if (price < 0.25) return "longshot";
  if (price < 0.55) return "mid";
  if (price < 0.78) return "favorite";
  return "heavy-favorite";
}

function evaluateMarket(market, points) {
  const outcomes = [];
  let previousBucket = null;
  for (let index = 0; index < points.length; index++) {
    const current = points[index], bucket = Math.floor(current.t / (6 * HOUR));
    if (bucket === previousBucket || current.p < 0.08 || current.p > 0.92) continue;
    const signal = signalAt(points, index);
    if (!signal) continue;
    const entry = signal.side === "YES" ? current.p : 1 - current.p;
    const fadeEntry = signal.side === "YES" ? 1 - current.p : current.p;
    if (entry <= 0.02 || entry >= 0.98) continue;
    let captured = false;
    for (const horizonHours of HORIZONS) {
      const future = atOrAfter(points, current.t + horizonHours * HOUR);
      if (!future || future.t - (current.t + horizonHours * HOUR) > 3 * HOUR) continue;
      const exit = signal.side === "YES" ? future.p : 1 - future.p;
      const fadeExit = signal.side === "YES" ? 1 - future.p : future.p;
      const grossReturn = exit / entry - 1;
      const netReturn = grossReturn - (COST_CENTS / 100) / entry;
      const fadeNetReturn = fadeEntry > 0.02 && fadeEntry < 0.98
        ? fadeExit / fadeEntry - 1 - (COST_CENTS / 100) / fadeEntry : null;
      outcomes.push({ marketId: market.id, eventKey: market.eventKey, question: market.question, category: market.category,
        type: signal.type, side: signal.side, band: priceBand(entry), entry, exit, horizonHours,
        grossReturn, netReturn, fadeNetReturn, hourMove: signal.hourMove, dayMove: signal.dayMove, weekMove: signal.weekMove,
        observedAt: current.t, evaluatedAt: future.t });
      captured = true;
    }
    if (captured) previousBucket = bucket;
  }
  return outcomes;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function summarize(rows, field = "netReturn") {
  if (!rows.length) return { count: 0, markets: 0, events: 0, mean: 0, median: 0, winRate: 0, worst: 0, best: 0, marketMean: 0, lower90: 0, upper90: 0 };
  const returns = rows.map((row) => row[field]).filter(Number.isFinite);
  if (!returns.length) return { count: 0, markets: 0, events: 0, mean: 0, median: 0, winRate: 0, worst: 0, best: 0, marketMean: 0, lower90: 0, upper90: 0 };
  const eventBuckets = new Map();
  rows.forEach((row) => {
    const value = row[field];
    if (!Number.isFinite(value)) return;
    const key = row.eventKey || row.marketId;
    const bucket = eventBuckets.get(key) || [];
    bucket.push(value); eventBuckets.set(key, bucket);
  });
  const marketReturns = [...eventBuckets.values()].map((values) => values.reduce((sum, value) => sum + value, 0) / values.length);
  const marketMean = marketReturns.reduce((sum, value) => sum + value, 0) / Math.max(1, marketReturns.length);
  const variance = marketReturns.length > 1
    ? marketReturns.reduce((sum, value) => sum + (value - marketMean) ** 2, 0) / (marketReturns.length - 1) : 0;
  const margin90 = 1.645 * Math.sqrt(variance / Math.max(1, marketReturns.length));
  return { count: returns.length,
    mean: returns.reduce((sum, value) => sum + value, 0) / returns.length,
    median: median(returns), winRate: returns.filter((value) => value > 0).length / returns.length,
    worst: Math.min(...returns), best: Math.max(...returns), markets: new Set(rows.map((row) => row.marketId)).size, events: marketReturns.length,
    marketMean, lower90: marketMean - margin90, upper90: marketMean + margin90 };
}

function grouped(rows, key) {
  return Object.fromEntries([...new Set(rows.map((row) => row[key]))].sort().map((value) => [value, summarize(rows.filter((row) => row[key] === value))]));
}

const RULES = [
  { name: "follow_all", field: "netReturn", test: () => true },
  { name: "follow_trend", field: "netReturn", test: (row) => row.type === "trend" },
  { name: "follow_trend_no", field: "netReturn", test: (row) => row.type === "trend" && row.side === "NO" },
  { name: "follow_trend_yes", field: "netReturn", test: (row) => row.type === "trend" && row.side === "YES" },
  { name: "follow_trend_mid", field: "netReturn", test: (row) => row.type === "trend" && row.band === "mid" },
  { name: "follow_trend_favorites", field: "netReturn", test: (row) => row.type === "trend" && ["favorite", "heavy-favorite"].includes(row.band) },
  { name: "follow_trend_non_longshot", field: "netReturn", test: (row) => row.type === "trend" && row.band !== "longshot" },
  { name: "follow_strong_trend", field: "netReturn", test: (row) => row.type === "trend" && Math.abs(row.dayMove) >= 0.015 && Math.abs(row.weekMove) >= 0.03 },
  { name: "follow_moderate_trend", field: "netReturn", test: (row) => row.type === "trend" && Math.abs(row.dayMove) <= 0.03 && Math.abs(row.weekMove) <= 0.10 },
  { name: "follow_hour_confirmed_trend", field: "netReturn", test: (row) => row.type === "trend" && Math.sign(row.hourMove) === Math.sign(row.dayMove) },
  ...["Politics", "Sports", "Crypto", "Economy", "Pop Culture", "Other"].map((category) => ({
    name: `follow_trend_${category.toLowerCase().replace(/\s+/g, "_")}`, field: "netReturn",
    test: (row) => row.type === "trend" && row.category === category,
  })),
  { name: "follow_reversal", field: "netReturn", test: (row) => row.type === "reversal" },
  { name: "fade_trend", field: "fadeNetReturn", test: (row) => row.type === "trend" },
  { name: "fade_trend_yes_move", field: "fadeNetReturn", test: (row) => row.type === "trend" && row.side === "YES" },
  { name: "fade_trend_no_move", field: "fadeNetReturn", test: (row) => row.type === "trend" && row.side === "NO" },
  { name: "fade_trend_mid", field: "fadeNetReturn", test: (row) => row.type === "trend" && row.band === "mid" },
  { name: "fade_trend_favorites", field: "fadeNetReturn", test: (row) => row.type === "trend" && ["favorite", "heavy-favorite"].includes(row.band) },
  { name: "fade_trend_longshots", field: "fadeNetReturn", test: (row) => row.type === "trend" && row.band === "longshot" },
  { name: "fade_strong_trend", field: "fadeNetReturn", test: (row) => row.type === "trend" && Math.abs(row.dayMove) >= 0.015 && Math.abs(row.weekMove) >= 0.03 },
  { name: "fade_moderate_trend", field: "fadeNetReturn", test: (row) => row.type === "trend" && Math.abs(row.dayMove) <= 0.03 && Math.abs(row.weekMove) <= 0.10 },
  ...["Politics", "Sports", "Crypto", "Economy", "Pop Culture", "Other"].map((category) => ({
    name: `fade_trend_${category.toLowerCase().replace(/\s+/g, "_")}`, field: "fadeNetReturn",
    test: (row) => row.type === "trend" && row.category === category,
  })),
];

const COMBINATION_CATEGORIES = ["Politics", "Sports", "Crypto", "Economy", "Pop Culture", "Other"];
const COMBINATION_BANDS = ["longshot", "mid", "favorite", "heavy-favorite"];
for (const category of COMBINATION_CATEGORIES) {
  const slug = category.toLowerCase().replace(/\s+/g, "_");
  for (const side of ["YES", "NO"]) {
    RULES.push({ name: `follow_trend_${slug}_${side.toLowerCase()}`, field: "netReturn",
      test: (row) => row.type === "trend" && row.category === category && row.side === side });
    RULES.push({ name: `follow_reversal_${slug}_${side.toLowerCase()}`, field: "netReturn",
      test: (row) => row.type === "reversal" && row.category === category && row.side === side });
    for (const band of COMBINATION_BANDS) {
      RULES.push({ name: `follow_trend_${slug}_${side.toLowerCase()}_${band.replace("-", "_")}`, field: "netReturn",
        test: (row) => row.type === "trend" && row.category === category && row.side === side && row.band === band });
    }
  }
}
for (const side of ["YES", "NO"]) {
  for (const band of COMBINATION_BANDS) {
    RULES.push({ name: `follow_trend_${side.toLowerCase()}_${band.replace("-", "_")}`, field: "netReturn",
      test: (row) => row.type === "trend" && row.side === side && row.band === band });
    RULES.push({ name: `follow_reversal_${side.toLowerCase()}_${band.replace("-", "_")}`, field: "netReturn",
      test: (row) => row.type === "reversal" && row.side === side && row.band === band });
  }
}
RULES.push(
  { name: "follow_strong_trend_yes", field: "netReturn", test: (row) => row.type === "trend" && row.side === "YES" && Math.abs(row.dayMove) >= 0.015 && Math.abs(row.weekMove) >= 0.03 },
  { name: "follow_strong_trend_no", field: "netReturn", test: (row) => row.type === "trend" && row.side === "NO" && Math.abs(row.dayMove) >= 0.015 && Math.abs(row.weekMove) >= 0.03 },
  { name: "follow_hour_confirmed_trend_yes", field: "netReturn", test: (row) => row.type === "trend" && row.side === "YES" && Math.sign(row.hourMove) === Math.sign(row.dayMove) },
  { name: "follow_hour_confirmed_trend_no", field: "netReturn", test: (row) => row.type === "trend" && row.side === "NO" && Math.sign(row.hourMove) === Math.sign(row.dayMove) },
);

function evaluateRules(rows) {
  return Object.fromEntries(RULES.map((rule) => [rule.name, summarize(rows.filter(rule.test), rule.field)]));
}

function chronologicalEvaluation(rows) {
  const ordered = [...rows].sort((a, b) => a.observedAt - b.observedAt);
  const splitTime = ordered[Math.floor(ordered.length * 0.70)]?.observedAt || 0;
  const train = ordered.filter((row) => row.observedAt < splitTime), test = ordered.filter((row) => row.observedAt >= splitTime);
  const cut1 = ordered[Math.floor(ordered.length / 3)]?.observedAt || 0;
  const cut2 = ordered[Math.floor(ordered.length * 2 / 3)]?.observedAt || 0;
  const thirds = [ordered.filter((row) => row.observedAt < cut1),
    ordered.filter((row) => row.observedAt >= cut1 && row.observedAt < cut2),
    ordered.filter((row) => row.observedAt >= cut2)];
  const thirdRules = thirds.map(evaluateRules), pooled = evaluateRules(ordered);
  const trainRules = evaluateRules(train), testRules = evaluateRules(test);
  const robustRules = Object.fromEntries(RULES.map((rule) => {
    const segments = thirdRules.map((result) => result[rule.name]);
    const trainStats = trainRules[rule.name], testStats = testRules[rule.name], pooledStats = pooled[rule.name];
    const enoughData = segments.every((segment) => segment.count >= 20 && segment.events >= 5);
    const trainTestPositive = trainStats.count >= 40 && testStats.count >= 20
      && trainStats.mean > 0 && trainStats.marketMean > 0 && testStats.mean > 0 && testStats.marketMean > 0;
    const trainTestNegative = trainStats.count >= 40 && testStats.count >= 20
      && trainStats.mean < 0 && trainStats.marketMean < 0 && testStats.mean < 0 && testStats.marketMean < 0;
    const allPositive = enoughData && trainTestPositive && pooledStats.lower90 > 0
      && segments.every((segment) => segment.mean > 0 && segment.marketMean > 0);
    const allNegative = enoughData && trainTestNegative && pooledStats.upper90 < 0
      && segments.every((segment) => segment.mean < 0 && segment.marketMean < 0);
    return [rule.name, { enoughData, allPositive, allNegative,
      minimumSegmentMean: Math.min(...segments.map((segment) => segment.mean)),
      maximumSegmentMean: Math.max(...segments.map((segment) => segment.mean)), pooled: pooledStats }];
  }));
  return { splitTime: splitTime ? new Date(splitTime * 1000).toISOString() : null,
    trainCount: train.length, testCount: test.length, train: trainRules, test: testRules,
    thirds: thirdRules, robustRules };
}

async function fetchActiveMarkets(limit) {
  const markets = [], seen = new Set(), pageSize = 100;
  for (let offset = 0; markets.length < limit && offset < limit * 4; offset += pageSize) {
    const params = new URLSearchParams({ active: "true", closed: "false", archived: "false", include_tag: "true",
      limit: String(pageSize), offset: String(offset), order: "volume24hr", ascending: "false" });
    const page = await fetchJson(`${GAMMA}/markets?${params}`);
    if (!Array.isArray(page) || !page.length) break;
    for (const market of page) {
      const id = String(market.id || ""), labels = parseJson(market.outcomes).map((outcome) => String(outcome).trim().toLowerCase());
      if (!id || seen.has(id) || labels[0] !== "yes" || labels[1] !== "no") continue;
      seen.add(id); markets.push(market);
      if (markets.length >= limit) break;
    }
    if (page.length < pageSize) break;
  }
  return markets.slice(0, limit);
}

const rawMarkets = await fetchActiveMarkets(MARKET_LIMIT);
const markets = rawMarkets.map((raw) => ({ id: String(raw.id), question: raw.question || "", category: categoryOf(raw),
  binaryLabels: parseJson(raw.outcomes).map((outcome) => String(outcome).trim().toLowerCase()),
  eventKey: String(raw.events?.[0]?.id || raw.events?.[0]?.slug || raw.eventId || raw.id),
  tokenId: String(parseJson(raw.clobTokenIds)[0] || "") })).filter((market) => market.id && market.tokenId
    && market.binaryLabels[0] === "yes" && market.binaryLabels[1] === "no");
const histories = await mapLimit(markets, CONCURRENCY, async (market) => {
  const data = await fetchJson(`${CLOB}/prices-history?market=${encodeURIComponent(market.tokenId)}&interval=1m&fidelity=60`);
  const points = (data.history || []).map((point) => ({ t: Number(point.t), p: Number(point.p) }))
    .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.p)).sort((a, b) => a.t - b.t);
  return { market, points, outcomes: evaluateMarket(market, points) };
});
const successful = histories.filter((result) => result && !result.error && result.points.length);
const outcomes = successful.flatMap((result) => result.outcomes);
const primaryHorizon = HORIZONS.includes(12) ? 12 : HORIZONS[0];
const primaryOutcomes = outcomes.filter((row) => row.horizonHours === primaryHorizon);
const report = {
  generatedAt: new Date().toISOString(), marketLimit: MARKET_LIMIT, marketsWithHistory: successful.length,
  methodology: { horizonHours: HORIZONS, primaryHorizon, observationBucketHours: 6, historyInterval: "1m", fidelityMinutes: 60,
    estimatedRoundTripCostCents: COST_CENTS, clusterUnit: "event",
    note: "Current active-market selection and current category tags are a survivorship-biased proxy; signal inputs and future marks are time-ordered without lookahead. Confidence intervals cluster correlated markets by Polymarket event." },
  overall: summarize(primaryOutcomes), byType: grouped(primaryOutcomes, "type"), byCategory: grouped(primaryOutcomes, "category"),
  byBand: grouped(primaryOutcomes, "band"), bySide: grouped(primaryOutcomes, "side"),
  chronologicalSplit: chronologicalEvaluation(primaryOutcomes),
  horizons: Object.fromEntries(HORIZONS.map((horizon) => {
    const rows = outcomes.filter((row) => row.horizonHours === horizon);
    return [horizon, { overall: summarize(rows), chronological: chronologicalEvaluation(rows) }];
  })),
  failures: histories.filter((result) => result?.error).length,
};
const compact = process.env.EVAL_SUMMARY === "1";
const compactStats = (stats = {}) => ({ count: stats.count || 0, markets: stats.markets || 0, events: stats.events || 0,
  mean: stats.mean || 0, marketMean: stats.marketMean || 0, lower90: stats.lower90 || 0, upper90: stats.upper90 || 0,
  winRate: stats.winRate || 0 });
const compactRules = (rules = {}) => Object.fromEntries(Object.entries(rules)
  .filter(([, result]) => result.enoughData && (result.allPositive || result.allNegative))
  .map(([name, result]) => [name, { direction: result.allPositive ? "positive" : "negative",
    minimumSegmentMean: result.minimumSegmentMean, maximumSegmentMean: result.maximumSegmentMean,
    pooled: compactStats(result.pooled) }]));
const summary = {
  generatedAt: report.generatedAt, marketLimit: report.marketLimit, marketsWithHistory: report.marketsWithHistory,
  primaryHorizon: report.methodology.primaryHorizon, failures: report.failures,
  overall: compactStats(report.overall),
  byType: Object.fromEntries(Object.entries(report.byType).map(([key, value]) => [key, compactStats(value)])),
  byCategory: Object.fromEntries(Object.entries(report.byCategory).map(([key, value]) => [key, compactStats(value)])),
  byBand: Object.fromEntries(Object.entries(report.byBand).map(([key, value]) => [key, compactStats(value)])),
  bySide: Object.fromEntries(Object.entries(report.bySide).map(([key, value]) => [key, compactStats(value)])),
  train: compactStats(report.chronologicalSplit.train.follow_all),
  test: compactStats(report.chronologicalSplit.test.follow_all),
  robustRules: compactRules(report.chronologicalSplit.robustRules),
  horizons: Object.fromEntries(Object.entries(report.horizons).map(([hours, value]) => [hours, {
    overall: compactStats(value.overall), robustRules: compactRules(value.chronological.robustRules),
  }])),
};
console.log(JSON.stringify(compact ? summary : report, null, 2));
