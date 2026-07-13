# Provider Setup

You signed up with `emplusbodyworks@gmail.com` for the selected launch stack:

- Clerk for authentication.
- Neon for Postgres storage.
- Veriff for KYC / KYB / AML workflow.
- Circle for USDC, wallets, deposits, withdrawals, and webhooks.
- Sentry for monitoring.

The app is wired for these providers, but private credentials must be copied
from each provider dashboard into Vercel environment variables. Never commit
real credentials to GitHub.

## Vercel environment variables to add

### Clerk

- `AUTH_PROVIDER=Clerk`
- `CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `CLERK_WEBHOOK_SIGNING_SECRET`

Clerk docs list `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and
`CLERK_WEBHOOK_SIGNING_SECRET` for app connection and webhook verification.

### Neon

- `DATABASE_URL`
- `NEON_DATABASE_URL` optional alias; use the same value as `DATABASE_URL`

Use the pooled Neon connection string when possible. Neon connection strings
look like `postgresql://...neon.tech/dbname?sslmode=require...`.

### Veriff

- `KYC_PROVIDER=Veriff`
- `SANCTIONS_PROVIDER=Veriff`
- `GEOIP_PROVIDER=Veriff`
- `VERIFF_API_KEY`
- `VERIFF_SECRET_KEY`
- `VERIFF_WEBHOOK_SECRET`

The app treats Veriff as the selected KYC provider. Actual verification-session
creation is still locked until the final compliance flow is approved.

### Circle

- `PAYMENTS_PROVIDER=Circle`
- `WALLET_PROVIDER=Circle`
- `CIRCLE_API_KEY`
- `CIRCLE_WEBHOOK_SECRET`
- `CIRCLE_WALLET_SET_ID`

Circle is wired as the selected payments/wallet provider. Live deposits,
withdrawals, and wallet execution remain disabled until compliance, wallet
signing, reconciliation, and testing are complete.

### Sentry

- `MONITORING_DSN`
- `SENTRY_DSN`
- `SENTRY_AUTH_TOKEN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`
- `SENTRY_WEBHOOK_URL`

`SENTRY_DSN` is exposed to the browser through `/api/config` so the frontend can
initialize Sentry. Keep auth tokens server-side only.

## Already safe to set

- `ADMIN_ALERT_EMAIL=emplusbodyworks@gmail.com`
- `CUSTOMER_SUPPORT_EMAIL=emplusbodyworks@gmail.com`
- `PRODUCTION_APP_URL=https://polymarket-site-eta.vercel.app`
- `WEBHOOK_BASE_URL=https://polymarket-site-eta.vercel.app/api`
- `RESTRICTED_JURISDICTIONS=US,CA-NY,CA-ON`
- `LIVE_TRADING_ENABLED=false`

## Webhook URLs to paste into provider dashboards

These endpoints store provider events in Neon for audit/reconciliation prep.
They do not move money or place orders.

- Clerk: `https://polymarket-site-eta.vercel.app/api/webhooks/clerk`
- Veriff: `https://polymarket-site-eta.vercel.app/api/webhooks/veriff`
- Circle: `https://polymarket-site-eta.vercel.app/api/webhooks/circle`

Provider event counts are visible at
`https://polymarket-site-eta.vercel.app/api/provider-events`.

## What is still intentionally locked

- Real deposits.
- Real withdrawals.
- Live Polymarket order placement.
- Automatic agent trading with real funds.

## Newly wired backend endpoints

- Policies: `https://polymarket-site-eta.vercel.app/api/policies`
- Consent recording: `https://polymarket-site-eta.vercel.app/api/consent`
- Server risk profile: `https://polymarket-site-eta.vercel.app/api/risk-profile`
- Incident alerts: `https://polymarket-site-eta.vercel.app/api/incident`

The consent and incident endpoints are intentionally gated: consent needs real
approved policy versions, and incident alerts need `RISK_ADMIN_TOKEN`.

Those should stay locked until legal review, eligibility checks, signed-order
execution, reconciliation, audit logs, and incident response are complete.
