import assert from "node:assert/strict";
import { databaseConnectionDiagnostics, databaseUrl, databaseUrls, normalizeDatabaseUrl } from "../lib/db.js";
import { compactAgentState, compactSuggestion, cycleVersion, providerErrorCode, sanitizeGithubRuntimeState } from "../api/state.js";

assert.equal(normalizeDatabaseUrl("psql 'postgresql://user:pass@example.test/db?sslmode=require'"),
  "postgresql://user:pass@example.test/db?sslmode=require");
assert.equal(normalizeDatabaseUrl('"postgres://user:pass@example.test/db"'), "postgres://user:pass@example.test/db");
assert.equal(normalizeDatabaseUrl("DATABASE_URL=postgresql://user:pass@example.test/db"),
  "postgresql://user:pass@example.test/db");
assert.equal(cycleVersion("2026-08-21T20|v59"), 59);
assert.equal(cycleVersion("2026-08-21T20:05|s62"), 62);
assert.equal(cycleVersion("2026-08-21T20:05|s63"), 63);
assert.equal(cycleVersion("2026-08-21T20:05"), 0);

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalNeonUrl = process.env.NEON_DATABASE_URL;
process.env.DATABASE_URL = "not-a-postgres-url";
process.env.NEON_DATABASE_URL = "postgresql://alias:pass@example.test/db";
assert.equal(databaseUrl(), process.env.NEON_DATABASE_URL);
assert.deepEqual(databaseUrls(), [process.env.NEON_DATABASE_URL]);
process.env.DATABASE_URL = "postgresql://stale:pass@example.test/db";
assert.deepEqual(databaseUrls(), [process.env.DATABASE_URL, process.env.NEON_DATABASE_URL]);
const diagnostics = databaseConnectionDiagnostics();
assert.equal(diagnostics.candidates, 2);
assert.equal(diagnostics.urls[0].valid_postgres_url, true);
assert.equal(diagnostics.urls[0].has_username, true);
assert.equal(diagnostics.urls[0].has_password, true);
assert.equal(diagnostics.urls[0].has_database_name, true);
if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
else process.env.DATABASE_URL = originalDatabaseUrl;
if (originalNeonUrl === undefined) delete process.env.NEON_DATABASE_URL;
else process.env.NEON_DATABASE_URL = originalNeonUrl;

const compacted = compactSuggestion({
  market_id: "bundle:1:yes", side: "YES", signal_type: "bundle-arb", signal_confidence: 1,
  entry_candidate: true, adaptive_promotion: false, requires_live: true, bundle_id: "bundle:1:yes", bundle_event_id: "1",
  bundle_side: "NO", bundle_logic: "neg-risk-complete-no", bundle_immediate_convert: true,
  neg_risk_market_id: "0xmarket", neg_risk_fee_bips: 25, bundle_cost_per_unit: 1.95,
  bundle_payout_per_unit: 1.995, bundle_settlement_payout_per_unit: 2,
  bundle_net_profit_per_unit: 0.05, bundle_capital_efficiency: 0.0025, bundle_legs: [{ market_id: "1", side: "YES" }],
  fees_enabled: false, fee_schedule: { rate: 0, exponent: 1, takerOnly: true },
  depth_verified: true, fees_verified: true, fee_model: "verified-market-specific", execution_model: "live-order-book-vwap",
  execution_units: 250, execution_notional: 237.5, verification_status: "executable", promoted_for_agents: ["value"],
});
assert.equal(compacted.signal_type, "bundle-arb");
assert.equal(compacted.entry_candidate, true);
assert.equal(compacted.requires_live, true);
assert.equal(compacted.bundle_side, "NO");
assert.equal(compacted.bundle_event_id, "1");
assert.equal(compacted.bundle_logic, "neg-risk-complete-no");
assert.equal(compacted.bundle_immediate_convert, true);
assert.equal(compacted.neg_risk_market_id, "0xmarket");
assert.equal(compacted.neg_risk_fee_bips, 25);
assert.equal(compacted.bundle_settlement_payout_per_unit, 2);
assert.equal(compacted.bundle_capital_efficiency, 0.0025);
assert.equal(compacted.bundle_legs.length, 1);
assert.equal(compacted.fee_schedule.rate, 0);
assert.equal(compacted.execution_units, 250);
assert.equal(compacted.verification_status, "executable");
assert.deepEqual(compacted.promoted_for_agents, ["value"]);

