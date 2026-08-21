# Polymarket Analyst

A Vercel-hosted Polymarket agent arena with shared paper-trading state, agent
return charts, paper accounts, market browsing, and live-money readiness rails.

## Just look at it now

Open the deployed site:

https://polymarket-site-eta.vercel.app

Personal research mode:

https://polymarket-site-eta.vercel.app/personal.html

The site fetches live Polymarket markets, generates agent suggestions, lets you
run frequent paper cycles, and syncs the shared arena state through Neon or
Vercel Blob. Build 73 also installs an offline app shell and caches timestamped
market snapshots. During an outage, cycles continue locally; cached entries are
allowed for 90 minutes, older snapshots become mark-only, and all cached data
expires after 24 hours.

Build 73 distinguishes a temporary order-book pause from settlement. Exact
market refreshes still mark paused positions to the latest published price, but
the engine cannot simulate a stop, policy exit, or settlement while
`acceptingOrders` is false and `closed` is still false. Only a closed market
books the final paper proceeds and contributes a completed learner outcome.

The live scan now continues through activity-ranked pages until it has the 500
most-active eligible Yes/No contracts. Markets whose actual outcome labels are
team names, Over/Under, or another pair are rejected instead of being silently
reinterpreted as Yes/No. The same semantic check applies to complete event
bundles and the offline evaluators.

Build 73 ranks the competition by each agent's return since Strategy 58 began.
Historical replay equity remains visible for context, but it no longer makes an
agent look like the current leader when the live adaptive strategy is losing.

Each agent learns bounded weights from its own v34+ trade outcomes across signal
type, setup quality, category, side, entry-price band, and time to resolution.
The learner shrinks small samples toward neutral, caps sizing changes to
0.68x-1.30x, and reserves
15% of candidates for deterministic exploration so a stale regime cannot become
permanent.

Strategy 58 treats each binary stake as capable of falling to zero even when the
18% stop cannot fill. New core positions are capped at 2.5%-4% of equity and
aggressive positions at 3%-5%, with lower limits for near-term, extreme-price,
reversal, and fast-moving setups. Oversized positions inherited from older
engines are reduced to the same loss budget during live marking.
The two-agent overlap guard counts only positions worth at least 1.25% of an
agent's equity, so tiny profit-lock runners do not block a new material trade.

A separate walk-forward ledger records every confirmed signal before its future
price is known, grades it at 6 hours for early loss vetoes and in separate
24-hour and 72-hour promotion windows, and combines
that broad market calibration with each agent's personal outcomes. This expands
the learning sample without forcing observation-only signals into portfolios or
backfilling future information into old decisions. Missed windows expire instead
of borrowing an arbitrarily later price. The 24-hour checkpoint matches the
minimum ordinary holding policy while the 72-hour checkpoint tests persistence;
stops and profit locks still act immediately from fresh prices. Positive
six-hour evidence cannot promote capital, while a mature negative six-hour
cohort can demote it.

The Build 69 re-audit loaded all 500 requested histories with no failures. The
six-hour family lost 1.27% net on average across 106 independent events, with
its full 90% interval below zero; no tested rule was robustly positive at 6,
12, 24, or 72 hours. Build 73 therefore uses six hours only to stop bad regimes
sooner. It also closes every stale pre-Strategy-58 directional holding at the
next fresh mark, including legacy records missing a signal label, while leaving
complete arbitrage bundles and paired maker inventory under their own accounting.

The initial seven-day chart seed is an approximate replay, not a live return.
It uses only prices available on each simulated date, computes daily and weekly
changes from those historical prices, disables unavailable hourly reversal data,
and labels the combined number as legacy/replay. Adaptive-strategy returns are the
clean live comparison.

Run `npm run evaluate:signals` to test the price-signal rules against one month
of hourly Polymarket history. The evaluator forms signals only from prior
one-hour, one-day, and one-week prices, marks them 6, 12, 24, and 72 hours later,
applies a conservative half-cent cost estimate, and reports a chronological
70/30 split plus three consecutive time segments. Results are clustered by
Polymarket event so repeated observations and correlated outcome contracts cannot
masquerade as broad evidence. Set `EVAL_MARKETS`, `EVAL_CONCURRENCY`, `EVAL_HORIZONS`, or
`EVAL_COST_CENTS` to change the audit. Set `EVAL_SUMMARY=1` for the compact,
decision-focused report.

