import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildObservations } from "../lib/offline-replay.js";

const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";
const ACTIVE_LIMIT = Math.max(0, Math.min(5000, Number(process.env.REPLAY_ACTIVE_MARKETS || 500)));
const CLOSED_LIMIT = Math.max(0, Math.min(5000, Number(process.env.REPLAY_CLOSED_MARKETS || 1000)));
const CLOSED_SKIP = Math.max(0, Math.min(20000, Number(process.env.REPLAY_CLOSED_SKIP || 0)));
const CONCURRENCY = Math.max(1, Math.min(16, Number(process.env.REPLAY_CONCURRENCY || 10)));
const OUTPUT = resolve(process.env.REPLAY_CACHE || "research/cache/adaptive-observations-v1.json");

function parseJson(value) {
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value || "[]"); } catch { return []; }
}

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
    await new Promise((resolveWait) => setTimeout(resolveWait, 500 * (attempt + 1)));
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

function categoryOf(raw) {
  const text = `${raw.question || ""} ${(raw.tags || []).map((tag) => tag.slug || tag.label || "").join(" ")}`.toLowerCase();
  if (/\b(election|president|politic|senate|congress|parliament|minister|governor|government|nominee|primary)\b/.test(text)) return "Politics";
  if (/\b(bitcoin|crypto|ethereum|btc|eth|solana|xrp|token|stablecoin)\b/.test(text)) return "Crypto";
  if (/\b(nba|nfl|nhl|mlb|soccer|football|baseball|basketball|tennis|ufc|boxing|championship|match|game|tournament|league)\b/.test(text)) return "Sports";
  if (/\b(fed|inflation|gdp|recession|stock|company|economy|tariff|interest rate|unemployment|earnings)\b/.test(text)) return "Economy";
  if (/\b(movie|music|album|box office|television|celebrity|award|gaming|youtube|stream)\b/.test(text)) return "Pop Culture";
  return "Other";
}

function marketFromRaw(raw, universe) {
  const id = String(raw.id || "");
  const labels = parseJson(raw.outcomes).map((outcome) => String(outcome).trim().toLowerCase());
  const tokenId = String(parseJson(raw.clobTokenIds)[0] || "");
  if (!id || !tokenId || labels[0] !== "yes" || labels[1] !== "no") return null;
  if (universe === "closed") {
    const outcomes = parseJson(raw.outcomePrices).map(Number);
    const resolved = outcomes.length === 2 && outcomes.every(Number.isFinite)
      && ((outcomes[0] >= 0.99 && outcomes[1] <= 0.01) || (outcomes[1] >= 0.99 && outcomes[0] <= 0.01));
    if (!resolved) return null;
  }
  return {
    id,
    tokenId,
    question: raw.question || "",
    category: categoryOf(raw),
    eventKey: String(raw.events?.[0]?.id || raw.events?.[0]?.slug || raw.eventId || id),
    universe,
  };
}

async function fetchActiveMarkets(limit) {
  const markets = [];
  const seen = new Set();
  const pageSize = 100;
  for (let offset = 0; markets.length < limit && offset < limit * 4; offset += pageSize) {
    const params = new URLSearchParams({ active: "true", closed: "false", archived: "false", include_tag: "true",
      limit: String(pageSize), offset: String(offset), order: "volume24hr", ascending: "false" });
    const page = await fetchJson(`${GAMMA}/markets?${params}`);
    if (!Array.isArray(page) || !page.length) break;
    for (const raw of page) {
      const market = marketFromRaw(raw, "active");
      if (!market || seen.has(market.id)) continue;
      seen.add(market.id);
      markets.push(market);
      if (markets.length >= limit) break;
    }
    if (page.length < pageSize) break;
  }
  return markets;
}

async function fetchClosedMarkets(limit, skip = 0) {
  const markets = [];
  const seen = new Set();
  let skipped = 0;
  let cursor = "";
  while (markets.length < limit) {
    const params = new URLSearchParams({ closed: "true", order: "closedTime", ascending: "false", limit: "100", include_tag: "true" });
    if (cursor) params.set("after_cursor", cursor);
    const payload = await fetchJson(`${GAMMA}/markets/keyset?${params}`);
    const page = payload?.markets;
    if (!Array.isArray(page) || !page.length) break;
    for (const raw of page) {
      const market = marketFromRaw(raw, "closed");
      if (!market || seen.has(market.id)) continue;
      seen.add(market.id);
      if (skipped < skip) {
        skipped++;
        continue;
      }
      markets.push(market);
      if (markets.length >= limit) break;
    }
    if (page.length < 100 || !payload.next_cursor || payload.next_cursor === cursor) break;
    cursor = payload.next_cursor;
  }
  return markets;
}

function chunks(items, size) {
  const output = [];
  for (let index = 0; index < items.length; index += size) output.push(items.slice(index, index + size));
  return output;
}

async function fetchHistories(markets) {
  const batches = chunks(markets, 20);
  const responses = await mapLimit(batches, CONCURRENCY, async (batch, index) => {
    if (index && index % 10 === 0) process.stderr.write(`fetched ${index * 20}/${markets.length}\n`);
    return fetchJson(`${CLOB}/batch-prices-history`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ markets: batch.map((market) => market.tokenId), interval: "max", fidelity: 60 }),
    });
  });
  const byToken = new Map();
  for (const response of responses) {
    if (!response?.history) continue;
    for (const [tokenId, history] of Object.entries(response.history)) byToken.set(tokenId, history || []);
  }
  return { byToken, failures: responses.filter((response) => response?.error).length };
}

const startedAt = Date.now();
const [activeMarkets, closedMarkets] = await Promise.all([fetchActiveMarkets(ACTIVE_LIMIT), fetchClosedMarkets(CLOSED_LIMIT, CLOSED_SKIP)]);
const markets = [...activeMarkets, ...closedMarkets];
const fetched = await fetchHistories(markets);
const histories = markets.map((market) => {
  const points = (fetched.byToken.get(market.tokenId) || []).map((point) => ({ t: Number(point.t), p: Number(point.p) }))
    .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.p)).sort((a, b) => a.t - b.t);
  return { rows: buildObservations(market, points).map((row) => ({ ...row, universe: market.universe })), points: points.length };
});
const rows = histories.flatMap((result) => result.rows);
const payload = {
  schema: "poly-arena-offline-replay-v1",
  generatedAt: new Date().toISOString(),
  requestedMarkets: { active: ACTIVE_LIMIT, closed: CLOSED_LIMIT, closedSkip: CLOSED_SKIP },
  fetchedMarkets: markets.length,
  universeMarkets: { active: activeMarkets.length, closed: closedMarkets.length },
  historiesWithData: histories.filter((result) => result.points).length,
  failures: fetched.failures,
  observationSpacingHours: 6,
  elapsedSeconds: +((Date.now() - startedAt) / 1000).toFixed(2),
  rows,
};
await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(payload)}\n`);
console.log(JSON.stringify({ ...payload, rows: rows.length, cache: OUTPUT }, null, 2));
