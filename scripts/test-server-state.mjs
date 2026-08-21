import assert from "node:assert/strict";
import { databaseConnectionDiagnostics, databaseUrl, databaseUrls, normalizeDatabaseUrl } from "../lib/db.js";
import { compactAgentState, compactSuggestion, providerErrorCode, sanitizeGithubRuntimeState } from "../api/state.js";

assert.equal(normalizeDatabaseUrl("psql 'postgresql://user:pass@example.test/db?sslmode=require'"),
  "postgresql://user:pass@example.test/db?sslmode=require");
assert.equal(normalizeDatabaseUrl('"postgres://user:pass@example.test/db"'), "postgres://user:pass@example.test/db");
assert.equal(normalizeDatabaseUrl("DATABASE_URL=postgresql://user:pass@example.test/db"),
  "postgresql://user:pass@example.test/db");

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
  entry_candidate: true, adaptive_promotion: false, requires_live: true, bundle_id: "bundle:1:yes",
  bundle_side: "YES", bundle_logic: "threshold-dominance", bundle_cost_per_unit: 0.95, bundle_payout_per_unit: 1,
  bundle_net_profit_per_unit: 0.05, bundle_legs: [{ market_id: "1", side: "YES" }],
});
assert.equal(compacted.signal_type, "bundle-arb");
assert.equal(compacted.entry_candidate, true);
assert.equal(compacted.requires_live, true);
assert.equal(compacted.bundle_side, "YES");
assert.equal(compacted.bundle_logic, "threshold-dominance");
assert.equal(compacted.bundle_legs.length, 1);

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
