const CLOB = "https://clob.polymarket.com";
const BOOK_BATCH_SIZE = 200;

async function fetchJson(url, options = {}, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(30000),
        headers: { accept: "application/json", ...(options.headers || {}) },
      });
      if (response.ok) return response.json();
      lastError = new Error(`${response.status} ${response.statusText}`);
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
  }
  throw lastError || new Error("request failed");
}

function activeRate(market) {
  return (market.rewards_config || []).reduce((sum, row) => sum + Number(row.rate_per_day || 0), 0);
}

function categoryFor(question) {
  const text = String(question || "").toLowerCase();
  if (/election|president|senate|governor|mayor|minister|parliament|ceasefire|war|trump|congress/.test(text)) return "Politics";
  if (/bitcoin|ethereum|crypto|btc|eth|solana|xrp|doge|token/.test(text)) return "Crypto";
  if (/nba|nfl|mlb|nhl|soccer|football|tennis|ufc|boxing|tournament|championship|match|game/.test(text)) return "Sports";
  if (/gdp|inflation|interest rate|fed|stock|nasdaq|s&p|oil|gold|gross margin|unemployment/.test(text)) return "Economy";
  if (/movie|album|music|tv|views|award|ai lab|model release|code arena/.test(text)) return "Pop Culture";
  return "Other";
}

async function fetchRewardMarkets(marketLimit, minHoursToEnd) {
  const params = new URLSearchParams({ order_by: "rate_per_day", position: "DESC", page_size: "500" });
  const response = await fetchJson(`${CLOB}/rewards/markets/multi?${params}`);
  const cutoff = Date.now() + minHoursToEnd * 60 * 60 * 1000;
  return (response.data || [])
    .filter((market) => {
      const tokens = market.tokens || [];
      const labels = tokens.map((token) => String(token.outcome || "").trim().toLowerCase());
      const endTime = Date.parse(market.end_date || "");
      return labels[0] === "yes" && labels[1] === "no" && tokens.every((token) => token.token_id)
        && activeRate(market) >= 1 && Number(market.rewards_min_size) > 0
        && Number(market.rewards_max_spread) > 0 && Number.isFinite(endTime) && endTime >= cutoff;
    })
    .slice(0, marketLimit);
}

async function fetchBooks(tokenIds) {
  const result = new Map();
  for (let index = 0; index < tokenIds.length; index += BOOK_BATCH_SIZE) {
    const batch = tokenIds.slice(index, index + BOOK_BATCH_SIZE);
    const books = await fetchJson(`${CLOB}/books`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(batch.map((token_id) => ({ token_id }))),
    });
    for (const book of books || []) result.set(String(book.asset_id), book);
  }
  return result;
}

function levels(raw, side) {
  return (raw || [])
    .map((row) => ({ price: Number(row.price), size: Number(row.size) }))
    .filter((row) => Number.isFinite(row.price) && Number.isFinite(row.size) && row.price > 0 && row.price < 1 && row.size > 0)
    .sort((a, b) => side === "bid" ? b.price - a.price : a.price - b.price);
}

function adjustedLevel(rows, minimumSize) {
  let cumulative = 0;
  for (const row of rows) {
    cumulative += row.size;
    if (cumulative + 1e-9 >= minimumSize) return row.price;
  }
  return null;
}

function midpoint(book, minimumSize, ownBid) {
  const bids = levels(book.bids, "bid");
  if (ownBid) bids.push(ownBid);
  bids.sort((a, b) => b.price - a.price);
  const asks = levels(book.asks, "ask");
  const bid = adjustedLevel(bids, minimumSize);
  const ask = adjustedLevel(asks, minimumSize);
  return Number.isFinite(bid) && Number.isFinite(ask) && bid < ask ? (bid + ask) / 2 : null;
}

function utility(maxDistance, distance) {
  if (!(maxDistance > 0) || distance > maxDistance) return 0;
  return ((maxDistance - distance) / maxDistance) ** 2;
}

function publicUtility(book, mid, maxDistance) {
  return [...levels(book.bids, "bid"), ...levels(book.asks, "ask")]
    .reduce((sum, row) => sum + utility(maxDistance, Math.abs(row.price - mid)) * row.size, 0);
}

function proposedBid(book) {
  const bids = levels(book.bids, "bid");
  const asks = levels(book.asks, "ask");
  if (!bids.length || !asks.length) return null;
  const tick = Number(book.tick_size || 0.01);
  const bestBid = bids[0].price;
  const bestAsk = asks[0].price;
  const improved = bestAsk - bestBid >= tick * 3 ? bestBid + tick : bestBid;
  return { price: Math.min(bestAsk - tick, improved), bestBid, bestAsk, tick };
}

