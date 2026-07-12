# Real Money Enablement Roadmap

This app is currently paper trading only. The Live Money tab and `/api/live`
endpoint are readiness scaffolding: they make the required product and backend
interfaces visible without moving funds or placing orders.

## What is configured now

- `.env.example` lists the environment variables the production app needs.
- `/api/live` reports which live-money providers are configured or missing.
- `/api/live` accepts order intents only as dry-runs and returns an audit event.
- The Live Money tab shows launch checks, wallet/deposit settings, agent risk
  limits, a dry-run order console, and an audit preview.

The app still refuses to place live orders. That is intentional until the legal,
provider, wallet-signing, reconciliation, and monitoring steps below are done.

## Required before live deposits or trading

1. Legal and eligibility
   - Terms, risk disclosures, privacy policy, and jurisdiction policy.
   - KYC / KYB provider.
   - Age, location, sanctions, and restricted-market checks.

2. Account and wallet
   - Real authentication.
   - Non-custodial wallet connection or Polymarket deposit-wallet flow.
   - User-controlled permissions for each agent.

3. Funds
   - Deposit provider.
   - Withdrawal provider.
   - Balance reconciliation, statements, support, and accounting exports.

4. Execution
   - Backend order router.
   - Polymarket CLOB API credentials.
   - EIP-712 order-signing flow.
   - Order placement, cancellation, fill tracking, and position reconciliation.

5. Risk and controls
   - Per-agent max allocation.
   - Per-market max position size.
   - Category exclusions.
   - Manual approval mode.
   - Emergency pause and cancel-all.
   - Always-available withdrawal path.

6. Audit and monitoring
   - Durable append-only audit log.
   - Signal, approval, order, fill, cancellation, deposit, and withdrawal events.
   - Admin monitoring and incident response.

## Environment variables expected by `/api/live`

Copy `.env.example` into your local environment for development, then add the
same variables in Vercel Project Settings -> Environment Variables for
production.

- `KYC_PROVIDER`
- `KYC_API_KEY`
- `KYC_WEBHOOK_SECRET`
- `PAYMENTS_PROVIDER`
- `PAYMENTS_API_KEY`
- `PAYMENTS_WEBHOOK_SECRET`
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
- `AUDIT_LOG_STORE`
- `ADMIN_ALERT_EMAIL`
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
2. Choose the deposit and withdrawal provider.
3. Choose the wallet or embedded-wallet provider and create a deposit wallet.
4. Derive or create Polymarket CLOB credentials for the approved signing flow.
5. Create durable append-only audit storage.
6. Add all environment variables in Vercel.
7. Run dry-runs against `/api/live` and verify audit events.
8. Complete legal review, terms, restricted jurisdiction rules, and support
   procedures.
9. Only then set `LIVE_TRADING_ENABLED=true`.
