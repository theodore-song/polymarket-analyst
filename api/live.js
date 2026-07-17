import {
  createTradeTicket,
  listPersonalCapital,
  listRealPortfolio,
  listTradeTickets,
  recordAuditEvent,
  recordPersonalCapitalAction,
  recordRealFill,
  updateRealPositionMark,
  updateTradeTicketStatus,
} from "./_db.js";

const REQUIRED_ENV = [
  ["PRODUCTION_APP_URL", "Production app URL"],
  ["AUTH_PROVIDER", "Real account authentication provider"],
  ["DATABASE_URL", "Production account database"],
  ["SESSION_SECRET", "Session signing secret"],
  ["ENCRYPTION_KEY", "Encryption key for sensitive user settings"],
  ["KYC_PROVIDER", "KYC / eligibility provider"],
  ["KYC_API_KEY", "KYC provider API key"],
  ["KYC_WEBHOOK_SECRET", "KYC webhook secret"],
  ["SANCTIONS_PROVIDER", "Sanctions / watchlist screening provider"],
  ["SANCTIONS_API_KEY", "Sanctions provider API key"],
  ["GEOIP_PROVIDER", "Geo-IP / geofencing provider"],
  ["GEOIP_API_KEY", "Geo-IP provider API key"],
  ["RESTRICTED_JURISDICTIONS", "Restricted jurisdiction rules"],
  ["TERMS_VERSION", "Approved terms version"],
  ["PRIVACY_VERSION", "Approved privacy policy version"],
  ["RISK_DISCLOSURE_VERSION", "Approved risk disclosure version"],
  ["MARKET_POLICY_STORE", "Market eligibility and category policy store"],
  ["CONSENT_STORE", "Versioned user consent store"],
  ["PAYMENTS_PROVIDER", "Deposit and withdrawal provider"],
  ["PAYMENTS_API_KEY", "Payments provider API key"],
  ["PAYMENTS_WEBHOOK_SECRET", "Payments webhook secret"],
  ["WEBHOOK_BASE_URL", "Public webhook base URL"],
  ["WALLET_PROVIDER", "Wallet or deposit-wallet provider"],
  ["WALLET_PROJECT_ID", "Wallet provider project ID"],
  ["WALLET_API_KEY", "Wallet provider API key"],
  ["DEPOSIT_WALLET_ADDRESS", "Polymarket deposit-wallet address"],
  ["POLYMARKET_SIGNATURE_TYPE", "Polymarket signature type"],
  ["POLYMARKET_CLOB_API_KEY", "Polymarket CLOB API key"],
  ["POLYMARKET_CLOB_SECRET", "Polymarket CLOB API secret"],
  ["POLYMARKET_CLOB_PASSPHRASE", "Polymarket CLOB passphrase"],
  ["SETTLEMENT_ASSET", "Settlement asset"],
  ["SETTLEMENT_CHAIN", "Settlement chain"],
  ["RECONCILIATION_STORE", "Balance, position, and fill reconciliation store"],
  ["ACCOUNTING_EXPORT_STORE", "Statements, tax, and accounting export store"],
  ["RATE_LIMIT_STORE", "Rate limit and abuse prevention store"],
  ["AUDIT_LOG_STORE", "Durable audit log store"],
  ["MONITORING_DSN", "Error and performance monitoring"],
  ["INCIDENT_WEBHOOK_URL", "Incident alert webhook"],
  ["RISK_ADMIN_TOKEN", "Risk admin incident-control token"],
  ["ADMIN_ALERT_EMAIL", "Admin alert destination"],
  ["CUSTOMER_SUPPORT_EMAIL", "Customer support contact"],
];

const PERSONAL_REQUIRED_ENV = [
  ["DATABASE_URL", "Audit database"],
  ["DEPOSIT_WALLET_ADDRESS", "Personal Polymarket deposit wallet address"],
  ["POLYMARKET_SIGNATURE_TYPE", "Polymarket signature type"],
  ["POLYMARKET_CLOB_API_KEY", "Personal Polymarket CLOB API key"],
  ["POLYMARKET_CLOB_SECRET", "Personal Polymarket CLOB API secret"],
  ["POLYMARKET_CLOB_PASSPHRASE", "Personal Polymarket CLOB passphrase"],
  ["RISK_ADMIN_TOKEN", "Personal admin token"],
];

