const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";
const MARKET_LIMIT = Math.max(1000, Math.min(5000, Number(process.env.CAL_MODEL_MARKETS || 3000)));
const MARKET_SKIP = Math.max(0, Math.min(15000, Number(process.env.CAL_MODEL_SKIP || 0)));
const CONCURRENCY = Math.max(1, Math.min(12, Number(process.env.CAL_MODEL_CONCURRENCY || 10)));
const SLIPPAGE = Math.max(0, Math.min(0.05, Number(process.env.CAL_MODEL_SLIPPAGE_CENTS || 1) / 100));
const UNKNOWN_FEE = Math.max(0, Math.min(0.03, Number(process.env.CAL_MODEL_UNKNOWN_FEE_CENTS || 0.5) / 100));
const HORIZONS = [1, 3, 7, 14, 30];
const DAY = 86400;

function parseJson(value) {
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value || "[]"); } catch { return []; }
}

function timestamp(value) {
  const parsed = Date.parse(String(value || "").replace(" ", "T").replace(/\+00$/, "Z"));
  return Number.isFinite(parsed) ? parsed / 1000 : null;
}

function categoryOf(raw) {
  const tags = [...(raw.tags || []), ...(raw.events || []).flatMap((event) => event.tags || [])]
    .map((tag) => `${tag.slug || ""} ${tag.label || ""}`).join(" ");
  const text = `${raw.category || ""} ${raw.question || ""} ${raw.sportsMarketType || ""} ${tags}`.toLowerCase();
  if (/\b(election|president|politic|senate|congress|parliament|minister|governor|government|nominee|primary)\b/.test(text)) return "Politics";
  if (/\b(bitcoin|crypto|ethereum|btc|eth|solana|xrp|token|stablecoin)\b/.test(text)) return "Crypto";
  if (/\b(sports?|soccer|football|basketball|baseball|tennis|hockey|cricket|golf|boxing|ufc|nba|nfl|nhl|mlb|fifa|epl|match|game|tournament)\b/.test(text)) return "Sports";
  if (/\b(fed|inflation|gdp|recession|stock|company|economy|tariff|interest rate|unemployment|earnings|ipo)\b/.test(text)) return "Economy";
  if (/\b(movie|music|album|box office|television|celebrity|award|gaming|youtube|stream)\b/.test(text)) return "Pop Culture";
  return "Other";
}

function sportsContestKey(raw, gameStartAt) {
  const slug = String(raw?.slug || "").toLowerCase();
  const datedPrefix = slug.match(/^(.+?-\d{4}-\d{2}-\d{2})(?:-|$)/)?.[1];
  if (datedPrefix) return `sports:${datedPrefix}`;
  return `sports:${gameStartAt || "unknown"}:${String(raw?.events?.[0]?.id || raw?.id || "unknown")}`;
}

function feeScheduleOf(raw) {
  const rate = Number(raw?.feeSchedule?.rate), exponent = Number(raw?.feeSchedule?.exponent);
  return Number.isFinite(rate) && rate >= 0 && Number.isFinite(exponent) && exponent > 0
    ? { rate, exponent } : null;
}