function evaluateMarket(market, books) {
  const [yesToken, noToken] = market.tokens;
  const yesBook = books.get(String(yesToken.token_id));
  const noBook = books.get(String(noToken.token_id));
  if (!yesBook || !noBook) return null;
  const yes = proposedBid(yesBook), no = proposedBid(noBook);
  if (!yes || !no || yes.price <= 0 || no.price <= 0) return null;

  const size = Math.max(Number(market.rewards_min_size), Number(yesBook.min_order_size || 0), Number(noBook.min_order_size || 0));
  const maxDistance = Number(market.rewards_max_spread) / 100;
  const yesMid = midpoint(yesBook, size, { price: yes.price, size });
  const noMid = midpoint(noBook, size, { price: no.price, size });
  if (!Number.isFinite(yesMid) || !Number.isFinite(noMid)) return null;

  const ownQMin = Math.min(
    utility(maxDistance, Math.abs(yes.price - yesMid)) * size,
    utility(maxDistance, Math.abs(no.price - noMid)) * size,
  );
  if (!(ownQMin > 0)) return null;

  const competitorUpperScore = publicUtility(yesBook, yesMid, maxDistance)
    + publicUtility(noBook, noMid, maxDistance);
  const conservativeShareAtB1 = ownQMin / (ownQMin + competitorUpperScore);
  const dailyRate = activeRate(market);
  const estimatedDailyRewardFloor = dailyRate * conservativeShareAtB1;
  const pairedCost = yes.price + no.price;
  const capital = pairedCost * size;
  const pairedFillProfit = (1 - pairedCost) * size;
  const maximumOneLegLoss = Math.max(yes.price, no.price) * size;
  const hoursToEnd = (Date.parse(market.end_date) - Date.now()) / 3600000;
  const payoutEligible = estimatedDailyRewardFloor >= 1;
  const shadowQualified = payoutEligible && pairedCost <= 1 && conservativeShareAtB1 >= 0.0025
    && estimatedDailyRewardFloor / Math.max(capital, 1) >= 0.001;

  return {
    audit_version: 1,
    market_id: String(market.market_id),
    condition_id: market.condition_id,
    event_key: String(market.event_slug || market.market_slug || market.market_id),
    question: market.question,
    event: market.event_slug || "",
    url: `https://polymarket.com/event/${market.event_slug || market.market_slug}`,
    category: categoryFor(market.question),
    clob_token_ids: [String(yesToken.token_id), String(noToken.token_id)],
    reward_daily_rate: dailyRate,
    reward_min_size: size,
    reward_max_spread: Number(market.rewards_max_spread),
    hours_to_end: hoursToEnd,
    yes_quote: yes.price,
    no_quote: no.price,
    yes_adjusted_mid: yesMid,
    no_adjusted_mid: noMid,
    paired_cost: pairedCost,
    required_capital: capital,
    locked_profit: pairedFillProfit,
    maximum_one_leg_loss: maximumOneLegLoss,
    own_q_min: ownQMin,
    competitor_upper_score: competitorUpperScore,
    reward_share_floor: conservativeShareAtB1,
    estimated_reward_floor_daily: estimatedDailyRewardFloor,
    payout_eligible: payoutEligible,
    shadow_qualified: shadowQualified,
    spread: Math.max(yes.bestAsk - yes.bestBid, no.bestAsk - no.bestBid),
    tick_size: Math.min(yes.tick, no.tick),
  };
}

function roundRow(row) {
  const rounded = { ...row };
  for (const key of ["reward_daily_rate", "reward_min_size", "reward_max_spread", "hours_to_end", "yes_quote", "no_quote",
    "yes_adjusted_mid", "no_adjusted_mid", "paired_cost", "required_capital", "locked_profit", "maximum_one_leg_loss",
    "own_q_min", "competitor_upper_score", "reward_share_floor", "estimated_reward_floor_daily", "spread", "tick_size"]) {
    rounded[key] = +Number(row[key]).toFixed(6);
  }
  return rounded;
}

export async function auditLiquidity({ marketLimit = 100, minHoursToEnd = 48 } = {}) {
  const safeLimit = Math.max(10, Math.min(250, Number(marketLimit) || 100));
  const safeHours = Math.max(1, Number(minHoursToEnd) || 48);
  const markets = await fetchRewardMarkets(safeLimit, safeHours);
  const books = await fetchBooks(markets.flatMap((market) => market.tokens.map((token) => String(token.token_id))));
  const evaluated = markets.map((market) => evaluateMarket(market, books)).filter(Boolean);
  const qualified = evaluated.filter((row) => row.shadow_qualified)
    .sort((a, b) => (b.estimated_reward_floor_daily / Math.max(b.required_capital, 1))
      - (a.estimated_reward_floor_daily / Math.max(a.required_capital, 1))
      || b.estimated_reward_floor_daily - a.estimated_reward_floor_daily);
  return {
    generated_at: new Date().toISOString(),
    requested_markets: safeLimit,
    minimum_hours_to_end: safeHours,
    reward_markets: markets.length,
    complete_book_pairs: evaluated.length,
    shadow_qualified: qualified.length,
    methodology: {
      execution: "two resting BUY quotes, one on each complementary outcome; no fill or reward is credited",
      midpoint: "minimum-qualifying-size adjusted midpoint recomputed with the proposed quote",
      competition: "sum of public order utility upper-bounds competitors' aggregate Q_min at a uniform b=1",
      reward_estimate: "single-snapshot lower-share estimate, not a guaranteed payout; $1 daily payout minimum enforced",
      unresolved_risk: "in-game multipliers, future competition, queue priority, fills, and adverse selection require shadow evidence",
    },
    candidates: qualified.slice(0, 50).map(roundRow),
  };
}
