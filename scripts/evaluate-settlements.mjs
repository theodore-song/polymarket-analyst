const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";
const MARKET_LIMIT = Math.max(20, Math.min(500, Number(process.env.SETTLEMENT_MARKETS || 200)));
const CONCURRENCY = Math.max(1, Math.min(12, Number(process.env.SETTLEMENT_CONCURRENCY || 6)));
const HORIZON_DAYS = [...new Set(String(process.env.SETTLEMENT_HORIZONS || "1,3,7,14,30,90").split(",")
  .map(Number).filter((value) => Number.isFinite(value) && value >= 1 && value <= 365))].sort((a, b) => a - b);
const COST_CENTS = Math.max(0, Math.min(5, Number(process.env.SETTLEMENT_COST_CENTS || 0.5)));
const DAY = 86400;

function parseJson(value) {
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value || "[]"); } catch { return []; }
}

function toTimestamp(value) {
  const parsed = Date.parse(String(value || "").replace(" ", "T").replace(/\+00$/, "Z"));
  return Number.isFinite(parsed) ? parsed / 1000 : null;
}

function categoryOf(raw) {
  const text = `${raw.category || ""} ${raw.question || ""} ${(raw.events || []).flatMap((event) => event.tags || [])
    .map((tag) => tag.slug || tag.label || "").join(" ")}`.toLowerCase();
  if (/\b(election|president|politic|senate|congress|parliament|minister|governor|government|nominee|primary)\b/.test(text)) return "Politics";
  if (/\b(bitcoin|crypto|ethereum|btc|eth|solana|xrp|token|stablecoin)\b/.test(text)) return "Crypto";
  if (/\b(nba|nfl|nhl|mlb|soccer|football|baseball|basketball|tennis|ufc|boxing|championship|match|game|tournament|league)\b/.test(text)) return "Sports";
  if (/\b(fed|inflation|gdp|recession|stock|company|economy|tariff|interest rate|unemployment|earnings)\b/.test(text)) return "Economy";
  if (/\b(movie|music|album|box office|television|celebrity|award|gaming|youtube|stream)\b/.test(text)) return "Pop Culture";
  return "Other";
}

async function fetchJson(url, options = {}, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(25000),
        headers: { accept: "application/json", ...(options.headers || {}) } });
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

function priceBand(price) {
  if (price < 0.25) return "longshot";
  if (price < 0.55) return "mid";
  if (price < 0.78) return "favorite";
  return "heavy-favorite";
}

function confirmedTrendAt(points, target, current) {
  const dayPoint = atOrBefore(points, target - DAY), weekPoint = atOrBefore(points, target - 7 * DAY);
  if (!dayPoint || !weekPoint || target - DAY - dayPoint.t > 36 * 3600 || target - 7 * DAY - weekPoint.t > 36 * 3600) return null;
  const dayMove = current.p - dayPoint.p, weekMove = current.p - weekPoint.p;
  const daySign = Math.sign(dayMove), weekSign = Math.sign(weekMove);
  const confirmed = daySign && daySign === weekSign && Math.abs(dayMove) >= 0.006 && Math.abs(weekMove) >= 0.012
    && Math.abs(dayMove) <= 0.08 && Math.abs(weekMove) <= 0.18;
  if (!confirmed) return null;
  return { side: daySign > 0 ? "YES" : "NO", dayMove, weekMove,
    strong: Math.abs(dayMove) >= 0.015 && Math.abs(weekMove) >= 0.03,
    moderate: Math.abs(dayMove) <= 0.03 && Math.abs(weekMove) <= 0.10 };
}

