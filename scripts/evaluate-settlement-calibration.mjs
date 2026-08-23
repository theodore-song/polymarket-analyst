const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";
const MARKET_LIMIT = Math.max(500, Math.min(5000, Number(process.env.CALIBRATION_MARKETS || 5000)));
const MARKET_SKIP = Math.max(0, Math.min(10000, Number(process.env.CALIBRATION_SKIP || 0)));
const CONCURRENCY = Math.max(1, Math.min(12, Number(process.env.CALIBRATION_CONCURRENCY || 10)));
const COST = Math.max(0, Math.min(0.10, Number(process.env.CALIBRATION_COST_CENTS || 1) / 100));
const EXACT_GAMMA_FEES = process.env.CALIBRATION_EXACT_GAMMA_FEES === "1";
const HORIZONS = [...new Set(String(process.env.CALIBRATION_HORIZONS || "1,3,7,14,30")
  .split(",").map(Number).filter((value) => Number.isFinite(value) && value >= 1 && value <= 180))].sort((a, b) => a - b);
const TARGET_RULE_IDS = String(process.env.CALIBRATION_TARGET_RULES || "3d_no_0.03-0.97_sports")
  .split(",").map((value) => value.trim()).filter(Boolean);
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

function feeScheduleOf(raw) {
  const rate = Number(raw?.feeSchedule?.rate), exponent = Number(raw?.feeSchedule?.exponent);
  return Number.isFinite(rate) && rate >= 0 && Number.isFinite(exponent) && exponent > 0
    ? { rate, exponent } : null;
}

function takerFeePerShare(schedule, price) {
  const p = Number(price), rate = Number(schedule?.rate), exponent = Number(schedule?.exponent);
  if (!(p > 0 && p < 1) || !Number.isFinite(rate) || rate < 0 || !Number.isFinite(exponent) || exponent <= 0) return null;
  return rate * Math.pow(p * (1 - p), exponent);
}

