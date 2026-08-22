import assert from "node:assert/strict";
import fs from "node:fs";
import { ALLOWED_RUNTIME_KEYS, validateRuntimeSnapshot } from "./run-autonomous-cycle.mjs";

const index = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const api = fs.readFileSync(new URL("../api/state.js", import.meta.url), "utf8");
const workflow = fs.readFileSync(new URL("../.github/workflows/autonomous-cycle.yml", import.meta.url), "utf8");
const runner = fs.readFileSync(new URL("./run-autonomous-cycle.mjs", import.meta.url), "utf8");
const resolutionAudit = JSON.parse(fs.readFileSync(new URL("../research/resolution-week-no-audit.json", import.meta.url), "utf8"));
const sportsContestAudit = JSON.parse(fs.readFileSync(new URL("../research/sports-contest-no-exploration-audit.json", import.meta.url), "utf8"));
const build = Number(index.match(/const BUILD_VERSION = (\d+);/)?.[1]);

assert.equal(build, 119);
assert.deepEqual([...ALLOWED_RUNTIME_KEYS].sort(), ["pma_agents_v2", "pma_suggestions_v5"]);
assert.match(index, /function collectPublicRuntimeItems\(\)/);
assert.match(index, /const PUBLIC_RUNTIME_KEYS=Object\.freeze\(\[AGENTS_KEY,SUG_KEY\]\)/);
assert.match(index, /suggestions:300/);
assert.match(index, /function compactPublicSuggestionsForSync\(payload\)/);
assert.match(index, /drivers\.slice\(0,1\)/);
assert.match(index, /if\(!out\.trade_ready\)\{delete out\.clob_yes;delete out\.clob_no;\}/);
assert.match(index, /function compactPublicSignalLedger\(ledger\)/);
assert.match(index, /st\.signal_ledger=compactPublicSignalLedger\(st\.signal_ledger\)/);
assert.match(index, /const PUBLIC_RUNTIME_SNAPSHOT_BUDGET_BYTES = 875000;/);
assert.match(index, /const PUBLIC_SIGNAL_OUTCOME_RESERVE = 96;/);
assert.match(index, /history:80,suggestions:300/);
assert.match(index, /function compactMakerOutcomeForPublic\(row\)/);
assert.match(index, /publicMakerCompactionPreservesCalibration:/);
assert.match(index, /function fitPublicRuntimeSnapshot\(snapshot\)/);
assert.match(index, /reservedCount=Math\.min\(PUBLIC_SIGNAL_OUTCOME_RESERVE,outcomes\.length\)/);
assert.match(index, /return fitPublicRuntimeSnapshot\(snapshot\)/);
assert.match(index, /publicCompactionPreservesForwardGrading:/);
assert.match(index, /publicCompactionPreservesAgentCalibration:/);
assert.match(index, /const DIRECTIONAL_PROBATION_HORIZON_HOURS = 6;/);
assert.match(index, /const DIRECTIONAL_PROBATION_MIN_EVENTS = 12;/);
assert.match(index, /sixHourEvidenceStartsBoundedProbation:/);
assert.match(index, /probationMetadataSurvivesOfflineCompaction:/);
assert.match(index, /probationExitsAtExecutableSixHourPrice:/);
assert.match(index, /claimedProbationEvents/);
assert.match(api, /adaptive_probation: s\.adaptive_probation, probation_exit_hours: s\.probation_exit_hours/);
assert.match(index, /function buildRuntimeFallbackMarketCache\(stored,state\)/);
assert.match(index, /buildRuntimeFallbackMarketCache\(stored,st\)/);
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
assert.match(workflow, /EXPECTED_BUILD: "119"/);
assert.match(workflow, /actions: write/);
assert.match(workflow, /cancel-in-progress: false/);
assert.match(workflow, /next=\$\(\( \(now \/ 300 \+ 1\) \* 300 \+ 15 \)\)/);
assert.match(workflow, /actions\/workflows\/autonomous-cycle\.yml\/dispatches/);
assert.match(workflow, /--data '\{"ref":"main"\}'/);
assert.match(index, /cloudRestartReconstructsOfflineCache:true/);
assert.match(index, /saveSuggestions\(sugs,markets\.length,analysisMarkets\.length,bundleAudit\)/);
assert.match(index, /const NEG_RISK_EVENT_SCAN_LIMIT=1000;/);
assert.match(index, /bundleOpportunityTelemetry:true/);
assert.match(index, /const BUNDLE_DEPTH_CANDIDATE_LIMIT=60;/);
assert.match(index, /bundleRequiresDepthVerification:true/);
assert.match(index, /bundleRequiresClobFeeVerification:true/);
assert.match(index, /function bundleExecutableLeg\(book,units,feeSchedule\)/);
assert.match(index, /function maximizeBundleExecution\(candidate,books,minimumUnits\)/);
assert.match(index, /const BUNDLE_MAX_VERIFIED_NOTIONAL=400;/);
assert.match(index, /sizesToLargestVerifiedProfitableFill:/);
assert.match(index, /stopsSizingAtShallowestBundleLeg:/);
assert.match(index, /!s\.depth_verified\|\|!s\.fees_verified\|\|s\.verification_status!=="executable"/);
assert.match(runner, /MAX_STATE_BYTES = 900_000/);
assert.match(runner, /Production already advanced to Build \$\{status\.build\}; retiring stale Build \$\{expectedBuild\} runner/);
assert.equal(resolutionAudit.strategy, "resolution-window-no-50-55-forward-shadow-v3");
assert.deepEqual(resolutionAudit.selection.horizon_days_enabled, []);
assert.deepEqual(resolutionAudit.selection.horizon_days_observed, [4]);
assert.equal(resolutionAudit.disjoint_holdout.passed_strict_gate, false);
assert.ok(resolutionAudit.disjoint_holdout.holdout_event_lower_90 < 0);
assert.equal(resolutionAudit.production_constraints.capital_enabled, false);
assert.equal(resolutionAudit.production_constraints.promotion_events, 40);
assert.equal(sportsContestAudit.production_strategy, 62);
assert.equal(sportsContestAudit.status, "bounded-paper-exploration-not-proven");
assert.equal(sportsContestAudit.corrected_5000_market_result.independent_contests, 76);
assert.equal(sportsContestAudit.corrected_5000_market_result.passed_strict_gate, false);
assert.ok(sportsContestAudit.corrected_5000_market_result.validation.lower_95 < 0);
assert.equal(sportsContestAudit.production_constraints.initial_position_pct, 0.5);
assert.equal(sportsContestAudit.production_constraints.total_lane_cap_pct, 3);
assert.equal(sportsContestAudit.production_constraints.exact_entry_fee_required, true);
assert.match(index, /function sportsContestKey\(m\)/);
assert.match(index, /function sportsContestNoSuggestions\(markets\)/);
assert.match(index, /const SPORTS_FAVORITE_MAX_NEW_PER_CYCLE=1;/);
assert.match(index, /function compactDecisionForPublic\(decision\)/);
assert.match(index, /delete out\.learning\.buckets/);

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
