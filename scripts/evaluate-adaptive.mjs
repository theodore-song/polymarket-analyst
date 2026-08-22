const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";
const MARKET_LIMIT = Math.max(50, Math.min(500, Number(process.env.ADAPTIVE_MARKETS || 300)));
const CONCURRENCY = Math.max(1, Math.min(12, Number(process.env.ADAPTIVE_CONCURRENCY || 6)));
const COST = Math.max(0, Math.min(0.05, Number(process.env.ADAPTIVE_COST_CENTS || 0.5) / 100));
const HOUR = 3600;

function parseJson(value) {
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value || "[]"); } catch { return []; }
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
      try { output[index] = await task(items[index]); }
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
  if (/\b(movie|music|album|box office|television|celebrity|award|gaming|youtube|stream)\b/.test(text)) return "Pop Culture";
  return "Other";
}

async function fetchMarkets(limit) {
  const markets = [], seen = new Set(), pageSize = 100;
  for (let offset = 0; markets.length < limit && offset < limit * 4; offset += pageSize) {
    const params = new URLSearchParams({ active: "true", closed: "false", archived: "false", include_tag: "true",
      limit: String(pageSize), offset: String(offset), order: "volume24hr", ascending: "false" });
    const page = await fetchJson(`${GAMMA}/markets?${params}`);
    if (!Array.isArray(page) || !page.length) break;
    for (const raw of page) {
      const id = String(raw.id || ""), labels = parseJson(raw.outcomes).map((outcome) => String(outcome).trim().toLowerCase());
      const tokenId = String(parseJson(raw.clobTokenIds)[0] || "");
      if (!id || seen.has(id) || !tokenId || labels[0] !== "yes" || labels[1] !== "no") continue;
      seen.add(id);
      markets.push({ id, tokenId, question: raw.question || "", category: categoryOf(raw),
        eventKey: String(raw.events?.[0]?.id || raw.events?.[0]?.slug || raw.eventId || id) });
      if (markets.length >= limit) break;
    }
    if (page.length < pageSize) break;
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

function atOrAfter(points, target) {
  let lo = 0, hi = points.length - 1, answer = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t >= target) { answer = points[mid]; hi = mid - 1; }
    else lo = mid + 1;
  }
  return answer;
}

function observations(market, points) {
  const rows = [], seenBuckets = new Set();
  for (const current of points) {
    const bucket = Math.floor(current.t / (12 * HOUR));
    if (seenBuckets.has(bucket) || current.p < 0.08 || current.p > 0.92) continue;
    const history = {};
    let complete = true;
    for (const hours of [1, 6, 24, 72, 168]) {
      const prior = atOrBefore(points, current.t - hours * HOUR);
      if (!prior || current.t - hours * HOUR - prior.t > 3 * HOUR) { complete = false; break; }
      history[hours] = current.p - prior.p;
    }
    if (!complete) continue;
    const future = {};
    for (const hours of [6, 24, 72]) {
      const next = atOrAfter(points, current.t + hours * HOUR);
      if (next && next.t - (current.t + hours * HOUR) <= 3 * HOUR) future[hours] = next.p;
    }
    if (!Number.isFinite(future[24]) && !Number.isFinite(future[72])) continue;
    seenBuckets.add(bucket);
    rows.push({ marketId: market.id, eventKey: market.eventKey, category: market.category,
      observedAt: current.t, price: current.p, moves: history, future });
  }
  return rows;
}

function bandOf(price) {
  if (price < 0.3) return "longshot";
  if (price < 0.7) return "mid";
  return "favorite";
}

function tradeFor(row, rule, horizon) {
  const move = row.moves[rule.lookback], magnitude = Math.abs(move);
  if (!move || magnitude < rule.minMove || magnitude > rule.maxMove) return null;
  const longSign = Math.sign(row.moves[24]), slowSign = Math.sign(row.moves[168]);
  if (rule.agreement === "same" && (!longSign || longSign !== slowSign)) return null;
  if (rule.agreement === "opposite" && (!longSign || longSign === slowSign)) return null;
  if (rule.category !== "All" && row.category !== rule.category) return null;
  const direction = Math.sign(move) * (rule.mode === "follow" ? 1 : -1);
  const side = direction > 0 ? "YES" : "NO", entry = side === "YES" ? row.price : 1 - row.price;
  const futureYes = row.future[horizon], exit = side === "YES" ? futureYes : 1 - futureYes;
  if (!Number.isFinite(exit) || entry < 0.08 || entry > 0.92 || (rule.band !== "all" && bandOf(entry) !== rule.band)) return null;
  return { eventKey: row.eventKey, marketId: row.marketId, observedAt: row.observedAt,
    netReturn: exit / entry - 1 - COST / entry };
}

