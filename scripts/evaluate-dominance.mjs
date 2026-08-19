const GAMMA = "https://gamma-api.polymarket.com";
const EVENT_LIMIT = Math.max(20, Math.min(1000, Number(process.env.DOMINANCE_EVENTS || 500)));
const COST_CENTS = Math.max(0, Math.min(5, Number(process.env.DOMINANCE_COST_CENTS || 0.5)));
const MIN_LIQUIDITY = Math.max(0, Number(process.env.DOMINANCE_MIN_LIQUIDITY || 1000));
const MIN_NET_PROFIT = Math.max(0, Number(process.env.DOMINANCE_MIN_NET_PROFIT || 0.003));
const MIN_NET_RETURN = Math.max(0, Number(process.env.DOMINANCE_MIN_NET_RETURN || 0.0015));

function parseJson(value) {
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value || "[]"); } catch { return []; }
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

const THRESHOLD_PATTERNS = [
  { direction: "above", outcomeMode: "over-under", regex: /(\bover\s*\/\s*under\s*(?:[$€£]\s*)?)([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)\s*(k|m|b|%|bps)?\b/i },
  { direction: "above", outcomeMode: "yes-no", regex: /(\b(?:above|over|at least|higher than|greater than)\s*(?:[$€£]\s*)?)([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)\s*(k|m|b|%|bps)?\b/i },
  { direction: "below", outcomeMode: "yes-no", regex: /(\b(?:below|(?<!\/)under|at most|lower than|less than)\s*(?:[$€£]\s*)?)([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)\s*(k|m|b|%|bps)?\b/i },
];

function parseThreshold(question) {
  const text = String(question || "").trim();
  for (const pattern of THRESHOLD_PATTERNS) {
    const match = pattern.regex.exec(text);
    if (!match) continue;
    const rawValue = Number(match[2].replaceAll(",", ""));
    const suffix = String(match[3] || "").toLowerCase();
    const multiplier = suffix === "k" ? 1e3 : suffix === "m" ? 1e6 : suffix === "b" ? 1e9 : 1;
    const value = rawValue * multiplier;
    if (!Number.isFinite(value)) continue;
    const valueStart = match.index + match[1].length, valueEnd = valueStart + match[2].length;
    const stem = `${text.slice(0, valueStart)}{threshold}${text.slice(valueEnd)}`.toLowerCase().replace(/\s+/g, " ").trim();
    return { direction: pattern.direction, outcomeMode: pattern.outcomeMode, value, stem };
  }
  return null;
}

function quoteMarket(raw, event) {
  const threshold = parseThreshold(raw.question);
  const tokens = parseJson(raw.clobTokenIds).map(String), prices = parseJson(raw.outcomePrices).map(number);
  const outcomes = parseJson(raw.outcomes).map((outcome) => String(outcome).trim().toLowerCase());
  const bid = number(raw.bestBid), ask = number(raw.bestAsk), liquidity = number(raw.liquidityNum || raw.liquidity) || 0;
  const expectedOutcomes = threshold?.outcomeMode === "over-under" ? ["over", "under"] : ["yes", "no"];
  if (!threshold || tokens.length !== 2 || prices.length !== 2 || outcomes[0] !== expectedOutcomes[0] || outcomes[1] !== expectedOutcomes[1] || !tokens[0] || !tokens[1]
    || bid == null || ask == null || bid < 0 || ask > 1 || ask < bid || liquidity < MIN_LIQUIDITY
    || raw.closed || raw.active === false || raw.acceptingOrders === false) return null;
  return { ...threshold, marketId: String(raw.id || ""), question: raw.question || "", yesBid: bid, yesAsk: ask,
    yesMid: prices[0], noMid: prices[1], yesToken: tokens[0], noToken: tokens[1], liquidity,
    url: event.slug ? `https://polymarket.com/event/${event.slug}` : "" };
}

function evaluateEvent(event) {
  const quotes = (Array.isArray(event.markets) ? event.markets : []).map((market) => quoteMarket(market, event)).filter(Boolean);
  const groups = new Map();
  for (const quote of quotes) {
    const key = `${quote.direction}|${quote.stem}`;
    const group = groups.get(key) || [];
    group.push(quote); groups.set(key, group);
  }
  const candidates = [];
  for (const group of groups.values()) {
    if (group.length < 2 || new Set(group.map((quote) => quote.value)).size !== group.length) continue;
    const ordered = [...group].sort((a, b) => a.value - b.value);
    for (let left = 0; left < ordered.length - 1; left++) {
      for (let right = left + 1; right < ordered.length; right++) {
        const lower = ordered[left], higher = ordered[right];
        const superset = lower.direction === "above" ? lower : higher;
        const subset = lower.direction === "above" ? higher : lower;
        const yesEntry = superset.yesAsk + COST_CENTS / 100;
        const noEntry = 1 - subset.yesBid + COST_CENTS / 100;
        const cost = yesEntry + noEntry, profit = 1 - cost, netReturn = cost > 0 ? profit / cost : 0;
        candidates.push({ eventId: String(event.id || ""), title: event.title || "", direction: lower.direction,
          supersetThreshold: superset.value, subsetThreshold: subset.value, cost, payout: 1, profit, netReturn,
          minimumLiquidity: Math.min(superset.liquidity, subset.liquidity), url: superset.url,
          legs: [{ marketId: superset.marketId, question: superset.question, side: "YES", entry: yesEntry },
            { marketId: subset.marketId, question: subset.question, side: "NO", entry: noEntry }] });
      }
    }
  }
  return candidates;
}

const events = await fetchEvents(EVENT_LIMIT);
const candidates = events.flatMap(evaluateEvent).sort((a, b) => b.netReturn - a.netReturn);
const actionable = candidates.filter((candidate) => candidate.profit >= MIN_NET_PROFIT && candidate.netReturn >= MIN_NET_RETURN);
const compact = (candidate) => ({ eventId: candidate.eventId, title: candidate.title, direction: candidate.direction,
  supersetThreshold: candidate.supersetThreshold, subsetThreshold: candidate.subsetThreshold,
  cost: +candidate.cost.toFixed(4), payout: candidate.payout, profit: +candidate.profit.toFixed(4),
  netReturn: +candidate.netReturn.toFixed(4), minimumLiquidity: +candidate.minimumLiquidity.toFixed(2),
  url: candidate.url, legs: candidate.legs.map((leg) => ({ ...leg, entry: +leg.entry.toFixed(4) })) });

console.log(JSON.stringify({ generatedAt: new Date().toISOString(), requestedEvents: EVENT_LIMIT, fetchedEvents: events.length,
  eligibleDominancePairs: candidates.length, actionablePairs: actionable.length, estimatedCostCentsPerLeg: COST_CENTS,
  minimumLiquidityPerLeg: MIN_LIQUIDITY, minimumNetProfitPerPair: MIN_NET_PROFIT, minimumNetReturn: MIN_NET_RETURN,
  actionable: actionable.slice(0, 50).map(compact), bestObserved: candidates.slice(0, 20).map(compact) }, null, 2));
