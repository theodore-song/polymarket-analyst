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
const TRANSPORT_HISTORY_LIMIT = 24;
const TRANSPORT_SNAPSHOT_LIMIT = 96;
const TRANSPORT_MAKER_OUTCOME_LIMIT = 30;
const TRANSPORT_BUNDLE_MAKER_OUTCOME_LIMIT = 30;
const TRANSPORT_TARGET_BYTES = 850_000;
const TRANSPORT_HISTORY_FLOOR = 12;
const TRANSPORT_MAKER_OUTCOME_FLOOR = 12;
const TRANSPORT_BUNDLE_MAKER_OUTCOME_FLOOR = 12;
const TRANSPORT_SUGGESTION_FLOOR = 240;
const TRANSPORT_SIGNAL_OUTCOME_RESERVE = 144;
const TRANSPORT_SNAPSHOT_FALLBACKS = Object.freeze([72, 48, 24]);

export function followUpCycleDelay(now = Date.now()) {
  const offset = ((Number(now) % 60_000) + 60_000) % 60_000;
  return Math.max(15_000, 65_000 - offset);
}

async function runArenaCycle(page) {
  await page.evaluate(() => window.PMA_AUTOMATION.runCycle());
  await page.waitForFunction(() => !window.PMA_AUTOMATION?.status?.().running, null, { timeout: 12 * 60_000 });
}

function sampleSnapshots(rows, limit = TRANSPORT_SNAPSHOT_LIMIT) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length <= limit) return list;
  const recentCount = Math.min(24, limit);
  const older = list.slice(0, -recentCount);
  const olderSlots = limit - recentCount;
  const sampled = [];
  for (let i = 0; i < olderSlots; i += 1) {
    const index = olderSlots === 1 ? older.length - 1 : Math.round(i * (older.length - 1) / (olderSlots - 1));
    if (older[index] && sampled.at(-1) !== older[index]) sampled.push(older[index]);
  }
  return sampled.concat(list.slice(-recentCount)).slice(-limit);
}

function compactHistoryRow(row) {
  if (!row || typeof row !== "object") return row;
  return {
    date: row.date,
    action: row.action,
    question: typeof row.question === "string" ? row.question.slice(0, 140) : row.question,
    side: row.side,
    detail: typeof row.detail === "string" ? row.detail.slice(0, 220) : row.detail,
  };
}

function compactPublicSuggestion(suggestion) {
  if (!suggestion || typeof suggestion !== "object") return suggestion;
  const out = { ...suggestion };
  if (suggestion.trade_ready || suggestion.adaptive_probation || suggestion.bundle_id) {
    out.drivers = Array.isArray(suggestion.drivers) ? suggestion.drivers.slice(0, 1).map(value => String(value).slice(0, 80)) : [];
    out.rationale = typeof suggestion.rationale === "string"
      ? suggestion.rationale.slice(0, 180)
      : "Trade-ready opportunity passed the active execution gate.";
  } else {
    out.drivers = [];
    out.rationale = suggestion.jump_risk
      ? "Watch only: settlement-gap risk prevents a protected entry."
      : suggestion.signal_type && suggestion.signal_type !== "none"
        ? "Watch only: gathering independent forward evidence before capital is enabled."
        : "Watch only: no independently confirmed direction yet.";
    delete out.clob_yes;
    delete out.clob_no;
  }
  return out;
}

function compactDecision(decision) {
  if (!decision || typeof decision !== "object") return decision;
  const out = { ...decision };
  if (out.makerProfile && typeof out.makerProfile === "object") {
    out.makerProfile = { version: out.makerProfile.version, outcomes: out.makerProfile.outcomes, global: out.makerProfile.global };
  }
  if (out.bundleMakerProfile && typeof out.bundleMakerProfile === "object") out.bundleMakerProfile = { ...out.bundleMakerProfile };
  if (out.learning && typeof out.learning === "object") {
    out.learning = { ...out.learning };
    delete out.learning.buckets;
    delete out.learning.current_buckets;
  }
  if (out.marketLearning && typeof out.marketLearning === "object") {
    out.marketLearning = { ...out.marketLearning };
    delete out.marketLearning.buckets;
  }
  return out;
}

