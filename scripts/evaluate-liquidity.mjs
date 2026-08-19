const GAMMA = "https://gamma-api.polymarket.com";
const LIMIT = Math.max(100, Math.min(500, Number(process.env.LIQUIDITY_MARKETS || 500)));

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

async function fetchMarkets(limit) {
  const markets = [];
  for (let offset = 0; markets.length < limit && offset < limit * 4; offset += 100) {
    const params = new URLSearchParams({ active: "true", closed: "false", archived: "false", include_tag: "true",
      limit: "100", offset: String(offset), order: "volume24hr", ascending: "false" });
    const page = await fetchJson(`${GAMMA}/markets?${params}`);
    if (!Array.isArray(page) || !page.length) break;
    for (const raw of page) {
      const labels = parseJson(raw.outcomes).map((outcome) => String(outcome).trim().toLowerCase());
      if (labels[0] !== "yes" || labels[1] !== "no") continue;
      markets.push(raw);
      if (markets.length >= limit) break;
    }
    if (page.length < 100) break;
  }
  return markets;
}

function candidate(raw) {
  const bestBid = Number(raw.bestBid), bestAsk = Number(raw.bestAsk), spread = bestAsk - bestBid;
  const dailyRate = (raw.clobRewards || []).reduce((sum, reward) => sum + Number(reward.rewardsDailyRate || 0), 0);
  const minSize = Math.max(Number(raw.rewardsMinSize || 0), Number(raw.orderMinSize || 0), 5);
  const maxSpread = Number(raw.rewardsMaxSpread || 0) / 100;
  const tick = Number(raw.orderPriceMinTickSize || 0.01), dayMove = Math.abs(Number(raw.oneDayPriceChange || 0));
  const yesQuote = bestBid, noQuote = 1 - bestAsk, pairedCost = yesQuote + noQuote;
  const requiredCapital = minSize * pairedCost, lockedProfit = minSize * (1 - pairedCost);
  const scoring = dailyRate > 0 && spread > 0 && minSize > 0 && maxSpread > 0 && spread / 2 <= maxSpread
    && Number.isFinite(yesQuote) && Number.isFinite(noQuote) && yesQuote >= tick && noQuote >= tick;
  return { marketId: String(raw.id || ""), conditionId: raw.conditionId || "", question: raw.question || "",
    url: raw.events?.[0]?.slug ? `https://polymarket.com/event/${raw.events[0].slug}` : "",
    dailyRate, minSize, maxSpread, spread, tick, bestBid, bestAsk, yesQuote, noQuote, pairedCost,
    lockedProfit, requiredCapital, maximumRewardYield: requiredCapital > 0 ? dailyRate / requiredCapital : 0,
    competitiveness: Number(raw.competitive || raw.events?.[0]?.competitive || 0), dayMove,
    volume24hr: Number(raw.volume24hr || 0), liquidity: Number(raw.liquidityNum || raw.liquidity || 0), scoring };
}

const markets = await fetchMarkets(LIMIT), candidates = markets.map(candidate).filter((row) => row.scoring);
const balanced = candidates.filter((row) => row.spread >= 0.02 && row.dayMove <= Math.max(0.02, row.spread)
  && row.liquidity >= 5000 && row.volume24hr >= 2000 && row.requiredCapital <= 5000)
  .sort((a, b) => (b.dailyRate / Math.max(1, b.requiredCapital)) - (a.dailyRate / Math.max(1, a.requiredCapital)) || b.spread - a.spread);
const compact = (row) => ({ ...row, dailyRate: +row.dailyRate.toFixed(3), maxSpread: +row.maxSpread.toFixed(4),
  spread: +row.spread.toFixed(4), bestBid: +row.bestBid.toFixed(4), bestAsk: +row.bestAsk.toFixed(4),
  yesQuote: +row.yesQuote.toFixed(4), noQuote: +row.noQuote.toFixed(4), pairedCost: +row.pairedCost.toFixed(4),
  lockedProfit: +row.lockedProfit.toFixed(2), requiredCapital: +row.requiredCapital.toFixed(2),
  maximumRewardYield: +row.maximumRewardYield.toFixed(4), competitiveness: +row.competitiveness.toFixed(4),
  dayMove: +row.dayMove.toFixed(4), volume24hr: +row.volume24hr.toFixed(2), liquidity: +row.liquidity.toFixed(2) });

console.log(JSON.stringify({ generatedAt: new Date().toISOString(), requestedMarkets: LIMIT, fetchedEligibleMarkets: markets.length,
  rewardScoringMarkets: candidates.length, balancedPairedQuoteCandidates: balanced.length,
  methodology: { fillCredit: "none; scanner identifies resting-quote candidates only",
    rewardCredit: "none; maximumRewardYield assumes an impossible 100% reward share and is ranking context only",
    pairedPayout: "$1 if both complementary bids eventually fill", singleFillRisk: "directional until the complementary quote fills or inventory exits" },
  candidates: balanced.slice(0, 50).map(compact) }, null, 2));