async function fetchResolvedMarkets(limit) {
  const raw = [], seen = new Set(), pageSize = 100;
  for (let offset = 0; raw.length < limit && offset < limit * 3; offset += pageSize) {
    const params = new URLSearchParams({ closed: "true", order: "volumeNum", ascending: "false",
      limit: String(pageSize), offset: String(offset) });
    const page = await fetchJson(`${GAMMA}/markets?${params}`);
    if (!Array.isArray(page) || !page.length) break;
    for (const market of page) {
      const id = String(market.id || ""), outcomes = parseJson(market.outcomePrices).map(Number);
      const tokens = parseJson(market.clobTokenIds), closedAt = toTimestamp(market.closedTime || market.endDate);
      const resolved = outcomes.length === 2 && outcomes.every(Number.isFinite)
        && ((outcomes[0] >= 0.99 && outcomes[1] <= 0.01) || (outcomes[1] >= 0.99 && outcomes[0] <= 0.01));
      if (!id || seen.has(id) || !resolved || tokens.length !== 2 || !closedAt) continue;
      seen.add(id); raw.push({ id, question: market.question || "", category: categoryOf(market),
        eventId: String(market.events?.[0]?.id || id),
        tokenId: String(tokens[0]), finalYes: outcomes[0] >= 0.99 ? 1 : 0, closedAt,
        volume: Number(market.volumeNum || market.volume || 0) });
      if (raw.length >= limit) break;
    }
    if (page.length < pageSize) break;
  }
  return raw;
}

function evaluateMarket(market, points) {
  const rows = [];
  for (const horizonDays of HORIZON_DAYS) {
    const target = market.closedAt - horizonDays * DAY, point = atOrBefore(points, target);
    const maximumStaleness = Math.max(36 * 3600, horizonDays * DAY * 0.15);
    if (!point || target - point.t > maximumStaleness || point.p <= 0.03 || point.p >= 0.97) continue;
    const yesEntry = point.p, noEntry = 1 - point.p, favoriteSide = yesEntry >= noEntry ? "YES" : "NO";
    const winningSide = market.finalYes ? "YES" : "NO", trend = confirmedTrendAt(points, target, point);
    for (const side of ["YES", "NO"]) {
      const entry = side === "YES" ? yesEntry : noEntry, final = side === winningSide ? 1 : 0;
      const netReturn = final / entry - 1 - (COST_CENTS / 100) / entry;
      rows.push({ marketId: market.id, eventId: market.eventId, question: market.question, category: market.category, closedAt: market.closedAt,
        horizonDays, side, favorite: side === favoriteSide, winner: side === winningSide,
        trend: Boolean(trend && trend.side === side), trendSide: trend?.side || null,
        dayMove: trend?.dayMove || 0, weekMove: trend?.weekMove || 0,
        strongTrend: Boolean(trend?.strong), moderateTrend: Boolean(trend?.moderate),
        entry, band: priceBand(entry), netReturn });
    }
  }
  return rows;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function summarize(rows) {
  if (!rows.length) return { count: 0, events: 0, mean: 0, median: 0, winRate: 0, lower90: 0, upper90: 0,
    eventMean: 0, eventLower90: 0, eventUpper90: 0, worst: 0, best: 0 };
  const values = rows.map((row) => row.netReturn), mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.length > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1) : 0;
  const margin90 = 1.645 * Math.sqrt(variance / values.length);
  const eventBuckets = new Map();
  rows.forEach((row) => {
    const bucket = eventBuckets.get(row.eventId) || [];
    bucket.push(row.netReturn); eventBuckets.set(row.eventId, bucket);
  });
  const eventReturns = [...eventBuckets.values()].map((bucket) => bucket.reduce((sum, value) => sum + value, 0) / bucket.length);
  const eventMean = eventReturns.reduce((sum, value) => sum + value, 0) / eventReturns.length;
  const eventVariance = eventReturns.length > 1
    ? eventReturns.reduce((sum, value) => sum + (value - eventMean) ** 2, 0) / (eventReturns.length - 1) : 0;
  const eventMargin90 = 1.645 * Math.sqrt(eventVariance / eventReturns.length);
  return { count: values.length, mean, median: median(values), winRate: rows.filter((row) => row.winner).length / rows.length,
    lower90: mean - margin90, upper90: mean + margin90, events: eventReturns.length,
    eventMean, eventLower90: eventMean - eventMargin90, eventUpper90: eventMean + eventMargin90,
    worst: Math.min(...values), best: Math.max(...values) };
}

