import assert from "node:assert/strict";
import fs from "node:fs";

const report = JSON.parse(fs.readFileSync(new URL("../research/shock-strategy-3-audit.json", import.meta.url), "utf8"));
const independent = JSON.parse(fs.readFileSync(new URL("../research/shock-strategy-3-independent-audit.json", import.meta.url), "utf8"));
const candidate = report.candidates.find(row => row.rule.id === "fade_h12_w3_m0.08_accelerating_v1_All_All");

assert.equal(report.markets, 2000);
assert.equal(report.observations, 534894);
assert.equal(report.methodology.costCents, 2);
assert.deepEqual(report.methodology.entryPriceRange, [0.08, 0.92]);
assert.deepEqual(report.methodology.returnWinsorization, [-1, 2]);
assert.ok(candidate, "The deployed Strategy 3 rule is missing from the audit artifact");
assert.equal(candidate.rule.horizon, 12);
assert.equal(candidate.rule.window, 3);
assert.equal(candidate.rule.minMove, 0.08);
assert.equal(candidate.rule.confirmation, "accelerating");
assert.equal(candidate.passesHoldout, true);
assert.equal(candidate.passesEventHoldout, true);
assert.equal(candidate.passesArchive, false);

for (const partition of ["train", "validation", "holdout", "eventHoldout"]) {
  assert.ok(candidate[partition].events >= 80, `${partition} lacks independent event support`);
  assert.ok(candidate[partition].lower > 0, `${partition} lower confidence bound is not positive`);
}

assert.equal(independent.activeMarketsSkipped, 2000);
assert.equal(independent.markets, 1000);
assert.equal(independent.observations, 246580);
assert.equal(independent.methodology.costCents, 2);
assert.deepEqual(independent.methodology.returnWinsorization, [-1, 2]);
assert.equal(independent.exactStrategy3.rule.id, candidate.rule.id);
for (const partition of ["train", "validation", "holdout", "eventHoldout"]) {
  assert.ok(independent.exactStrategy3[partition].mean > 0, `${partition} independent mean is not positive`);
}
assert.ok(independent.exactStrategy3.eventHoldout.events >= 60);
assert.ok(independent.exactStrategy3.eventHoldout.lower > 0);
assert.ok(independent.exactStrategy3.train.lower < 0, "Independent train limitation must remain visible");
assert.ok(independent.exactStrategy3.holdout.lower < 0, "Independent chronological limitation must remain visible");

console.log("shock audit artifact verified");