const ENV_ALIASES = {
  DATABASE_URL: ["NEON_DATABASE_URL"],
  KYC_API_KEY: ["VERIFF_API_KEY"],
  KYC_WEBHOOK_SECRET: ["VERIFF_WEBHOOK_SECRET", "VERIFF_SECRET_KEY"],
  SANCTIONS_API_KEY: ["VERIFF_API_KEY"],
  GEOIP_API_KEY: ["VERIFF_API_KEY"],
  PAYMENTS_API_KEY: ["CIRCLE_API_KEY"],
  PAYMENTS_WEBHOOK_SECRET: ["CIRCLE_WEBHOOK_SECRET"],
  WALLET_PROJECT_ID: ["CIRCLE_WALLET_SET_ID"],
  WALLET_API_KEY: ["CIRCLE_API_KEY"],
  RECONCILIATION_STORE: ["DATABASE_URL", "NEON_DATABASE_URL"],
  ACCOUNTING_EXPORT_STORE: ["DATABASE_URL", "NEON_DATABASE_URL"],
  RATE_LIMIT_STORE: ["DATABASE_URL", "NEON_DATABASE_URL"],
  AUDIT_LOG_STORE: ["DATABASE_URL", "NEON_DATABASE_URL"],
  CONSENT_STORE: ["DATABASE_URL", "NEON_DATABASE_URL"],
  MONITORING_DSN: ["SENTRY_DSN"],
  INCIDENT_WEBHOOK_URL: ["SENTRY_WEBHOOK_URL"],
};

const PROVIDER_STACK = [
  {
    provider: "Clerk",
    role: "User auth, sessions, sign-in/sign-out, account identity",
    env: ["AUTH_PROVIDER", "CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY", "CLERK_WEBHOOK_SIGNING_SECRET"],
    dashboard: "https://dashboard.clerk.com/",
  },
  {
    provider: "Neon",
    role: "Postgres database for users, portfolios, audit metadata, reconciliation, and history",
    env: ["DATABASE_URL"],
    dashboard: "https://console.neon.tech/",
  },
  {
    provider: "Veriff",
    role: "KYC/KYB, identity verification, age checks, AML/sanctions workflow",
    env: ["KYC_PROVIDER", "VERIFF_API_KEY", "VERIFF_SECRET_KEY", "VERIFF_WEBHOOK_SECRET"],
    dashboard: "https://station.veriff.com/",
  },
  {
    provider: "Circle",
    role: "USDC, embedded wallets, payments/deposits/withdrawals, webhooks",
    env: ["PAYMENTS_PROVIDER", "WALLET_PROVIDER", "CIRCLE_API_KEY", "CIRCLE_WEBHOOK_SECRET", "CIRCLE_WALLET_SET_ID"],
    dashboard: "https://console.circle.com/",
  },
  {
    provider: "Sentry",
    role: "Error monitoring, browser/backend issue tracking, incident visibility",
    env: ["MONITORING_DSN", "SENTRY_DSN"],
    dashboard: "https://sentry.io/",
  },
];

const LAUNCH_REQUIREMENTS = [
  ["legal", "Terms, privacy policy, risk disclosures, and jurisdiction policy approved"],
  ["eligibility", "KYC/KYB, age, sanctions, watchlist, and location screening active"],
  ["market_policy", "Allowed market categories, restricted events, and manipulation rules defined"],
  ["auth", "Production accounts, sessions, password reset, MFA path, and sign-out implemented"],
  ["wallets", "User-controlled wallet/deposit-wallet signing and permission revocation implemented"],
  ["payments", "Deposits, withdrawals, webhooks, failed-payment handling, and support flows implemented"],
  ["execution", "Signed order creation, CLOB submission, cancellation, retry, and fill tracking implemented"],
  ["reconciliation", "Cash, open orders, positions, fills, fees, and withdrawals reconciled continuously"],
  ["risk", "Agent allocation caps, market caps, stop rules, manual approval, and emergency pause enforced server-side"],
  ["security", "Secret management, encryption, rate limits, abuse controls, and security review completed"],
  ["records", "Append-only audit logs, customer statements, exports, and retention policy active"],
  ["operations", "Monitoring, incident response, customer support, and rollback plan ready"],
  ["testing", "Paper-to-live parity, dry-runs, test wallets, webhook tests, and edge-case QA completed"],
];

