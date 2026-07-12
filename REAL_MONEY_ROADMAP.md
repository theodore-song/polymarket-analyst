# Real Money Enablement Roadmap

This app is currently paper trading only. The Live Money tab and `/api/live`
endpoint are readiness scaffolding: they make the required product and backend
interfaces visible without moving funds or placing orders.

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

- `KYC_PROVIDER`
- `PAYMENTS_PROVIDER`
- `WALLET_PROVIDER`
- `POLYMARKET_CLOB_API_KEY`
- `POLYMARKET_CLOB_SECRET`
- `POLYMARKET_CLOB_PASSPHRASE`
- `AUDIT_LOG_STORE`
- `LIVE_TRADING_ENABLED=true`

Even when all variables are present, live order placement remains intentionally
unimplemented until wallet signing, compliance approval, and safe order routing
are completed.
