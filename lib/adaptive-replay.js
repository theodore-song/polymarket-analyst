import { HOUR, applyTieredRiskPolicy, executableTrades, summarizeTrades } from "./offline-replay.js";

export function buildAdaptiveExperts(rows, rules, horizons = [6, 24, 72], costCents = 3, riskPolicy = null) {
  const experts = [];
  for (const rule of rules) {
    for (const horizon of horizons) {
      const eligibleRows = rows.filter((row) => Number.isFinite(row.future[horizon]));
      const rawTrades = executableTrades(eligibleRows, rule, horizon, costCents);
      const trades = riskPolicy ? applyTieredRiskPolicy(eligibleRows, rawTrades, horizon, costCents, riskPolicy) : rawTrades;
      if (!trades.length) continue;
      experts.push({ id: `${rule.id}@${horizon}h`, rule, horizon, trades });
    }
  }
  return experts;
}

export function prepareAdaptiveTimeline(experts, allowedEvents) {
  const allowed = allowedEvents instanceof Set ? allowedEvents : new Set(allowedEvents || []);
  const outcomes = [];
  const signals = [];
  const expertById = new Map();
  for (const expert of experts) {
    expertById.set(expert.id, expert);
    for (const trade of expert.trades) {
      if (allowed.size && !allowed.has(trade.eventKey)) continue;
      signals.push({ ...trade, expertId: expert.id, horizon: expert.horizon });
      outcomes.push({ expertId: expert.id, eventKey: trade.eventKey,
        availableAt: trade.observedAt + expert.horizon * HOUR, netReturn: trade.netReturn });
    }
  }
  signals.sort((a, b) => a.observedAt - b.observedAt || String(a.eventKey).localeCompare(String(b.eventKey))
    || String(a.expertId).localeCompare(String(b.expertId)));
  outcomes.sort((a, b) => a.availableAt - b.availableAt || String(a.expertId).localeCompare(String(b.expertId)));
  return { expertById, signals, outcomes };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function scoreHistory(history, options) {
  const eventRows = [...history.entries()].map(([eventKey, row]) => ({ eventKey,
    availableAt: row.availableAt, value: row.values.reduce((sum, value) => sum + value, 0) / row.values.length }))
    .sort((a, b) => b.availableAt - a.availableAt || String(a.eventKey).localeCompare(String(b.eventKey)))
    .slice(0, options.windowEvents);
  if (eventRows.length < options.minimumEvents) return null;
  const values = eventRows.map((row) => row.value);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.length > 1
    ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1) : 0;
  const lower = mean - options.confidence * Math.sqrt(variance / values.length);
  const middle = median(values);
  const total = values.reduce((sum, value) => sum + value, 0);
  const jackknife = values.length > 1
    ? Math.min(...values.map((value) => (total - value) / (values.length - 1))) : -Infinity;
  if (lower <= options.minimumLower || middle <= 0 || jackknife <= 0) return null;
  return { score: lower + middle * 0.1, events: values.length, mean, median: middle, lower, jackknife };
}