Run `npm run evaluate:adaptive` for a stricter chronological search across 1,920
predefined price-action rules. It uses a 60/20/20 train, validation, and holdout
split and never selects a rule from the holdout period. The August 19 run loaded
all 300 requested histories and found no directional rule that passed both train
and validation at either 24 or 72 hours. Strategy 55 therefore keeps directional
signals in the walk-forward observation ledger until current, independent-event
evidence proves an edge.

Run `npm run evaluate:sports-favorites` for the separate pregame favorite audit.
It anchors decisions to the published game start, rejects stale prices, takes only
the highest-priced eligible favorite per event, and uses a chronological 60/20/20
split. The refreshed August 20 run loaded all 3,000 histories with no failures and
found zero train-pass rules. The Strategy 57 24-hour, 60%-85% capital rule was
negative even with zero modeled execution cost, so Strategy 58 retired it. The
narrower 12-hour, 60%-75% cohort stayed positive by point estimate in train,
validation, and holdout at a one-cent cost, but the train and holdout confidence
bounds still crossed zero; its holdout point estimate also turned negative near a
two-cent cost. Build 74 therefore records only zero-capital observations whose
executable ask plus a 0.25-cent slippage buffer is no more than one cent above the
midpoint. It persists the pending and completed forward ledger offline, grades
only closed markets, and requires 30 new independent closed events with a positive
90% lower confidence bound before 1.25% positions can begin.

Run `npm run evaluate:settlement-calibration` for the stricter settlement-bias
search across up to 5,000 resolved markets. It uses a 60/20/20 chronological
split, a one-market-per-event limit, 95% event-clustered confidence bounds, four
stability windows, a 24-hour market-age minimum, and a recent non-flat price
history requirement. Before those activity and overlap controls, four sports
rules appeared to pass holdout because correlated props shared one event and
some histories contained inactive default prices. After correction, 11 of
1,400 rules passed training and zero passed validation. Strategy 58 therefore
does not install any other static side, category, price-band, or settlement-horizon bet.

Strategy 58 also removes the last emotion-driven sizing path. Agent mood and
leaderboard urgency remain visible in reports, but neither can increase capital.
A positive peer signal receives at most a 5% sizing lift, and only when both the
agent's realized-trade cohort and the independent walk-forward market cohort are
already promoted. One learner, popularity, or urgency alone leaves size at 1.00x.

Run `npm run evaluate:liquidity` to inspect live reward-scoring markets using
both public outcome books. It recomputes the minimum-size-adjusted midpoint,
upper-bounds competing maker score from visible qualifying depth, enforces the
$1 payout minimum, and reports one-leg loss beside the estimated reward share.
The estimate is a single snapshot, not earned income. Run `npm run evaluate:maker`
for the chronological fill-path audit; set
`MAKER_MARKETS`, `MAKER_HISTORY_DAYS`, `MAKER_CONCURRENCY`, or
`MAKER_EXIT_COST_CENTS` to change it and `MAKER_SUMMARY=1` for compact output.

The August 19 audit loaded both token histories for all 300 requested markets,
formed 5,477 non-overlapping observations, and tested 3,024 rules over 3, 6, 12,
and 24-hour horizons. Zero rules passed training, validation, or untouched
holdout. At three hours, the broad 0.5-cent quote-gap rule still lost 0.63% per
event in holdout; only 0.61% of observations completed both legs while 23.33%
produced adverse one-leg inventory. Wider quotes traded less but remained
negative. Strategy 58 therefore does not risk paper capital on an unproven
maker rule.

Run `npm run evaluate:reward-maker` to stress current reward-qualified books
against 30 days of token history. The August 19 comparison found zero passing
candidates at a three-hour exit window. At one hour, 2 of 24 current candidates
passed the chronological path screen at 25% of the present reward estimate, but
both did so without an adverse historical touch; this prioritizes shadow
research and does not authorize capital.

Maker research version 3 lets all ten agents split distinct zero-capital shadow
quote pairs selected by the shared reward-book audit. Token histories are fetched
in batches, so the learner no longer silently ignores quotes after the first ten
markets. A live cycle must still verify each touch from public CLOB price history
or a current book cross. After the first one-sided touch, the shadow engine now
buys the complement only when the current executable ask locks a positive margin
after modeled cost; otherwise it grades an immediate executable exit. It no
longer waits with adverse one-sided shadow inventory.

