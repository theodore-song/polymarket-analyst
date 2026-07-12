# Polymarket Analyst

A Vercel-hosted Polymarket agent arena with shared paper-trading state, agent
return charts, paper accounts, market browsing, and live-money readiness rails.

## Just look at it now

Open the deployed site:

https://polymarket-site-eta.vercel.app

The site fetches live Polymarket markets, generates agent suggestions, lets you
run hourly paper cycles, and syncs the shared arena state through the Vercel API
when `BLOB_READ_WRITE_TOKEN` is configured.

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

- `BLOB_READ_WRITE_TOKEN` enables cross-device shared state.
- `/api/live` reports whether KYC, payments, wallet/deposit-wallet, Polymarket
  CLOB, audit, and monitoring providers are configured.
- `LIVE_TRADING_ENABLED` should stay `false` until legal review, provider setup,
  wallet signing, reconciliation, and dry-run testing are complete.
- See `REAL_MONEY_ROADMAP.md` for the launch requirements before any real funds
  or live order execution are enabled.

## Notes
- Paper trading only right now — no real money, nothing places real orders.
- The analysis is a transparent heuristic, **not financial advice**.
- The shared arena uses cloud state when configured. Individual paper accounts
  still use local browser storage unless a backend account database is added.
