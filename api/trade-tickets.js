import { createTradeTicket, listTradeTickets, recordAuditEvent, updateTradeTicketStatus } from "./_db.js";

const VALID_STATUSES = new Set(["staged", "reviewed", "placed_manually", "skipped", "cancelled"]);

function marketSearchUrl(question) {
  return `https://polymarket.com/search?query=${encodeURIComponent(String(question || ""))}`;
}

function buildInstructions(ticket) {
  const marketUrl = ticket.marketUrl || marketSearchUrl(ticket.question || ticket.marketId);
  return {
    warning: "Manual review only. The AI/site does not hold a private key and does not submit orders.",
    steps: [
      "Open the Polymarket market link.",
      "Confirm the exact market, side, current price, liquidity, and resolution terms.",
      "Keep the order at or below the staged limit price and max amount.",
      "Sign or place the order only from your own wallet/account.",
      "Return here and mark the ticket as placed manually or skipped.",
    ],
    market_url: marketUrl,
  };
}

function normalizeTicket(body) {
  return {
    userId: String(body.user_id || "local-readiness-user").trim(),
    agentId: String(body.agent_id || "").trim(),
    marketId: String(body.market_id || "").trim(),
    question: String(body.question || "").trim(),
    marketUrl: String(body.market_url || "").trim(),
    side: String(body.side || "").trim().toUpperCase(),
    maxAmount: Number(body.max_amount || 0),
    limitPrice: body.limit_price === undefined || body.limit_price === "" ? null : Number(body.limit_price),
    rationale: String(body.rationale || "").trim(),
  };
}

function validate(ticket) {
  const errors = [];
  if (!ticket.userId) errors.push("user_id");
  if (!ticket.agentId) errors.push("agent_id");
  if (!ticket.marketId) errors.push("market_id");
  if (!["YES", "NO"].includes(ticket.side)) errors.push("side must be YES or NO");
  if (!Number.isFinite(ticket.maxAmount) || ticket.maxAmount <= 0) errors.push("max_amount must be positive");
  if (ticket.limitPrice != null && (!Number.isFinite(ticket.limitPrice) || ticket.limitPrice <= 0 || ticket.limitPrice >= 1)) {
    errors.push("limit_price must be between 0 and 1");
  }
  return errors;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  try {
    if (req.method === "GET") {
      const userId = String(req.query?.user_id || "local-readiness-user").trim();
      const tickets = await listTradeTickets(userId, req.query?.limit || 50);
      return res.status(200).json({ ok: true, tickets });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      if (body.action === "status") {
        const userId = String(body.user_id || "local-readiness-user").trim();
        const status = String(body.status || "").trim();
        if (!VALID_STATUSES.has(status)) return res.status(400).json({ ok: false, error: "Invalid ticket status" });
        const ticket = await updateTradeTicketStatus(userId, body.ticket_id, status);
        if (!ticket) return res.status(404).json({ ok: false, error: "Ticket not found" });
        await recordAuditEvent("TRADE_TICKET_STATUS_UPDATED", { user_id: userId, ticket_id: ticket.id, status });
        return res.status(200).json({ ok: true, ticket });
      }

      const ticket = normalizeTicket(body);
      const errors = validate(ticket);
      if (errors.length) return res.status(400).json({ ok: false, error: "Invalid trade ticket", details: errors });

      const saved = await createTradeTicket({
        ...ticket,
        status: "staged",
        instructions: buildInstructions(ticket),
      });
      await recordAuditEvent("TRADE_TICKET_STAGED", {
        user_id: ticket.userId,
        ticket_id: saved?.id,
        agent_id: ticket.agentId,
        market_id: ticket.marketId,
        side: ticket.side,
        max_amount: ticket.maxAmount,
      });

      return res.status(201).json({
        ok: true,
        ticket: saved,
        private_key_used: false,
        live_order_placed: false,
        manual_review_required: true,
      });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "Trade ticket request failed" });
  }
}