function compactMakerOutcome(row) {
  if (!row || typeof row !== "object") return row;
  return {
    quote_id: row.quote_id, market_id: row.market_id, event_key: row.event_key, category: row.category,
    spread: row.spread, spread_band: row.spread_band, reward_yield_band: row.reward_yield_band,
    price_balance_band: row.price_balance_band, day_move_band: row.day_move_band, margin_band: row.margin_band,
    competition_band: row.competition_band, status: row.status,
    pnl: row.pnl, shadow_only: row.shadow_only, deployed_capital: row.deployed_capital, reserved_capital: row.reserved_capital,
    completed_at: row.completed_at, strategy_version: row.strategy_version, maker_strategy_version: row.maker_strategy_version,
  };
}

function compactBundleMakerOutcome(row) {
  if (!row || typeof row !== "object") return row;
  return {
    quote_id: row.quote_id, event_key: row.event_key, bundle_id: row.bundle_id, logic: row.logic, owner_id: row.owner_id,
    status: row.status, pnl: row.pnl, shadow_only: row.shadow_only, deployed_capital: row.deployed_capital,
    return_on_reserved: row.return_on_reserved, created_at: row.created_at, completed_at: row.completed_at,
    hours_to_outcome: row.hours_to_outcome, strategy_version: row.strategy_version,
    bundle_maker_strategy_version: row.bundle_maker_strategy_version, build_version: row.build_version,
  };
}

export function compactRuntimeTransportSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || !snapshot.items) return snapshot;
  const out = { ...snapshot, items: { ...snapshot.items } };
  let state;
  let suggestions;
  try {
    state = JSON.parse(out.items[AGENTS_KEY]);
    suggestions = JSON.parse(out.items[SUGGESTIONS_KEY]);
  } catch {
    return out;
  }
  for (const portfolio of Object.values(state.agents || {})) {
    portfolio.history = (portfolio.history || []).slice(-TRANSPORT_HISTORY_LIMIT).map(compactHistoryRow);
    portfolio.snapshots = sampleSnapshots(portfolio.snapshots, TRANSPORT_SNAPSHOT_LIMIT);
    portfolio.maker_outcomes = (portfolio.maker_outcomes || []).slice(-TRANSPORT_MAKER_OUTCOME_LIMIT).map(compactMakerOutcome);
    portfolio.bundle_maker_quotes = (portfolio.bundle_maker_quotes || []).slice(-2);
    portfolio.bundle_maker_outcomes = (portfolio.bundle_maker_outcomes || []).slice(-TRANSPORT_BUNDLE_MAKER_OUTCOME_LIMIT).map(compactBundleMakerOutcome);
    portfolio.lastDecision = compactDecision(portfolio.lastDecision);
  }
  suggestions.suggestions = (suggestions.suggestions || []).slice(0, 300).map(compactPublicSuggestion);
  const writeItems = () => {
    out.items[AGENTS_KEY] = JSON.stringify(state);
    out.items[SUGGESTIONS_KEY] = JSON.stringify(suggestions);
    return Buffer.byteLength(JSON.stringify(out));
  };
  let bytes = writeItems();
  if (bytes > TRANSPORT_TARGET_BYTES) {
    for (const portfolio of Object.values(state.agents || {})) {
      portfolio.history = (portfolio.history || []).slice(-TRANSPORT_HISTORY_FLOOR);
      portfolio.maker_outcomes = (portfolio.maker_outcomes || []).slice(-TRANSPORT_MAKER_OUTCOME_FLOOR);
      portfolio.bundle_maker_outcomes = (portfolio.bundle_maker_outcomes || []).slice(-TRANSPORT_BUNDLE_MAKER_OUTCOME_FLOOR);
    }
    suggestions.suggestions = suggestions.suggestions.slice(0, TRANSPORT_SUGGESTION_FLOOR);
    bytes = writeItems();
  }
  const ledger = state.signal_ledger && typeof state.signal_ledger === "object" ? state.signal_ledger : null;
  const pending = Array.isArray(ledger?.pending) ? ledger.pending : [];
  const outcomes = Array.isArray(ledger?.outcomes) ? ledger.outcomes : [];
  if (bytes > TRANSPORT_TARGET_BYTES && ledger) {
    ledger.pending = [];
    ledger.outcomes = outcomes.slice(-Math.min(TRANSPORT_SIGNAL_OUTCOME_RESERVE, outcomes.length));
    bytes = writeItems();

    for (const limit of TRANSPORT_SNAPSHOT_FALLBACKS) {
      if (bytes <= TRANSPORT_TARGET_BYTES) break;
      for (const portfolio of Object.values(state.agents || {})) {
        portfolio.snapshots = sampleSnapshots(portfolio.snapshots, limit);
      }
      bytes = writeItems();
    }

    if (bytes > TRANSPORT_TARGET_BYTES && ledger.outcomes.length) {
      let low = 0;
      let high = ledger.outcomes.length;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        ledger.outcomes = outcomes.slice(-mid);
        if (writeItems() <= TRANSPORT_TARGET_BYTES) low = mid;
        else high = mid - 1;
      }
      ledger.outcomes = low ? outcomes.slice(-low) : [];
      bytes = writeItems();
    }

    let pendingLow = 0;
    let pendingHigh = pending.length;
    while (pendingLow < pendingHigh) {
      const mid = Math.ceil((pendingLow + pendingHigh) / 2);
      ledger.pending = pending.slice(0, mid);
      if (writeItems() <= TRANSPORT_TARGET_BYTES) pendingLow = mid;
      else pendingHigh = mid - 1;
    }
    ledger.pending = pending.slice(0, pendingLow);
    bytes = writeItems();

    if (pendingLow === pending.length && ledger.outcomes.length < outcomes.length) {
      let outcomeLow = ledger.outcomes.length;
      let outcomeHigh = outcomes.length;
      while (outcomeLow < outcomeHigh) {
        const mid = Math.ceil((outcomeLow + outcomeHigh) / 2);
        ledger.outcomes = outcomes.slice(-mid);
        if (writeItems() <= TRANSPORT_TARGET_BYTES) outcomeLow = mid;
        else outcomeHigh = mid - 1;
      }
      ledger.outcomes = outcomeLow ? outcomes.slice(-outcomeLow) : [];
      writeItems();
    }
  }
  const syncLedgerSummary = () => {
    if (!out.summary?.signal_ledger || !ledger) return;
    out.summary.signal_ledger.pending_retained = ledger.pending.length;
    out.summary.signal_ledger.pending_total = Math.max(Number(out.summary.signal_ledger.pending_total || 0), pending.length);
    out.summary.signal_ledger.outcomes_retained = ledger.outcomes.length;
    out.summary.signal_ledger.outcomes_total = Math.max(Number(out.summary.signal_ledger.outcomes_total || 0), outcomes.length);
    out.summary.signal_ledger.byte_budget = TRANSPORT_TARGET_BYTES;
  };
  syncLedgerSummary();
  bytes = writeItems();
  while (bytes > TRANSPORT_TARGET_BYTES && ledger?.pending.length) {
    ledger.pending.pop();
    syncLedgerSummary();
    bytes = writeItems();
  }
  while (bytes > TRANSPORT_TARGET_BYTES && ledger?.outcomes.length) {
    ledger.outcomes.shift();
    syncLedgerSummary();
    bytes = writeItems();
  }
  return out;
}

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
    if (Number(status?.build) > expectedBuild) {
      throw new Error(`Production already advanced to Build ${status.build}; retiring stale Build ${expectedBuild} runner`);
    }
    await sleep(20_000);
  }
  throw new Error(`Production did not reach Build ${expectedBuild} before the autonomous cycle deadline`);
}

