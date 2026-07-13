function envValue(key, fallback = "") {
  return process.env[key] || fallback;
}

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const MARKET_RULES = [
  "No trading for restricted jurisdictions or users who fail eligibility checks.",
  "No market categories may be enabled until a written market policy is approved.",
  "Agent orders must obey per-user allocation caps, per-market caps, stop rules, and emergency pause.",
  "Users must be able to revoke agent permissions and withdraw available funds.",
  "Every signal, consent, order intent, fill, cancellation, deposit, and withdrawal must be audit logged.",
];

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const versions = {
    terms: envValue("TERMS_VERSION"),
    privacy: envValue("PRIVACY_VERSION"),
    risk_disclosure: envValue("RISK_DISCLOSURE_VERSION"),
  };
  const approved = Boolean(versions.terms && versions.privacy && versions.risk_disclosure && envValue("MARKET_POLICY_STORE"));

  return res.status(200).json({
    ok: true,
    approved,
    status: approved ? "configured" : "draft_not_approved",
    versions,
    restricted_jurisdictions: splitList(envValue("RESTRICTED_JURISDICTIONS")),
    market_policy_store: envValue("MARKET_POLICY_STORE"),
    live_trading_enabled: process.env.LIVE_TRADING_ENABLED === "true",
    rules: MARKET_RULES,
    note: approved
      ? "Policy versions are configured, but live trading still requires all other launch checks."
      : "Draft policy guardrails are available. Legal approval and versioned documents are still required before real money.",
  });
}
