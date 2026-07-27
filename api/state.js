import { get, list, put } from "@vercel/blob";

const STATE_PATH = process.env.PMA_STATE_PATH || "shared/state.json";
const STATE_VERSION_PREFIX = process.env.PMA_STATE_VERSION_PREFIX || "shared/state-versions/";
const AGENTS_KEY = "pma_agents_v2";
const SUG_KEY = "pma_suggestions_v5";
const PAPER_KEY = "pma_paper_accounts_v1";
const LIVE_KEY = "pma_live_readiness_v1";
const AGENT_IDS = ["value", "momentum", "favorite", "longshot", "diversifier", "copycat", "whale1", "whale2", "whale3", "whale4"];
const LIMITS = { closed: 80, history: 160, snapshots: 240, suggestions: 900, paperHistory: 120, paperSnapshots: 120, audit: 120 };

async function readJsonBlob() {
  const latest = await latestVersionedStateBlob();
  if (latest) return latest;
  const blob = await get(STATE_PATH, { access: "private" });
  if (!blob || blob.statusCode !== 200 || !blob.stream) return null;
  const text = await new Response(blob.stream).text();
  return text ? JSON.parse(text) : null;
}

async function latestVersionedStateBlob() {
  let cursor;
  let newest = null;
  do {
    const page = await list({ prefix: STATE_VERSION_PREFIX, limit: 1000, cursor });
    for (const blob of page.blobs || []) {
      if (!newest || new Date(blob.uploadedAt).getTime() > new Date(newest.uploadedAt).getTime()) newest = blob;
    }
    cursor = page.cursor;
  } while (cursor);
  if (!newest) return null;
  const blob = await get(newest.url, {
    access: "private",
    headers: { "cache-control": "no-cache" },
  });
  if (!blob || blob.statusCode !== 200 || !blob.stream) return null;
  const text = await new Response(blob.stream).text();
  return text ? JSON.parse(text) : null;
}

function cycleVersion(cycle = "") {
  const m = String(cycle).match(/\|v(\d+)$/);
  return m ? Number(m[1]) : 0;
}

function openPositionCount(st) {
  if (!st || !st.agents) return 0;
  return AGENT_IDS.reduce((sum, id) => sum + (Array.isArray(st.agents[id]?.positions) ? st.agents[id].positions.length : 0), 0);
}

function shouldRejectStaleAgentWrite(currentAgents, incomingAgents) {
  if (!currentAgents || !incomingAgents) return false;
  const currentCycle = currentAgents.last_cycle_hour || "";
  const incomingCycle = incomingAgents.last_cycle_hour || "";
  if (!currentCycle || !incomingCycle) return false;
  const currentVersion = cycleVersion(currentCycle);
  const incomingVersion = cycleVersion(incomingCycle);
  if (incomingVersion < currentVersion) return true;
  if (incomingVersion === currentVersion && incomingCycle < currentCycle) return true;
  const currentOpen = openPositionCount(currentAgents);
  const incomingOpen = openPositionCount(incomingAgents);
  return incomingVersion === currentVersion && incomingCycle === currentCycle && currentOpen > 0 && incomingOpen === 0;
}

function agentStateFromItems(items) {
  if (!items || !items[AGENTS_KEY]) return null;
  try {
    return JSON.parse(items[AGENTS_KEY]);
  } catch {
    return null;
  }
}

function compactPortfolio(p) {
  if (!p || typeof p !== "object") return p;
  const out = { ...p };
  out.positions = Array.isArray(p.positions) ? p.positions : [];
  out.closed = Array.isArray(p.closed) ? p.closed.slice(-LIMITS.closed) : [];
  out.history = Array.isArray(p.history) ? p.history.slice(-LIMITS.history) : [];
  out.snapshots = Array.isArray(p.snapshots) ? p.snapshots.slice(-LIMITS.snapshots) : [];
  if (p.stopped && typeof p.stopped === "object") out.stopped = Object.fromEntries(Object.entries(p.stopped).slice(-80));
  return out;
}

function compactAgentState(st) {
  if (!st || typeof st !== "object") return st;
  const out = { ...st, agents: {} };
  for (const id of AGENT_IDS) {
    out.agents[id] = compactPortfolio(st.agents && st.agents[id]);
  }
  out.whales = st.whales || {};
  return out;
}