const RULES = [
  { name: "buy_favorite", test: (row) => row.favorite },
  { name: "buy_heavy_favorite", test: (row) => row.favorite && row.entry >= 0.78 },
  { name: "buy_60_78_favorite", test: (row) => row.favorite && row.entry >= 0.60 && row.entry < 0.78 },
  { name: "buy_55_60_favorite", test: (row) => row.favorite && row.entry >= 0.55 && row.entry < 0.60 },
  { name: "buy_underdog", test: (row) => !row.favorite },
  { name: "buy_yes", test: (row) => row.side === "YES" },
  { name: "buy_no", test: (row) => row.side === "NO" },
  { name: "follow_trend", test: (row) => row.trend },
  { name: "follow_trend_yes", test: (row) => row.trend && row.side === "YES" },
  { name: "follow_trend_no", test: (row) => row.trend && row.side === "NO" },
  { name: "follow_trend_favorite", test: (row) => row.trend && row.favorite },
  { name: "follow_trend_underdog", test: (row) => row.trend && !row.favorite },
  { name: "follow_strong_trend", test: (row) => row.trend && row.strongTrend },
  { name: "follow_moderate_trend", test: (row) => row.trend && row.moderateTrend },
  ...["Politics", "Sports", "Crypto", "Economy", "Pop Culture", "Other"].flatMap((category) => [
    { name: `buy_favorite_${category.toLowerCase().replace(/\s+/g, "_")}`, test: (row) => row.favorite && row.category === category },
    { name: `buy_underdog_${category.toLowerCase().replace(/\s+/g, "_")}`, test: (row) => !row.favorite && row.category === category },
    { name: `follow_trend_${category.toLowerCase().replace(/\s+/g, "_")}`, test: (row) => row.trend && row.category === category },
  ]),
];

function evaluateRules(rows) {
  return Object.fromEntries(RULES.map((rule) => [rule.name, summarize(rows.filter(rule.test))]));
}

function chronologicalEvaluation(rows) {
  const ordered = [...rows].sort((a, b) => a.closedAt - b.closedAt);
  const splitTime = ordered[Math.floor(ordered.length * 0.70)]?.closedAt || 0;
  const cut1 = ordered[Math.floor(ordered.length / 3)]?.closedAt || 0;
  const cut2 = ordered[Math.floor(ordered.length * 2 / 3)]?.closedAt || 0;
  const train = ordered.filter((row) => row.closedAt < splitTime), test = ordered.filter((row) => row.closedAt >= splitTime);
  const thirds = [ordered.filter((row) => row.closedAt < cut1),
    ordered.filter((row) => row.closedAt >= cut1 && row.closedAt < cut2),
    ordered.filter((row) => row.closedAt >= cut2)];
  const pooled = evaluateRules(ordered), trainRules = evaluateRules(train), testRules = evaluateRules(test), thirdRules = thirds.map(evaluateRules);
  const robustRules = Object.fromEntries(RULES.map((rule) => {
    const segments = thirdRules.map((result) => result[rule.name]), all = pooled[rule.name];
    const enoughData = all.events >= 15 && segments.every((segment) => segment.count >= 15 && segment.events >= 5)
      && trainRules[rule.name].count >= 30 && trainRules[rule.name].events >= 10
      && testRules[rule.name].count >= 15 && testRules[rule.name].events >= 5;
    const allPositive = enoughData && all.eventLower90 > 0 && trainRules[rule.name].eventLower90 > 0
      && testRules[rule.name].eventLower90 > 0 && segments.every((segment) => segment.mean > 0 && segment.eventMean > 0);
    const allNegative = enoughData && all.eventUpper90 < 0 && trainRules[rule.name].eventUpper90 < 0
      && testRules[rule.name].eventUpper90 < 0 && segments.every((segment) => segment.mean < 0 && segment.eventMean < 0);
    return [rule.name, { enoughData, allPositive, allNegative, pooled: all, train: trainRules[rule.name], test: testRules[rule.name], segments }];
  }));
  return { splitTime: splitTime ? new Date(splitTime * 1000).toISOString() : null, trainCount: train.length,
    testCount: test.length, train: trainRules, test: testRules, thirds: thirdRules, robustRules };
}

