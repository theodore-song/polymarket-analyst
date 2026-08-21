import { chromium } from "playwright";
import { pathToFileURL } from "node:url";

export const AGENTS_KEY = "pma_agents_v2";
export const SUGGESTIONS_KEY = "pma_suggestions_v5";
export const ALLOWED_RUNTIME_KEYS = Object.freeze([AGENTS_KEY, SUGGESTIONS_KEY]);
const FORBIDDEN_RUNTIME_KEYS = Object.freeze([
  "pma_paper_accounts_v1",
  "pma_trade_email_alerts_v1",
  "pma_invest_allocations_v1",
  "pma_live_readiness_v1",
  "pma_agent_chat_v1",
  "pma_paid_agent_chat_v1",
]);
const MAX_STATE_BYTES = 900_000;

function required(name, fallback = "") {
  const value = process.env[name] || fallback;
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function validateRuntimeSnapshot(snapshot, expectedBuild = 0, { allowIncomplete = false } = {}) {
  if (!snapshot || typeof snapshot !== "object" || !snapshot.items || typeof snapshot.items !== "object") {
    throw new Error("Autonomous export is not a state snapshot");
  }
  const keys = Object.keys(snapshot.items).sort();
  const allowed = [...ALLOWED_RUNTIME_KEYS].sort();
  if (JSON.stringify(keys) !== JSON.stringify(allowed)) {
    throw new Error(`Autonomous export contains unexpected keys: ${keys.join(", ")}`);
  }
  for (const key of FORBIDDEN_RUNTIME_KEYS) {
    if (Object.prototype.hasOwnProperty.call(snapshot.items, key)) throw new Error(`Private key ${key} cannot enter autonomous state`);
  }
  for (const key of ALLOWED_RUNTIME_KEYS) {
    if (typeof snapshot.items[key] !== "string") throw new Error(`Runtime item ${key} must be serialized JSON`);
    JSON.parse(snapshot.items[key]);
  }
  const agents = JSON.parse(snapshot.items[AGENTS_KEY]);
  const suggestions = JSON.parse(snapshot.items[SUGGESTIONS_KEY]);
  if (!agents.agents || Object.keys(agents.agents).length !== 10) throw new Error("Runtime snapshot must contain ten public agents");
  if (!agents.seeded || !agents.last_cycle_hour) throw new Error("Runtime snapshot has not completed a cycle");
  if (expectedBuild && Number(snapshot.build_version) !== Number(expectedBuild)) {
    throw new Error(`Expected Build ${expectedBuild}, received Build ${snapshot.build_version}`);
  }
  const suggestionCount = (suggestions.suggestions || []).length;
  if (suggestionCount > 300) throw new Error("Runtime suggestion snapshot exceeds the 300-item public limit");
  if (!allowIncomplete && suggestionCount === 0) throw new Error("Runtime cycle produced no live suggestions");
  if (!allowIncomplete && Object.values(agents.agents).some(agent => !agent?.lastDecision)) {
    throw new Error("Runtime cycle did not produce a decision for every agent");
  }
  const bytes = Buffer.byteLength(JSON.stringify(snapshot));
  if (bytes > MAX_STATE_BYTES) throw new Error(`Runtime snapshot is ${bytes} bytes; limit is ${MAX_STATE_BYTES}`);
  return { snapshot, bytes, agents, suggestions };
}

async function githubRequest(path, options = {}) {
  const token = required("GITHUB_TOKEN");
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "polymarket-arena-autonomous-runtime",
      ...(options.headers || {}),
    },
  });
  if (response.status === 404 && options.allowNotFound) return null;
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`GitHub API ${options.method || "GET"} ${path} failed with HTTP ${response.status}: ${body?.message || "unknown error"}`);
  return body;
}

