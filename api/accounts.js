import { get, put } from "@vercel/blob";
import crypto from "node:crypto";

const INDEX_PATH = process.env.PMA_ACCOUNTS_INDEX_PATH || "accounts/index.json";
const PBKDF2_ITERATIONS = 210000;

function configured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.VERCEL_OIDC_TOKEN);
}

async function readJson(path, fallback) {
  const blob = await get(path, { access: "private" });
  if (!blob || blob.statusCode !== 200 || !blob.stream) return fallback;
  const text = await new Response(blob.stream).text();
  return text ? JSON.parse(text) : fallback;
}

async function writeJson(path, data) {
  await put(path, JSON.stringify(data), {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 0,
  });
}

function normalizeName(name) {
  return String(name || "").trim().replace(/\s+/g, " ").slice(0, 48);
}

function accountKey(name) {
  return normalizeName(name).toLowerCase();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(String(password), salt, PBKDF2_ITERATIONS, 32, "sha256").toString("hex");
  return { salt, hash };
}

function timingSafeEqualHex(a, b) {
  const ab = Buffer.from(String(a || ""), "hex");
  const bb = Buffer.from(String(b || ""), "hex");
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function tokenSecret() {
  return process.env.ACCOUNT_SESSION_SECRET || process.env.SESSION_SECRET || process.env.BLOB_READ_WRITE_TOKEN || "local-dev-only";
}

function makeSessionToken(accountId) {
  const issued = Date.now();
  const payload = `${accountId}.${issued}`;
  const sig = crypto.createHmac("sha256", tokenSecret()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

function verifySessionToken(accountId, token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts[0] !== accountId) return false;
  const issued = Number(parts[1]);
  if (!Number.isFinite(issued) || Date.now() - issued > 1000 * 60 * 60 * 24 * 30) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = crypto.createHmac("sha256", tokenSecret()).update(payload).digest("hex");
  return timingSafeEqualHex(parts[2], expected);
}

function sanitizeAccount(account) {
  const clean = account && typeof account === "object" ? JSON.parse(JSON.stringify(account)) : {};
  clean.id = String(clean.id || "");
  clean.name = normalizeName(clean.name || "Paper Trader");
  clean.cash = Number.isFinite(Number(clean.cash)) ? Number(clean.cash) : 10000;
  clean.starting_balance = Number.isFinite(Number(clean.starting_balance)) ? Number(clean.starting_balance) : 10000;
  clean.positions = Array.isArray(clean.positions) ? clean.positions.slice(0, 500) : [];
  clean.history = Array.isArray(clean.history) ? clean.history.slice(-1000) : [];
  clean.snapshots = Array.isArray(clean.snapshots) ? clean.snapshots.slice(-2000) : [];
  clean.passwordHash = "cloud";
  clean.cloudBacked = true;
  return clean;
}

function accountPath(accountId) {
  return `accounts/${accountId}.json`;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  try {
    if (!configured()) return res.status(503).json({ ok: false, error: "Account storage is not configured" });

    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const action = String(body.action || "");
    const index = await readJson(INDEX_PATH, { version: 1, accounts: {} });

    if (action === "create") {
      const name = normalizeName(body.name);
      const password = String(body.password || "");
      if (name.length < 2) return res.status(400).json({ ok: false, error: "Account name is too short" });
      if (password.length < 4) return res.status(400).json({ ok: false, error: "Use at least 4 characters for a cloud paper password" });
      const key = accountKey(name);
      if (index.accounts[key]) return res.status(409).json({ ok: false, error: "That paper account name already exists" });
      const id = `acct_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
      const passwordRecord = hashPassword(password);
      const now = new Date().toISOString();
      index.accounts[key] = { id, name, created_at: now, updated_at: now, password: passwordRecord };
      const account = sanitizeAccount(body.account || {});
      account.id = id;
      account.name = name;
      account.history = [{ date: now.slice(0, 10), action: "CREATE", detail: "Created cloud-synced paper account." }].concat(account.history || []).slice(-1000);
      await writeJson(INDEX_PATH, index);
      await writeJson(accountPath(id), { version: 1, updated_at: now, account });
      return res.status(200).json({ ok: true, account, session_token: makeSessionToken(id) });
    }

    if (action === "login") {
      const key = accountKey(body.name);
      const record = index.accounts[key];
      if (!record) return res.status(404).json({ ok: false, error: "Paper account not found" });
      const passwordRecord = record.password || {};
      const attempt = hashPassword(String(body.password || ""), passwordRecord.salt);
      if (!timingSafeEqualHex(attempt.hash, passwordRecord.hash)) return res.status(401).json({ ok: false, error: "Incorrect paper account password" });
      const saved = await readJson(accountPath(record.id), null);
      const account = sanitizeAccount(saved && saved.account ? saved.account : {});
      account.id = record.id;
      account.name = record.name;
      return res.status(200).json({ ok: true, account, session_token: makeSessionToken(record.id) });
    }

    if (action === "save") {
      const accountId = String(body.account_id || "");
      if (!verifySessionToken(accountId, body.session_token)) return res.status(401).json({ ok: false, error: "Cloud paper session expired. Log in again." });
      const account = sanitizeAccount(body.account || {});
      account.id = accountId;
      const now = new Date().toISOString();
      await writeJson(accountPath(accountId), { version: 1, updated_at: now, account });
      return res.status(200).json({ ok: true, updated_at: now });
    }

    return res.status(400).json({ ok: false, error: "Unknown account action" });
  } catch (err) {
    const message = err && err.message ? err.message : "Account request failed";
    return res.status(500).json({ ok: false, error: message });
  }
}