function takerFeePerShare(schedule, price) {
  if (!schedule) return UNKNOWN_FEE;
  const p = Number(price);
  if (!(p > 0 && p < 1)) return UNKNOWN_FEE;
  return schedule.rate * Math.pow(p * (1 - p), schedule.exponent);
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
      try { output[index] = await task(items[index]); }
      catch (error) { output[index] = { error: error.message }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

async function fetchResolvedMarkets(limit, skip = 0) {
  const markets = [], seen = new Set();
  const target = limit + skip;
  let cursor = "";
  while (markets.length < target) {
    const params = new URLSearchParams({ closed: "true", order: "closedTime", ascending: "false", limit: "100", include_tag: "true" });
    if (cursor) params.set("after_cursor", cursor);
    const payload = await fetchJson(`${GAMMA}/markets/keyset?${params}`), page = payload?.markets;
    if (!Array.isArray(page) || !page.length) break;
    for (const raw of page) {
      const id = String(raw.id || ""), labels = parseJson(raw.outcomes).map((value) => String(value).trim().toLowerCase());
      const outcomes = parseJson(raw.outcomePrices).map(Number), tokens = parseJson(raw.clobTokenIds).map(String);
      const finalYes = outcomes[0] >= 0.99 && outcomes[1] <= 0.01 ? 1 : outcomes[1] >= 0.99 && outcomes[0] <= 0.01 ? 0 : null;
      const closedAt = timestamp(raw.closedTime || raw.endDate), createdAt = timestamp(raw.createdAt), gameStartAt = timestamp(raw.gameStartTime);
      if (!id || seen.has(id) || labels[0] !== "yes" || labels[1] !== "no" || tokens.length !== 2 || finalYes == null || !closedAt || !createdAt) continue;
      seen.add(id);
      const category = categoryOf(raw), eventKey = category === "Sports"
        ? sportsContestKey(raw, gameStartAt)
        : String(raw.events?.[0]?.id || raw.eventId || id);
      markets.push({ id, question: raw.question || "", category, eventKey, tokenId: tokens[0], finalYes,
        closedAt, createdAt, decisionAnchor: category === "Sports" && gameStartAt ? gameStartAt : closedAt,
        negRisk: Boolean(raw.negRisk), feeSchedule: feeScheduleOf(raw) });
      if (markets.length >= target) break;
    }
    if (page.length < 100 || !payload.next_cursor || payload.next_cursor === cursor) break;
    cursor = payload.next_cursor;
  }
  return markets.slice(skip, skip + limit);
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

function observation(market, points, horizonDays) {
  const decisionAt = market.decisionAnchor - horizonDays * DAY, point = atOrBefore(points, decisionAt);
  const oneDay = atOrBefore(points, decisionAt - DAY), sevenDay = atOrBefore(points, decisionAt - 7 * DAY);
  const recent = points.filter((candidate) => candidate.t >= decisionAt - 7 * DAY && candidate.t <= decisionAt);
  if (!point || decisionAt < market.createdAt + DAY || decisionAt - point.t > 36 * 3600 || point.p <= 0.03 || point.p >= 0.97
    || recent.length < 2 || Math.max(...recent.map((candidate) => candidate.p)) - Math.min(...recent.map((candidate) => candidate.p)) < 0.005) return null;
  const trend1d = oneDay && decisionAt - DAY - oneDay.t <= 36 * 3600 ? point.p - oneDay.p : 0;
  const trend7d = sevenDay && decisionAt - 7 * DAY - sevenDay.t <= 36 * 3600 ? point.p - sevenDay.p : 0;
  const range7d = recent.length >= 2 ? Math.max(...recent.map((candidate) => candidate.p)) - Math.min(...recent.map((candidate) => candidate.p)) : 0;
  const ageDays = Math.max(1, (decisionAt - market.createdAt) / DAY), text = market.question.toLowerCase();
  return { ...market, decisionAt, horizonDays, price: point.p, trend1d, trend7d, range7d, ageDays,
    numeric: /\d/.test(text), deadline: /\b(by|before|on or before|through)\b/.test(text),
    threshold: /\b(above|below|over|under|at least|at most|between)\b/.test(text) };
}

const CATEGORIES = ["Politics", "Sports", "Crypto", "Economy", "Pop Culture"];
function rawFeatures(row) {
  const p = Math.max(0.001, Math.min(0.999, row.price)), logit = Math.log(p / (1 - p));
  return [1, logit, logit * Math.abs(logit), p - 0.5, Math.abs(p - 0.5), row.trend1d, row.trend7d,
    row.range7d, Math.log1p(row.ageDays), Number(row.negRisk), Number(row.numeric), Number(row.deadline), Number(row.threshold),
    ...CATEGORIES.map((category) => Number(row.category === category))];
}

function scaler(rows) {
  const values = rows.map(rawFeatures), width = values[0]?.length || 0;
  const means = Array(width).fill(0), scales = Array(width).fill(1);
  for (let j = 1; j < width; j++) {
    means[j] = values.reduce((sum, row) => sum + row[j], 0) / Math.max(1, values.length);
    const variance = values.reduce((sum, row) => sum + (row[j] - means[j]) ** 2, 0) / Math.max(1, values.length - 1);
    scales[j] = Math.sqrt(variance) || 1;
  }
  return { means, scales, transform(row) { return rawFeatures(row).map((value, index) => index ? (value - means[index]) / scales[index] : 1); } };
}

function sigmoid(value) {
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const exp = Math.exp(value); return exp / (1 + exp);
}

function trainModel(rows, lambda, featureScaler) {
  const eventCounts = new Map();
  rows.forEach((row) => eventCounts.set(row.eventKey, (eventCounts.get(row.eventKey) || 0) + 1));
  const samples = rows.map((row) => ({ x: featureScaler.transform(row), y: row.finalYes,
    weight: 1 / Math.max(1, eventCounts.get(row.eventKey) || 1) }));
  const weights = Array(samples[0]?.x.length || 0).fill(0), totalWeight = samples.reduce((sum, row) => sum + row.weight, 0);
  for (let epoch = 0; epoch < 320; epoch++) {
    const gradient = Array(weights.length).fill(0);
    for (const sample of samples) {
      const predicted = sigmoid(sample.x.reduce((sum, value, index) => sum + value * weights[index], 0));
      const error = (predicted - sample.y) * sample.weight;
      for (let j = 0; j < weights.length; j++) gradient[j] += error * sample.x[j];
    }
    const rate = 0.12 / Math.sqrt(1 + epoch / 40);
    for (let j = 0; j < weights.length; j++) {
      const penalty = j ? lambda * weights[j] : 0;
      weights[j] -= rate * (gradient[j] / Math.max(1, totalWeight) + penalty);
    }
  }
  return { weights, scaler: featureScaler,
    predict(row) { const x = featureScaler.transform(row); return sigmoid(x.reduce((sum, value, index) => sum + value * weights[index], 0)); } };
}

function candidateTrade(row, model, minimumEdge, maxEntry) {
  const predictedYes = model.predict(row), yesEntry = row.price, noEntry = 1 - row.price;
  const yesFriction = SLIPPAGE + takerFeePerShare(row.feeSchedule, yesEntry);
  const noFriction = SLIPPAGE + takerFeePerShare(row.feeSchedule, noEntry);
  const yesEdge = (predictedYes - yesEntry - yesFriction) / yesEntry;
  const noEdge = ((1 - predictedYes) - noEntry - noFriction) / noEntry;
  const side = yesEdge >= noEdge ? "YES" : "NO", entry = side === "YES" ? yesEntry : noEntry;
  const expectedEdge = side === "YES" ? yesEdge : noEdge, won = side === (row.finalYes ? "YES" : "NO");
  const friction = side === "YES" ? yesFriction : noFriction;
  if (entry < 0.05 || entry > maxEntry || expectedEdge < minimumEdge) return null;
  return { eventKey: row.eventKey, marketId: row.id, question: row.question, category: row.category,
    closedAt: row.closedAt, decisionAt: row.decisionAt, side, entry, predictedYes, expectedEdge, won,
    netReturn: (won ? 1 : 0) / entry - 1 - friction / entry };
}

function tradesFor(rows, model, minimumEdge, maxEntry) {
  const events = new Map();
  for (const row of rows) {
    const trade = candidateTrade(row, model, minimumEdge, maxEntry);
    if (!trade) continue;
    const current = events.get(trade.eventKey);
    if (!current || trade.expectedEdge > current.expectedEdge || (trade.expectedEdge === current.expectedEdge && trade.marketId < current.marketId)) {
      events.set(trade.eventKey, trade);
    }
  }
  return [...events.values()];
}

function summarize(rows) {
  if (!rows.length) return { trades: 0, events: 0, mean: 0, lower90: 0, upper90: 0, winRate: 0 };
  const mean = rows.reduce((sum, row) => sum + row.netReturn, 0) / rows.length;
  const variance = rows.length > 1 ? rows.reduce((sum, row) => sum + (row.netReturn - mean) ** 2, 0) / (rows.length - 1) : 0;
  const margin = 1.645 * Math.sqrt(variance / rows.length);
  return { trades: rows.length, events: rows.length, mean, lower90: mean - margin, upper90: mean + margin,
    winRate: rows.filter((row) => row.won).length / rows.length };
}

function splitByEventTime(rows) {
  const eventTimes = new Map();
  rows.forEach((row) => eventTimes.set(row.eventKey, Math.max(eventTimes.get(row.eventKey) || 0, row.closedAt)));
  const ordered = [...eventTimes.values()].sort((a, b) => a - b), trainCut = ordered[Math.floor(ordered.length * 0.60)] || 0;
  const validationCut = ordered[Math.floor(ordered.length * 0.80)] || 0;
  return { train: rows.filter((row) => (eventTimes.get(row.eventKey) || 0) < trainCut),
    validation: rows.filter((row) => (eventTimes.get(row.eventKey) || 0) >= trainCut && (eventTimes.get(row.eventKey) || 0) < validationCut),
    holdout: rows.filter((row) => (eventTimes.get(row.eventKey) || 0) >= validationCut), trainCut, validationCut };
}

const markets = await fetchResolvedMarkets(MARKET_LIMIT, MARKET_SKIP);
const histories = await mapLimit(markets, CONCURRENCY, async (market) => {
  const data = await fetchJson(`${CLOB}/prices-history?market=${encodeURIComponent(market.tokenId)}&interval=max&fidelity=1440`);
  const points = (data.history || []).map((point) => ({ t: Number(point.t), p: Number(point.p) }))
    .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.p)).sort((a, b) => a.t - b.t);
  return { market, points };
});
const usable = histories.filter((row) => row && !row.error && row.points.length);
const results = [];
for (const horizonDays of HORIZONS) {
  const rows = usable.map(({ market, points }) => observation(market, points, horizonDays)).filter(Boolean);
  const partitions = splitByEventTime(rows), featureScaler = scaler(partitions.train), candidates = [];
  for (const lambda of [0.01, 0.05, 0.20]) {
    const model = trainModel(partitions.train, lambda, featureScaler);
    for (const minimumEdge of [0.01, 0.02, 0.04, 0.06]) {
      for (const maxEntry of [0.90, 0.95]) {
        const trainRows = tradesFor(partitions.train, model, minimumEdge, maxEntry), train = summarize(trainRows);
        const validationRows = tradesFor(partitions.validation, model, minimumEdge, maxEntry), validation = summarize(validationRows);
        const eligible = train.events >= 80 && train.lower90 > 0 && validation.events >= 40 && validation.lower90 > 0;
        candidates.push({ lambda, minimumEdge, maxEntry, model, trainRows, train, validationRows, validation, eligible });
      }
    }
  }
  const selected = candidates.filter((row) => row.eligible)
    .sort((a, b) => b.validation.lower90 - a.validation.lower90 || b.validation.mean - a.validation.mean)[0] || null;
  const holdoutRows = selected ? tradesFor(partitions.holdout, selected.model, selected.minimumEdge, selected.maxEntry) : [];
  const compact = (stats) => Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, Number.isFinite(value) ? +value.toFixed(5) : value]));
  results.push({ horizonDays, observations: rows.length,
    partitionEvents: Object.fromEntries(Object.entries(partitions).filter(([, value]) => Array.isArray(value))
      .map(([key, value]) => [key, new Set(value.map((row) => row.eventKey)).size])),
    validationEligibleConfigurations: candidates.filter((row) => row.eligible).length,
    selected: selected ? { lambda: selected.lambda, minimumEdge: selected.minimumEdge, maxEntry: selected.maxEntry,
      coefficients: selected.model.weights.map((value) => +value.toFixed(6)), train: compact(selected.train),
      validation: compact(selected.validation), holdout: compact(summarize(holdoutRows)),
      passesUntouchedHoldout: holdoutRows.length >= 40 && summarize(holdoutRows).lower90 > 0,
      holdoutExamples: holdoutRows.slice(0, 12).map((row) => ({ question: row.question, side: row.side,
        entry: +row.entry.toFixed(4), predictedYes: +row.predictedYes.toFixed(4), expectedEdge: +row.expectedEdge.toFixed(4),
        won: row.won, netReturn: +row.netReturn.toFixed(4) })) } : null });
}