The August 21 expanded audit loaded both token histories for all 500 requested
markets, formed 7,335 observations, and tested 6,048 wait and immediate-hedge
rules. Zero passed training, validation, or untouched holdout. The separate
reward-assisted stress test also found zero passing candidates. Maker capital is
therefore disabled even if a small live cohort appears positive; those outcomes
remain research evidence and cannot override the failed independent backtest.
Existing paper inventory from prior maker versions is still reconciled honestly.
There is no capital-backed exploration lane, and the engine does not credit
hypothetical rewards.
See Polymarket's official [fees](https://docs.polymarket.com/trading/fees),
[maker rebates](https://docs.polymarket.com/market-makers/maker-rebates), and
[liquidity rewards](https://docs.polymarket.com/market-makers/liquidity-rewards)
documentation for the live venue rules this paper simulation approximates.

The latest 120-active-market audit produced 1,241 twelve-hour observations from
41 markets with no fetch failures. The broad rule averaged -1.35% net and was
negative in all three chronological segments. Reversals averaged -3.69%, with a
market-clustered 90% interval entirely below zero. Crypto and Sports were also
negative but covered only three and five markets. The 24-hour cohort improved to
-0.82% row mean and +1.31% market mean, with no rule robustly negative across all
segments. Strategy 54 therefore keeps reversal entries observation-only until
their recent signal and quality cohorts independently earn promotion, retains
their signals for paper grading, and evaluates adaptation at 24 and 72 hours.

The expanded active-market audit loaded history for 498 of the top 500 active
markets with no failures and produced 3,597 net-of-cost 24-hour outcomes across
142 markets. No tested follow or fade rule was robustly positive. Crypto trends
averaged -3.83% per observation and -3.99% per market; Sports trends averaged
-5.44% and -6.61%. Both stayed negative in every chronological segment and their
market-clustered 90% intervals were entirely below zero. Strategy 54 therefore
keeps Crypto and Sports trends observation-only while continuing to grade them.

The August 18 event-clustered rerun loaded 499 of 500 active markets and produced
3,894 twelve-hour observations across 156 markets and 102 independent events.
The broad mean was -1.14%, the event mean was -1.11%, and the event-clustered
90% interval stayed below zero. No tested category, side, price band, signal
strength, or combined feature cohort was robustly positive. Broad trends,
YES trends, favorite trends, strong trends, and hour-confirmed trends were all
robustly negative. Strategy 54 therefore makes every directional trend or
reversal observation-only until its own signal, side, and category cohorts each
earn positive promotion from recent independent events. This is a strategy reset,
so current adaptive returns begin from the portfolio equity at migration.

The final August 19 300-market rerun loaded all 300 eligible Yes/No price
histories without a failure and produced 2,598 twelve-hour observations across
64 independent events. The broad row mean was -0.65% and the event-cluster mean
was -1.71%. The 72-hour event-cluster mean was -3.59% with its 90% interval below
zero, and no tested directional rule was robustly positive. Strategy 54
therefore requires positive evidence at both 24 and 72 hours rather than
allowing one favorable short-horizon mark to authorize cash exposure.

A corrected 200-market audit paged through 197 markets with usable history and
1,912 twelve-hour outcomes. Reversals remained negative in every chronological
segment and averaged -4.13%. Sports trends were negative in train and test and
averaged -3.53% at 72 hours. Politics trends were the sole cohort with positive
row-level returns in all three 72-hour segments, but its market-cluster interval
still crossed zero; that supports a longer hold test, not a larger entry bet.
Strategy 54 gives previously opened Politics trend positions that 72-hour observation window before
ordinary signal exits. Stops, profit locks, settlement handling, and risk-budget
reductions remain immediate.

Strategy 54 also subtracts a half-cent round-trip cost when grading each live
walk-forward signal. Confidence uses the largest independent matching bucket,
not the sum of five overlapping feature buckets, and evidence from older engine
versions is down-weighted. This prevents a handful of duplicated observations
from authorizing larger positions or hiding a modest negative regime.

Strategy 54 adds uncertainty-aware, multi-horizon promotion and demotion. A
matching setup must accumulate at least eight effective independent-event
observations, including at least five from the current strategy, and agree across
at least two feature views at both the 24-hour and 72-hour checkpoints before it
can risk cash. Mixed or one-horizon evidence stays observation-only instead of
being mistaken for an edge.

Build 65 enforces the documented offline boundary end to end. Cached snapshots
under 90 minutes old may continue paper execution. Older snapshots remain usable
for valuation and chart snapshots for up to 24 hours, but cannot trigger entries,
stop-losses, gain-stops, risk rebalances, settlements, or policy exits. Network
requests have bounded timeouts so a weak connection falls back to cache instead
of leaving a cycle hanging indefinitely.

Build identity is separate from strategy lineage starting with build 42. The
service worker and deployment metadata advance with each code release, but
adaptive baselines, pending signal grades, and trade evidence remain in one strategy
lineage until the actual entry, sizing, or exit logic changes. Legacy build 40 and 41
records are migrated into the same strategy lineage without losing evidence.

Build 65 independently refreshes markets for due pending signals that have
left the current top-500 activity scan. Unavailable markets remain queued for a
bounded retry window. This prevents activity-rank survivorship from deciding
which wins and losses reach the adaptive calibration ledger.

Build 65 also allocates the 300 pending observation slots by evidence coverage.
Under-sampled signal/side/category cohorts are observed first, followed by
under-sampled independent events and market sides, with conviction used only as
a later tie-breaker. This prevents the same popular contracts from monopolizing
the ledger and gives the learner a realistic path to promote or reject more
diverse cohorts.

Build 65 retains safe shared-state provider diagnostics from both reads and
writes. A device now says `local only` when Neon is paused or a Blob credential
is rejected, instead of presenting a local browser save as a successful
cross-device sync. Completed cycle statuses retain that `local only` warning
until a cloud provider succeeds. Database URLs still fail over across configured Neon
aliases without exposing credentials in the API response.

Strategy 54 coordinates high-risk exploration globally. Near-term, extreme-price,
and other gap-prone positions may be held materially by only one agent, while
ordinary independently confirmed markets retain the two-agent cap. The robustly
negative Sports- and Crypto-trend cohorts cannot enter through exploration.
Reversal and short-dated NO signals remain observation-only until their own recent
feature cohorts pass the promotion gate.

Run `npm run evaluate:settlements` to evaluate fixed decisions made 1, 3, 7,
14, 30, and 90 days before known binary settlements. The audit uses one
observation per resolved market and horizon, includes losing contracts at zero,
applies the same half-cent cost assumption, clusters related contracts by event,
and requires positive event-clustered confidence bounds in train and test plus
positive results in three chronological segments before it calls a settlement
cohort robust. Environment variables beginning with
`SETTLEMENT_` control its market count, concurrency, horizons, and cost. Set
`SETTLEMENT_SUMMARY=1` for the compact report.

Run `npm run evaluate:neg-risk` to scan complete active negative-risk events for
whole-event YES or NO bundles using executable best asks/bids, per-leg costs, and
a minimum-liquidity requirement. An earlier 500-event audit found 33 complete
liquid negative-risk events and zero positive worst-case bundle returns after
costs. Midpoint price sums sometimes looked attractive, but executable spreads
removed the apparent edge. The August 18 rerun found 35 eligible events and one
three-leg NO bundle with a 0.25%
modeled margin after estimated costs. The final August 19 scan found 49 eligible
events and no currently actionable bundle; its closest complete bundle remained
0.25% negative after modeled costs. Strategy 54 can paper-trade either a
complete YES or complete NO bundle only from live executable prices, opens every
leg together, and holds
the hedge intact until settlement. It also requires at least a 0.15% modeled net
return so large bundles cannot tie up capital for a negligible absolute edge.
Cached bundle prices are never allowed to open positions.

Run `npm run evaluate:dominance` to inspect logically nested threshold contracts
using executable prices. The corrected August 19 scan tested 807 eligible pairs
across 500 active events and found zero positive pairs after estimated costs. The
August 20 rerun tested 888 eligible pairs and found one current candidate: YES on
MetaMask FDV above $2B plus NO on FDV above $3B cost 0.994 per pair after the
half-cent-per-leg execution allowance, against a guaranteed minimum $1 payout
when both contracts share the same event terms. Build 75 adds these same-event,
same-wording dominance pairs to Value Hunter's live scanner. Both legs must open
together, cached/offline prices cannot create an entry, and mismatched wording,
non-Yes/No labels, inadequate liquidity, and non-positive margins are rejected.
An earlier parser had mistaken Over/Under labels for Yes/No; the label-aware
scanner and live engine retain a regression test for that failure mode.

Build 78 expands the same-event dominance audit to explicit calendar deadlines.
For otherwise identical questions, buying NO on the earlier deadline and YES on
the later deadline guarantees at least one winning contract whether the event
happens early, happens between the dates, or never happens by the later date.
The August 21 audit found 198 valid deadline pairs among the 500 most-active
events and no pair with a positive executable margin after the half-cent-per-leg
allowance. The live scanner still monitors them every cycle and can open both
legs atomically when a positive gap appears. Mixed explicit/implicit years,
invalid dates, changed wording, non-Yes/No labels, stale quotes, and
non-positive margins are rejected.

Build 79 splits the forward directional learner by agent strategy. Every new
observation stores the agent IDs whose actual acceptance rules matched that
candidate. Graded outcomes retain the scope, and each agent builds an
event-clustered calibration from only its eligible opportunity universe. A
positive Momentum Chaser cohort can therefore promote for Momentum Chaser
without enabling the same trade for Value Hunter or the other agents; a losing
cohort can also veto one strategy without freezing all ten. The Suggestions tab
lists the agents that earned an aggregate promotion. Explicit empty scopes do
not leak to any agent, legacy unlabeled outcomes remain readable for migration,
and eligibility metadata survives local/offline and cloud-state compaction.

Build 80 expands the pending forward-research queue from 300 to 600 records and
the retained graded history from 500 to 1,000 outcomes. This keeps the 300
legacy observations through their remaining checkpoints while opening capacity
for strategy-scoped observations immediately. The larger history retains enough
independent events for per-agent 6-hour risk vetoes and 24-hour/72-hour
promotion confidence checks without relaxing execution, cost, or evidence
requirements.

Build 81 separates research eligibility from capital eligibility. Directional
trend and reversal candidates are tagged for every strategy whose broader
mandate would study them, including observation-only setups; actual positions
still require the strategy's stricter quality, edge, evidence, and forward
promotion gates. Sports-pilot and priced-bundle records are excluded from the
directional learner. Each agent report now audits the global pending queue as
legacy shared, strategy-tagged, unassigned, and tagged-for-this-agent counts so
learning differences are visible instead of inferred from a single total.

Build 82 fixes the migration edge discovered by the first Build 81 production
cycle: an explicitly unassigned Build 80 observation remains visible in the
queue audit but no longer blocks a new strategy-tagged observation for the same
market side. New records also retain the signal features used to assign their
research scope, making later audits reproducible.

Build 83 advances to Strategy 59 after a fresh return audit. A 300-market,
3,713-observation adaptive replay found no rule with a positive event-clustered
lower bound in train, validation, and untouched holdout at both 24 and 72 hours;
a separate 5,000-resolved-market settlement replay also produced no validated
holdout winner. Favorite-priced trend following was consistently net-negative
after cost across 6, 12, 24, and 72 hours, so that cohort is now hard-blocked.
Personal adaptation and position-size changes now use only closed Strategy 59
trades. Older trades remain visible as historical context but cannot promote a
personal cohort or increase current risk. Forward directional evidence from
Strategies 51-59 remains compatible because the signal and checkpoint policy
did not change.

Build 84 retires maker capital after the expanded 500-market audit found zero
validated winners among 6,048 wait and immediate-hedge rules. New maker work is
zero-capital lock-or-exit research: after one resting bid touches, the engine
records a complementary hedge only when the current executable ask locks a net
profit; otherwise it grades an immediate exit. A positive in-app cohort cannot
reactivate capital without a separately approved chronological backtest.

Build 85 adds a forward-only Shock Reversion lane after a 157,386-observation
hourly replay found a promising but not yet independently conclusive regime.
The agent detects an 8-point or larger three-hour YES-price move whose final
hour remains aligned, then observes the opposite side for exactly three hours.
Entry and exit use executable book prices plus a 0.25-cent slippage buffer.
The first 30 independent events use zero capital, missed exit windows expire
without borrowing a later price, and offline snapshots cannot create or grade
an observation. A positive 90% lower confidence bound above 0.5% is required
before 0.75%-of-equity paper positions can begin, with all concurrent shock
positions capped at 2% of equity.

Build 77 separates the directional learner's evidence lineage from the global
strategy release. Code-history verification found the same trend/reversal
generator and 24-hour/72-hour grading policy in Strategy 51 through Strategy
59, so their forward, net-of-cost checkpoint observations remain compatible
even when an unrelated sports, maker, or bundle subsystem ships.
Older signal policies remain down-weighted and cannot satisfy the current-policy
promotion gate. This avoids repeatedly emptying a valid evidence set while
preserving the requirement for positive 24-hour and 72-hour results across
independent events. The app also requests an immediate catch-up cycle whenever
it regains focus, becomes visible, or reconnects; background browser timers can
still be suspended by the operating system when the app is closed.

The expanded event-clustered run loaded history for 498 of the 500 highest-volume
resolved markets with no fetch failures. No side, price band, category, trend,
or 1-90 day holding rule passed the required train/test confidence checks. In
particular, older YES/underdog gains
reversed in the recent test segment. The engine therefore does not install a
static settlement-direction boost from this audit.

The earlier 200-resolved-market audit found short-dated NO entries strongly
negative, but the 500-market rerun did not reproduce that loss in its newer test
segment. Strategy 54 therefore treats the result as a provisional prior instead
of a permanent ban: NO entries with 21 days or less remain observation-only until
the recent walk-forward calibration promotes their matching side and duration
cohorts. Exact numeric-range contracts are excluded from new entries because a
settlement jump can pass directly through an 18% stop; the live audit found that
this failure mode caused the largest latest-day loss.

Strategy 54 also excludes path-dependent barriers such as "reach $66,000," "hit
$90," and "dip to $62,000." These contracts can resolve abruptly as soon as the
barrier is touched, so a later hourly stop cannot reliably cap the loss. Fixed-date
level questions such as "above $66,000 on August 23" remain eligible.

Strategy 54 clusters live walk-forward observations by Polymarket event and checkpoint before
calculating confidence. Multiple six-hour snapshots and correlated outcome
markets from the same event are averaged into one effective outcome, so one
election or tournament cannot promote or demote an entire feature cohort.
Promotion requires agreement across two feature views at both 24-hour and
72-hour promotion horizons, while a mature negative six-hour view may veto risk.
Current-strategy support prevents old lineage data from authorizing a new rule.

The pending signal ledger keeps only one ungraded observation for each market and
side. When its bounded queue is full, it preserves the oldest evidence through
the 6-hour, 24-hour, and 72-hour grades and admits new signals in ranked order as space opens.
This prevents frequent cycles from evicting every signal shortly before maturity.

Paper accounts created with a password are also saved through the backend, so a
user can log in from another device and see the same paper portfolio, activity,
and value history. Passwordless paper accounts remain local-only.

## Put it online (free) so you can reach it from any device

Pick one — all give you a public URL:

**Option A — Netlify Drop (easiest, ~30 seconds, no account needed to start)**
1. Go to <https://app.netlify.com/drop>
2. Drag the whole **`polymarket-site`** folder onto the page.
3. You get a live URL like `https://your-name.netlify.app`. Done.

**Option B — GitHub Pages**
1. Create a new GitHub repo and upload `index.html`.
2. Repo → Settings → Pages → Branch: `main`, folder: `/root` → Save.
3. Your site appears at `https://theodore-song.github.io/<repo>/`.

**Option C — Vercel**
1. <https://vercel.com> → Add New → Project → import this GitHub repo under the
   `theodore_song` Vercel account (or use the `vercel` CLI in this folder) → Deploy.

## Configuration

Use `.env.example` as the setup template.

- `DATABASE_URL` or `NEON_DATABASE_URL` enables Neon-backed shared state;
  `BLOB_READ_WRITE_TOKEN` is the fallback provider. The backend accepts raw
  Postgres URLs, quoted URLs, `DATABASE_URL=...`, and Neon dashboard
  `psql 'postgresql://...'` copy formats, and prefers a syntactically valid
  alias if the primary value is malformed. Shared-state reads and writes also
  fail over across distinct configured database URLs when one has stale
  credentials or points at an empty project. `/api/state` reports only
  sanitized provider error codes when all stores are unavailable.
- `ACCOUNT_SESSION_SECRET` signs cloud paper-account sessions. If omitted, the
  app falls back to the existing server secret/token, but production should use
  a dedicated value.
- `PROVIDER_SETUP.md` maps the current stack — Clerk, Neon, Veriff, Circle, and
  Sentry — to the exact Vercel environment variables still needed.
- `/api/live` reports whether KYC, payments, wallet/deposit-wallet, Polymarket
  CLOB, authentication, geofencing, sanctions, audit, support, and monitoring
  providers are configured.
- `LIVE_TRADING_ENABLED` should stay `false` until legal review, provider setup,
  wallet signing, reconciliation, and dry-run testing are complete.
- See `REAL_MONEY_ROADMAP.md` for the launch requirements before any real funds
  or live order execution are enabled.

## Notes
- Paper trading only right now — no real money, nothing places real orders.
- Personal research mode hides investor/live-money tabs and is for your own
  analysis plus manual execution links only.
- The analysis is a transparent heuristic, **not financial advice**.
- The shared arena uses cloud state when configured. Password-backed paper
  accounts use the backend account API; passwordless paper accounts use local
  browser storage.
