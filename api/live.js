const REQUIRED_ENV = [
  ["PRODUCTION_APP_URL", "Production app URL"],
  ["AUTH_PROVIDER", "Real account authentication provider"],
  ["DATABASE_URL", "Production account database"],
  ["SESSION_SECRET", "Session signing secret"],
  ["ENCRYPTION_KEY", "Encryption key for sensitive user settings"],
  ["KYC_PROVIDER", "KYC / eligibility provider"],
  ["KYC_API_KEY", "KYC provider API key"],
  ["KYC_WEBHOOK_SECRET", "KYC webhook secret"],
  ["SANCTIONS_PROVIDER", "Sanctions / watchlist screening provider"],
  ["SANCTIONS_API_KEY", "Sanctions provider API key"],
  ["GEOIP_PROVIDER", "Geo-IP / geofencing provider"],
  ["GEOIP_API_KEY", "Geo-IP provider API key"],
  ["RESTRICTED_JURISDICTIONS", "Restricted jurisdiction rules"],
  ["TERMS_VERSION", "Approved terms version"],
  ["PRIVACY_VERSION", "Approved privacy policy version"],
  ["RISK_DISCLOSURE_VERSION", "Approved risk disclosure version"],
  ["MARKET_POLICY_STORE", "Market eligibility and category policy store"],
  ["PAYMENTS_PROVIDER", "Deposit and withdrawal provider"],
  ["PAYMENTS_API_KEY", "Payments provider API key"],
  ["PAYMENTS_WEBHOOK_SECRET", "Payments webhook secret"],
  ["WEBHOOK_BASE_URL", "Public webhook base URL"],
  ["WALLET_PROVIDER", "Wallet or deposit-wallet provider"],
  ["WALLET_PROJECT_ID", "Wallet provider project ID"],
  ["WALLET_API_KEY", "Wallet provider API key"],
  ["DEPOSIT_WALLET_ADDRESS", "Polymarket deposit-wallet address"],
  ["POLYMARKET_SIGNATURE_TYPE", "Polymarket signature type"],
  ["POLYMARKET_CLOB_API_KEY", "Polymarket CLOB API key"],
  ["POLYMARKET_CLOB_SECRET", "Polymarket CLOB API secret"],
  ["POLYMARKET_CLOB_PASSPHRASE", "Polymarket CLOB passphrase"],
  ["SETTLEMENT_ASSET", "Settlement asset"],
  ["SETTLEMENT_CHAIN", "Settlement chain"],
  ["RECONCILIATION_STORE", "Balance, position, and fill reconciliation store"],
  ["ACCOUNTING_EXPORT_STORE", "Statements, tax, and accounting export store"],
  ["RATE_LIMIT_STORE", "Rate limit and abuse prevention store"],
  ["AUDIT_LOG_STORE", "Durable audit log store"],
  ["MONITORING_DSN", "Error and performance monitoring"],
  ["INCIDENT_WEBHOOK_URL", "Incident alert webhook"],
  ["ADMIN_ALERT_EMAIL", "Admin alert destination"],
  ["CUSTOMER_SUPPORT_EMAIL", "Customer support contact"],
];

const ENV_ALIASES = {
  DATABASE_URL: ["NEON_DATABASE_URL"],
  KYC_API_KEY: ["VERIFF_API_KEY"],
  KYC_WEBHOOK_SECRET: ["VERIFF_WEBHOOK_SECRET", "VERIFF_SECRET_KEY"],
  SANCTIONS_API_KEY: ["VERIFF_API_KEY"],
  GEOIP_API_KEY: ["VERIFF_API_KEY"],
  PAYMENTS_API_KEY: ["CIRCLE_API_KEY"],
  PAYMENTS_WEBHOOK_SECRET: ["CIRCLE_WEBHOOK_SECRET"],
  WALLET_PROJECT_ID: ["CIRCLE_WALLET_SET_ID"],
  WALLET_API_KEY: ["CIRCLE_API_KEY"],
  RECONCILIATION_STORE: ["DATABASE_URL", "NEON_DATABASE_URL"],
  ACCOUNTING_EXPORT_STORE: ["DATABASE_URL", "NEON_DATABASE_URL"],
  RATE_LIMIT_STORE: ["DATABASE_URL", "NEON_DATABASE_URL"],
  AUDIT_LOG_STORE: ["DATABASE_URL", "NEON_DATABASE_URL"],
  MONITORING_DSN: ["SENTRY_DSN"],
  INCIDENT_WEBHOOK_URL: ["SENTRY_WEBHOOK_URL"],
};

