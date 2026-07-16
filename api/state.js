import { get, put } from "@vercel/blob";

const STATE_PATH = process.env.PMA_STATE_PATH || "shared/state.json";
const AGENTS_KEY = "pma_agents_v2";

async function readJsonBlob() {
  const blob = await get(STATE_PATH, { access: "private" });
  if (!blob || blob.statusCode !== 200 || !blob.stream) return null;
  const text = await new Response(blob.stream).text();
  return text ? JSON.parse(text) : null;
}

function agentStateFromItems(items) {
  if (!items || !items[AGENTS_KEY]) return null;
  try {
    return JSON.parse(items[AGENTS_KEY]);
  } catch {
    return null;
  }
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
      return res.status(200).json({ ok: true, state: await readJsonBlob() });
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
      const state = { version: 1, updated_at: new Date().toISOString(), items: body.items };
      await put(STATE_PATH, JSON.stringify(state), {
        access: "private",
        allowOverwrite: true,
        contentType: "application/json",
        cacheControlMaxAge: 60,
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