async function main() {
  const repository = required("GITHUB_REPOSITORY", "theodore-song/polymarket-analyst");
  const branch = process.env.RUNTIME_BRANCH || "runtime-state";
  const pathname = process.env.RUNTIME_STATE_PATH || "runtime/state.json";
  const arenaUrl = (process.env.ARENA_URL || "https://polymarket-site-eta.vercel.app").replace(/\/$/, "");
  const expectedBuild = Number(required("EXPECTED_BUILD", "121"));
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
    await runArenaCycle(page);
    await page.waitForTimeout(followUpCycleDelay());
    await runArenaCycle(page);
    const rawSnapshot = await page.evaluate(({ agentKey, suggestionsKey }) => {
      const snapshot = window.PMA_AUTOMATION.exportShared();
      const agents = localStorage.getItem(agentKey);
      const suggestions = localStorage.getItem(suggestionsKey);
      if (agents) snapshot.items[agentKey] = agents;
      if (suggestions) snapshot.items[suggestionsKey] = suggestions;
      return snapshot;
    }, { agentKey: AGENTS_KEY, suggestionsKey: SUGGESTIONS_KEY });
    const snapshot = compactRuntimeTransportSnapshot(rawSnapshot);
    const validated = validateRuntimeSnapshot(snapshot, expectedBuild);
    await writeRuntimeFile(repository, branch, pathname, snapshot, prior.sha);
    const status = await page.evaluate(() => window.PMA_AUTOMATION.status());
    console.log(JSON.stringify({
      ok: true,
      build: status.build,
      cycle: snapshot.last_cycle_hour,
      cycle_passes: 2,
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