export function simulateAdaptiveSelector(timeline, targetEvents, options = {}) {
  const config = {
    windowEvents: options.windowEvents || 40,
    shortWindowEvents: options.shortWindowEvents || 0,
    minimumEvents: options.minimumEvents || 12,
    minimumLower: options.minimumLower ?? 0.01,
    minimumConsensusLookbacks: options.minimumConsensusLookbacks || 1,
    minimumEntry: options.minimumEntry ?? 0.08,
    maximumEntry: options.maximumEntry ?? 0.92,
    confidence: options.confidence || 1.645,
  };
  const targets = targetEvents instanceof Set ? targetEvents : new Set(targetEvents || []);
  const histories = new Map();
  const versions = new Map();
  const scoreCache = new Map();
  const usedEvents = new Set();
  const selected = [];
  const selectedExperts = new Map();
  let outcomeCursor = 0;

  const updateOutcomes = (time) => {
    while (outcomeCursor < timeline.outcomes.length && timeline.outcomes[outcomeCursor].availableAt <= time) {
      const outcome = timeline.outcomes[outcomeCursor++];
      const history = histories.get(outcome.expertId) || new Map();
      const event = history.get(outcome.eventKey) || { availableAt: 0, values: [] };
      event.availableAt = Math.max(event.availableAt, outcome.availableAt);
      event.values.push(outcome.netReturn);
      history.set(outcome.eventKey, event);
      histories.set(outcome.expertId, history);
      versions.set(outcome.expertId, (versions.get(outcome.expertId) || 0) + 1);
    }
  };
  const expertScore = (expertId) => {
    const version = versions.get(expertId) || 0;
    const cached = scoreCache.get(expertId);
    if (cached?.version === version) return cached.value;
    const history = histories.get(expertId) || new Map();
    const longScore = scoreHistory(history, config);
    const shortScore = longScore && config.shortWindowEvents
      ? scoreHistory(history, { ...config, windowEvents: config.shortWindowEvents }) : longScore;
    const value = longScore && shortScore ? { ...longScore,
      score: Math.min(longScore.score, shortScore.score),
      lower: Math.min(longScore.lower, shortScore.lower),
      shortEvents: shortScore.events,
      shortMean: shortScore.mean,
      shortMedian: shortScore.median,
      shortLower: shortScore.lower } : null;
    scoreCache.set(expertId, { version, value });
    return value;
  };

  for (let start = 0; start < timeline.signals.length;) {
    const observedAt = timeline.signals[start].observedAt;
    updateOutcomes(observedAt);
    let end = start + 1;
    while (end < timeline.signals.length && timeline.signals[end].observedAt === observedAt) end++;
    const candidatesByEvent = new Map();
    for (let index = start; index < end; index++) {
      const signal = timeline.signals[index];
      if (!targets.has(signal.eventKey) || usedEvents.has(signal.eventKey)) continue;
      if (signal.entryPrice < config.minimumEntry || signal.entryPrice > config.maximumEntry) continue;
      const score = expertScore(signal.expertId);
      if (!score) continue;
      const groups = candidatesByEvent.get(signal.eventKey) || new Map();
      const key = `${signal.marketId}:${signal.side}`;
      const rows = groups.get(key) || [];
      rows.push({ signal, score });groups.set(key, rows);candidatesByEvent.set(signal.eventKey, groups);
    }
    for (const [eventKey, groups] of candidatesByEvent) {
      let chosen = null;
      for (const rows of groups.values()) {
        const byLookback = new Map();
        for (const row of rows) {
          const expert = timeline.expertById.get(row.signal.expertId);
          const lookback = Number(expert?.rule?.lookback || 0);
          const prior = byLookback.get(lookback);
          if (!prior || row.score.score > prior.score.score) byLookback.set(lookback, row);
        }
        if (byLookback.size < config.minimumConsensusLookbacks) continue;
        const representatives = [...byLookback.values()];
        const consensusScore = Math.min(...representatives.map((row) => row.score.score));
        const best = representatives.sort((a, b) => b.score.score - a.score.score
          || b.signal.signalStrength - a.signal.signalStrength || a.signal.expertId.localeCompare(b.signal.expertId))[0];
        if (!chosen || consensusScore > chosen.consensusScore) chosen = { ...best, consensusScore,
          consensusLookbacks: byLookback.size };
      }
      if (!chosen) continue;
      const { signal, score, consensusLookbacks } = chosen;
      selected.push({ ...signal, adaptiveScore: score.score, evidenceEvents: score.events,
        evidenceMean: score.mean, evidenceMedian: score.median, evidenceLower: score.lower,
        shortEvidenceEvents: score.shortEvents || score.events, shortEvidenceLower: score.shortLower ?? score.lower,
        consensusLookbacks });
      selectedExperts.set(signal.expertId, (selectedExperts.get(signal.expertId) || 0) + 1);
      usedEvents.add(eventKey);
    }
    start = end;
  }
  return {
    config,
    selected,
    summary: summarizeTrades(selected),
    selectedExperts: [...selectedExperts.entries()].sort((a, b) => b[1] - a[1])
      .map(([expertId, trades]) => ({ expertId, trades })),
  };
}
