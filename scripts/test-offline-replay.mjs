import assert from "node:assert/strict";
import { applyTieredRiskPolicy, chronologicalEventSplit, executableTrades, summarizeTrades, tradeFor } from "../lib/offline-replay.js";

const rows = [];
for (let event = 0; event < 10; event++) {
  for (let sample = 0; sample < 3; sample++) {
    rows.push({ eventKey: `event-${event}`, marketId: `market-${event}`, observedAt: event * 100 + sample,
      price: 0.5, moves: { 1: 0.02, 3: 0.05, 24: 0.03, 168: 0.02, prior1: 0.01 }, future: { 6: 0.55 } });
  }
}
const split = chronologicalEventSplit(rows);
assert.deepEqual(split.events, { train: 6, validation: 2, holdout: 2 });
const trainEvents = new Set(split.train.map((row) => row.eventKey));
assert.equal(split.validation.some((row) => trainEvents.has(row.eventKey)), false);
assert.equal(split.holdout.some((row) => trainEvents.has(row.eventKey)), false);

const rule = { lookback: 3, minMove: 0.04, maxMove: 1, category: "All", agreement: "any",
  mode: "follow", band: "all", acceleration: true };
const trade = tradeFor(rows[0], rule, 6, 2);
assert.ok(trade);
assert.equal(+trade.netReturn.toFixed(4), 0.06);
assert.equal(trade.entryPrice, 0.5);
assert.equal(tradeFor({ ...rows[0], price: 0.08, future: { 6: 1 } }, rule, 6, 2).netReturn, 2);
assert.equal(tradeFor({ ...rows[0], price: 0.08, future: { 6: 0 } }, rule, 6, 2).netReturn, -1);
assert.equal(tradeFor({ ...rows[0], moves: { ...rows[0].moves, 1: 0.005 } }, rule, 6, 2), null);
const repeated = executableTrades([
  rows[0],
  { ...rows[0], marketId: "same-event-stronger", observedAt: rows[0].observedAt + 1, moves: { ...rows[0].moves, 3: 0.08 } },
  { ...rows[0], observedAt: rows[0].observedAt + 6 * 3600 },
], rule, 6, 2);
assert.equal(repeated.length, 2);
assert.equal(repeated[0].marketId, rows[0].marketId);

const riskTrade = { eventKey: "risk", marketId: "risk", observedAt: 0, side: "YES", entryPrice: 0.5, netReturn: 0 };
const stopped = applyTieredRiskPolicy([{ marketId: "risk", observedAt: 3600, price: 0.4 }], [riskTrade], 6, 0)[0];
assert.equal(stopped.riskExit, "stop-loss");
assert.equal(+stopped.netReturn.toFixed(2), -0.2);
const gains = applyTieredRiskPolicy([
  { marketId: "risk", observedAt: 3600, price: 0.6 },
  { marketId: "risk", observedAt: 7200, price: 0.7 },
  { marketId: "risk", observedAt: 10800, price: 0.8 },
], [riskTrade], 6, 0)[0];
assert.equal(gains.riskExit, "staged-gain");
assert.equal(gains.gainTiersFilled, 3);
assert.equal(+gains.netReturn.toFixed(2), 0.3);

const stable = summarizeTrades([0.05, 0.04, 0.03, 0.02].map((netReturn, index) => ({
  eventKey: `stable-${index}`, marketId: `stable-${index}`, netReturn,
})));
assert.ok(stable.jackknifeMean > 0);
const outlier = summarizeTrades([-0.05, -0.04, -0.03, 0.5].map((netReturn, index) => ({
  eventKey: `outlier-${index}`, marketId: `outlier-${index}`, netReturn,
})));
assert.ok(outlier.eventMean > 0);
assert.ok(outlier.jackknifeMean < 0);

console.log("offline replay tests passed");
