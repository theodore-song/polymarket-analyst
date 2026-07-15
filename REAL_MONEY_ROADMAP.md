# Real Money Enablement Roadmap

This public app is currently paper trading only. The public site hides live
trading controls. The `/personal` route opens a private cockpit for your own
wallet, your own money, manual approval, and audit logging.

## What is configured now

- `.env.example` lists the environment variables the production app needs.
- `/api/live` reports which live-money providers are configured or missing.
- `/api/live` accepts public order intents only as dry-runs and returns an
  audit event. Personal-mode intents are staged for manual review, not executed.
- `/api/live?action=tickets` and `/api/live` ticket actions store
  non-custodial manual trade tickets. These tickets contain the market, side,
  amount, limit, rationale, Polymarket link, and review instructions, but never
  a private key or signed order.
- `/api/live` manual-fill actions record trades that you placed yourself on
  Polymarket, then update tracked real positions and P&L. These records are for
  reconciliation only: Poly Arena still does not sign or submit the trade.
- `/api/accounts` creates, logs into, and saves password-backed paper accounts
  through Vercel Blob storage.
- `/api/config` exposes safe public provider configuration, including the
  Sentry browser DSN and Clerk publishable key once configured.
- `/api/live` now checks the selected provider stack: Clerk, Neon, Veriff,
  Circle, and Sentry.
- `/api/webhooks/clerk`, `/api/webhooks/veriff`, and `/api/webhooks/circle`
  receive provider events and store them in Neon.
- `/api/provider-events` reports provider event counts for a quick health check.
- `/api/policies` exposes the active policy/readiness state.
- `/api/consent` records versioned user consent after approved versions are
  configured.
- `/api/risk-profile` stores wallet, jurisdiction, allocation, and agent
  permission settings server-side.
- `/api/incident` records incident events and can notify the configured incident
  webhook after `RISK_ADMIN_TOKEN` is set.
- The public site hides the live-money tab. `/personal` shows wallet/deposit
  settings, personal risk limits, provider webhook URLs, a manual intent
  console, and an audit preview.

The app still refuses to place live orders. Personal mode stages manual intents
only until your own deposit wallet, CLOB credentials, and tiny test flow are
ready.

## Personal-use path

Personal mode is narrower than the public business launch:

- Your own money only.
- Your own Polymarket/deposit wallet only.
- No outside investors, deposits, pooled funds, or copy-trading customers.
- No unattended agent trading.
- Every live trade starts as a staged manual intent and must be reviewed before
  you do anything in Polymarket.
- Trade execution happens outside Poly Arena through your own Polymarket wallet
  or UI. Poly Arena remains the analyst/ticketing layer.
- After you manually trade, record the actual shares, price, fees, and note in
  Poly Arena so the personal cockpit can track real position value and P&L.
- Public `LIVE_TRADING_ENABLED` stays `false`.

Personal mode still needs:

- `DEPOSIT_WALLET_ADDRESS`
- `POLYMARKET_SIGNATURE_TYPE=3`
- `POLYMARKET_CLOB_API_KEY`
- `POLYMARKET_CLOB_SECRET`
- `POLYMARKET_CLOB_PASSPHRASE`
- `RISK_ADMIN_TOKEN`
- `PERSONAL_TRADING_ENABLED=true` only after your own tiny manual test flow

## Required before live deposits or trading

1. Legal and eligibility
   - Terms, risk disclosures, privacy policy, and jurisdiction policy.
   - KYC / KYB provider.
   - Age, location, sanctions, and restricted-market checks.
   - Market category policy for elections, sports, finance, crypto, geopolitical
     events, manipulated markets, disputed markets, and restricted outcomes.
   - Record of user consent to every active terms, privacy, and risk-disclosure
     version.

2. Account and wallet
   - Real authentication for live-money users.
   - Production account database. The current backend account API is enough for
     paper portfolios, but live money should use a real database with admin,
     audit, and compliance tooling.
   - Password reset, sign-out, session expiry, and optional MFA path.
   - Non-custodial wallet connection or Polymarket deposit-wallet flow.
   - User-controlled permissions for each agent.
   - Revocation path so a user can stop agent trading immediately.

3. Funds
   - Deposit provider.
   - Withdrawal provider.
   - Payment webhooks and failure handling.
   - Balance reconciliation, statements, support, and accounting exports.
   - Withdrawal review rules for fraud, sanctions, chargeback, and settlement
     edge cases.

4. Execution
   - Backend order router.
   - Polymarket CLOB API credentials.
   - EIP-712 order-signing flow.
   - Order placement, cancellation, fill tracking, and position reconciliation.
   - Idempotency keys, retry policy, rate limits, and stale-order protection.
   - Server-side enforcement of user permissions and risk limits.

5. Risk and controls
   - Per-agent max allocation.
   - Per-market max position size.
   - Category exclusions.
   - Manual approval mode.
   - Emergency pause and cancel-all.
   - Always-available withdrawal path.
   - Admin kill switch.
   - Market blacklist and category exclusion controls.

