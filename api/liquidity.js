import { auditLiquidity } from "../lib/liquidity-audit.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }
  try {
    const report = await auditLiquidity({
      marketLimit: Number(req.query.limit || 60),
      minHoursToEnd: Number(req.query.min_hours || 48),
    });
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    return res.status(200).json({ ok: true, ...report });
  } catch (error) {
    return res.status(502).json({ ok: false, error: "liquidity_audit_unavailable", detail: String(error && error.message || error) });
  }
}
