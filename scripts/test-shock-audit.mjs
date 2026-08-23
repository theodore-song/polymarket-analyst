import assert from "node:assert/strict";
import fs from "node:fs";

const report = JSON.parse(fs.readFileSync(new URL("../research/shock-strategy-3-audit.json", import.meta.url), "utf8"));
const independent = JSON.parse(fs.readFileSync(new URL("../research/shock-strategy-3-independent-audit.json", import.meta.url), "utf8"));
const strategy4 = JSON.parse(fs.readFileSync(new URL("../research/shock-strategy-4-audit.json", import.meta.url), "utf8"));
const strategy4Independent = JSON.parse(fs.readFileSync(new URL("../research/shock-strategy-4-independent-audit.json", import.meta.url), "utf8"));
const index = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
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

assert.match(strategy4.methodology.strategy4ContractGate, /Reject path barriers and exact numeric ranges/);
assert.equal(strategy4.exactStrategy4.rule.contractGate, "strategy4");
assert.equal(strategy4Independent.activeMarketsSkipped, 2000);
for (const partition of ["train", "validation", "holdout", "eventHoldout"]) {
  assert.ok(strategy4.exactStrategy4[partition].events >= 60, `${partition} Strategy 4 primary support is too small`);
  assert.ok(strategy4.exactStrategy4[partition].lower > 0, `${partition} Strategy 4 primary lower bound must remain positive`);
}
assert.ok(strategy4.exactStrategy4.holdout.mean < 0, "Primary trade-level holdout limitation must remain visible");
assert.ok(strategy4Independent.exactStrategy4.holdout.eventMean < 0, "Independent chronological event mean must remain negative");
assert.ok(strategy4Independent.exactStrategy4.holdout.lower < 0, "Independent chronological failure must remain visible");
assert.ok(strategy4Independent.exactStrategy4.eventHoldout.lower < 0, "Independent event-holdout uncertainty must remain visible");

const support = { train: 15, validation: 8, holdout: 8, eventHoldout: 8 };
const partitions = Object.keys(support);
const independentRefinements = new Map(strategy4Independent.strategy4Refinements.map(row => [row.rule.id, row]));
const primarySurvivors = strategy4.strategy4Refinements.filter(row => partitions.every(partition =>
  row[partition].events >= support[partition] && row[partition].eventMean > 0 && row[partition].lower > 0));
assert.equal(primarySurvivors.length, 1, "Unexpected Strategy 4 primary refinement count");
assert.equal(primarySurvivors[0].rule.category, "All");
assert.equal(primarySurvivors[0].rule.band, "All");
assert.equal(primarySurvivors.filter(row => {
  const untouched = independentRefinements.get(row.rule.id);
  return untouched && partitions.every(partition => untouched[partition].events >= support[partition]
    && untouched[partition].eventMean > 0 && untouched[partition].lower > 0);
}).length, 0, "A Strategy 4 refinement unexpectedly passed every independent partition");

assert.match(index, /const SHOCK_FADE_BACKTEST_APPROVED=false/);
assert.match(index, /const SHOCK_FADE_QUALIFICATION_EVENTS=40/);
assert.match(index, /const SHOCK_FADE_PROMOTION_EVENTS=80/);

console.log("shock audit artifact verified");
