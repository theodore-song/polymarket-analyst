import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildAdaptiveExperts, prepareAdaptiveTimeline, simulateAdaptiveSelector } from "../lib/adaptive-replay.js";
import { chronologicalEventSplit, generateRules } from "../lib/offline-replay.js";

const CACHE_PATHS = String(process.env.REPLAY_CACHES || "research/cache/adaptive-observations-older-5000.json,research/cache/adaptive-observations-5500.json")
  .split(",").map((value) => resolve(value.trim())).filter(Boolean);
const OUTPUT = resolve(process.env.REPLAY_OUTPUT || "research/adaptive-selector-audit.json");
const FINAL_CACHE = process.env.REPLAY_FINAL_CACHE === "none" ? null
  : resolve(process.env.REPLAY_FINAL_CACHE || "research/cache/adaptive-observations-third-5000.json");
const COST_CENTS = Math.max(0, Math.min(10, Number(process.env.REPLAY_COST_CENTS || 3)));
const RISK_POLICY = Object.freeze({ stopLoss: 0.18, gainTiers: [0.15, 0.30, 0.50], gainFraction: 0.25 });

const fixedRules = generateRules().filter((rule) => {
  if (rule.category !== "All") return false;
  if (!new Set(["all", "mid"]).has(rule.band)) return false;
  if (rule.family === "shock") return true;
  return [[0.01, 0.08], [0.02, 0.15], [0.04, 1]].some(([minimum, maximum]) =>
    rule.minMove === minimum && rule.maxMove === maximum);
});
const policies = [];
for (const windowEvents of [40, 80]) {
  for (const shortWindowEvents of [20, 40]) {
    if (shortWindowEvents > windowEvents) continue;
    for (const minimumConsensusLookbacks of [2, 3]) {
      for (const [minimumEntry, maximumEntry] of [[0.15, 0.85], [0.30, 0.70]]) {
        for (const minimumLower of [0, 0.01]) policies.push({ windowEvents, shortWindowEvents, minimumEvents: 20,
          minimumConsensusLookbacks, minimumEntry, maximumEntry, minimumLower });
      }
    }
  }
}

function compact(stats) {
  return Object.fromEntries(Object.entries(stats).map(([key, value]) => [key,
    Number.isFinite(value) ? +value.toFixed(5) : value]));
}
function passes(stats, minimumEvents = 8) {
  return stats.events >= minimumEvents && stats.lower > 0 && stats.median > 0 && stats.jackknifeMean > 0;
}

const blocks = [];
for (const cachePath of CACHE_PATHS) {
  const cache = JSON.parse(await readFile(cachePath, "utf8"));
  const rows = cache.rows.filter((row) => row.universe === "closed");
  const split = chronologicalEventSplit(rows);
  const experts = buildAdaptiveExperts(rows, fixedRules, [6, 24, 72], COST_CENTS, RISK_POLICY);
  const eventSets = Object.fromEntries(["train", "validation", "holdout"].map((partition) =>
    [partition, new Set(split[partition].map((row) => row.eventKey))]));
  const validationTimeline = prepareAdaptiveTimeline(experts, new Set([...eventSets.train, ...eventSets.validation]));
  blocks.push({ cachePath, cache, rows, split, experts, eventSets, validationTimeline });
}

const validation = policies.map((policy) => {
  const results = blocks.map((block) => simulateAdaptiveSelector(block.validationTimeline, block.eventSets.validation, policy));
  const eligible = results.every((result) => result.summary.events >= 8);
  const robust = results.every((result) => passes(result.summary));
  const floor = Math.min(...results.map((result) => result.summary.lower));
  const eventFloor = Math.min(...results.map((result) => result.summary.events));
  return { policy, eligible, robust, floor, eventFloor, results };
}).sort((a, b) => Number(b.robust) - Number(a.robust) || Number(b.eligible) - Number(a.eligible)
  || b.floor - a.floor || b.eventFloor - a.eventFloor);

