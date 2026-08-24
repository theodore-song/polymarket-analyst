import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluateRules, generateRules } from "../lib/offline-replay.js";

const CACHE = resolve(process.env.REPLAY_CACHE || "research/cache/adaptive-observations-v1.json");
const OUTPUT = process.env.REPLAY_OUTPUT ? resolve(process.env.REPLAY_OUTPUT) : null;
const COST_CENTS = Math.max(0, Math.min(10, Number(process.env.REPLAY_COST_CENTS || 2)));
const RULE_IDS = String(process.env.REPLAY_RULE_IDS || "").split(",").map((value) => value.trim()).filter(Boolean);
const HORIZONS = String(process.env.REPLAY_HORIZONS || "6,12,24,72").split(",").map(Number)
  .filter((value) => [3, 6, 12, 24, 72].includes(value));
const startedAt = performance.now();
const cache = JSON.parse(await readFile(CACHE, "utf8"));
if (cache.schema !== "poly-arena-offline-replay-v1" || !Array.isArray(cache.rows)) {
  throw new Error(`Unsupported replay cache: ${CACHE}`);
}

const allRules = generateRules();
const rules = RULE_IDS.length ? allRules.filter((rule) => RULE_IDS.includes(rule.id)) : allRules;
if (!rules.length) throw new Error(`No replay rules matched: ${RULE_IDS.join(", ")}`);
const evaluation = evaluateRules(cache.rows, { costCents: COST_CENTS, rules, horizons: HORIZONS });
const compact = (stats) => Object.fromEntries(Object.entries(stats).map(([key, value]) => [key,
  Number.isFinite(value) ? +value.toFixed(5) : value]));
const report = {
  generatedAt: new Date().toISOString(),
  cacheGeneratedAt: cache.generatedAt,
  cache: CACHE,
  observations: cache.rows.length,
  markets: new Set(cache.rows.map((row) => row.marketId)).size,
  events: new Set(cache.rows.map((row) => row.eventKey)).size,
  universes: Object.fromEntries(["active", "closed"].map((universe) => [universe,
    new Set(cache.rows.filter((row) => row.universe === universe).map((row) => row.marketId)).size])),
  methodology: {
    split: "chronological 60/20/20 by whole Polymarket event; no event crosses partitions",
    costCentsPerShareRoundTrip: COST_CENTS,
    selection: "positive event-clustered 90% lower bound, positive median, and positive leave-one-event-out mean in train and validation",
    holdout: "evaluated only after train and validation selection",
    caveat: "Historical fills and order-book depth are unavailable; the cost stress is a conservative model, not a fill guarantee.",
  },
  splitEvents: evaluation.split.events,
  candidateRules: evaluation.rules,
  elapsedSeconds: +((performance.now() - startedAt) / 1000).toFixed(3),
  horizons: evaluation.results.map((result) => ({
    horizon: result.horizon,
    rows: result.rows,
    trainSelected: result.trainSelected,
    validationSelected: result.validationSelected,
    holdoutPassed: result.holdoutPassed,
    candidates: result.candidates.slice(0, 25).map((candidate) => ({
      rule: candidate.rule,
      passesHoldout: candidate.passesHoldout,
      train: compact(candidate.train),
      validation: compact(candidate.validation),
      holdout: compact(candidate.holdout),
    })),
    closestValidation: result.closestValidation.map((candidate) => ({
      rule: candidate.rule,
      train: compact(candidate.train),
      validation: compact(candidate.validation),
    })),
  })),
};
const json = `${JSON.stringify(report, null, 2)}\n`;
if (OUTPUT) await writeFile(OUTPUT, json);
console.log(json);
