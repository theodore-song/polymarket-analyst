import { recordProviderEvent } from "../_db.js";
import { firstHeader, parseJson, rawBody, safeHeaders, sendMethodNotAllowed, verifyHmacSignature } from "../_webhook.js";

const SIGNATURE_HEADERS = [
  "circle-signature",
  "x-circle-signature",
  "x-signature",
  "webhook-signature",
];

function eventType(payload) {
  return payload.type || payload.eventType || payload.notificationType || "circle.webhook";
}

function externalId(payload) {
  return payload.id || payload.notificationId || payload.data?.id || payload.resource?.id || null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return sendMethodNotAllowed(res);

  try {
    const body = await rawBody(req);
    const payload = parseJson(body);
    const headers = safeHeaders(req, SIGNATURE_HEADERS.concat(["user-agent"]));
    const secret = process.env.CIRCLE_WEBHOOK_SECRET;
    const signature = firstHeader(req, SIGNATURE_HEADERS);
    const signatureValid = verifyHmacSignature(body, secret, signature);

    const recorded = await recordProviderEvent({
      provider: "circle",
      eventType: eventType(payload),
      externalId: externalId(payload),
      signatureValid,
      payload,
      headers,
    });

    return res.status(202).json({
      ok: true,
      recorded: Boolean(recorded),
      provider: "circle",
      event_type: eventType(payload),
      signature_valid: signatureValid,
      warning: signatureValid ? undefined : "Event recorded, but no recognized Circle signature was verified.",
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "Circle webhook failed" });
  }
}