async function ensureRuntimeBranch(repository, branch) {
  const encoded = encodeURIComponent(`heads/${branch}`);
  const current = await githubRequest(`/repos/${repository}/git/ref/${encoded}`, { allowNotFound: true });
  if (current) return;
  await githubRequest(`/repos/${repository}/git/refs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: required("GITHUB_SHA") }),
  });
}

async function readRuntimeFile(repository, branch, pathname) {
  const file = await githubRequest(`/repos/${repository}/contents/${pathname}?ref=${encodeURIComponent(branch)}`, { allowNotFound: true });
  if (!file || file.type !== "file" || !file.content) return { snapshot: null, sha: null };
  try {
    return { snapshot: JSON.parse(Buffer.from(file.content.replace(/\s/g, ""), "base64").toString("utf8")), sha: file.sha };
  } catch {
    throw new Error("Existing runtime state is not valid JSON");
  }
}

async function writeRuntimeFile(repository, branch, pathname, snapshot, sha) {
  const body = {
    message: `Update autonomous paper cycle ${snapshot.last_cycle_hour}`,
    content: Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`).toString("base64"),
    branch,
  };
  if (sha) body.sha = sha;
  await githubRequest(`/repos/${repository}/contents/${pathname}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function waitForProductionBuild(page, arenaUrl, expectedBuild) {
  const deadline = Date.now() + 12 * 60_000;
  while (Date.now() < deadline) {
    await page.goto(`${arenaUrl}?automation=1&build=${expectedBuild}&t=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForFunction(() => Boolean(window.PMA_AUTOMATION), null, { timeout: 20_000 }).catch(() => {});
    const status = await page.evaluate(() => window.PMA_AUTOMATION?.status?.() || null);
    if (Number(status?.build) === expectedBuild) return status;
    await sleep(20_000);
  }
  throw new Error(`Production did not reach Build ${expectedBuild} before the autonomous cycle deadline`);
}

async function main() {
  const repository = required("GITHUB_REPOSITORY", "theodore-song/polymarket-analyst");
  const branch = process.env.RUNTIME_BRANCH || "runtime-state";
  const pathname = process.env.RUNTIME_STATE_PATH || "runtime/state.json";
  const arenaUrl = (process.env.ARENA_URL || "https://polymarket-site-eta.vercel.app").replace(/\/$/, "");
  const expectedBuild = Number(required("EXPECTED_BUILD", "100"));
  await ensureRuntimeBranch(repository, branch);
  const prior = await readRuntimeFile(repository, branch, pathname);
  if (prior.snapshot) validateRuntimeSnapshot(prior.snapshot, 0, { allowIncomplete: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: "block" });
    if (prior.snapshot) {
      await context.addInitScript(({ snapshot, allowedKeys }) => {
        try {
          for (const key of allowedKeys) {
            if (typeof snapshot.items?.[key] === "string") localStorage.setItem(key, snapshot.items[key]);
          }
        } catch {}
      }, { snapshot: prior.snapshot, allowedKeys: ALLOWED_RUNTIME_KEYS });
    }
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(String(error?.message || error)));
    await waitForProductionBuild(page, arenaUrl, expectedBuild);
    await page.waitForFunction(() => {
      const status = window.PMA_AUTOMATION?.status?.();
      return Boolean(status?.seeded && !status?.running);
    }, null, { timeout: 12 * 60_000 });
    await page.evaluate(() => window.PMA_AUTOMATION.runCycle());
    await page.waitForFunction(() => !window.PMA_AUTOMATION?.status?.().running, null, { timeout: 12 * 60_000 });
    const snapshot = await page.evaluate(() => window.PMA_AUTOMATION.exportShared());
    const validated = validateRuntimeSnapshot(snapshot, expectedBuild);
    await writeRuntimeFile(repository, branch, pathname, snapshot, prior.sha);
    const status = await page.evaluate(() => window.PMA_AUTOMATION.status());
    console.log(JSON.stringify({
      ok: true,
      build: status.build,
      cycle: snapshot.last_cycle_hour,
      suggestions: validated.suggestions.suggestions?.length || 0,
      bytes: validated.bytes,
      agent_summary: snapshot.summary?.agents || [],
      page_errors: pageErrors.slice(0, 3),
    }));
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
