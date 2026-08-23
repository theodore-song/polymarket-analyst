const GAMMA = "https://gamma-api.polymarket.com";
const EVENT_LIMIT = Math.max(20, Math.min(1000, Number(process.env.NEG_RISK_EVENTS || 300)));
const COST_CENTS = Math.max(0, Math.min(5, Number(process.env.NEG_RISK_COST_CENTS || 0.5)));
const MIN_LIQUIDITY = Math.max(0, Number(process.env.NEG_RISK_MIN_LIQUIDITY || 1000));
const MIN_NET_PROFIT = Math.max(0, Number(process.env.NEG_RISK_MIN_NET_PROFIT || 0.001));
const MIN_NET_RETURN = Math.max(0, Number(process.env.NEG_RISK_MIN_NET_RETURN || 0.0015));

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

function parseJson(value) {
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value || "[]"); } catch { return []; }
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchEvents(limit) {
  const events = [], pageSize = 100;
  for (let offset = 0; offset < limit; offset += pageSize) {
    const size = Math.min(pageSize, limit - offset);
    const params = new URLSearchParams({ active: "true", closed: "false", archived: "false",
      limit: String(size), offset: String(offset), order: "volume24hr", ascending: "false" });
    const page = await fetchJson(`${GAMMA}/events?${params}`);
    if (!Array.isArray(page) || !page.length) break;
    events.push(...page);
    if (page.length < size) break;
  }
  return events.slice(0, limit);
}

function evaluateEvent(event) {
  if (!event?.negRisk || event.enableNegRisk === false) return null;
  const allMarkets = Array.isArray(event.markets) ? event.markets : [];
  if (allMarkets.length < 2 || allMarkets.some((market) => market.closed || market.active === false || market.acceptingOrders === false)) return null;
  const legs = allMarkets.map((market) => {
    const outcomes = parseJson(market.outcomes).map((outcome) => String(outcome).trim().toLowerCase());
    const prices = parseJson(market.outcomePrices).map(number);
    return { id: String(market.id || ""), question: market.question || "", yes: prices[0],
      binaryLabels: outcomes[0] === "yes" && outcomes[1] === "no",
      bid: number(market.bestBid), ask: number(market.bestAsk), liquidity: number(market.liquidityNum || market.liquidity) || 0 };
  });
  if (legs.some((leg) => !leg.binaryLabels || !leg.id || leg.yes == null || leg.bid == null || leg.ask == null
    || leg.bid < 0 || leg.ask > 1 || leg.ask < leg.bid || leg.liquidity < MIN_LIQUIDITY)) return null;
  const count = legs.length, costPerLeg = COST_CENTS / 100;
  const yesCost = legs.reduce((sum, leg) => sum + leg.ask, 0) + count * costPerLeg;
  const yesProfit = 1 - yesCost;
  const noCost = count - legs.reduce((sum, leg) => sum + leg.bid, 0) + count * costPerLeg;
  const noProfit = count - 1 - noCost;
  const yesReturn = yesCost > 0 ? yesProfit / yesCost : 0;
  const noReturn = noCost > 0 ? noProfit / noCost : 0;
  const side = yesReturn >= noReturn ? "YES_BUNDLE" : "NO_BUNDLE";
  return { eventId: String(event.id || ""), title: event.title || "", slug: event.slug || "", markets: count,
    minimumLiquidity: Math.min(...legs.map((leg) => leg.liquidity)), side,
    executableCost: side === "YES_BUNDLE" ? yesCost : noCost,
    worstCasePayout: side === "YES_BUNDLE" ? 1 : count - 1,
    netProfitPerBundle: side === "YES_BUNDLE" ? yesProfit : noProfit,
    netReturn: side === "YES_BUNDLE" ? yesReturn : noReturn,
    theoreticalYesSum: legs.reduce((sum, leg) => sum + leg.yes, 0), legs };
}

const events = await fetchEvents(EVENT_LIMIT);
const evaluated = events.map(evaluateEvent).filter(Boolean).sort((a, b) => b.netReturn - a.netReturn);
const actionable = evaluated.filter((event) => event.netProfitPerBundle >= MIN_NET_PROFIT && event.netReturn >= MIN_NET_RETURN);
const compact = (event) => ({ eventId: event.eventId, title: event.title, markets: event.markets, side: event.side,
  executableCost: +event.executableCost.toFixed(4), worstCasePayout: event.worstCasePayout,
  netProfitPerBundle: +event.netProfitPerBundle.toFixed(4), netReturn: +event.netReturn.toFixed(4),
  minimumLiquidity: +event.minimumLiquidity.toFixed(2), theoreticalYesSum: +event.theoreticalYesSum.toFixed(4),
  url: event.slug ? `https://polymarket.com/event/${event.slug}` : "" });

console.log(JSON.stringify({ generatedAt: new Date().toISOString(), requestedEvents: EVENT_LIMIT,
  fetchedEvents: events.length, eligibleNegativeRiskEvents: evaluated.length, actionableBundles: actionable.length,
  estimatedCostCentsPerLeg: COST_CENTS, minimumLiquidityPerLeg: MIN_LIQUIDITY,
  minimumNetProfitPerBundle: MIN_NET_PROFIT, minimumNetReturn: MIN_NET_RETURN,
  actionable: actionable.slice(0, 50).map(compact), bestObserved: evaluated.slice(0, 20).map(compact) }, null, 2));