console.log(JSON.stringify({ generatedAt: new Date().toISOString(), strategy: "walk-forward probability calibration model",
  requestedMarkets: MARKET_LIMIT, skippedMarkets: MARKET_SKIP, resolvedMarkets: markets.length,
  historiesWithData: usable.length, failures: histories.filter((row) => row?.error).length,
  methodology: { entryData: "daily CLOB midpoint at or before the decision timestamp", horizonsDays: HORIZONS,
    model: "event-weighted ridge logistic calibration using price, pre-entry trend/range, age, category, and question-form features",
    split: "event-disjoint chronological 60% train / 20% validation / 20% untouched holdout",
    execution: `settlement redemption after exact Gamma taker fee when published, otherwise ${UNKNOWN_FEE * 100} cent fee reserve, plus ${SLIPPAGE * 100} cent slippage`,
    selection: "one highest predicted net-edge position per underlying event or sports contest",
    promotionGate: "at least 80 train, 40 validation, and 40 holdout events with a positive event-level 90% lower bound in every partition",
    limitations: ["Historical midpoint is not a fill guarantee.", "Resolved-market closure cohorts can differ from future live markets.",
      "No capital may be enabled unless the untouched holdout passes; forward paper evidence is still required."] },
  holdoutPassed: results.filter((row) => row.selected?.passesUntouchedHoldout).length,
  results,
  productionDecision: results.some((row) => row.selected?.passesUntouchedHoldout)
    ? "Eligible for zero-capital forward shadow validation only; not immediate capital permission."
    : "Rejected: no configuration survived the untouched event-disjoint holdout." }, null, 2));
