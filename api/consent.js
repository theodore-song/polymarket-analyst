import { recordAuditEvent, recordUserConsent } from "./_db.js";

function activeVersions() {
  return {
    termsVersion: process.env.TERMS_VERSION || "",
    privacyVersion: process.env.PRIVACY_VERSION || "",
    riskDisclosureVersion: process.env.RISK_DISCLOSURE_VERSION || "",
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const userId = String(body.user_id || "").trim();
    const jurisdiction = String(body.jurisdiction || "").trim();
    const accepted = Boolean(body.accept_terms && body.accept_privacy && body.accept_risk);
    const versions = activeVersions();
    const missing = [];

    if (!userId) missing.push("user_id");
    if (!accepted) missing.push("accept_terms, accept_privacy, and accept_risk");
    if (!versions.termsVersion) missing.push("TERMS_VERSION");
    if (!versions.privacyVersion) missing.push("PRIVACY_VERSION");
    if (!versions.riskDisclosureVersion) missing.push("RISK_DISCLOSURE_VERSION");

    if (missing.length) {
      return res.status(400).json({ ok: false, error: "Consent is not ready to record", missing });
    }

    const recorded = await recordUserConsent({
      userId,
      jurisdiction,
      ...versions,
      payload: {
        source: "live_money_readiness",
        user_agent: req.headers["user-agent"] || "",
      },
    });
    await recordAuditEvent("USER_CONSENT_RECORDED", { user_id: userId, jurisdiction, ...versions });

    return res.status(200).json({ ok: true, recorded });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "Consent recording failed" });
  }
}
