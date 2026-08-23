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
Offline cycles can apply calibration already earned from live observations, but
the evidence ledger is read-only: cached prices cannot grade pending signals,
expire horizons, or create new observations.

Build 136 targets five-minute slots with a serialized, self-chained GitHub Actions runtime.
The mutable snapshot stays on the dedicated `runtime-state` branch, which is
explicitly excluded from Vercel Git deployments through
`git.deploymentEnabled`. This prevents high-frequency state commits from
consuming Preview deployment quota while ordinary `main` source commits still
produce Production deployments.
It continues from the previous agent snapshot and runs the next due paper cycle
even when no browser is open. After each cycle attempt, one repo-scoped
workflow dispatch waits for the next five-minute boundary; one concurrency group
serializes active and pending runs, and both successful and failed runs hand off
after the next boundary while the cron schedule remains as recovery. The runtime writes a
sanitized snapshot to the `runtime-state` branch and `/api/state` uses that as a
read-only fallback while Neon or Vercel Blob is unavailable. The public snapshot
contains only `pma_agents_v2` and `pma_suggestions_v5`, with suggestions capped at
300 to keep cross-device loads small. The API preserves oldest-first pending
observations plus fee schedules, agent promotion scopes, and verified bundle
capacity from the bounded runtime instead of applying its older lossy compactor.
Public maker outcomes retain only calibration fields, action logs are bounded
to 48 entries per agent, and chart snapshots are evenly sampled once their
96-point public limit is reached so older dates remain represented. Repetitive
watch-only explanations are normalized without changing signal fields. If the
875 KB browser transport budget is reached, the compactor first protects 75 KB for
learning, reserves up to 144 of the newest completed directional outcomes, and
then gives the remaining evidence space to the oldest still-pending
observations. Only after display history reaches its documented floor can the
public suggestion list fall from 300 to its 240-item emergency floor. The headless
runner applies an additional 850 KB hard target before committing state, leaving
margin below the API's 900 KB limit.
Paper accounts, passwords, email settings,
investment allocations, chat history, wallet information, and live-money
settings are explicitly excluded. While that fallback is active, ordinary
phones and computers are display-only and cannot fork the public portfolio with
their local timer; only the headless runner advances it. The next autonomous
result is the shared public authority until managed storage is restored. The
headless browser also rebuilds a minimal timestamped market cache from those two
public items on every restart. A complete network outage can therefore continue
the existing 90-minute cached-entry and 24-hour mark-only policy without adding
another synchronized key; strategies that require fresh order-book depth remain
blocked until live connectivity returns. The five shock-strategy adopters now learn from one shared,
event-deduplicated forward ledger. A trade allocated to one agent therefore
teaches the other four without copying its cash or P&L; shared positive evidence
can promote bounded size and shared negative evidence disables the lane.
Active shock positions use a second underlying-risk key in addition to the
Polymarket event key. Related Ethereum or Bitcoin contracts cannot create
several simultaneous copies of one move, and outcomes from the same underlying
three-hour shock window count as one learner event.

Each Build 136 job performs two bounded live passes, with the second beginning
only after the wall-clock minute changes. This gives transient verified bundle
exits and resting maker touches a second execution opportunity without creating
parallel authorities or weakening any entry, fee, depth, overlap, or offline
gate. The sanitized shared snapshot commits only after both passes complete.

Each Build 136 cycle also scans the 1,000 most-active Polymarket events for
complete negative-risk bundles and logically nested threshold or deadline
pairs, plus same-market YES/NO complements whose equal shares have a fixed
$1 redemption value. Polymarket's documented complete-set merge converts equal
YES and NO amounts directly back into collateral, so a verified binary complement
is merged and realized in the same paper cycle instead of waiting for resolution.
The official negative-risk adapter also converts a complete set of NO tokens into
`n - 1` units of collateral, less the event's `negRiskFeeBips`. Strategy 65 treats
that as a separate immediate path. The scanner reserves 40 of its 200 depth checks
for complete-NO candidates, then reads `getFeeBips` and `getQuestionCount` from the
official Polygon adapter for only those candidates. Every leg must expose one
consistent `negRiskMarketID`, the event leg count must equal the on-chain question
count, all asks and CLOB fee schedules must verify, and the post-conversion proceeds
must remain profitable. Missing or inconsistent adapter data cannot produce paper
P&L. Complete YES sets and logical dominance pairs are not convertible and continue
to use settlement or verified live-bid exits.
Build 136 persists up to two zero-capital maker-assisted observations discovered in
each depth-checked protected-structure scan. Each observation rests for one hour.
If the public price trades at least half a tick through its bid, the learner treats
that as a conservative paper touch, then re-fetches every leg's order book and exact CLOB fee
schedule. It grades a protected lock only when all remaining legs can be bought
immediately with at least $0.50 total profit and the duration-adjusted hurdle still
clears; otherwise it grades the touched leg at its executable bid, or conservatively
as a full loss when an exact unwind cannot be verified. Offline snapshots can retain
an observation but cannot touch, grade, or fund it. Completed events enter a shared
24-hour cooldown and survive the public runtime's bounded transport.