const PROVIDER_STACK = [
  {
    provider: "Clerk",
    role: "User auth, sessions, sign-in/sign-out, account identity",
    env: ["AUTH_PROVIDER", "CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY", "CLERK_WEBHOOK_SIGNING_SECRET"],
    dashboard: "https://dashboard.clerk.com/",
  },
  {
    provider: "Neon",
    role: "Postgres database for users, portfolios, audit metadata, reconciliation, and history",
    env: ["DATABASE_URL"],
    dashboard: "https://console.neon.tech/",
  },
  {
    provider: "Veriff",
    role: "KYC/KYB, identity verification, age checks, AML/sanctions workflow",
    env: ["KYC_PROVIDER", "VERIFF_API_KEY", "VERIFF_SECRET_KEY", "VERIFF_WEBHOOK_SECRET"],
    dashboard: "https://station.veriff.com/",
  },
  {
    provider: "Circle",
    role: "USDC, embedded wallets, payments/deposits/withdrawals, webhooks",
    env: ["PAYMENTS_PROVIDER", "WALLET_PROVIDER", "CIRCLE_API_KEY", "CIRCLE_WEBHOOK_SECRET", "CIRCLE_WALLET_SET_ID"],
    dashboard: "https://console.circle.com/",
  },
  {
    provider: "Sentry",
    role: "Error monitoring, browser/backend issue tracking, incident visibility",
    env: ["MONITORING_DSN", "SENTRY_DSN"],
    dashboard: "https://sentry.io/",
  },
];

const LAUNCH_REQUIREMENTS = [
  ["legal", "Terms, privacy policy, risk disclosures, and jurisdiction policy approved"],
  ["eligibility", "KYC/KYB, age, sanctions, watchlist, and location screening active"],
  ["market_policy", "Allowed market categories, restricted events, and manipulation rules defined"],
  ["auth", "Production accounts, sessions, password reset, MFA path, and sign-out implemented"],
  ["wallets", "User-controlled wallet/deposit-wallet signing and permission revocation implemented"],
  ["payments", "Deposits, withdrawals, webhooks, failed-payment handling, and support flows implemented"],
  ["execution", "Signed order creation, CLOB submission, cancellation, retry, and fill tracking implemented"],
  ["reconciliation", "Cash, open orders, positions, fills, fees, and withdrawals reconciled continuously"],
  ["risk", "Agent allocation caps, market caps, stop rules, manual approval, and emergency pause enforced server-side"],
  ["security", "Secret management, encryption, rate limits, abuse controls, and security review completed"],
  ["records", "Append-only audit logs, customer statements, exports, and retention policy active"],
  ["operations", "Monitoring, incident response, customer support, and rollback plan ready"],
  ["testing", "Paper-to-live parity, dry-runs, test wallets, webhook tests, and edge-case QA completed"],
];

function envValue(key) {
  if (process.env[key]) return process.env[key];
  return (ENV_ALIASES[key] || []).map((alias) => process.env[alias]).find(Boolean);
}

function providerStatus() {
  return REQUIRED_ENV.map(([key, label]) => ({
    key,
    label,
    configured: Boolean(envValue(key)),
    aliases: ENV_ALIASES[key] || [],
    expected: key === "POLYMARKET_SIGNATURE_TYPE" ? "3 for new deposit-wallet API users" : undefined,
  }));
}

