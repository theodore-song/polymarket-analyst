import assert from "node:assert/strict";
import { databaseConnectionDiagnostics, databaseUrl, databaseUrls, normalizeDatabaseUrl } from "../lib/db.js";
import { compactAgentState, compactSuggestion, providerErrorCode } from "../api/state.js";

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
  bundle_side: "YES", bundle_cost_per_unit: 0.95, bundle_payout_per_unit: 1,
  bundle_net_profit_per_unit: 0.05, bundle_legs: [{ market_id: "1", side: "YES" }],
});
assert.equal(compacted.signal_type, "bundle-arb");
assert.equal(compacted.entry_candidate, true);
assert.equal(compacted.requires_live, true);
assert.equal(compacted.bundle_side, "YES");
assert.equal(compacted.bundle_legs.length, 1);

const compactedState = compactAgentState({
  agents: {},
  signal_ledger: { pending: [], outcomes: [], expired_ungraded: 7 },
});
assert.equal(compactedState.signal_ledger.expired_ungraded, 7);
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
