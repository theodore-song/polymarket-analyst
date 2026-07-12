const REQUIRED_ENV = [
  ["KYC_PROVIDER", "KYC / eligibility provider"],
  ["KYC_API_KEY", "KYC provider API key"],
  ["KYC_WEBHOOK_SECRET", "KYC webhook secret"],
  ["PAYMENTS_PROVIDER", "Deposit and withdrawal provider"],
  ["PAYMENTS_API_KEY", "Payments provider API key"],
  ["PAYMENTS_WEBHOOK_SECRET", "Payments webhook secret"],
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
  ["AUDIT_LOG_STORE", "Durable audit log store"],
  ["ADMIN_ALERT_EMAIL", "Admin alert destination"],
];

function providerStatus() {
  return REQUIRED_ENV.map(([key, label]) => ({
    key,
    label,
    configured: Boolean(process.env[key]),
    expected: key === "POLYMARKET_SIGNATURE_TYPE" ? "3 for new deposit-wallet API users" : undefined,
  }));
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
