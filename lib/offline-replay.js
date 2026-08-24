export const HOUR = 3600;

export function atOrBefore(points, target) {
  let low = 0;
  let high = points.length - 1;
  let answer = null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (points[middle].t <= target) {
      answer = points[middle];
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return answer;
}

export function atOrAfter(points, target) {
  let low = 0;
  let high = points.length - 1;
  let answer = null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (points[middle].t >= target) {
      answer = points[middle];
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  return answer;
}

export function buildObservations(market, points, spacingHours = 6) {
  const rows = [];
  const seenBuckets = new Set();
  for (const current of points) {
    const bucket = Math.floor(current.t / (spacingHours * HOUR));
    if (seenBuckets.has(bucket) || current.p < 0.05 || current.p > 0.95) continue;

    const moves = {};
    let complete = true;
    for (const hours of [1, 3, 6, 24, 72, 168]) {
      const target = current.t - hours * HOUR;
      const prior = atOrBefore(points, target);
      if (!prior || target - prior.t > 3 * HOUR) {
        complete = false;
        break;
      }
      moves[hours] = current.p - prior.p;
    }
    if (!complete) continue;

    const priorOneHour = atOrBefore(points, current.t - 2 * HOUR);
    if (!priorOneHour || current.t - 2 * HOUR - priorOneHour.t > 3 * HOUR) continue;
    moves.prior1 = (atOrBefore(points, current.t - HOUR)?.p ?? current.p) - priorOneHour.p;

    const future = {};
    for (const hours of [3, 6, 12, 24, 72]) {
      const target = current.t + hours * HOUR;
      const next = atOrAfter(points, target);
      if (next && next.t - target <= 3 * HOUR) future[hours] = next.p;
    }
    if (![6, 12, 24, 72].some((hours) => Number.isFinite(future[hours]))) continue;

    seenBuckets.add(bucket);
    rows.push({
      marketId: market.id,
      eventKey: market.eventKey,
      category: market.category,
      observedAt: current.t,
      price: current.p,
      moves,
      future,
    });
  }
  return rows;
}

export function chronologicalEventSplit(rows, trainFraction = 0.6, validationFraction = 0.2) {
  const eventTimes = new Map();
  for (const row of rows) {
    const current = eventTimes.get(row.eventKey);
    if (!current || row.observedAt > current) eventTimes.set(row.eventKey, row.observedAt);
  }
  const events = [...eventTimes].sort((a, b) => a[1] - b[1] || String(a[0]).localeCompare(String(b[0])));
  const trainEnd = Math.floor(events.length * trainFraction);
  const validationEnd = Math.floor(events.length * (trainFraction + validationFraction));
  const partition = new Map(events.map(([eventKey], index) => [eventKey,
    index < trainEnd ? "train" : index < validationEnd ? "validation" : "holdout"]));

  const split = { train: [], validation: [], holdout: [] };
  for (const row of rows) split[partition.get(row.eventKey)].push(row);
  return {
    ...split,
    events: {
      train: new Set(split.train.map((row) => row.eventKey)).size,
      validation: new Set(split.validation.map((row) => row.eventKey)).size,
      holdout: new Set(split.holdout.map((row) => row.eventKey)).size,
    },
  };
}

function priceBand(price) {
  if (price < 0.3) return "longshot";
  if (price < 0.7) return "mid";
  return "favorite";
}

export function tradeFor(row, rule, horizon, costCents = 2) {
  const move = Number(row.moves[rule.lookback]);
  const magnitude = Math.abs(move);
  if (!Number.isFinite(move) || !move || magnitude < rule.minMove || magnitude > rule.maxMove) return null;
  if (rule.category !== "All" && row.category !== rule.category) return null;

  if (rule.agreement && rule.agreement !== "any") {
    const mediumSign = Math.sign(row.moves[24]);
    const slowSign = Math.sign(row.moves[168]);
    const same = mediumSign && mediumSign === slowSign;
    if (rule.agreement === "same" && !same) return null;
    if (rule.agreement === "opposite" && (!mediumSign || same)) return null;
  }

  if (rule.acceleration) {
    const currentSign = Math.sign(move);
    const latest = Number(row.moves[1]);
    const prior = Number(row.moves.prior1);
    if (!currentSign || Math.sign(latest) !== currentSign || Math.abs(latest) <= Math.abs(prior)) return null;
  }

  const direction = Math.sign(move) * (rule.mode === "follow" ? 1 : -1);
  const side = direction > 0 ? "YES" : "NO";
  const entry = side === "YES" ? row.price : 1 - row.price;
  const futureYes = Number(row.future[horizon]);
  const exit = side === "YES" ? futureYes : 1 - futureYes;
  if (!Number.isFinite(exit) || entry < 0.08 || entry > 0.92) return null;
  if (rule.band !== "all" && priceBand(entry) !== rule.band) return null;

  const cost = Math.max(0, costCents) / 100;
  return {
    eventKey: row.eventKey,
    marketId: row.marketId,
    universe: row.universe || "unknown",
    observedAt: row.observedAt,
    side,
    signalStrength: magnitude,
    netReturn: (exit - entry - cost) / entry,
  };
}

export function executableTrades(rows, rule, horizon, costCents = 2) {
  const candidates = rows.map((row) => tradeFor(row, rule, horizon, costCents)).filter(Boolean)
    .sort((a, b) => a.observedAt - b.observedAt || b.signalStrength - a.signalStrength
      || String(a.marketId).localeCompare(String(b.marketId)));
  const selected = [];
  const nextEntryByEvent = new Map();
  const selectedBucketByEvent = new Map();
  for (const candidate of candidates) {
    const bucketKey = `${candidate.eventKey}:${candidate.observedAt}`;
    if (selectedBucketByEvent.has(bucketKey)) continue;
    if (candidate.observedAt < (nextEntryByEvent.get(candidate.eventKey) || 0)) continue;
    selected.push(candidate);
    selectedBucketByEvent.set(bucketKey, true);
    nextEntryByEvent.set(candidate.eventKey, candidate.observedAt + horizon * HOUR);
  }
  return selected;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarizeTrades(trades, confidence = 1.645) {
  if (!trades.length) {
    return { trades: 0, markets: 0, events: 0, mean: 0, eventMean: 0, median: 0,
      lower: 0, upper: 0, winRate: 0, worstEvent: 0, jackknifeMean: 0 };
  }
  const buckets = new Map();
  for (const trade of trades) {
    const values = buckets.get(trade.eventKey) || [];
    values.push(trade.netReturn);
    buckets.set(trade.eventKey, values);
  }
  const eventReturns = [...buckets.values()].map(mean);
  const eventMean = mean(eventReturns);
  const variance = eventReturns.length > 1
    ? eventReturns.reduce((sum, value) => sum + (value - eventMean) ** 2, 0) / (eventReturns.length - 1)
    : 0;
  const margin = confidence * Math.sqrt(variance / Math.max(1, eventReturns.length));
  const jackknifeMean = eventReturns.length > 1
    ? Math.min(...eventReturns.map((_, index) => mean(eventReturns.filter((__, other) => other !== index))))
    : -Infinity;
  return {
    trades: trades.length,
    markets: new Set(trades.map((trade) => trade.marketId)).size,
    events: eventReturns.length,
    activeTrades: trades.filter((trade) => trade.universe === "active").length,
    closedTrades: trades.filter((trade) => trade.universe === "closed").length,
    mean: mean(trades.map((trade) => trade.netReturn)),
    eventMean,
    median: median(eventReturns),
    lower: eventMean - margin,
    upper: eventMean + margin,
    winRate: trades.filter((trade) => trade.netReturn > 0).length / trades.length,
    worstEvent: Math.min(...eventReturns),
    jackknifeMean,
  };
}

export function generateRules() {
  const rules = [];
  for (const lookback of [3, 6, 24, 72, 168]) {
    for (const mode of ["follow", "fade"]) {
      for (const [minMove, maxMove] of [[0.005, 0.04], [0.01, 0.08], [0.02, 0.15], [0.04, 1]]) {
        for (const band of ["all", "longshot", "mid", "favorite"]) {
          for (const category of ["All", "Politics", "Sports", "Crypto", "Other"]) {
            for (const agreement of ["any", "same", "opposite"]) {
              rules.push({
                id: `${mode}_${lookback}h_${minMove}-${maxMove}_${band}_${category}_${agreement}`,
                family: "directional",
                lookback, mode, minMove, maxMove, band, category, agreement,
              });
            }
          }
        }
      }
    }
  }
  for (const mode of ["follow", "fade"]) {
    for (const minMove of [0.04, 0.06, 0.08, 0.12]) {
      for (const band of ["all", "longshot", "mid", "favorite"]) {
        for (const category of ["All", "Politics", "Sports", "Crypto", "Other"]) {
          rules.push({
            id: `shock_${mode}_3h_${minMove}_${band}_${category}`,
            family: "shock",
            lookback: 3,
            mode,
            minMove,
            maxMove: 1,
            band,
            category,
            agreement: "any",
            acceleration: true,
          });
        }
      }
    }
  }
  return rules;
}

function passes(stats, minimumTrades, minimumEvents) {
  return stats.trades >= minimumTrades && stats.events >= minimumEvents && stats.lower > 0
    && stats.median > 0 && stats.jackknifeMean > 0;
}

export function evaluateRules(rows, options = {}) {
  const horizons = options.horizons || [6, 12, 24, 72];
  const rules = options.rules || generateRules();
  const costCents = options.costCents ?? 2;
  const split = chronologicalEventSplit(rows);
  const results = [];

  for (const horizon of horizons) {
    const trainRows = split.train.filter((row) => Number.isFinite(row.future[horizon]));
    const validationRows = split.validation.filter((row) => Number.isFinite(row.future[horizon]));
    const holdoutRows = split.holdout.filter((row) => Number.isFinite(row.future[horizon]));
    const trainSelected = [];
    const selected = [];
    for (const rule of rules) {
      const train = summarizeTrades(executableTrades(trainRows, rule, horizon, costCents));
      if (!passes(train, 60, 15)) continue;
      const validation = summarizeTrades(executableTrades(validationRows, rule, horizon, costCents));
      trainSelected.push({ rule, train, validation });
      if (!passes(validation, 25, 8)) continue;
      selected.push({ rule, train, validation });
    }
    const candidates = selected.map((candidate) => {
      const holdout = summarizeTrades(executableTrades(holdoutRows, candidate.rule, horizon, costCents));
      return { ...candidate, holdout, passesHoldout: passes(holdout, 25, 8) };
    }).sort((a, b) => Number(b.passesHoldout) - Number(a.passesHoldout)
      || b.holdout.lower - a.holdout.lower);
    results.push({
      horizon,
      rows: { train: trainRows.length, validation: validationRows.length, holdout: holdoutRows.length },
      trainSelected: trainSelected.length,
      validationSelected: selected.length,
      holdoutPassed: candidates.filter((candidate) => candidate.passesHoldout).length,
      candidates,
      closestValidation: trainSelected.sort((a, b) => b.validation.lower - a.validation.lower).slice(0, 10),
    });
  }
  return { split, rules: rules.length, costCents, results };
}
