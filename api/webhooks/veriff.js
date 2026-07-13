import { recordProviderEvent } from "../_db.js";
import { firstHeader, parseJson, rawBody, safeHeaders, sendMethodNotAllowed, verifyHmacSignature } from "../_webhook.js";

const SIGNATURE_HEADERS = [
  "x-hmac-signature",
  "x-veriff-signature",
  "veriff-signature",
  "x-signature",
];

function eventType(payload) {
  return payload.action || payload.eventType || payload.type || payload.status || "veriff.webhook";
}

function externalId(payload) {
  return payload.id || payload.sessionId || payload.verification?.id || payload.verification?.vendorData || payload.vendorData || null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return sendMethodNotAllowed(res);

  try {
    const body = await rawBody(req);
    const payload = parseJson(body);
    const headers = safeHeaders(req, SIGNATURE_HEADERS.concat(["user-agent"]));
    const secret = process.env.VERIFF_WEBHOOK_SECRET || process.env.VERIFF_SECRET_KEY;
    const signature = firstHeader(req, SIGNATURE_HEADERS);
    const signatureValid = verifyHmacSignature(body, secret, signature);

    const recorded = await recordProviderEvent({
      provider: "veriff",
      eventType: eventType(payload),
      externalId: externalId(payload),
      signatureValid,
      payload,
      headers,
    });

    return res.status(202).json({
      ok: true,
      recorded: Boolean(recorded),
      provider: "veriff",
      event_type: eventType(payload),
      signature_valid: signatureValid,
      warning: signatureValid ? undefined : "Event recorded, but no recognized Veriff signature was verified.",
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || "Veriff webhook failed" });
  }
}
