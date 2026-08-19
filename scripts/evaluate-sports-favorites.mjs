const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";
const MARKET_LIMIT = Math.max(500, Math.min(5000, Number(process.env.SPORTS_FAVORITE_MARKETS || 3000)));
const CONCURRENCY = Math.max(1, Math.min(12, Number(process.env.SPORTS_FAVORITE_CONCURRENCY || 10)));
const COST = Math.max(0, Math.min(0.10, Number(process.env.SPORTS_FAVORITE_COST_CENTS || 5) / 100));
const MAX_STALENESS_HOURS = Math.max(1, Math.min(12, Number(process.env.SPORTS_FAVORITE_MAX_STALENESS_HOURS || 3)));
const HOUR = 3600;

function parseJson(value) {
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value || "[]"); } catch { return []; }
}

function timestamp(value) {
  const parsed = Date.parse(String(value || "").replace(" ", "T").replace(/\+00$/, "Z"));
  return Number.isFinite(parsed) ? parsed / 1000 : null;
}

async function fetchJson(url, attempts = 4) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { accept: "application/json" } });
      if (response.ok) return response.json();
      lastError = new Error(`${response.status} ${response.statusText}`);
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
  }
  throw lastError || new Error("request failed");
}

async function mapLimit(items, limit, task) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      try { output[index] = await task(items[index]); }
      catch (error) { output[index] = { error: error.message }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

function sportsMarket(raw) {
  const tags = [...(raw.tags || []), ...(raw.events || []).flatMap((event) => event.tags || [])]
    .map((tag) => `${tag.slug || ""} ${tag.label || ""}`).join(" ");
  const text = `${raw.question || ""} ${raw.sportsMarketType || ""} ${tags}`.toLowerCase();
  return /\b(sports?|soccer|football|basketball|baseball|tennis|hockey|cricket|golf|boxing|ufc|nba|nfl|nhl|mlb|fifa|epl|match|game|tournament)\b/.test(text);
}

function gameStart(raw) {
  const event = raw.events?.[0] || {};
  return timestamp(raw.gameStartTime || raw.eventStartTime || event.startTime || event.eventDate);
}

async function fetchMarkets(limit) {
  const markets = [], seen = new Set();
  let cursor = "";
  while (markets.length < limit) {
    const params = new URLSearchParams({ closed: "true", order: "closedTime", ascending: "false", limit: "100", include_tag: "true" });
    if (cursor) params.set("after_cursor", cursor);
    const payload = await fetchJson(`${GAMMA}/markets/keyset?${params}`), page = payload?.markets;
    if (!Array.isArray(page) || !page.length) break;
    for (const raw of page) {
      const id = String(raw.id || ""), labels = parseJson(raw.outcomes).map((value) => String(value).trim().toLowerCase());
      const outcomes = parseJson(raw.outcomePrices).map(Number), tokens = parseJson(raw.clobTokenIds).map(String);
      const finalYes = outcomes[0] >= 0.99 && outcomes[1] <= 0.01 ? 1 : outcomes[1] >= 0.99 && outcomes[0] <= 0.01 ? 0 : null;
      const startsAt = gameStart(raw), closedAt = timestamp(raw.closedTime || raw.endDate);
      if (!id || seen.has(id) || labels[0] !== "yes" || labels[1] !== "no" || tokens.length !== 2 || finalYes == null
        || !startsAt || !closedAt || !sportsMarket(raw)) continue;
      seen.add(id);
      markets.push({ id, question: raw.question || "", eventKey: String(raw.events?.[0]?.id || id), event: raw.events?.[0]?.title || "",
        tokenId: tokens[0], finalYes, startsAt, closedAt, marketType: String(raw.sportsMarketType || "unknown") });
      if (markets.length >= limit) break;
    }
    if (page.length < 100 || !payload.next_cursor || payload.next_cursor === cursor) break;
    cursor = payload.next_cursor;
  }
  return markets;
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

function observation(market, points, leadHours) {
  const target = market.startsAt - leadHours * HOUR, point = atOrBefore(points, target);
  if (!point || target - point.t > MAX_STALENESS_HOURS * HOUR || point.p <= 0.03 || point.p >= 0.97) return null;
  const side = point.p >= 0.5 ? "YES" : "NO", entry = side === "YES" ? point.p : 1 - point.p;
  const won = side === (market.finalYes ? "YES" : "NO"), netReturn = (won ? 1 : 0) / entry - 1 - COST / entry;
  return { marketId: market.id, eventKey: market.eventKey, question: market.question, event: market.event,
    marketType: market.marketType, startsAt: market.startsAt, closedAt: market.closedAt, leadHours, side, entry, won, netReturn };
}

function summarize(rows) {
  if (!rows.length) return { trades: 0, events: 0, mean: 0, eventMean: 0, lower: 0, upper: 0, winRate: 0 };
  const events = new Map();
  rows.forEach((row) => { const bucket = events.get(row.eventKey) || []; bucket.push(row.netReturn); events.set(row.eventKey, bucket); });
  const eventReturns = [...events.values()].map((values) => values.reduce((sum, value) => sum + value, 0) / values.length);
  const eventMean = eventReturns.reduce((sum, value) => sum + value, 0) / eventReturns.length;
  const variance = eventReturns.length > 1 ? eventReturns.reduce((sum, value) => sum + (value - eventMean) ** 2, 0) / (eventReturns.length - 1) : 0;
  const margin = 1.645 * Math.sqrt(variance / Math.max(1, eventReturns.length));
  return { trades: rows.length, events: eventReturns.length, mean: rows.reduce((sum, row) => sum + row.netReturn, 0) / rows.length,
    eventMean, lower: eventMean - margin, upper: eventMean + margin, winRate: rows.filter((row) => row.won).length / rows.length };
}

const rules = [];
for (const leadHours of [12, 18, 24, 30, 36]) {
  for (const minEntry of [0.55, 0.60, 0.65, 0.70]) {
    for (const maxEntry of [0.75, 0.85, 0.95]) {
      if (minEntry >= maxEntry) continue;
      rules.push({ id: `lead${leadHours}_${minEntry}-${maxEntry}`, leadHours, minEntry, maxEntry });
    }
  }
}

const markets = await fetchMarkets(MARKET_LIMIT);
const histories = await mapLimit(markets, CONCURRENCY, async (market) => {
  const data = await fetchJson(`${CLOB}/prices-history?market=${encodeURIComponent(market.tokenId)}&interval=max&fidelity=60`);
  const points = (data.history || []).map((point) => ({ t: Number(point.t), p: Number(point.p) }))
    .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.p)).sort((a, b) => a.t - b.t);
  return { market, points };
});
const usable = histories.filter((row) => row && !row.error && row.points.length);
const times = usable.map((row) => row.market.startsAt).sort((a, b) => a - b);
const trainCut = times[Math.floor(times.length * 0.6)] || 0, validationCut = times[Math.floor(times.length * 0.8)] || 0;
const partitions = {
  train: usable.filter((row) => row.market.startsAt < trainCut),
  validation: usable.filter((row) => row.market.startsAt >= trainCut && row.market.startsAt < validationCut),
  holdout: usable.filter((row) => row.market.startsAt >= validationCut),
};