const compactedShock = compactSuggestion({
  market_id: "shock:1", event_key: "event:1", side: "NO", signal_type: "shock-fade-shadow",
  market_price: 0.18, entry_price: 0.1845, shock_move_1h: 0.06, shock_prior_move_1h: 0.03,
  shock_move_3h: 0.12, shock_observed_at: "2026-08-21T20:00:00.000Z", shock_strategy_version: 3,
  pilot_prior: { modeled_cost_cents: 2 }, requires_live: true,
});
assert.equal(compactedShock.event_key, "event:1");
assert.equal(compactedShock.market_price, 0.18);
assert.equal(compactedShock.shock_move_3h, 0.12);
assert.equal(compactedShock.shock_strategy_version, 3);
assert.equal(compactedShock.pilot_prior.modeled_cost_cents, 2);

const compactedProbation = compactSuggestion({
  market_id: "probation:1", event_key: "event:probation", side: "YES", signal_type: "trend",
  trade_ready: true, entry_candidate: true, adaptive_probation: true, probation_exit_hours: 6,
  promoted_for_agents: ["momentum"], fee_schedule: { rate: 0.04, exponent: 1, takerOnly: true },
});
assert.equal(compactedProbation.adaptive_probation, true);
assert.equal(compactedProbation.probation_exit_hours, 6);
assert.deepEqual(compactedProbation.promoted_for_agents, ["momentum"]);

const compactedState = compactAgentState({
  agents: { reversal: {
    positions: [], closed: [], history: [], snapshots: [],
    shock_fade_shadows: [{ event_key: "event:1", shock_strategy_version: 3 }],
    shock_fade_outcomes: [{ event_key: "event:0", shock_strategy_version: 3, net_return: 0.08 }],
  } },
  signal_ledger: { pending: [], outcomes: [], expired_ungraded: 7 },
});
assert.equal(compactedState.signal_ledger.expired_ungraded, 7);
assert.equal(compactedState.agents.reversal.shock_fade_shadows[0].shock_strategy_version, 3);
assert.equal(compactedState.agents.reversal.shock_fade_outcomes[0].net_return, 0.08);

const ledgerOrder = compactAgentState({
  agents: {},
  signal_ledger: {
    pending: Array.from({ length: 650 }, (_, i) => ({ key: `pending-${i}` })),
    outcomes: Array.from({ length: 1050 }, (_, i) => ({ key: `outcome-${i}` })),
  },
}).signal_ledger;
assert.equal(ledgerOrder.pending.length, 600);
assert.equal(ledgerOrder.pending[0].key, "pending-0");
assert.equal(ledgerOrder.pending.at(-1).key, "pending-599");
assert.equal(ledgerOrder.outcomes.length, 1000);
assert.equal(ledgerOrder.outcomes[0].key, "outcome-50");
assert.equal(ledgerOrder.outcomes.at(-1).key, "outcome-1049");

const publicAgents = Object.fromEntries([
  "value", "momentum", "favorite", "longshot", "diversifier", "catalyst", "reversal", "breakout", "tailalpha", "conviction",
].map(id => [id, { cash: 10000, positions: [], closed: [], history: [], snapshots: [] }]));
const sanitizedRuntime = sanitizeGithubRuntimeState({
  schema_version: 1,
  build_version: 88,
  generated_at: "2026-08-21T20:00:00.000Z",
  items: {
    pma_agents_v2: JSON.stringify({ seeded: true, last_cycle_hour: "2026-08-21T20|v59", agents: publicAgents }),
    pma_suggestions_v5: JSON.stringify({ suggestions: [] }),
    pma_paper_accounts_v1: JSON.stringify({ password: "must-not-survive" }),
    pma_trade_email_alerts_v1: JSON.stringify({ email: "private@example.com" }),
    pma_live_readiness_v1: JSON.stringify({ wallet: "private" }),
  },
});
assert.deepEqual(Object.keys(sanitizedRuntime.items).sort(), ["pma_agents_v2", "pma_suggestions_v5"]);
assert.equal(sanitizedRuntime.read_only, true);
assert.equal(sanitizedRuntime.source, "github-actions");
assert.equal(sanitizedRuntime.build_version, 88);
assert.throws(() => sanitizeGithubRuntimeState({ items: { pma_suggestions_v5: "{}" } }), /missing agent portfolios/);
assert.equal(providerErrorCode(new Error("403 Forbidden")), "authorization_failed");
assert.equal(providerErrorCode(new Error("Error connecting to database: HTTP status 402")), "provider_payment_required");
assert.equal(providerErrorCode(new Error("invalid connection string")), "invalid_connection_string");
assert.equal(providerErrorCode(Object.assign(new Error("database rejected login"), { code: "28P01" })), "authorization_failed");
const nestedFetchError = Object.assign(new Error("Error connecting to database"), {
  name: "NeonDbError",
  sourceError: Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }),
});
assert.equal(providerErrorCode(nestedFetchError), "dns_failed");

console.log("server state tests passed");
