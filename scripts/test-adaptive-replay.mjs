import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildAdaptiveExperts, prepareAdaptiveTimeline, simulateAdaptiveSelector } from "../lib/adaptive-replay.js";

const rule = { id: "synthetic", family: "directional", lookback: 3, mode: "follow", minMove: 0.04,
  maxMove: 1, band: "all", category: "All", agreement: "any" };
const row = (eventKey, observedAt, price, future) => ({ marketId: eventKey, eventKey, category: "Other", universe: "closed",
  observedAt, price, moves: { 3: 0.05, 24: 0.05, 168: 0.05, prior1: 0.01, 1: 0.02 }, future: { 6: future } });
const rows = [];
for (let index = 0; index < 10; index++) rows.push(row(`learn-${index}`, index * 12 * 3600, 0.5, 0.6));
rows.push(row("before-maturity", 10 * 12 * 3600 + 3600, 0.5, 0.6));
rows.push(row("after-maturity", 11 * 12 * 3600, 0.5, 0.6));
const experts = buildAdaptiveExperts(rows, [rule], [6], 0);
const timeline = prepareAdaptiveTimeline(experts, new Set(rows.map((item) => item.eventKey)));

const tooEarly = simulateAdaptiveSelector(timeline, new Set(["before-maturity"]),
  { windowEvents: 20, minimumEvents: 10, minimumLower: 0 });
assert.equal(tooEarly.selected.length, 1, "Ten earlier outcomes should be mature before the test signal");

const strict = simulateAdaptiveSelector(timeline, new Set(["after-maturity"]),
  { windowEvents: 20, minimumEvents: 12, minimumLower: 0 });
assert.equal(strict.selected.length, 0, "The selector must not use an outcome before its exit time");

const active = simulateAdaptiveSelector(timeline, new Set(["after-maturity"]),
  { windowEvents: 20, minimumEvents: 10, minimumLower: 0 });
assert.equal(active.selected.length, 1);
assert.equal(active.selected[0].evidenceEvents, 11);
assert.ok(active.summary.lower > 0);

const repeatRows = [...rows.slice(0, 10), row("repeat", 10 * 12 * 3600 + 3600, 0.5, 0.6),
  { ...row("repeat", 11 * 12 * 3600, 0.5, 0.6), marketId: "repeat-second-market" }];
const repeatExperts = buildAdaptiveExperts(repeatRows, [rule], [6], 0);
const repeatTimeline = prepareAdaptiveTimeline(repeatExperts, new Set(repeatRows.map((item) => item.eventKey)));
const noReentry = simulateAdaptiveSelector(repeatTimeline, new Set(["repeat"]),
  { windowEvents: 20, minimumEvents: 10, minimumLower: 0 });
assert.equal(noReentry.selected.length, 1);
assert.equal(noReentry.selected[0].eventKey, "repeat");

const audit = JSON.parse(await readFile(new URL("../research/adaptive-selector-audit.json", import.meta.url), "utf8"));
assert.equal(audit.blocks.length, 3);
assert.equal(audit.finalBlock.events, 371);
assert.equal(audit.finalBlock.removedOverlappingEvents, 56);
assert.equal(audit.validationPassedAllDevelopmentBlocks, false);
assert.equal(audit.holdoutPassedAllDevelopmentBlocks, false);
assert.equal(audit.finalHoldoutPassed, false);
assert.equal(audit.capitalApproved, false);
assert.ok(audit.finalBlock.holdout.events >= 30);
assert.ok(audit.finalBlock.holdout.mean > 0);
assert.ok(audit.finalBlock.holdout.median < 0);
assert.ok(audit.finalBlock.holdout.lower < 0);
assert.match(audit.methodology.riskPolicy, /-18% full stop/);
assert.match(audit.methodology.riskPolicy, /\+15%, \+30%, and \+50%/);

console.log("adaptive replay tests passed");
