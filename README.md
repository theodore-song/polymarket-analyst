# 📊 Polymarket Analyst — standalone website

A **single-file website**. Everything (fetching live Polymarket data, the
analysis engine, and the ten AI paper-trading agents) runs in your browser. The
paper portfolio is saved in your browser's local storage. No server, no keys.

## Just look at it now
Double-click **`index.html`** — it opens in your browser and works immediately.
On first open it fetches live markets, generates today's suggestions, and the
agents run a seven-day backtest, then begin live tracking. It auto-refreshes
once per day; the **Run cycle** button forces a refresh anytime.

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

## Notes
- Paper trading only — no real money, nothing places real orders.
- The analysis is a transparent heuristic, **not financial advice**.
- Because the portfolio lives in your browser, each browser/device keeps its
  own portfolio. Clearing site data resets it (so does the **Reset** button).
