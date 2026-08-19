import assert from "node:assert/strict";
import { databaseUrl, databaseUrls, normalizeDatabaseUrl } from "../api/_db.js";
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
assert.deepEqual(databaseUrls(), [process.env.NEON_DATABASE_URL, "not-a-postgres-url"]);
process.env.DATABASE_URL = "postgresql://stale:pass@example.test/db";
assert.deepEqual(databaseUrls(), [process.env.DATABASE_URL, process.env.NEON_DATABASE_URL]);
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
assert.equal(providerErrorCode(new Error("invalid connection string")), "invalid_connection_string");

console.log("server state tests passed");