6. Audit and monitoring
   - Durable append-only audit log.
   - Signal, approval, order, fill, cancellation, deposit, and withdrawal events.
   - Admin monitoring and incident response.
   - Error tracking, uptime monitoring, webhook monitoring, and alert routing.
   - Customer support process and data retention policy.

7. Testing and launch operations
   - Paper-to-live parity tests.
   - Test wallets and dry-run order intents.
   - KYC, payments, wallet, CLOB, and webhook integration tests.
   - Reconciliation tests for partial fills, cancellations, market resolution,
     withdrawals, failed deposits, and duplicate webhooks.
   - Rollback plan and incident response drill.

## Environment variables expected by `/api/live`

Copy `.env.example` into your local environment for development, then add the
same variables in Vercel Project Settings -> Environment Variables for
production.

- `KYC_PROVIDER`
- `KYC_API_KEY`
- `KYC_WEBHOOK_SECRET`
- `SANCTIONS_PROVIDER`
- `SANCTIONS_API_KEY`
- `GEOIP_PROVIDER`
- `GEOIP_API_KEY`
- `RESTRICTED_JURISDICTIONS`
- `TERMS_VERSION`
- `PRIVACY_VERSION`
- `RISK_DISCLOSURE_VERSION`
- `MARKET_POLICY_STORE`
- `AUTH_PROVIDER`
- `DATABASE_URL`
- `SESSION_SECRET`
- `ENCRYPTION_KEY`
- `PAYMENTS_PROVIDER`
- `PAYMENTS_API_KEY`
- `PAYMENTS_WEBHOOK_SECRET`
- `WEBHOOK_BASE_URL`
- `WALLET_PROVIDER`
- `WALLET_PROJECT_ID`
- `WALLET_API_KEY`
- `DEPOSIT_WALLET_ADDRESS`
- `POLYMARKET_SIGNATURE_TYPE=3`
- `POLYMARKET_CHAIN_ID=137`
- `SETTLEMENT_ASSET=pUSD`
- `SETTLEMENT_CHAIN=polygon`
- `POLYMARKET_CLOB_API_KEY`
- `POLYMARKET_CLOB_SECRET`
- `POLYMARKET_CLOB_PASSPHRASE`
- `RECONCILIATION_STORE`
- `ACCOUNTING_EXPORT_STORE`
- `RATE_LIMIT_STORE`
- `AUDIT_LOG_STORE`
- `MONITORING_DSN`
- `INCIDENT_WEBHOOK_URL`
- `ADMIN_ALERT_EMAIL`
- `CUSTOMER_SUPPORT_EMAIL`
- `LIVE_TRADING_ENABLED=true` only after final approval and end-to-end testing

Even when all variables are present, live order placement remains intentionally
unimplemented until wallet signing, compliance approval, and safe order routing
are completed.

## Polymarket integration notes

Polymarket's public docs describe trading as non-custodial. Orders are signed
and matched through the CLOB, and new API users generally use the deposit-wallet
flow with signature type `3`.

Useful official docs:

- Trading overview: https://docs.polymarket.com/trading/overview
- Trading quickstart: https://docs.polymarket.com/trading/quickstart
- Deposit wallets: https://docs.polymarket.com/trading/deposit-wallets

## Final setup checklist

1. Choose and contract the KYC / eligibility provider.
2. Choose and contract the sanctions/watchlist and geo-IP/geofencing providers.
3. Choose the deposit and withdrawal provider.
4. Choose the wallet or embedded-wallet provider and create a deposit wallet.
5. Build production accounts: auth, sessions, password reset, sign-out, account
   database, consent records, and portfolio history storage.
6. Derive or create Polymarket CLOB credentials for the approved signing flow.
7. Build the live order router with signing, submission, cancellation, fill
   tracking, idempotency, rate limits, and stale-order protection.
8. Build continuous reconciliation for cash, open orders, fills, positions,
   withdrawals, fees, and resolved markets.
9. Enforce every user permission and risk limit on the server, not only in the
   browser.
10. Create durable append-only audit storage, statements, exports, monitoring,
    alerting, and support procedures.
11. Complete legal review, terms, privacy policy, risk disclosures, restricted
    jurisdiction rules, market category policy, and incident response plan.
12. Add all environment variables in Vercel.
13. Run dry-runs and test-wallet trades; verify webhooks, audit events,
    reconciliation, and user withdrawal paths.
14. Only then set `LIVE_TRADING_ENABLED=true`.

## What still cannot be completed from code alone

- Legal approval and jurisdiction-specific advice.
- KYC/KYB, sanctions, payments, wallet, and support vendor contracts.
- Real provider API keys, webhook secrets, CLOB credentials, and deposit wallet
  addresses.
- Bank, stablecoin, or payment settlement relationships.
- Production security review and incident-response ownership.
- Final decision to enable live trading.
