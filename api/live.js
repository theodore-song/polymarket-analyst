const REQUIRED_ENV = [
  ["KYC_PROVIDER", "KYC / eligibility provider"],
  ["PAYMENTS_PROVIDER", "Deposit and withdrawal provider"],
  ["WALLET_PROVIDER", "Wallet or deposit-wallet provider"],
  ["POLYMARKET_CLOB_API_KEY", "Polymarket CLOB API key"],
  ["POLYMARKET_CLOB_SECRET", "Polymarket CLOB API secret"],
  ["POLYMARKET_CLOB_PASSPHRASE", "Polymarket CLOB passphrase"],
  ["AUDIT_LOG_STORE", "Durable audit log store"],
];

function providerStatus() {
  return REQUIRED_ENV.map(([key, label]) => ({
    key,
    label,
    configured: Boolean(process.env[key]),
  }));
}

function liveTradingReady() {
  return providerStatus().every((x) => x.configured) && process.env.LIVE_TRADING_ENABLED === "true";
}

function baseStatus() {
  const providers = providerStatus();
  return {
    ok: true,
    live_trading_enabled: liveTradingReady(),
    locked_reason: liveTradingReady()
      ? null
      : "Live trading is locked until KYC, payments, wallet signing, CLOB credentials, audit storage, and LIVE_TRADING_ENABLED=true are configured.",
    providers,
    next_required: providers.filter((x) => !x.configured).map((x) => x.label),
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
