import { Webhook } from "svix";
import { recordProviderEvent } from "../_db.js";
import { rawBody, parseJson, safeHeaders, sendMethodNotAllowed } from "../_webhook.js";

function eventType(payload) {
  return payload.type || "clerk.webhook";
}

function externalId(payload) {
  return payload.id || payload.data?.id || payload.data?.user_id || null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return sendMethodNotAllowed(res);

  try {
    const secret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
    if (!secret) return res.status(503).json({ ok: false, error: "Clerk webhook secret is not configured" });

    const body = await rawBody(req);
    const headers = safeHeaders(req, ["svix-id", "svix-timestamp", "svix-signature"]);
    let payload;

    try {
      payload = new Webhook(secret).verify(body, headers);
    } catch {
      return res.status(401).json({ ok: false, error: "Invalid Clerk webhook signature" });
    }

    const recorded = await recordProviderEvent({
      provider: "clerk",
      eventType: eventType(payload),
      externalId: externalId(payload),
      signatureValid: true,
      payload,
      headers,
    });

    return res.status(200).json({
      ok: true,
      recorded: Boolean(recorded),
      provider: "clerk",
      event_type: eventType(payload),
      signature_valid: true,
    });
  } catch (err) {
    const payload = parseJson(req.body);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Clerk webhook failed",
      provider: "clerk",
      event_type: eventType(payload),
    });
  }
}
