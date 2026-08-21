import assert from "node:assert/strict";
import fs from "node:fs";
import { ALLOWED_RUNTIME_KEYS, validateRuntimeSnapshot } from "./run-autonomous-cycle.mjs";

const index = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../api/state.js", import.meta.url), "utf8");
const workflow = fs.readFileSync(new URL("../.github/workflows/autonomous-cycle.yml", import.meta.url), "utf8");
const runner = fs.readFileSync(new URL("./run-autonomous-cycle.mjs", import.meta.url), "utf8");
const resolutionAudit = JSON.parse(fs.readFileSync(new URL("../research/resolution-week-no-audit.json", import.meta.url), "utf8"));
const build = Number(index.match(/const BUILD_VERSION = (\d+);/)?.[1]);

assert.equal(build, 98);
assert.deepEqual([...ALLOWED_RUNTIME_KEYS].sort(), ["pma_agents_v2", "pma_suggestions_v5"]);
assert.match(index, /function collectPublicRuntimeItems\(\)/);
assert.match(index, /const PUBLIC_RUNTIME_KEYS=Object\.freeze\(\[AGENTS_KEY,SUG_KEY\]\)/);
assert.match(index, /suggestions:300/);
assert.match(index, /window\.PMA_AUTOMATION=Object\.freeze/);
assert.match(index, /if\(CLOUD_STATE_HEALTH\.read_only\)return false/);
assert.match(index, /function autonomousRuntimeControlsCycle/);
assert.match(index, /if\(CYCLE_RUNNING\|\|autonomousRuntimeControlsCycle\(\)\)return/);
assert.match(index, /btn\.textContent="Auto cycle"/);
assert.match(api, /runtime-state\/runtime\/state\.json/);
assert.match(api, /sanitizeGithubRuntimeState/);
assert.match(api, /api\.github\.com\/repos\/theodore-song\/polymarket-analyst\/contents\/runtime\/state\.json/);
assert.match(api, /Buffer\.from\(file\.content/);
assert.match(api, /searchParams\.set\("runtime", `\$\{Date\.now\(\)\}/);
assert.match(workflow, /cron: "2,7,12,17,22,27,32,37,42,47,52,57 \* \* \* \*"/);
assert.match(workflow, /contents: write/);
assert.match(workflow, /EXPECTED_BUILD: "98"/);
assert.match(index, /const NEG_RISK_EVENT_SCAN_LIMIT=1000;/);
assert.match(index, /bundleOpportunityTelemetry:true/);
assert.match(runner, /MAX_STATE_BYTES = 900_000/);
assert.equal(resolutionAudit.strategy, "resolution-window-no-50-55-safe-non-sports-v2");
assert.deepEqual(resolutionAudit.selection.horizon_days_enabled, [3, 4, 5, 6]);
for (const days of resolutionAudit.selection.horizon_days_enabled) {
  const rule = resolutionAudit.rules[`${days}_day`];
  assert.ok(rule.train_event_lower_90 > 0);
  assert.ok(rule.holdout_event_lower_90 > 0);
  assert.ok(rule.chronological_thirds_event_lower_90.every((value) => value > 0));
}
assert.match(resolutionAudit.rejected_windows["2_day"], /holdout/i);
assert.match(resolutionAudit.rejected_windows["7_day"], /negative/i);

const agentIds = ["value", "momentum", "favorite", "longshot", "diversifier", "catalyst", "reversal", "breakout", "tailalpha", "conviction"];
const agents = Object.fromEntries(agentIds.map(id => [id, { cash: 10000, positions: [], lastDecision: { mode: "test" } }]));
const snapshot = {
  schema_version: 1,
  build_version: build,
  generated_at: new Date().toISOString(),
  last_cycle_hour: "2026-08-21T20|v59",
  items: {
    pma_agents_v2: JSON.stringify({ seeded: true, last_cycle_hour: "2026-08-21T20|v59", agents }),
    pma_suggestions_v5: JSON.stringify({ suggestions: [{ market_id: "test" }] }),
  },
};
assert.equal(validateRuntimeSnapshot(snapshot, build).agents.seeded, true);
assert.throws(() => validateRuntimeSnapshot({ ...snapshot, items: { ...snapshot.items, pma_paper_accounts_v1: "{}" } }, build), /unexpected keys/);
assert.throws(() => validateRuntimeSnapshot({ ...snapshot, build_version: build - 1 }, build), /Expected Build/);
assert.throws(() => validateRuntimeSnapshot({ ...snapshot, items: { ...snapshot.items, pma_suggestions_v5: JSON.stringify({ suggestions: [] }) } }, build), /no live suggestions/);

console.log(`autonomous runtime verified for Build ${build}`);