function sportsContestKey(raw, gameStartAt) {
  const slug = String(raw?.slug || "").toLowerCase();
  const datedPrefix = slug.match(/^(.+?-\d{4}-\d{2}-\d{2})(?:-|$)/)?.[1];
  if (datedPrefix) return `sports:${datedPrefix}`;
  const start = Number.isFinite(gameStartAt) ? String(gameStartAt) : "unknown-start";
  const title = String(raw?.question || "").toLowerCase().split(":")[0]
    .replace(/\b(will|win|exact score|leading at halftime|to score first)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
  return `sports:${start}:${title || raw?.id || "unknown"}`;
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
  const targetCount = limit + skip;
  let cursor = "";
  while (markets.length < targetCount) {
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
      const category = categoryOf(raw), eventKey = category === "Sports" ? sportsContestKey(raw, gameStartAt) : String(raw.events?.[0]?.id || id);
      markets.push({ id, question: raw.question || "", eventKey, tokenId: tokens[0],
        finalYes, closedAt, createdAt, gameStartAt, decisionAnchor:category === "Sports" && gameStartAt ? gameStartAt : closedAt,
        category, feeSchedule: feeScheduleOf(raw) });
      if (markets.length >= targetCount) break;
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

function observations(market, points) {
  return HORIZONS.flatMap((horizonDays) => {
    const decisionAt = market.decisionAnchor - horizonDays * DAY, point = atOrBefore(points, decisionAt);
    const recent = points.filter((candidate) => candidate.t >= decisionAt - 7 * DAY && candidate.t <= decisionAt);
    const recentRange = recent.length ? Math.max(...recent.map((candidate) => candidate.p)) - Math.min(...recent.map((candidate) => candidate.p)) : 0;
    if (!point || decisionAt < market.createdAt + DAY || decisionAt - point.t > 36 * 3600
      || recent.length < 2 || recentRange < 0.005 || point.p <= 0.03 || point.p >= 0.97) return [];
    return ["YES", "NO"].map((side) => {
      const entry = side === "YES" ? point.p : 1 - point.p;
      const won = side === (market.finalYes ? "YES" : "NO");
      const fee = EXACT_GAMMA_FEES ? takerFeePerShare(market.feeSchedule, entry) : null;
      const entryCost = COST + (EXACT_GAMMA_FEES && Number.isFinite(fee) ? fee : 0);
      return { marketId: market.id, eventKey: market.eventKey, question: market.question, category: market.category,
        closedAt: market.closedAt,gameStartAt:market.gameStartAt,decisionAt, horizonDays, side, entry, favorite: entry >= 0.5, won,
        entryCost, exactFeeSchedule: EXACT_GAMMA_FEES && market.feeSchedule != null,
        netReturn: (won ? 1 : 0) / entry - 1 - entryCost / entry };
    });
  });
}

function tradesFor(rows, rule) {
  const grouped = new Map();
  rows.filter((row) => matches(row, rule)).forEach((row) => {
    const current = grouped.get(row.eventKey);
    if (!current || row.entry > current.entry || (row.entry === current.entry && row.marketId < current.marketId)) {
      grouped.set(row.eventKey, row);
    }
  });
  return [...grouped.values()];
}

function summarize(rows, confidence = 1.96) {
  if (!rows.length) return { trades: 0, events: 0, mean: 0, eventMean: 0, lower: 0, upper: 0, winRate: 0 };
  const buckets = new Map();
  rows.forEach((row) => { const values = buckets.get(row.eventKey) || []; values.push(row.netReturn); buckets.set(row.eventKey, values); });
  const eventReturns = [...buckets.values()].map((values) => values.reduce((sum, value) => sum + value, 0) / values.length);
  const eventMean = eventReturns.reduce((sum, value) => sum + value, 0) / eventReturns.length;
  const variance = eventReturns.length > 1
    ? eventReturns.reduce((sum, value) => sum + (value - eventMean) ** 2, 0) / (eventReturns.length - 1) : 0;
  const margin = confidence * Math.sqrt(variance / Math.max(1, eventReturns.length));
  return { trades: rows.length, events: eventReturns.length,
    mean: rows.reduce((sum, row) => sum + row.netReturn, 0) / rows.length,
    eventMean, lower: eventMean - margin, upper: eventMean + margin,
    winRate: rows.filter((row) => row.won).length / rows.length };
}

const PRICE_RANGES = [
  [0.03, 0.97], [0.05, 0.25], [0.10, 0.30], [0.20, 0.40], [0.30, 0.50],
  [0.40, 0.60], [0.50, 0.70], [0.60, 0.80], [0.70, 0.90], [0.75, 0.95],
];
const CATEGORIES = ["All", "Politics", "Sports", "Crypto", "Economy", "Pop Culture", "Other"];
const rules = [];
for (const horizonDays of HORIZONS) {
  for (const side of ["YES", "NO", "FAVORITE", "UNDERDOG"]) {
    for (const [minEntry, maxEntry] of PRICE_RANGES) {
      for (const category of CATEGORIES) {
        rules.push({ id: `${horizonDays}d_${side.toLowerCase()}_${minEntry}-${maxEntry}_${category.toLowerCase().replace(/\s+/g, "-")}`,
          horizonDays, side, minEntry, maxEntry, category });
      }
    }
  }
}

function matches(row, rule) {
  return row.horizonDays === rule.horizonDays && row.entry >= rule.minEntry && row.entry < rule.maxEntry
    && (rule.category === "All" || row.category === rule.category)
    && (rule.side === row.side || (rule.side === "FAVORITE" && row.favorite) || (rule.side === "UNDERDOG" && !row.favorite));
}

function splitByTime(rows) {
  const times = [...new Set(rows.map((row) => row.closedAt))].sort((a, b) => a - b);
  const trainCut = times[Math.floor(times.length * 0.60)] || 0, validationCut = times[Math.floor(times.length * 0.80)] || 0;
  return {
    train: rows.filter((row) => row.closedAt < trainCut),
    validation: rows.filter((row) => row.closedAt >= trainCut && row.closedAt < validationCut),
    holdout: rows.filter((row) => row.closedAt >= validationCut),
    trainCut, validationCut,
  };
}

function stabilityWindows(rows) {
  const times = [...new Set(rows.map((row) => row.closedAt))].sort((a, b) => a - b);
  const cuts = [0, 0.25, 0.5, 0.75, 1].map((fraction) => times[Math.min(times.length - 1, Math.floor(times.length * fraction))] || 0);
  return Array.from({ length: 4 }, (_, index) => rows.filter((row) => row.closedAt >= cuts[index]
    && (index === 3 || row.closedAt < cuts[index + 1])));
}

const markets = await fetchResolvedMarkets(MARKET_LIMIT, MARKET_SKIP);
const histories = await mapLimit(markets, CONCURRENCY, async (market) => {
  const data = await fetchJson(`${CLOB}/prices-history?market=${encodeURIComponent(market.tokenId)}&interval=max&fidelity=1440`);
  const points = (data.history || []).map((point) => ({ t: Number(point.t), p: Number(point.p) }))
    .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.p)).sort((a, b) => a.t - b.t);
  return { market, points, observations: observations(market, points) };
});
const usable = histories.filter((row) => row && !row.error && row.points.length), rows = usable.flatMap((row) => row.observations);
const partitions = splitByTime(rows), windows = stabilityWindows(rows);
const evaluated = rules.map((rule) => {
  const train = summarize(tradesFor(partitions.train, rule));
  const validation = summarize(tradesFor(partitions.validation, rule));
  const holdoutRows = tradesFor(partitions.holdout, rule), holdout = summarize(holdoutRows);
  const stable = windows.map((window) => summarize(tradesFor(window, rule)));
  const trainPassed = train.trades >= 100 && train.events >= 50 && train.lower > 0;
  const validationPassed = trainPassed && validation.trades >= 40 && validation.events >= 20 && validation.lower > 0
    && stable.every((summary) => summary.trades >= 20 && summary.events >= 10 && summary.eventMean > 0);
  const passesHoldout = validationPassed && holdout.trades >= 40 && holdout.events >= 20 && holdout.lower > 0;
  return { rule, train, validation, holdout, stable, trainPassed, validationPassed, passesHoldout, holdoutRows };
});
const selected = evaluated.filter((row) => row.validationPassed)
  .sort((a, b) => Number(b.passesHoldout) - Number(a.passesHoldout) || b.holdout.lower - a.holdout.lower);
const compact = (stats) => Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, Number.isFinite(value) ? +value.toFixed(5) : value]));
const candidate = (row) => ({ rule: row.rule, train: compact(row.train), validation: compact(row.validation),
  holdout: compact(row.holdout), stabilityMeans: row.stable.map((summary) => +summary.eventMean.toFixed(5)), passesHoldout: row.passesHoldout });