function summary(trades, confidence = 1.645) {
  if (!trades.length) return { trades: 0, markets: 0, events: 0, mean: 0, eventMean: 0, lower: 0, upper: 0, winRate: 0 };
  const buckets = new Map();
  for (const trade of trades) {
    const values = buckets.get(trade.eventKey) || [];
    values.push(trade.netReturn); buckets.set(trade.eventKey, values);
  }
  const eventReturns = [...buckets.values()].map((values) => values.reduce((sum, value) => sum + value, 0) / values.length);
  const eventMean = eventReturns.reduce((sum, value) => sum + value, 0) / eventReturns.length;
  const variance = eventReturns.length > 1
    ? eventReturns.reduce((sum, value) => sum + (value - eventMean) ** 2, 0) / (eventReturns.length - 1) : 0;
  const margin = confidence * Math.sqrt(variance / Math.max(1, eventReturns.length));
  return { trades: trades.length, markets: new Set(trades.map((trade) => trade.marketId)).size, events: eventReturns.length,
    mean: trades.reduce((sum, trade) => sum + trade.netReturn, 0) / trades.length,
    eventMean, lower: eventMean - margin, upper: eventMean + margin,
    winRate: trades.filter((trade) => trade.netReturn > 0).length / trades.length };
}

const rules = [];
for (const lookback of [6, 24, 72, 168]) {
  for (const mode of ["follow", "fade"]) {
    for (const [minMove, maxMove] of [[0.005, 0.04], [0.01, 0.08], [0.02, 0.15], [0.04, 1]]) {
      for (const band of ["all", "longshot", "mid", "favorite"]) {
        for (const category of ["All", "Politics", "Sports", "Crypto", "Other"]) {
          for (const agreement of ["any", "same", "opposite"]) {
            const id = `${mode}_${lookback}h_${minMove}-${maxMove}_${band}_${category}_${agreement}`;
            rules.push({ id, lookback, mode, minMove, maxMove, band, category, agreement });
          }
        }
      }
    }
  }
}

const markets = await fetchMarkets(MARKET_LIMIT);
const histories = await mapLimit(markets, CONCURRENCY, async (market) => {
  const data = await fetchJson(`${CLOB}/prices-history?market=${encodeURIComponent(market.tokenId)}&interval=1m&fidelity=60`);
  const points = (data.history || []).map((point) => ({ t: Number(point.t), p: Number(point.p) }))
    .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.p)).sort((a, b) => a.t - b.t);
  return { rows: observations(market, points), points: points.length };
});
const rows = histories.filter((result) => result && !result.error).flatMap((result) => result.rows);
const times = rows.map((row) => row.observedAt).sort((a, b) => a - b);
const trainCut = times[Math.floor(times.length * 0.6)] || 0, validationCut = times[Math.floor(times.length * 0.8)] || 0;

function evaluateHorizon(horizon) {
  const trainRows = rows.filter((row) => row.observedAt < trainCut && row.observedAt + horizon * HOUR < trainCut);
  const validationRows = rows.filter((row) => row.observedAt >= trainCut && row.observedAt + horizon * HOUR < validationCut);
  const testRows = rows.filter((row) => row.observedAt >= validationCut);
  const selected = [];
  for (const rule of rules) {
    const train = summary(trainRows.map((row) => tradeFor(row, rule, horizon)).filter(Boolean));
    if (train.trades < 80 || train.events < 15 || train.lower <= 0) continue;
    const validation = summary(validationRows.map((row) => tradeFor(row, rule, horizon)).filter(Boolean));
    if (validation.trades < 40 || validation.events < 10 || validation.lower <= 0) continue;
    selected.push({ rule, train, validation });
  }
  const tested = selected.map((candidate) => {
    const test = summary(testRows.map((row) => tradeFor(row, candidate.rule, horizon)).filter(Boolean));
    return { ...candidate, test, passesHoldout: test.trades >= 40 && test.events >= 10 && test.lower > 0 };
  }).sort((a, b) => (Number(b.passesHoldout) - Number(a.passesHoldout)) || b.test.lower - a.test.lower);
  return { horizon, trainRows: trainRows.length, validationRows: validationRows.length, testRows: testRows.length,
    validationSelected: selected.length, holdoutPassed: tested.filter((candidate) => candidate.passesHoldout).length,
    candidates: tested.slice(0, 30) };
}

const compact = (stats) => Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, Number.isFinite(value) ? +value.toFixed(5) : value]));
const horizons = [6, 24, 72].map(evaluateHorizon).map((result) => ({ ...result,
  candidates: result.candidates.map((candidate) => ({ rule: candidate.rule, passesHoldout: candidate.passesHoldout,
    train: compact(candidate.train), validation: compact(candidate.validation), test: compact(candidate.test) })) }));
const passedByHorizon = Object.fromEntries(horizons.map((result) => [result.horizon,
  new Set(result.candidates.filter((candidate) => candidate.passesHoldout).map((candidate) => candidate.rule.id))]));
const probationRuleIds = [...passedByHorizon[6]];
const durableRuleIds = [...passedByHorizon[24]].filter((id) => passedByHorizon[72].has(id));

console.log(JSON.stringify({ generatedAt: new Date().toISOString(), requestedMarkets: MARKET_LIMIT, fetchedMarkets: markets.length,
  historiesWithData: histories.filter((result) => result && !result.error && result.points).length,
  failures: histories.filter((result) => result?.error).length, observations: rows.length,
  methodology: { costCents: COST * 100, observationSpacingHours: 12, split: "60% train / 20% validation / 20% untouched holdout",
    clusterUnit: "Polymarket event", candidateRules: rules.length,
    promotionGate: "positive event-clustered 90% lower bound with minimum support in train, validation, and holdout" },
  probationRuleIds, durableRuleIds, horizons }, null, 2));
