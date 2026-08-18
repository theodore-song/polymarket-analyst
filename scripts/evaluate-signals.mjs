const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";
const MARKET_LIMIT = Math.max(10, Math.min(200, Number(process.env.EVAL_MARKETS || 80)));
const CONCURRENCY = Math.max(1, Math.min(12, Number(process.env.EVAL_CONCURRENCY || 6)));
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
    const future = atOrAfter(points, current.t + 12 * HOUR);
    if (!future || future.t - (current.t + 12 * HOUR) > 3 * HOUR) continue;
    const entry = signal.side === "YES" ? current.p : 1 - current.p;
    const exit = signal.side === "YES" ? future.p : 1 - future.p;
    const fadeEntry = signal.side === "YES" ? 1 - current.p : current.p;
    const fadeExit = signal.side === "YES" ? 1 - future.p : future.p;
    if (entry <= 0.02 || entry >= 0.98) continue;
    const grossReturn = exit / entry - 1;
    const netReturn = grossReturn - 0.005 / entry;
    const fadeNetReturn = fadeEntry > 0.02 && fadeEntry < 0.98 ? fadeExit / fadeEntry - 1 - 0.005 / fadeEntry : null;
    outcomes.push({ marketId: market.id, question: market.question, category: market.category,
      type: signal.type, side: signal.side, band: priceBand(entry), entry, exit,
      grossReturn, netReturn, fadeNetReturn, hourMove: signal.hourMove, dayMove: signal.dayMove, weekMove: signal.weekMove,
      observedAt: current.t, evaluatedAt: future.t });
    previousBucket = bucket;
  }
  return outcomes;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function summarize(rows, field = "netReturn") {
  if (!rows.length) return { count: 0, mean: 0, median: 0, winRate: 0, worst: 0, best: 0 };
  const returns = rows.map((row) => row[field]).filter(Number.isFinite);
  if (!returns.length) return { count: 0, mean: 0, median: 0, winRate: 0, worst: 0, best: 0 };
  return { count: rows.length,
    mean: returns.reduce((sum, value) => sum + value, 0) / returns.length,
    median: median(returns), winRate: returns.filter((value) => value > 0).length / returns.length,
    worst: Math.min(...returns), best: Math.max(...returns) };
}

function grouped(rows, key) {
  return Object.fromEntries([...new Set(rows.map((row) => row[key]))].sort().map((value) => [value, summarize(rows.filter((row) => row[key] === value))]));
}

const RULES = [
  { name: "follow_all", field: "netReturn", test: () => true },
  { name: "follow_trend", field: "netReturn", test: (row) => row.type === "trend" },
  { name: "follow_trend_no", field: "netReturn", test: (row) => row.type === "trend" && row.side === "NO" },
  { name: "follow_trend_favorites", field: "netReturn", test: (row) => row.type === "trend" && ["favorite", "heavy-favorite"].includes(row.band) },
  { name: "follow_strong_trend", field: "netReturn", test: (row) => row.type === "trend" && Math.abs(row.dayMove) >= 0.015 && Math.abs(row.weekMove) >= 0.03 },
  { name: "follow_reversal", field: "netReturn", test: (row) => row.type === "reversal" },
  { name: "fade_trend", field: "fadeNetReturn", test: (row) => row.type === "trend" },
  { name: "fade_trend_yes_move", field: "fadeNetReturn", test: (row) => row.type === "trend" && row.side === "YES" },
  { name: "fade_strong_trend", field: "fadeNetReturn", test: (row) => row.type === "trend" && Math.abs(row.dayMove) >= 0.015 && Math.abs(row.weekMove) >= 0.03 },
];

function evaluateRules(rows) {
  return Object.fromEntries(RULES.map((rule) => [rule.name, summarize(rows.filter(rule.test), rule.field)]));
}

const params = new URLSearchParams({ active: "true", closed: "false", archived: "false", include_tag: "true",
  limit: String(MARKET_LIMIT), order: "volume24hr", ascending: "false" });
const rawMarkets = await fetchJson(`${GAMMA}/markets?${params}`);
const markets = rawMarkets.map((raw) => ({ id: String(raw.id), question: raw.question || "", category: categoryOf(raw),
  tokenId: String(parseJson(raw.clobTokenIds)[0] || "") })).filter((market) => market.id && market.tokenId);
const histories = await mapLimit(markets, CONCURRENCY, async (market) => {
  const data = await fetchJson(`${CLOB}/prices-history?market=${encodeURIComponent(market.tokenId)}&interval=1m&fidelity=60`);
  const points = (data.history || []).map((point) => ({ t: Number(point.t), p: Number(point.p) }))
    .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.p)).sort((a, b) => a.t - b.t);
  return { market, points, outcomes: evaluateMarket(market, points) };
});
const successful = histories.filter((result) => result && !result.error && result.points.length);
const outcomes = successful.flatMap((result) => result.outcomes);
const ordered = [...outcomes].sort((a, b) => a.observedAt - b.observedAt);
const splitTime = ordered[Math.floor(ordered.length * 0.70)]?.observedAt || 0;
const train = ordered.filter((row) => row.observedAt < splitTime), test = ordered.filter((row) => row.observedAt >= splitTime);
const report = {
  generatedAt: new Date().toISOString(), marketLimit: MARKET_LIMIT, marketsWithHistory: successful.length,
  methodology: { horizonHours: 12, observationBucketHours: 6, historyInterval: "1m", fidelityMinutes: 60,
    estimatedRoundTripCostCents: 0.5, note: "Current active-market selection and current category tags are a survivorship-biased proxy; signal inputs and future marks are time-ordered without lookahead." },
  overall: summarize(outcomes), byType: grouped(outcomes, "type"), byCategory: grouped(outcomes, "category"),
  byBand: grouped(outcomes, "band"), bySide: grouped(outcomes, "side"),
  chronologicalSplit: { splitTime: splitTime ? new Date(splitTime * 1000).toISOString() : null,
    trainCount: train.length, testCount: test.length, train: evaluateRules(train), test: evaluateRules(test) },
  failures: histories.filter((result) => result?.error).length,
};
console.log(JSON.stringify(report, null, 2));