const WEBHOOK_ROUTES = [
  ["clerk", "Clerk user and session events", "/api/webhooks/clerk"],
  ["veriff", "Veriff verification and review events", "/api/webhooks/veriff"],
  ["circle", "Circle payment, wallet, and transfer events", "/api/webhooks/circle"],
];

function envValue(key) {
  if (process.env[key]) return process.env[key];
  return (ENV_ALIASES[key] || []).map((alias) => process.env[alias]).find(Boolean);
}

function providerStatus() {
  return REQUIRED_ENV.map(([key, label]) => ({
    key,
    label,
    configured: Boolean(envValue(key)),
    aliases: ENV_ALIASES[key] || [],
    expected: key === "POLYMARKET_SIGNATURE_TYPE" ? "3 for new deposit-wallet API users" : undefined,
  }));
}

function personalStatus() {
  return PERSONAL_REQUIRED_ENV.map(([key, label]) => ({
    key,
    label,
    configured: Boolean(envValue(key)),
    expected: key === "POLYMARKET_SIGNATURE_TYPE" ? "3 for deposit-wallet users" : undefined,
  }));
}

function stackStatus() {
  return PROVIDER_STACK.map((provider) => {
    const checks = provider.env.map((key) => ({ key, configured: Boolean(envValue(key)) }));
    return {
      ...provider,
      configured: checks.every((x) => x.configured),
      checks,
    };
  });
}

function liveTradingReady() {
  const requiredConfigured = providerStatus().every((x) => x.configured);
  const liveFlagEnabled = process.env.LIVE_TRADING_ENABLED === "true";
  const signatureTypeOk = String(process.env.POLYMARKET_SIGNATURE_TYPE || "") === "3";
  const chainOk = String(process.env.POLYMARKET_CHAIN_ID || "137") === "137";
  return requiredConfigured && liveFlagEnabled && signatureTypeOk && chainOk;
}

function personalTradingReady() {
  return personalStatus().every((x) => x.configured)
    && process.env.PERSONAL_TRADING_ENABLED === "true"
    && String(process.env.POLYMARKET_SIGNATURE_TYPE || "") === "3"
    && String(process.env.POLYMARKET_CHAIN_ID || "137") === "137";
}

function baseStatus() {
  const providers = providerStatus();
  const origin = (envValue("WEBHOOK_BASE_URL") || envValue("PRODUCTION_APP_URL") || "").replace(/\/api\/?$/, "").replace(/\/$/, "");
  const liveFlagEnabled = process.env.LIVE_TRADING_ENABLED === "true";
  const signatureTypeOk = String(process.env.POLYMARKET_SIGNATURE_TYPE || "") === "3";
  const chainOk = String(process.env.POLYMARKET_CHAIN_ID || "137") === "137";
  const missing = providers.filter((x) => !x.configured).map((x) => x.label);
  const personal = personalStatus();
  const personalMissing = personal.filter((x) => !x.configured).map((x) => x.label);
  if (process.env.PERSONAL_TRADING_ENABLED !== "true") personalMissing.push("PERSONAL_TRADING_ENABLED=true after your own wallet/CLOB test");
  if (!liveFlagEnabled) missing.push("LIVE_TRADING_ENABLED=true after final approval");
  if (!signatureTypeOk) missing.push("POLYMARKET_SIGNATURE_TYPE=3 for deposit-wallet users");
  if (!chainOk) missing.push("POLYMARKET_CHAIN_ID=137");
  return {
    ok: true,
    live_trading_enabled: liveTradingReady(),
    personal_trading_enabled: personalTradingReady(),
    live_flag_enabled: liveFlagEnabled,
    personal_flag_enabled: process.env.PERSONAL_TRADING_ENABLED === "true",
    signature_type_ok: signatureTypeOk,
    chain_ok: chainOk,
    locked_reason: liveTradingReady()
      ? null
      : "Live trading is locked until eligibility, payments, wallet/deposit-wallet signing, Polymarket CLOB credentials, audit storage, monitoring, and LIVE_TRADING_ENABLED=true are configured.",
    providers,
    provider_stack: stackStatus(),
    personal_requirements: personal,
    launch_requirements: LAUNCH_REQUIREMENTS.map(([key, label]) => ({ key, label })),
    webhooks: WEBHOOK_ROUTES.map(([provider, label, path]) => ({
      provider,
      label,
      path,
      url: origin ? `${origin}${path}` : path,
    })),
    next_required: missing,
    personal_next_required: personalMissing,
    docs: {
      polymarket_overview: "https://docs.polymarket.com/trading/overview",
      polymarket_quickstart: "https://docs.polymarket.com/trading/quickstart",
      deposit_wallets: "https://docs.polymarket.com/trading/deposit-wallets",
    },
  };
}

