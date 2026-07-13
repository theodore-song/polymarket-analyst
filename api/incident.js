import { recordAuditEvent } from "./_db.js";

async function notifyIncidentWebhook(payload) {
  const url = process.env.INCIDENT_WEBHOOK_URL || process.env.SENTRY_WEBHOOK_URL;
  if (!url) return { sent: false, reason: "No incident webhook is configured" };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  return { sent: response.ok, status: response.status };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const adminToken = process.env.RISK_ADMIN_TOKEN || "";
    if (adminToken && req.headers["x-admin-token"] !== adminToken) {
      return res.status(401).json({ ok: false, error: "Invalid admin token" });
    }
    if (!adminToken) {
      return res.status(503).json({ ok: false, error: "Incident endpoint is locked until RISK_ADMIN_TOKEN is configured" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const payload = {
      at: new Date().toISOString(),
      severity: String(body.severity || "warning"),
      title: String(body.title || "Polymarket Arena incident"),
      detail: String(body.detail || ""),
      live_trading_enabled: process.env.LIVE_TRADING_ENABLED === "true",
    };

    await recordAuditEvent("INCIDENT_REPORTED", payload);
    const notification = await notifyIncidentWebhook(payload);
    return res.status(200).json({ ok: true, notification, payload });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "Incident report failed" });
  }
}