function tradesFor(partition, rule) {
  const eligible = partition.map(({ market, points }) => observation(market, points, rule.leadHours)).filter(Boolean)
    .filter((row) => row.entry >= rule.minEntry && row.entry < rule.maxEntry);
  const events = new Map();
  eligible.forEach((row) => {
    const rows = events.get(row.eventKey) || [];
    rows.push(row);events.set(row.eventKey, rows);
  });
  return [...events.values()].flatMap((rows) => rows.sort((a, b) => b.entry - a.entry || a.marketId.localeCompare(b.marketId)).slice(0, 4));
}

const evaluated = rules.map((rule) => {
  const trainRows = tradesFor(partitions.train, rule), validationRows = tradesFor(partitions.validation, rule), holdoutRows = tradesFor(partitions.holdout, rule);
  const train = summarize(trainRows), validation = summarize(validationRows), holdout = summarize(holdoutRows);
  const trainPassed = train.trades >= 60 && train.events >= 25 && train.lower > 0;
  const validationPassed = trainPassed && validation.trades >= 25 && validation.events >= 10 && validation.lower > 0;
  const passesHoldout = validationPassed && holdout.trades >= 25 && holdout.events >= 10 && holdout.lower > 0;
  return { rule, train, validation, holdout, trainPassed, validationPassed, passesHoldout, holdoutRows };
});
const selected = evaluated.filter((row) => row.validationPassed).sort((a, b) => Number(b.passesHoldout) - Number(a.passesHoldout) || b.holdout.lower - a.holdout.lower);
const baseline = evaluated.find((row) => row.rule.leadHours === 24 && row.rule.minEntry === 0.55 && row.rule.maxEntry === 0.95);
const compact = (stats) => Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, Number.isFinite(value) ? +value.toFixed(5) : value]));
const candidate = (row) => ({ rule: row.rule, train: compact(row.train), validation: compact(row.validation), holdout: compact(row.holdout), passesHoldout: row.passesHoldout });

console.log(JSON.stringify({ generatedAt: new Date().toISOString(), requestedMarkets: MARKET_LIMIT, sportsMarkets: markets.length,
  historiesWithData: usable.length, failures: histories.filter((row) => row?.error).length,
  methodology: { selection: "most recently closed eligible Yes/No sports markets", decisionAnchor: "published game start",
    historyFidelityMinutes: 60, maxPriceStalenessHours: MAX_STALENESS_HOURS, modeledCostCents: COST * 100,
    split: "60% train / 20% validation / 20% untouched holdout", clusterUnit: "equal-dollar event baskets split across at most four highest-priced eligible favorites", testedRules: rules.length },
  partitionMarkets: Object.fromEntries(Object.entries(partitions).map(([key, value]) => [key, value.length])),
  trainPassed: evaluated.filter((row) => row.trainPassed).length, validationSelected: selected.length,
  holdoutPassed: selected.filter((row) => row.passesHoldout).length, baseline: baseline ? candidate(baseline) : null,
  candidates: selected.slice(0, 20).map(candidate),
  holdoutExamples: (selected.find((row) => row.passesHoldout)?.holdoutRows || []).slice(0, 12)
    .map((row) => ({ question: row.question, event: row.event, side: row.side, entry: +row.entry.toFixed(4), won: row.won, netReturn: +row.netReturn.toFixed(4) }))
}, null, 2));
