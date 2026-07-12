# Real Money Enablement Roadmap

This app is currently paper trading only. The Live Money tab and `/api/live`
endpoint are readiness scaffolding: they make the required product and backend
interfaces visible without moving funds or placing orders.

## What is configured now

- `.env.example` lists the environment variables the production app needs.
- `/api/live` reports which live-money providers are configured or missing.
- `/api/live` accepts order intents only as dry-runs and returns an audit event.
- `/api/accounts` creates, logs into, and saves password-backed paper accounts
  through Vercel Blob storage.
- The Live Money tab shows launch checks, wallet/deposit settings, agent risk
  limits, a dry-run order console, and an audit preview.

The app still refuses to place live orders. That is intentional until the legal,
provider, wallet-signing, reconciliation, and monitoring steps below are done.

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