function compactSuggestion(s) {
  if (!s || typeof s !== "object") return s;
  return {
    market_id: s.market_id, question: s.question, event: s.event, url: s.url, category: s.category,
    clob_yes: s.clob_yes, clob_no: s.clob_no, yes_price: s.yes_price, no_price: s.no_price,
    fair_value: s.fair_value, edge: s.edge, side: s.side, entry_price: s.entry_price,
    net_edge: s.net_edge, friction: s.friction, chase_penalty: s.chase_penalty,
    evidence_score: s.evidence_score, quality: s.quality,
    conviction: s.conviction, volume: s.volume, volume_24hr: s.volume_24hr, liquidity: s.liquidity,
    trade_ready: s.trade_ready, watch_only: s.watch_only,
    days_to_resolution: s.days_to_resolution, drivers: s.drivers, rationale: s.rationale,
  };
}

function compactSuggestions(payload) {
  if (!payload || typeof payload !== "object") return payload;
  return { ...payload, suggestions: (payload.suggestions || []).slice(0, LIMITS.suggestions).map(compactSuggestion) };
}

function compactPaperStore(store) {
  if (!store || typeof store !== "object" || !store.accounts) return store;
  const accounts = {};
  for (const [id, acct] of Object.entries(store.accounts)) {
    accounts[id] = {
      ...acct,
      history: Array.isArray(acct.history) ? acct.history.slice(-LIMITS.paperHistory) : [],
      snapshots: Array.isArray(acct.snapshots) ? acct.snapshots.slice(-LIMITS.paperSnapshots) : [],
    };
  }
  return { ...store, accounts };
}

function compactItems(items) {
  const out = { ...(items || {}) };
  try { if (out[AGENTS_KEY]) out[AGENTS_KEY] = JSON.stringify(compactAgentState(JSON.parse(out[AGENTS_KEY]))); } catch {}
  try { if (out[SUG_KEY]) out[SUG_KEY] = JSON.stringify(compactSuggestions(JSON.parse(out[SUG_KEY]))); } catch {}
  try { if (out[PAPER_KEY]) out[PAPER_KEY] = JSON.stringify(compactPaperStore(JSON.parse(out[PAPER_KEY]))); } catch {}
  try {
    if (out[LIVE_KEY]) {
      const live = JSON.parse(out[LIVE_KEY]);
      if (Array.isArray(live.audit)) live.audit = live.audit.slice(-LIMITS.audit);
      out[LIVE_KEY] = JSON.stringify(live);
    }
  } catch {}
  return out;
}

function conflictResponse(res, error, current) {
  return res.status(409).json({ ok: false, error, state: current });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.VERCEL_OIDC_TOKEN) {
      return res.status(503).json({ ok: false, error: "Cloud state is not configured" });
    }

    if (req.method === "GET") {
      const state = await readJsonBlob();
      if (state && state.items) state.items = compactItems(state.items);
      return res.status(200).json({ ok: true, state });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      if (!body || typeof body !== "object" || !body.items || typeof body.items !== "object") {
        return res.status(400).json({ ok: false, error: "Invalid state payload" });
      }
      const current = await readJsonBlob();
      const currentAgents = agentStateFromItems(current && current.items);
      const incomingAgents = agentStateFromItems(body.items);
      if (!body.force && currentAgents) {
        const currentCycle = currentAgents.last_cycle_hour || "";
        const incomingCycle = incomingAgents && incomingAgents.last_cycle_hour ? incomingAgents.last_cycle_hour : "";
        if (currentCycle && (!incomingAgents || !incomingCycle)) {
          return conflictResponse(res, "Cloud already has a cycle result; refusing unscheduled local state", current);
        }
        if (currentCycle && incomingCycle && incomingCycle < currentCycle) {
          return conflictResponse(res, "Incoming state is older than the shared cloud result", current);
        }
        const sameCycle = currentCycle && currentCycle === incomingCycle;
        const differentRun = currentAgents.last_run && incomingAgents.last_run && currentAgents.last_run !== incomingAgents.last_run;
        if (sameCycle && differentRun) {
          return conflictResponse(res, "This cycle already has a cloud result", current);
        }
      }
      if (!body.force && shouldRejectStaleAgentWrite(currentAgents, incomingAgents)) {
        return conflictResponse(res, "Incoming state would replace newer active positions with stale cash-only data", current);
      }
      const state = { version: 1, updated_at: new Date().toISOString(), items: compactItems(body.items) };
      const versionedPath = `${STATE_VERSION_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
      await put(versionedPath, JSON.stringify(state), {
        access: "private",
        allowOverwrite: false,
        contentType: "application/json",
        cacheControlMaxAge: 0,
      });
      await put(STATE_PATH, JSON.stringify(state), {
        access: "private",
        allowOverwrite: true,
        contentType: "application/json",
        cacheControlMaxAge: 0,
      });
      return res.status(200).json({ ok: true, state });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (err) {
    const message = err && err.message ? err.message : "State sync failed";
    return res.status(500).json({ ok: false, error: message });
  }
}
