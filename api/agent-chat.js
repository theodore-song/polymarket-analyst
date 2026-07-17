const MAX_HISTORY = 12;
const MAX_POSITIONS = 10;
const MAX_SUGGESTIONS = 8;

function cleanText(value, max = 1200) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function compactPosition(pos) {
  return {
    question: cleanText(pos.question, 180),
    side: cleanText(pos.side, 8),
    entry_price: safeNumber(pos.entry_price),
    current_price: safeNumber(pos.current_price),
    value: safeNumber(pos.value),
    unrealized_pnl: safeNumber(pos.unrealized_pnl),
    conviction: safeNumber(pos.conviction),
    category: cleanText(pos.category, 60),
    opened_at: cleanText(pos.opened_at, 40),
    url: cleanText(pos.url, 240),
  };
}

function compactSuggestion(sug) {
  return {
    question: cleanText(sug.question, 180),
    side: cleanText(sug.side, 8),
    entry_price: safeNumber(sug.entry_price),
    conviction: safeNumber(sug.conviction),
    edge: safeNumber(sug.edge),
    category: cleanText(sug.category, 60),
    rationale: cleanText(sug.rationale, 240),
    url: cleanText(sug.url, 240),
  };
}

function compactHistory(history) {
  return (Array.isArray(history) ? history : []).slice(-MAX_HISTORY).map((m) => ({
    role: m && m.role === "user" ? "user" : "assistant",
    text: cleanText(m && m.text, 900),
  })).filter((m) => m.text);
}

function outputText(data) {
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

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(501).json({
      ok: false,
      code: "missing_openai_key",
      error: "Agent AI chat needs OPENAI_API_KEY in Vercel environment variables.",
    });
  }

  const body = req.body || {};
  const question = cleanText(body.question, 1000);
  if (!question) return res.status(400).json({ ok: false, error: "Question is required." });

  const agent = body.agent || {};
  const portfolio = body.portfolio || {};
  const context = {
    agent: {
      id: cleanText(agent.id, 40),
      name: cleanText(agent.name, 80),
      kind: cleanText(agent.kind, 40),
      style: cleanText(agent.style || agent.blurb, 800),
      voice: cleanText(agent.voice, 200),
    },
    portfolio: {
      equity: safeNumber(portfolio.equity),
      cash: safeNumber(portfolio.cash),
      return_pct: safeNumber(portfolio.return_pct),
      pnl: safeNumber(portfolio.pnl),
      rank: safeNumber(portfolio.rank),
      open_positions: safeNumber(portfolio.open_positions),
      last_decision: cleanText(portfolio.last_decision, 700),
      recent_actions: (Array.isArray(portfolio.recent_actions) ? portfolio.recent_actions : []).slice(-8).map((x) => cleanText(x, 260)),
      positions: (Array.isArray(portfolio.positions) ? portfolio.positions : []).slice(0, MAX_POSITIONS).map(compactPosition),
      snapshots: (Array.isArray(portfolio.snapshots) ? portfolio.snapshots : []).slice(-8).map((s) => ({
        date: cleanText(s.date || s.timestamp, 40),
        equity: safeNumber(s.equity),
        return_pct: safeNumber(s.return_pct),
        open_positions: safeNumber(s.open_positions),
      })),
    },
    leaderboard: (Array.isArray(body.leaderboard) ? body.leaderboard : []).slice(0, 10).map((r) => ({
      name: cleanText(r.name, 80),
      return_pct: safeNumber(r.return_pct),
      equity: safeNumber(r.equity),
      rank: safeNumber(r.rank),
    })),
    suggestions: (Array.isArray(body.suggestions) ? body.suggestions : []).slice(0, MAX_SUGGESTIONS).map(compactSuggestion),
    history: compactHistory(body.history),
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

  const input = [
    {
      role: "user",
      content: [{
        type: "input_text",
        text: `Context JSON:\n${JSON.stringify(context)}\n\nUser message:\n${question}`,
      }],
    },
  ];

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
        input,
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

    const text = outputText(data);
    return res.status(200).json({ ok: true, text: text || "I am here, but I could not form a useful answer from the current context." });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err && err.message ? err.message : "Agent chat failed." });
  }
}
