import { hasDatabase, providerEventSummary } from "./_db.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  if (!hasDatabase()) {
    return res.status(503).json({ ok: false, error: "Database is not configured" });
  }

  try {
    const providers = await providerEventSummary();
    return res.status(200).json({ ok: true, providers });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "Provider event summary failed" });
  }
}