function validateIntent(intent) {
  const missing = [];
  ["user_id", "wallet_address", "agent_id", "market_id", "side", "max_amount"].forEach((key) => {
    if (!intent || intent[key] === undefined || intent[key] === null || intent[key] === "") missing.push(key);
  });
  if (intent && !["YES", "NO"].includes(String(intent.side).toUpperCase())) missing.push("side must be YES or NO");
  if (intent && Number(intent.max_amount) <= 0) missing.push("max_amount must be positive");
  return missing;
}

const VALID_TICKET_STATUSES = new Set(["staged", "reviewed", "placed_manually", "skipped", "cancelled"]);
const VALID_FILL_ACTIONS = new Set(["BUY", "SELL"]);
const VALID_CAPITAL_ACTIONS = new Set(["DEPOSIT", "WITHDRAW", "BUY_AGENT", "SELL_AGENT"]);
const AGENT_CHAT_MAX_HISTORY = 12;
const AGENT_CHAT_MAX_POSITIONS = 10;
const AGENT_CHAT_MAX_SUGGESTIONS = 8;

function cleanAgentText(value, max = 1200) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function safeAgentNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function compactAgentPosition(pos) {
  return {
    question: cleanAgentText(pos.question, 180),
    side: cleanAgentText(pos.side, 8),
    entry_price: safeAgentNumber(pos.entry_price),
    current_price: safeAgentNumber(pos.current_price),
    value: safeAgentNumber(pos.value),
    unrealized_pnl: safeAgentNumber(pos.unrealized_pnl),
    conviction: safeAgentNumber(pos.conviction),
    category: cleanAgentText(pos.category, 60),
    opened_at: cleanAgentText(pos.opened_at, 40),
    url: cleanAgentText(pos.url, 240),
  };
}

function compactAgentSuggestion(sug) {
  return {
    question: cleanAgentText(sug.question, 180),
    side: cleanAgentText(sug.side, 8),
    entry_price: safeAgentNumber(sug.entry_price),
    conviction: safeAgentNumber(sug.conviction),
    edge: safeAgentNumber(sug.edge),
    category: cleanAgentText(sug.category, 60),
    rationale: cleanAgentText(sug.rationale, 240),
    url: cleanAgentText(sug.url, 240),
  };
}

function compactAgentHistory(history) {
  return (Array.isArray(history) ? history : []).slice(-AGENT_CHAT_MAX_HISTORY).map((m) => ({
    role: m && m.role === "user" ? "user" : "assistant",
    text: cleanAgentText(m && m.text, 900),
  })).filter((m) => m.text);
}

