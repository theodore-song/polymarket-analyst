import crypto from "node:crypto";

export async function rawBody(req) {
  if (typeof req.body === "string") return req.body;
  if (req.body && typeof req.body === "object") return JSON.stringify(req.body);

  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

export function parseJson(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function safeHeaders(req, names) {
  const allowed = new Set(names.map((name) => name.toLowerCase()));
  return Object.fromEntries(
    Object.entries(req.headers || {})
      .filter(([key]) => allowed.has(key.toLowerCase()))
      .map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value.join(",") : String(value)])
  );
}

function timingSafeEqualText(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function signatureCandidates(signature) {
  return String(signature || "")
    .split(/[,\s]+/)
    .map((piece) => piece.trim())
    .filter(Boolean)
    .flatMap((piece) => {
      const idx = piece.indexOf("=");
      return idx === -1 ? [piece] : [piece.slice(idx + 1), piece];
    })
    .map((piece) => piece.replace(/^sha256=/i, "").trim())
    .filter(Boolean);
}

export function verifyHmacSignature(raw, secret, signature) {
  if (!secret || !signature) return false;
  const hex = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const base64 = crypto.createHmac("sha256", secret).update(raw).digest("base64");
  return signatureCandidates(signature).some((candidate) => (
    timingSafeEqualText(candidate, hex) || timingSafeEqualText(candidate, base64)
  ));
}

export function firstHeader(req, names) {
  for (const name of names) {
    const value = req.headers?.[name.toLowerCase()];
    if (value) return Array.isArray(value) ? value.join(",") : String(value);
  }
  return "";
}

export function sendMethodNotAllowed(res) {
  res.setHeader("Allow", "POST");
  return res.status(405).json({ ok: false, error: "Method not allowed" });
}
