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
Vercel Blob. Engine v41 also installs an offline app shell and caches timestamped
market snapshots. During an outage, cycles continue locally; cached entries are
allowed for 90 minutes, older snapshots become mark-only, and all cached data
expires after 24 hours.

Each agent learns bounded weights from its own v34+ trade outcomes across signal
type, setup quality, category, side, and entry-price band. The learner shrinks
small samples toward neutral, caps sizing changes to 0.68x-1.30x, and reserves
15% of candidates for deterministic exploration so a stale regime cannot become
permanent.

Engine v41 treats each binary stake as capable of falling to zero even when the
18% stop cannot fill. New core positions are capped at 2.5%-4% of equity and
aggressive positions at 3%-5%, with lower limits for near-term, extreme-price,
reversal, and fast-moving setups. Oversized positions inherited from older
engines are reduced to the same loss budget during live marking.
The two-agent overlap guard counts only positions worth at least 1.25% of an
agent's equity, so tiny profit-lock runners do not block a new material trade.

A separate walk-forward ledger records each trade-ready signal before its future
price is known, grades it at least 12 hours later, and combines that broad market
calibration with each agent's personal outcomes. This expands the learning sample
without backfilling future information into old decisions.

The initial seven-day chart seed is an approximate replay, not a live return.
It uses only prices available on each simulated date, computes daily and weekly
changes from those historical prices, disables unavailable hourly reversal data,
and labels the combined number as legacy/replay. Engine-version returns are the
clean live comparison.

Run `npm run evaluate:signals` to test the price-signal rules against one month
of hourly Polymarket history. The evaluator forms signals only from prior
one-hour, one-day, and one-week prices, marks them 6, 12, 24, and 72 hours later,
applies a conservative half-cent cost estimate, and reports a chronological
70/30 split plus three consecutive time segments. Results are also clustered by
market so repeated observations from one contract cannot masquerade as broad
evidence. Set `EVAL_MARKETS`, `EVAL_CONCURRENCY`, `EVAL_HORIZONS`, or
`EVAL_COST_CENTS` to change the audit.
The first 80-market audit found that reversal signals lost 4.34% on average in
both chronological partitions, while crypto and longshot samples were also
negative overall. Engine v41 therefore blocks reversal and sports-trend entries outside the fixed
15% exploration lane and applies modest sizing penalties to crypto and longshots.
It does not boost any rule from this audit because no positive rule was robust
across the chronological split.

A corrected 200-market audit paged through 197 markets with usable history and
1,912 twelve-hour outcomes. Reversals remained negative in every chronological
segment and averaged -4.13%. Sports trends were negative in train and test and
averaged -3.53% at 72 hours. Politics trends were the sole cohort with positive
row-level returns in all three 72-hour segments, but its market-cluster interval
still crossed zero; that supports a longer hold test, not a larger entry bet.
Engine v41 gives Politics trend positions that 72-hour observation window before
ordinary signal exits. Stops, profit locks, settlement handling, and risk-budget
reductions remain immediate.

Engine v41 also subtracts a half-cent round-trip cost when grading each live
walk-forward signal. Confidence uses the largest independent matching bucket,
not the sum of five overlapping feature buckets, and evidence from older engine
versions is down-weighted. This prevents a handful of duplicated observations
from authorizing larger positions or hiding a modest negative regime.

Engine v41 adds uncertainty-aware promotion and demotion. A matching setup must
accumulate at least eight effective observations and agree across at least two
feature views before repeatable positive evidence can increase size or repeatable
negative evidence can block a new entry. Mixed evidence stays close to neutral
instead of being mistaken for an edge.

Engine v41 enforces the documented offline boundary end to end. Cached snapshots
under 90 minutes old may continue paper execution. Older snapshots remain usable
for valuation and chart snapshots for up to 24 hours, but cannot trigger entries,
stop-losses, gain-stops, risk rebalances, settlements, or policy exits. Network
requests have bounded timeouts so a weak connection falls back to cache instead
of leaving a cycle hanging indefinitely.

Run `npm run evaluate:settlements` to evaluate fixed decisions made 1, 3, 7,
14, 30, and 90 days before known binary settlements. The audit uses one
observation per resolved market and horizon, includes losing contracts at zero,
applies the same half-cent cost assumption, clusters related contracts by event,
and requires positive event-clustered confidence bounds in train and test plus
positive results in three chronological segments before it calls a settlement
cohort robust. Environment variables beginning with
`SETTLEMENT_` control its market count, concurrency, horizons, and cost.

The first event-clustered run loaded 498 of the 500 highest-volume resolved
markets. No side, price band, category, or 1-90 day holding rule passed the
required train/test confidence checks. In particular, older YES/underdog gains
reversed in the recent test segment. The engine therefore does not install a
static settlement-direction boost from this audit.

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
  `BLOB_READ_WRITE_TOKEN` is the fallback provider.
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