Maker-assisted capital starts at zero. Outcomes are separated by protected-structure
family and expected lock duration so a strong family cannot lend permission to an
unrelated weak one. A cohort can reach only a 0.5% per-event and 2% total paper
allocation after 15 independent current-version outcomes include at least four
protected locks and their lower 90% return bound exceeds 0.5%. Under-sampled cohorts
receive observation priority. Unfilled quotes and failed hedges remain in each
confidence calculation. Shadow returns never change portfolio cash, and no
real-money order path is enabled.

Build 136 also preserves verified complete-NO conversion metadata after a
maker-assisted touch. Once that cohort earns paper promotion, buying the remaining
legs at exact verified depth immediately converts the complete NO set through the
already verified negative-risk terms. The protected profit is realized and the
collateral is returned in the same cycle instead of being stranded until settlement.
Missing or mismatched conversion terms still block this path.

Build 133 first measured the zero-capital maker-assisted path for every depth-checked
protected structure. It asks whether improving one resting bid by one tick and
then immediately buying every remaining leg at the already verified live-depth
VWAP would leave a complete positive-payout bundle. The audit records the exact
resting leg, bid, ask, protected post-fill cost, units, return, and total profit.
That audit could not open a position or change cash. The first 1,000-event live scan found
one shadow candidate: a complete YES shipping-count bundle with $0.67 modeled
profit at 48.7 units, contingent on a 4.9-cent bid filling and the remaining
hedge still being executable. Forward fill-and-hedge evidence is required before
the Build 136 learner can now collect that evidence before this path receives any
paper capital.
Bundle capital is split between five independent owners instead of bottlenecking one
portfolio: Value Hunter owns settlement complete sets, Momentum owns exact complete-NO
conversions, Breakout owns same-market binary merges, Tail Alpha owns exclusive NO
pairs, and The Diversifier owns threshold and deadline dominance spreads. A global underlying-event
claim prevents any owner from duplicating exposure already held by another.
Gasless CTF operations include merge transactions; see
[Positions & Tokens](https://docs.polymarket.com/concepts/positions-tokens) and
[Gasless Transactions](https://docs.polymarket.com/trading/gasless).
Gamma's market-specific fee flag replaces the old blanket 0.5-cent fee
reserve for markets declared fee-free. The scanner uses 120 independent-first
general structure checks and reserves 40 additional checks for same-market
complements. Structures are ranked by locked-capital efficiency, with
the best structure from each independent event checked before alternates from events
already represented. They are repriced
from batched CLOB asks from the equal-unit size needed for at least a $50
paper order up to a $1,000 verified-notional ceiling. The scanner applies each market's Gamma fee schedule at every
consumed ask level and checks the exact CLOB condition metadata for a matching
fee curve or fee-free state. Any opened position is capped to the exact equal-unit size
of the largest fill that stays profitable and passes this depth test; portfolio
cash and reserve limits can reduce it further. Ordinary protected entries use at
most 6% of equity, entries returning at least 0.20% per locked day use at most 8%,
and immediate merge or conversion paths use at most 10%. Strategy 65 ranks verified
structures by net return per expected locked day before raw edge, and caps active
cost from one underlying event at 12% of the owning portfolio's equity. This prevents
several related threshold pairs from monopolizing the non-directional book. New bundles must
clear a duration-aware daily hurdle: 0.03% through 7 days, 0.04% through 30 days,
0.05% through 90 days, and 0.075% beyond 90 days. Immediate merge and conversion
paths use a 0.01% hurdle. Exact executable sizing must also preserve at least a
0.10-cent per-unit safety margin and $0.50 of total locked profit. This admits a
small margin only when verified depth can scale it into meaningful profit, while
demanding substantially more from positions that immobilize capital for months. Existing paper bundles are
never retroactively enlarged against depth their original simulated fill would
already have consumed. Each live cycle also prices an atomic exit across every bid
level needed to sell every leg of each intact bundle. It verifies every condition's
exact fee schedule again. Exit capture is duration-aware: bundles with at most
7 days remaining require 85% of settlement profit, those with at most 30 days
require 65%, those with at most 90 days require 45%, and longer locks require
20%. Every exit must still realize at least $0.50, remain profitable after exact
fees, and sell every equal-unit leg atomically. Missing depth, mismatched fees, or
an insufficient profit capture leave the guarantee intact; cached offline cycles cannot
execute this recycling path. A bundle can enter its designated protected owner only when that fee check
passes and the resulting worst-case payout clears the 0.10-cent per-unit buffer,
$0.50 total executable-profit floor, and 0.15% return floor. Top-of-book gaps, missing books,
incomplete fee schedules, and unavailable fee verification remain audit-only.
The Suggestions view stores scan, depth, fee, actionable, and closest
executable-margin counts so an empty lane is evidence rather than an ambiguous
failure.

Build 132 retains the directional learner's exact-fee policy, which replaced the blanket half-cent cost with
the market's Gamma fee schedule at both the entry and future checkpoint, plus a
separate half-cent round-trip slippage allowance. Fee-free markets pay only the
slippage allowance; an unavailable fee schedule gets a conservative four-cent
fee reserve and cannot look artificially profitable. Fee metadata survives
cloud compaction and offline caching. Unfinished observations from the prior fee
policy are replaced immediately, while completed historical outcomes remain
available at reduced weight. The exact-fee replay covered the top 1,000
active markets and 208 independent events: broad trends, reversals, and
favorite trends all had 90% upper bounds below zero at 12 hours. A separate
3,000-recently-closed-market study tested 297 one-decision-per-event settlement
rules and found zero robust positive rule. Strategy 65 retains online
directional evidence under fee policy 2. A separate probation gate can now use
capital after at least 12 current-policy independent events produce a net-of-cost
six-hour lower confidence bound above 1% for every required cohort feature.
The corresponding 500-market, 1,920-rule chronological audit selected zero
rules in validation at 6, 24, or 72 hours. No directional rule is preapproved;
probation and full sizing must be earned from new event-deduplicated forward
observations. Probation uses at most 0.5% of equity per position, 1% per-agent
total capital, one new
position per agent cycle, and one owner per Polymarket event across all agents.
Every probation position exits at the matching six-hour executable bid and keeps
the 18% stop policy active. Normal directional sizing remains locked until the
same cohort independently passes both the 24-hour and 72-hour promotion gates.

An August 23 exact-fee settlement calibration independently checked 5,000
resolved markets, 4,807 usable histories, and 7,854 observations across 1,400
fixed side, category, price-band, and 1/3/7/14/30-day rules. Zero rules cleared
even the event-clustered 95% training lower-bound gate. The three-day Sports NO
target fell to -44.14% in validation and remained negative in holdout, so it
cannot authorize capital. The reproducible result is stored in
`research/settlement-calibration-exact-fee-5000-audit.json`.

The August 23 walk-forward calibration-model audit tested whether a nonlinear
probability model could recover an edge missed by the static settlement grid.
It reconstructed only pre-decision price, trend, range, age, category, and
question-form features from 5,000 resolved markets, split underlying events
chronologically 60%/20%/20%, and allowed one position per event. Flat placeholder
histories are excluded, exact published fees or a conservative unknown-fee
reserve are charged, and one cent of entry slippage is added. A configuration
must have a positive event-level 90% lower bound in at least 80 training events,
40 validation events, and 40 untouched holdout events. Zero configurations
cleared the pre-holdout train-and-validation gate, so the model is rejected and
does not receive paper capital. Reproduce it with
`npm run evaluate:calibration-model`; the result is stored in
`research/calibration-model-5000-audit.json`.

Build 132 retains Build 100's retirement of the old 3-6 day resolution-window
capital permission. That audit clustered confidence by event but still averaged
several correlated contracts inside each event, while production could choose
only one. The corrected replay chooses the highest-volume eligible contract per event and
rule. In the recent 3,000-market discovery sample, only the safe non-Sports
50%-55% NO rule four days before settlement survived every chronological gate:
145 events, a 38.42% mean, and a 26.12% lower 90% bound after one cent of cost.
The next disjoint 3,000-market block did not confirm it: the safe cohort's
holdout lower bound was -4.73%, and two chronological-third lower bounds were
negative. No 3-6 day rule is therefore approved for capital.

The remaining four-day candidate is a zero-capital forward learner. It accepts
only fixed-date, non-Sports contracts with a 50%-55% NO midpoint, at least
$15,000 total volume, $1,400 liquidity, and no more than a three-cent spread.
The modeled entry uses the executable NO ask plus 0.25 cents of slippage and
rejects more than one cent of friction. One observation is recorded per event
and graded only after Polymarket marks the market closed; offline snapshots
cannot invent settlement. Forty independent settled observations with a lower
90% confidence bound above 1% are required before 0.5%-of-equity paper
positions can begin. Existing positions from the retired version still follow
their precommitted settlement-only exit.

Build 94 also closes the contract-safety hole exposed by the first Strategy 3
paper positions. Shock Strategy 4 keeps the same audited accelerating
three-hour fade and fixed 12-hour executable exit, but it will not enter a
path-dependent barrier, an exact numeric range, or a market without at least
the full 12-hour holding period plus its two-hour grading tolerance remaining.
Older unsafe shock positions are unwound at an executable bid; older valid
positions continue to their recorded target and still reserve their underlying
risk so the new strategy cannot overlap them. Strategy 4 starts a fresh shared
forward ledger because its eligible contract universe is materially different.

Build 95 removes Strategy 4's initial capital permission after replaying the
production contract gate over 2,000 primary and 1,000 untouched active markets
at a two-cent modeled cost. The primary train, validation, chronological, and
event-holdout lower bounds remained positive, but the untouched chronological
event mean was negative and both its chronological and event-holdout confidence
bounds crossed zero. No category or entry-price refinement survived every
independent partition. Strategy 4 therefore starts shadow-only: 40 positive
event-deduplicated forward outcomes with a lower bound above 1% can qualify 1%
paper positions; 80 outcomes with a lower bound above 1.5% can raise size to
1.5%. Twenty convincingly losing events keep capital disabled.

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

Run `npm run evaluate:sports-favorites` for the retired pregame favorite audit.
Its 12-hour, 60%-75% cohort had positive point estimates but did not establish a
reliable confidence bound, so Build 132 no longer allocates capital to that rule.

Strategy 65 also tracks the exact-fee settlement calibration's three-day Sports
NO cohort as a zero-capital forward lane. The corrected 5,000-market run
groups every prop with the same dated contest slug, anchors the decision to the
published game start, and keeps only the highest-priced eligible NO contract per
real contest. Its 76 contests had positive point estimates in all four
chronological quarters; train and holdout 95% lower bounds were positive, but
validation returned only +1.78% with a wide negative lower bound. This is not a
proven edge. A follow-up search tested 60 rules on the most recent 5,000 eligible
resolved sports markets and again on the next older disjoint 5,000. No rule passed
train, validation, and untouched holdout in both archives. Favorite Backer therefore
opens no sports capital initially and records at most one contest-level observation
per cycle using the executable NO ask, exact Gamma taker fee, and 0.25-cent slippage.
Twenty independent forward settlements with a lower 90% confidence bound above
0.5% can promote 0.75% positions; 40 stronger outcomes can raise size to 1%. The
same ledger persists offline, but stale cache policy and verified settlement rules
still apply.

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

Maker research version 4 lets all ten agents split distinct zero-capital shadow
quote pairs selected by the shared reward-book audit. Token histories are fetched
in batches, so the learner no longer silently ignores quotes after the first ten
markets. A live cycle must still verify each touch from public CLOB price history
or a current book cross. After the first one-sided touch, the shadow engine now
buys the complement only when the current executable ask locks a positive margin
after modeled cost; otherwise it grades an immediate executable exit. It no
longer waits with adverse one-sided shadow inventory. Build 132 records seven
reproducible setup cohorts for every completed observation: category, spread,
reward yield, quote-price balance, recent movement, paired locked margin, and
visible competition. Shadow selection adds a bounded novelty score so the ten
agents rotate toward under-sampled configurations instead of repeatedly measuring
one dominant setup. A mature losing cohort vetoes risk; promotion would require
every matching cohort to clear its independent-event confidence and locked-fill
requirements, as well as a separately approved chronological backtest.

Build 132 makes that research adaptation react sooner without lowering the
capital gate. Once a setup feature has three independent current-version events,
its confidence-weighted mean changes zero-capital candidate priority; early
losses therefore move similar setups down the queue instead of waiting for the
20-event promotion sample. A completed current-version event also enters a
shared 24-hour cooldown across all ten agents. This prevents repeated quotes on
the same event from masquerading as independent evidence and spends the limited
research slots on broader setups. Capital still requires 20 independent events,
three locked events, a positive lower confidence bound for every matching
feature, and a separately approved chronological backtest.
The cooldown is also enforced against inherited zero-capital quotes: when a
deployment starts with an active shadow quote for an event that already produced
a current-version outcome in the prior 24 hours, the quote is retired before
touch processing or new staging. That cleanup changes neither cash nor P&L.

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

Strategy 65 retains exact Gamma entry and exit taker fees plus a half-cent
slippage allowance when grading each live walk-forward signal. Confidence uses the largest independent matching bucket,
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

Build 86 replaces that inconclusive three-hour exit with a narrower rule that
survived a corrected 2,000-market audit. Across 534,894 hourly observations,
the exact accelerating three-hour shock / 8–25% opposite-side longshot / 24-hour
exit rule retained positive 90% lower bounds in train, validation, chronological
holdout, and a sealed event-disjoint holdout at one-cent modeled cost. The four
partitions contained 69, 70, 104, and 56 independent events respectively. It
did not survive a two-cent stress test, so live candidate construction requires
entry friction of at most half a cent and grades the future exit at the actual
executable bid with another 0.25-cent slippage buffer. Backtest-approved paper
positions begin at 0.5% of equity and total shock exposure is capped at 3%.
Thirty positive forward events with a lower bound above 1% can raise individual
size to 1%; twelve convincingly losing events or a 2% strategy loss demote the
lane to zero capital. Strategy-1 outcomes do not contaminate Strategy-2 evidence.

Build 87 applies a harsher two-cent round-trip stress and replaces Strategy 2
with the stronger all-price-band rule: fade an accelerating move of at least
eight percentage points over three hours and exit after twelve hours. With each
return winsorized to the live learner's -100%/+200% range, its 90%
event-clustered lower bounds were +4.01% train, +4.55% validation, +3.63%
chronological holdout, and +1.08% on the sealed event-disjoint holdout, across
93, 85, 159, and 80 independent events. Entry still requires a live executable
price between 8% and 92%, no more than one cent of entry friction, and an extra
0.25-cent slippage buffer at exit. Initial paper positions are 1% of agent
equity, capped at 5% total per agent; 40 positive forward events can raise size
to 1.5%, while 20 convincingly losing events or a 3% strategy loss disable the
lane for that agent. All five aggressive agents may adopt it, but no event may
be repeated across agents and each agent can open at most two shock positions
per cycle. The service worker now uses Build 87 cache invalidation and
network-first refreshes, so an installed offline copy receives new builds when
it reconnects instead of continuing to serve stale Build 83 assets.

The exact Strategy 3 rule was then frozen and checked without retuning on the
next 1,000 eligible active markets (246,580 additional observations). Mean
return remained positive in train, validation, chronological holdout, and the
event-disjoint holdout. The independent event holdout retained a +0.37% 90%
lower bound across 61 events; train and chronological-holdout lower bounds were
slightly inconclusive at -0.17% and -0.89%. This is why Build 87 starts at 1%
rather than extrapolating the stronger first-universe result into large risk.
Resolved-market archive history was still unavailable, so the strategy remains
a demotable paper-trading lane rather than a return guarantee.

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