const chosen = validation[0];
const holdout = blocks.map((block) => {
  const timeline = prepareAdaptiveTimeline(block.experts,
    new Set([...block.eventSets.train, ...block.eventSets.validation, ...block.eventSets.holdout]));
  return simulateAdaptiveSelector(timeline, block.eventSets.holdout, chosen.policy);
});
const developmentEvents = new Set(blocks.flatMap((block) => [...block.eventSets.train, ...block.eventSets.validation, ...block.eventSets.holdout]));
let finalBlock = null;
if (FINAL_CACHE) {
  const cache = JSON.parse(await readFile(FINAL_CACHE, "utf8"));
  const rows = cache.rows.filter((row) => row.universe === "closed" && !developmentEvents.has(row.eventKey));
  const split = chronologicalEventSplit(rows);
  const experts = buildAdaptiveExperts(rows, fixedRules, [6, 24, 72], COST_CENTS, RISK_POLICY);
  const train = new Set(split.train.map((row) => row.eventKey));
  const validationEvents = new Set(split.validation.map((row) => row.eventKey));
  const holdoutEvents = new Set(split.holdout.map((row) => row.eventKey));
  const timeline = prepareAdaptiveTimeline(experts, new Set([...train, ...validationEvents, ...holdoutEvents]));
  const result = simulateAdaptiveSelector(timeline, holdoutEvents, chosen.policy);
  finalBlock = { cache: FINAL_CACHE, rows: rows.length, markets: new Set(rows.map((row) => row.marketId)).size,
    events: new Set(rows.map((row) => row.eventKey)).size, removedOverlappingEvents: new Set(cache.rows
      .filter((row) => row.universe === "closed" && developmentEvents.has(row.eventKey)).map((row) => row.eventKey)).size,
    splitEvents: split.events, experts: experts.length, holdout: compact(result.summary),
    holdoutPassed: passes(result.summary), holdoutTopExperts: result.selectedExperts.slice(0, 10) };
}
const report = {
  schema: "poly-arena-adaptive-selector-v1",
  generatedAt: new Date().toISOString(),
  methodology: {
    caches: CACHE_PATHS,
    costCentsPerShareRoundTrip: COST_CENTS,
    eventSplit: "Chronological 60/20/20 by whole Polymarket event inside each market-disjoint block.",
    causalLearning: "An expert score uses only zero-capital outcomes whose fixed exit time occurred before the candidate entry.",
    capitalEventPolicy: "At most one selected capital trade per Polymarket event for the full replay, matching the live event-claim invariant.",
    riskPolicy: "Check the observed six-hour path for the live -18% full stop, then sell 25% of original size at +15%, +30%, and +50%; exit any remainder at the expert horizon.",
    expertUniverse: "Fixed before validation: All-category all/mid directional rules across three move ranges plus shock rules; 6h, 24h, and 72h exits.",
    policySelection: `Choose among ${policies.length} fixed dual-window consensus policies using ${blocks.length} development validations only; reveal development holdouts and the market-disjoint final block afterward.`,
    caveat: "The market blocks are market-disjoint after event de-duplication but overlap in calendar time. Historical midpoint series do not reconstruct full books or guarantee fills.",
  },
  rules: fixedRules.length,
  policies: policies.length,
  chosenPolicy: chosen.policy,
  validationPassedAllDevelopmentBlocks: chosen.robust,
  holdoutPassedAllDevelopmentBlocks: holdout.every((result) => passes(result.summary)),
  finalHoldoutPassed: Boolean(finalBlock?.holdoutPassed),
  capitalApproved: Boolean(chosen.robust && holdout.every((result) => passes(result.summary)) && finalBlock?.holdoutPassed),
  blocks: blocks.map((block, index) => ({
    cache: block.cachePath,
    rows: block.rows.length,
    markets: new Set(block.rows.map((row) => row.marketId)).size,
    events: new Set(block.rows.map((row) => row.eventKey)).size,
    experts: block.experts.length,
    splitEvents: block.split.events,
    validation: compact(chosen.results[index].summary),
    validationTopExperts: chosen.results[index].selectedExperts.slice(0, 10),
    holdout: compact(holdout[index].summary),
    holdoutTopExperts: holdout[index].selectedExperts.slice(0, 10),
  })),
  finalBlock,
  validationPolicies: validation.map((row) => ({ policy: row.policy, eligible: row.eligible, robust: row.robust,
    floor: +row.floor.toFixed(5), eventFloor: row.eventFloor,
    blocks: row.results.map((result) => compact(result.summary)) })),
};
await writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