const markets = await fetchResolvedMarkets(MARKET_LIMIT);
const histories = await mapLimit(markets, CONCURRENCY, async (market) => {
  const data = await fetchJson(`${CLOB}/prices-history?market=${encodeURIComponent(market.tokenId)}&interval=max&fidelity=1440`);
  const points = (data.history || []).map((point) => ({ t: Number(point.t), p: Number(point.p) }))
    .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.p)).sort((a, b) => a.t - b.t);
  return { market, points, rows: evaluateMarket(market, points) };
});
const successful = histories.filter((result) => result && !result.error && result.points.length);
const rows = successful.flatMap((result) => result.rows);
const report = {
  generatedAt: new Date().toISOString(), requestedMarkets: MARKET_LIMIT, resolvedMarkets: markets.length,
  marketsWithHistory: successful.length, failures: histories.filter((result) => result?.error).length,
  methodology: { horizonDays: HORIZON_DAYS, estimatedRoundTripCostCents: COST_CENTS,
    historyFidelityMinutes: 1440,
    clusterUnit: "event",
    note: "Each rule uses only daily prices available at or before the decision horizon and a subsequently published binary settlement. Trend replays require aligned one-day and one-week direction under the production move bounds. Confidence bounds cluster related markets by event. Markets are selected by resolved volume, so results still carry historical-selection and execution-model limitations." },
  horizons: Object.fromEntries(HORIZON_DAYS.map((horizon) => {
    const horizonRows = rows.filter((row) => row.horizonDays === horizon);
    return [horizon, { observations: horizonRows.length / 2, chronological: chronologicalEvaluation(horizonRows) }];
  })),
};
const compact = process.env.SETTLEMENT_SUMMARY === "1";
const compactStats = (stats = {}) => ({ count: stats.count || 0, events: stats.events || 0,
  mean: stats.mean || 0, eventMean: stats.eventMean || 0, eventLower90: stats.eventLower90 || 0,
  eventUpper90: stats.eventUpper90 || 0, winRate: stats.winRate || 0 });
const compactRules = (rules = {}) => Object.fromEntries(Object.entries(rules)
  .filter(([, result]) => result.enoughData && (result.allPositive || result.allNegative))
  .map(([name, result]) => [name, { direction: result.allPositive ? "positive" : "negative",
    pooled: compactStats(result.pooled), train: compactStats(result.train), test: compactStats(result.test) }]));
const summary = {
  generatedAt: report.generatedAt, requestedMarkets: report.requestedMarkets, resolvedMarkets: report.resolvedMarkets,
  marketsWithHistory: report.marketsWithHistory, failures: report.failures,
  horizons: Object.fromEntries(Object.entries(report.horizons).map(([days, value]) => [days, {
    observations: value.observations,
    favorite: compactStats(value.chronological.train.buy_favorite),
    favoriteTest: compactStats(value.chronological.test.buy_favorite),
    underdog: compactStats(value.chronological.train.buy_underdog),
    underdogTest: compactStats(value.chronological.test.buy_underdog),
    yes: compactStats(value.chronological.train.buy_yes),
    yesTest: compactStats(value.chronological.test.buy_yes),
    no: compactStats(value.chronological.train.buy_no),
    noTest: compactStats(value.chronological.test.buy_no),
    trend: compactStats(value.chronological.train.follow_trend),
    trendTest: compactStats(value.chronological.test.follow_trend),
    robustRules: compactRules(value.chronological.robustRules),
  }])),
};
console.log(JSON.stringify(compact ? summary : report, null, 2));