function openAIOutputText(data) {
  if (data && typeof data.output_text === "string") return data.output_text.trim();
  const chunks = [];
  for (const item of data && Array.isArray(data.output) ? data.output : []) {
    for (const content of Array.isArray(item.content) ? item.content : []) {
      if (content.type === "output_text" && content.text) chunks.push(content.text);
      if (content.type === "text" && content.text) chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

async function handleAgentChat(body, res) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(501).json({
      ok: false,
      code: "missing_openai_key",
      error: "Agent AI chat needs OPENAI_API_KEY in Vercel environment variables.",
    });
  }

  const question = cleanAgentText(body.question, 1000);
  if (!question) return res.status(400).json({ ok: false, error: "Question is required." });

  const agent = body.agent || {};
  const portfolio = body.portfolio || {};
  const context = {
    agent: {
      id: cleanAgentText(agent.id, 40),
      name: cleanAgentText(agent.name, 80),
      kind: cleanAgentText(agent.kind, 40),
      style: cleanAgentText(agent.style || agent.blurb, 800),
      voice: cleanAgentText(agent.voice, 200),
    },
    portfolio: {
      equity: safeAgentNumber(portfolio.equity),
      cash: safeAgentNumber(portfolio.cash),
      return_pct: safeAgentNumber(portfolio.return_pct),
      pnl: safeAgentNumber(portfolio.pnl),
      rank: safeAgentNumber(portfolio.rank),
      open_positions: safeAgentNumber(portfolio.open_positions),
      last_decision: cleanAgentText(portfolio.last_decision, 700),
      recent_actions: (Array.isArray(portfolio.recent_actions) ? portfolio.recent_actions : []).slice(-8).map((x) => cleanAgentText(x, 260)),
      positions: (Array.isArray(portfolio.positions) ? portfolio.positions : []).slice(0, AGENT_CHAT_MAX_POSITIONS).map(compactAgentPosition),
      snapshots: (Array.isArray(portfolio.snapshots) ? portfolio.snapshots : []).slice(-8).map((s) => ({
        date: cleanAgentText(s.date || s.timestamp, 40),
        equity: safeAgentNumber(s.equity),
        return_pct: safeAgentNumber(s.return_pct),
        open_positions: safeAgentNumber(s.open_positions),
      })),
    },
    leaderboard: (Array.isArray(body.leaderboard) ? body.leaderboard : []).slice(0, 10).map((r) => ({
      name: cleanAgentText(r.name, 80),
      return_pct: safeAgentNumber(r.return_pct),
      equity: safeAgentNumber(r.equity),
      rank: safeAgentNumber(r.rank),
    })),
    suggestions: (Array.isArray(body.suggestions) ? body.suggestions : []).slice(0, AGENT_CHAT_MAX_SUGGESTIONS).map(compactAgentSuggestion),
    history: compactAgentHistory(body.history),
  };

  const instructions = [
    `You are ${context.agent.name || "a Polymarket paper-trading agent"} inside Poly Arena.`,
    "Speak in first person as the selected agent, like a real chat partner.",
    "Answer the user's exact question instead of repeating a generic performance summary.",
    "Use the supplied portfolio, positions, leaderboard, suggestions, and chat history as your facts.",
    "Be specific about trades, risk, performance, and uncertainty when the data is available.",
    "Do not claim you can guarantee profits or force agents to make money.",
    "Do not give personalized financial advice. Keep it framed as paper trading, research, or manual review.",
    "If asked what you will do next, describe likely decision rules, not a guaranteed action.",
    "Keep responses concise: 2 to 5 short paragraphs or a tight bullet list.",
  ].join("\n");

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
        instructions,
        input: [{
          role: "user",
          content: [{
            type: "input_text",
            text: `Context JSON:\n${JSON.stringify(context)}\n\nUser message:\n${question}`,
          }],
        }],
        max_output_tokens: 550,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        error: data && data.error && data.error.message ? data.error.message : "OpenAI chat request failed.",
      });
    }

    const text = openAIOutputText(data);
    return res.status(200).json({ ok: true, text: text || "I am here, but I could not form a useful answer from the current context." });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err && err.message ? err.message : "Agent chat failed." });
  }
}

function marketSearchUrl(question) {
  return `https://polymarket.com/search?query=${encodeURIComponent(String(question || ""))}`;
}