console.log(JSON.stringify({ generatedAt: new Date().toISOString(), requestedMarkets: MARKET_LIMIT, resolvedMarkets: markets.length,
  historiesWithData: usable.length, failures: histories.filter((row) => row?.error).length, observations: rows.length / 2,
  methodology: { selection: "most recently closed eligible Yes/No markets", horizonsDays: HORIZONS,
    selectionOffset: MARKET_SKIP,historyFidelityMinutes: 1440, maximumPriceStalenessHours: 36,
    modeledEntrySlippageCents: COST * 100,exactGammaEntryFeeSchedules:EXACT_GAMMA_FEES,settlementRedemptionExitFeeCents:0,
    split: "60% train / 20% validation / 20% untouched holdout", confidence: "event-clustered 95% lower bound",
    stability: "positive event mean in each of four chronological windows; at most one highest-entry market per underlying event or sports contest",
    sportsTiming:"published gameStartTime minus horizon; sports contracts sharing the dated contest slug prefix form one cluster",
    activityGate: "market open for at least 24h with at least two recent observations and a 0.5-cent seven-day price range", testedRules: rules.length,
    note: "No final volume or settlement outcome enters rule features. Market selection remains a closure-time cohort, and midpoint-plus-fee-plus-slippage is still an execution approximation." },
  partitionRows: { train: partitions.train.length / 2, validation: partitions.validation.length / 2, holdout: partitions.holdout.length / 2 },
  trainPassed: evaluated.filter((row) => row.trainPassed).length, validationSelected: selected.length,
  holdoutPassed: selected.filter((row) => row.passesHoldout).length, candidates: selected.slice(0, 25).map(candidate),
  targets: evaluated.filter((row) => TARGET_RULE_IDS.includes(row.rule.id)).map(candidate),
  holdoutExamples: (selected.find((row) => row.passesHoldout)?.holdoutRows || []).slice(0, 15)
    .map((row) => ({ marketId: row.marketId, question: row.question, category: row.category, side: row.side,
      entry: +row.entry.toFixed(4), won: row.won, netReturn: +row.netReturn.toFixed(4),
      decisionAt: new Date(row.decisionAt * 1000).toISOString(), closedAt: new Date(row.closedAt * 1000).toISOString() }))
}, null, 2));
