import { latestRiskProfile, recordAuditEvent, upsertRiskProfile } from "./_db.js";

function validateProfile(profile) {
  const errors = [];
  if (!profile.userId) errors.push("user_id");
  if (Number(profile.depositLimit) < 0) errors.push("deposit_limit must be 0 or greater");
  if (Number(profile.withdrawReserve) < 0) errors.push("withdraw_reserve must be 0 or greater");

  Object.entries(profile.agentPermissions || {}).forEach(([agentId, permission]) => {
    if (Number(permission.maxAllocation || 0) < 0) errors.push(`${agentId} maxAllocation must be 0 or greater`);
    const maxPositionPct = Number(permission.maxPositionPct || 0);
    if (maxPositionPct < 0 || maxPositionPct > 100) errors.push(`${agentId} maxPositionPct must be between 0 and 100`);
    if (permission.autoTrade) errors.push(`${agentId} cannot enable unattended real-money trading in personal mode`);
  });

  return errors;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  try {
    if (req.method === "GET") {
      const userId = String(req.query?.user_id || "").trim();
      if (!userId) return res.status(400).json({ ok: false, error: "user_id is required" });
      const profile = await latestRiskProfile(userId);
      return res.status(200).json({ ok: true, profile });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const profile = {
        userId: String(body.user_id || "").trim(),
        walletAddress: String(body.wallet_address || "").trim(),
        jurisdiction: String(body.jurisdiction || "").trim(),
        depositLimit: Number(body.deposit_limit || 0),
        withdrawReserve: Number(body.withdraw_reserve || 0),
        agentPermissions: body.agent_permissions && typeof body.agent_permissions === "object" ? body.agent_permissions : {},
      };
      const errors = validateProfile(profile);
      if (errors.length) return res.status(400).json({ ok: false, error: "Invalid risk profile", details: errors });

      const saved = await upsertRiskProfile(profile);
      await recordAuditEvent("RISK_PROFILE_UPDATED", {
        user_id: profile.userId,
        jurisdiction: profile.jurisdiction,
        agent_count: Object.keys(profile.agentPermissions).length,
      });

      return res.status(200).json({ ok: true, saved, live_trading_enabled: false });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "Risk profile request failed" });
  }
}