function buildTicketInstructions(ticket) {
  const marketUrl = ticket.market_url || ticket.marketUrl || marketSearchUrl(ticket.question || ticket.market_id || ticket.marketId);
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

function validateTicket(ticket) {
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

function normalizeFill(body) {
  return {
    userId: String(body.user_id || "local-readiness-user").trim(),
    ticketId: body.ticket_id || null,
    agentId: String(body.agent_id || "").trim(),
    marketId: String(body.market_id || "").trim(),
    question: String(body.question || "").trim(),
    marketUrl: String(body.market_url || "").trim(),
    side: String(body.side || "").trim().toUpperCase(),
    action: String(body.fill_action || body.trade_action || "BUY").trim().toUpperCase(),
    shares: Number(body.shares || 0),
    price: Number(body.price || 0),
    fees: Number(body.fees || 0),
    txNote: String(body.tx_note || "").trim(),
    filledAt: body.filled_at || null,
  };
}

function validateFill(fill) {
  const errors = [];
  if (!fill.userId) errors.push("user_id");
  if (!fill.marketId) errors.push("market_id");
  if (!["YES", "NO"].includes(fill.side)) errors.push("side must be YES or NO");
  if (!VALID_FILL_ACTIONS.has(fill.action)) errors.push("fill_action must be BUY or SELL");
  if (!Number.isFinite(fill.shares) || fill.shares <= 0) errors.push("shares must be positive");
  if (!Number.isFinite(fill.price) || fill.price <= 0 || fill.price >= 1) errors.push("price must be between 0 and 1");
  if (!Number.isFinite(fill.fees) || fill.fees < 0) errors.push("fees must be 0 or greater");
  return errors;
}

function normalizeCapitalAction(body) {
  return {
    userId: String(body.user_id || "local-readiness-user").trim(),
    action: String(body.capital_action || body.capitalAction || "").trim().toUpperCase(),
    agentId: String(body.agent_id || "").trim(),
    amount: Number(body.amount || 0),
    note: String(body.note || "").trim(),
  };
}

function validateCapitalAction(action) {
  const errors = [];
  if (!action.userId) errors.push("user_id");
  if (!VALID_CAPITAL_ACTIONS.has(action.action)) errors.push("capital_action must be DEPOSIT, WITHDRAW, BUY_AGENT, or SELL_AGENT");
  if ((action.action === "BUY_AGENT" || action.action === "SELL_AGENT") && !action.agentId) errors.push("agent_id");
  if (!Number.isFinite(action.amount) || action.amount <= 0) errors.push("amount must be positive");
  return errors;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    if (req.query?.action === "tickets") {
      const userId = String(req.query?.user_id || "local-readiness-user").trim();
      const tickets = await listTradeTickets(userId, req.query?.limit || 50);
      return res.status(200).json({ ok: true, tickets });
    }
    if (req.query?.action === "real_portfolio") {
      const userId = String(req.query?.user_id || "local-readiness-user").trim();
      const portfolio = await listRealPortfolio(userId);
      return res.status(200).json({ ok: true, ...portfolio });
    }
    if (req.query?.action === "personal_capital") {
      const userId = String(req.query?.user_id || "local-readiness-user").trim();
      const capital = await listPersonalCapital(userId);
      return res.status(200).json({ ok: true, ...capital });
    }
    return res.status(200).json(baseStatus());
  }

  if (req.method === "POST") {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

    if (body.action === "agent_chat") {
      return handleAgentChat(body, res);
    }

    if (body.action === "ticket") {
      const ticket = normalizeTicket(body);
      const ticketErrors = validateTicket(ticket);
      if (ticketErrors.length) return res.status(400).json({ ok: false, error: "Invalid trade ticket", details: ticketErrors });
      const saved = await createTradeTicket({
        ...ticket,
        status: "staged",
        instructions: buildTicketInstructions(ticket),
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

    if (body.action === "ticket_status") {
      const userId = String(body.user_id || "local-readiness-user").trim();
      const status = String(body.status || "").trim();
      if (!VALID_TICKET_STATUSES.has(status)) return res.status(400).json({ ok: false, error: "Invalid ticket status" });
      const ticket = await updateTradeTicketStatus(userId, body.ticket_id, status);
      if (!ticket) return res.status(404).json({ ok: false, error: "Ticket not found" });
      await recordAuditEvent("TRADE_TICKET_STATUS_UPDATED", { user_id: userId, ticket_id: ticket.id, status });
      return res.status(200).json({ ok: true, ticket });
    }

    if (body.action === "record_fill") {
      const fill = normalizeFill(body);
      const fillErrors = validateFill(fill);
      if (fillErrors.length) return res.status(400).json({ ok: false, error: "Invalid manual fill", details: fillErrors });
      const saved = await recordRealFill(fill);
      await recordAuditEvent("REAL_FILL_RECORDED", {
        user_id: fill.userId,
        ticket_id: fill.ticketId,
        market_id: fill.marketId,
        side: fill.side,
        action: fill.action,
        shares: fill.shares,
        price: fill.price,
        private_key_used: false,
        live_order_placed_by_site: false,
      });
      return res.status(201).json({
        ok: true,
        fill: saved,
        private_key_used: false,
        live_order_placed_by_site: false,
        note: "Manual fill recorded for tracking only. Poly Arena did not sign or place this trade.",
      });
    }

    if (body.action === "mark_position") {
      const userId = String(body.user_id || "local-readiness-user").trim();
      const price = Number(body.current_price || 0);
      if (!Number.isFinite(price) || price <= 0 || price >= 1) return res.status(400).json({ ok: false, error: "current_price must be between 0 and 1" });
      const position = await updateRealPositionMark(userId, body.position_id, price);
      if (!position) return res.status(404).json({ ok: false, error: "Position not found" });
      await recordAuditEvent("REAL_POSITION_MARK_UPDATED", { user_id: userId, position_id: position.id, current_price: price });
      return res.status(200).json({ ok: true, position });
    }

    if (body.action === "capital_action") {
      const capitalAction = normalizeCapitalAction(body);
      const capitalErrors = validateCapitalAction(capitalAction);
      if (capitalErrors.length) return res.status(400).json({ ok: false, error: "Invalid personal capital action", details: capitalErrors });
      let capital;
      try {
        capital = await recordPersonalCapitalAction(capitalAction);
      } catch (err) {
        return res.status(400).json({ ok: false, error: err?.message || "Personal capital tracker update failed" });
      }
      await recordAuditEvent("PERSONAL_CAPITAL_ACTION", {
        user_id: capitalAction.userId,
        action: capitalAction.action,
        agent_id: capitalAction.agentId,
        amount: capitalAction.amount,
        custody_by_site: false,
        real_order_placed_by_site: false,
      });
      return res.status(200).json({
        ok: true,
        ...capital,
        custody_by_site: false,
        real_order_placed_by_site: false,
        note: "Personal capital tracker updated for bookkeeping only. Poly Arena did not receive funds or place an order.",
      });
    }

    const intent = body.intent || body;
    const errors = validateIntent(intent);
    if (errors.length) {
      return res.status(400).json({ ok: false, error: "Invalid order intent", details: errors });
    }

    const status = baseStatus();
    const auditEvent = {
      at: new Date().toISOString(),
      type: "ORDER_INTENT_DRY_RUN",
      user_id: String(intent.user_id),
      wallet_address: String(intent.wallet_address),
      agent_id: String(intent.agent_id),
      market_id: String(intent.market_id),
      side: String(intent.side).toUpperCase(),
      max_amount: Number(intent.max_amount),
      execution_mode: intent.execution_mode || "manual_approval",
      account_scope: intent.account_scope || body.account_scope || "public_readiness",
    };

    if (auditEvent.account_scope === "personal") {
      await recordAuditEvent("PERSONAL_ORDER_INTENT_STAGED", auditEvent);
      return res.status(202).json({
        ok: true,
        dry_run: true,
        manual_review_required: true,
        live_order_placed: false,
        message: personalTradingReady()
          ? "Personal prerequisites are configured, but this endpoint still stages manual review only."
          : "Personal order intent staged. Configure your own deposit wallet/CLOB credentials before any manual live execution.",
        audit_event: auditEvent,
        status,
      });
    }

    if (!status.live_trading_enabled) {
      await recordAuditEvent("ORDER_INTENT_BLOCKED", auditEvent);
      return res.status(423).json({
        ok: false,
        dry_run: true,
        error: status.locked_reason,
        audit_event: auditEvent,
        status,
      });
    }

    await recordAuditEvent("ORDER_INTENT_NOT_IMPLEMENTED", auditEvent);
    return res.status(501).json({
      ok: false,
      dry_run: true,
      error: "Live trading credentials are configured, but signed order placement is intentionally not implemented yet.",
      audit_event: auditEvent,
      status,
    });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ ok: false, error: "Method not allowed" });
}