function stackStatus() {
  return PROVIDER_STACK.map((provider) => {
    const checks = provider.env.map((key) => ({ key, configured: Boolean(envValue(key)) }));
    return {
      ...provider,
      configured: checks.every((x) => x.configured),
      checks,
    };
  });
}

function liveTradingReady() {
  const requiredConfigured = providerStatus().every((x) => x.configured);
  const liveFlagEnabled = process.env.LIVE_TRADING_ENABLED === "true";
  const signatureTypeOk = String(process.env.POLYMARKET_SIGNATURE_TYPE || "") === "3";
  const chainOk = String(process.env.POLYMARKET_CHAIN_ID || "137") === "137";
  return requiredConfigured && liveFlagEnabled && signatureTypeOk && chainOk;
}

function baseStatus() {
  const providers = providerStatus();
  const liveFlagEnabled = process.env.LIVE_TRADING_ENABLED === "true";
  const signatureTypeOk = String(process.env.POLYMARKET_SIGNATURE_TYPE || "") === "3";
  const chainOk = String(process.env.POLYMARKET_CHAIN_ID || "137") === "137";
  const missing = providers.filter((x) => !x.configured).map((x) => x.label);
  if (!liveFlagEnabled) missing.push("LIVE_TRADING_ENABLED=true after final approval");
  if (!signatureTypeOk) missing.push("POLYMARKET_SIGNATURE_TYPE=3 for deposit-wallet users");
  if (!chainOk) missing.push("POLYMARKET_CHAIN_ID=137");
  return {
    ok: true,
    live_trading_enabled: liveTradingReady(),
    live_flag_enabled: liveFlagEnabled,
    signature_type_ok: signatureTypeOk,
    chain_ok: chainOk,
    locked_reason: liveTradingReady()
      ? null
      : "Live trading is locked until eligibility, payments, wallet/deposit-wallet signing, Polymarket CLOB credentials, audit storage, monitoring, and LIVE_TRADING_ENABLED=true are configured.",
    providers,
    provider_stack: stackStatus(),
    launch_requirements: LAUNCH_REQUIREMENTS.map(([key, label]) => ({ key, label })),
    next_required: missing,
    docs: {
      polymarket_overview: "https://docs.polymarket.com/trading/overview",
      polymarket_quickstart: "https://docs.polymarket.com/trading/quickstart",
      deposit_wallets: "https://docs.polymarket.com/trading/deposit-wallets",
    },
  };
}

function validateIntent(intent) {
  const missing = [];
  ["user_id", "wallet_address", "agent_id", "market_id", "side", "max_amount"].forEach((key) => {
    if (!intent || intent[key] === undefined || intent[key] === null || intent[key] === "") missing.push(key);
  });
  if (intent && !["YES", "NO"].includes(String(intent.side).toUpperCase())) missing.push("side must be YES or NO");
  if (intent && Number(intent.max_amount) <= 0) missing.push("max_amount must be positive");
  return missing;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    return res.status(200).json(baseStatus());
  }

  if (req.method === "POST") {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const intent = body.intent || body;
    const errors = validateIntent(intent);
    if (errors.length) {
      return res.status(400).json({ ok: false, error: "Invalid order intent", details: errors });
    }

    const status = baseStatus();
    const auditEvent = {
      at: new Date().toISOString(),
      type: "ORDER_INTENT_DRY_RUN",
      user_id: String(intent.user_id),
      wallet_address: String(intent.wallet_address),
      agent_id: String(intent.agent_id),
      market_id: String(intent.market_id),
      side: String(intent.side).toUpperCase(),
      max_amount: Number(intent.max_amount),
      execution_mode: intent.execution_mode || "manual_approval",
    };

    if (!status.live_trading_enabled) {
      return res.status(423).json({
        ok: false,
        dry_run: true,
        error: status.locked_reason,
        audit_event: auditEvent,
        status,
      });
    }

    return res.status(501).json({
      ok: false,
      dry_run: true,
      error: "Live trading credentials are configured, but signed order placement is intentionally not implemented yet.",
      audit_event: auditEvent,
      status,
    });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ ok: false, error: "Method not allowed" });
}
