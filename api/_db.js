import { neon } from "@neondatabase/serverless";

let sqlClient;
let schemaReady;

export function databaseUrl() {
  return process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || "";
}

export function hasDatabase() {
  return Boolean(databaseUrl());
}

export function sql() {
  if (!sqlClient) {
    const url = databaseUrl();
    if (!url) throw new Error("Database is not configured");
    sqlClient = neon(url);
  }
  return sqlClient;
}

export async function ensureSchema() {
  if (schemaReady) return;
  const db = sql();

  await db`
    create table if not exists provider_events (
      id bigserial primary key,
      provider text not null,
      event_type text not null,
      external_id text,
      signature_valid boolean not null default false,
      payload jsonb not null,
      headers jsonb not null default '{}'::jsonb,
      received_at timestamptz not null default now()
    )
  `;

  await db`
    create unique index if not exists provider_events_provider_external_id_idx
      on provider_events (provider, external_id)
      where external_id is not null
  `;

  await db`
    create table if not exists readiness_audit (
      id bigserial primary key,
      event_type text not null,
      detail jsonb not null,
      created_at timestamptz not null default now()
    )
  `;

  await db`
    create table if not exists user_consents (
      id bigserial primary key,
      user_id text not null,
      terms_version text not null,
      privacy_version text not null,
      risk_disclosure_version text not null,
      jurisdiction text,
      payload jsonb not null default '{}'::jsonb,
      accepted_at timestamptz not null default now()
    )
  `;

  await db`
    create table if not exists risk_profiles (
      user_id text primary key,
      wallet_address text,
      jurisdiction text,
      deposit_limit numeric not null default 0,
      withdraw_reserve numeric not null default 0,
      agent_permissions jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    )
  `;

  await db`
    create table if not exists trade_tickets (
      id bigserial primary key,
      user_id text not null,
      agent_id text not null,
      market_id text not null,
      question text,
      market_url text,
      side text not null,
      max_amount numeric not null,
      limit_price numeric,
      rationale text,
      status text not null default 'staged',
      instructions jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `;

  await db`
    create index if not exists trade_tickets_user_status_idx
      on trade_tickets (user_id, status, created_at desc)
  `;

  await db`
    create table if not exists real_fills (
      id bigserial primary key,
      user_id text not null,
      ticket_id bigint,
      agent_id text,
      market_id text not null,
      question text,
      market_url text,
      side text not null,
      action text not null,
      shares numeric not null,
      price numeric not null,
      fees numeric not null default 0,
      tx_note text,
      filled_at timestamptz not null default now(),
      created_at timestamptz not null default now()
    )
  `;

  await db`
    create index if not exists real_fills_user_market_idx
      on real_fills (user_id, market_id, side, filled_at desc)
  `;

  await db`
    create table if not exists real_positions (
      id bigserial primary key,
      user_id text not null,
      agent_id text,
      market_id text not null,
      question text,
      market_url text,
      side text not null,
      shares numeric not null default 0,
      avg_price numeric not null default 0,
      cost_basis numeric not null default 0,
      realized_pnl numeric not null default 0,
      current_price numeric,
      updated_at timestamptz not null default now(),
      unique (user_id, market_id, side)
    )
  `;

  schemaReady = true;
}

export async function recordProviderEvent(event) {
  await ensureSchema();
  const db = sql();
  const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
  const headers = event.headers && typeof event.headers === "object" ? event.headers : {};

  const rows = await db`
    insert into provider_events (
      provider,
      event_type,
      external_id,
      signature_valid,
      payload,
      headers
    ) values (
      ${event.provider},
      ${event.eventType || "unknown"},
      ${event.externalId || null},
      ${Boolean(event.signatureValid)},
      ${JSON.stringify(payload)}::jsonb,
      ${JSON.stringify(headers)}::jsonb
    )
    on conflict do nothing
    returning id, received_at
  `;

  return rows[0] || null;
}

export async function recordAuditEvent(eventType, detail) {
  await ensureSchema();
  const db = sql();
  await db`
    insert into readiness_audit (event_type, detail)
    values (${eventType}, ${JSON.stringify(detail || {})}::jsonb)
  `;
}

export async function recordUserConsent(consent) {
  await ensureSchema();
  const db = sql();
  const rows = await db`
    insert into user_consents (
      user_id,
      terms_version,
      privacy_version,
      risk_disclosure_version,
      jurisdiction,
      payload
    ) values (
      ${consent.userId},
      ${consent.termsVersion},
      ${consent.privacyVersion},
      ${consent.riskDisclosureVersion},
      ${consent.jurisdiction || null},
      ${JSON.stringify(consent.payload || {})}::jsonb
    )
    returning id, accepted_at
  `;
  return rows[0] || null;
}

export async function upsertRiskProfile(profile) {
  await ensureSchema();
  const db = sql();
  const rows = await db`
    insert into risk_profiles (
      user_id,
      wallet_address,
      jurisdiction,
      deposit_limit,
      withdraw_reserve,
      agent_permissions,
      updated_at
    ) values (
      ${profile.userId},
      ${profile.walletAddress || null},
      ${profile.jurisdiction || null},
      ${Number(profile.depositLimit || 0)},
      ${Number(profile.withdrawReserve || 0)},
      ${JSON.stringify(profile.agentPermissions || {})}::jsonb,
      now()
    )
    on conflict (user_id) do update set
      wallet_address = excluded.wallet_address,
      jurisdiction = excluded.jurisdiction,
      deposit_limit = excluded.deposit_limit,
      withdraw_reserve = excluded.withdraw_reserve,
      agent_permissions = excluded.agent_permissions,
      updated_at = now()
    returning user_id, updated_at
  `;
  return rows[0] || null;
}

export async function latestRiskProfile(userId) {
  await ensureSchema();
  const db = sql();
  const rows = await db`
    select
      user_id,
      wallet_address,
      jurisdiction,
      deposit_limit,
      withdraw_reserve,
      agent_permissions,
      updated_at
    from risk_profiles
    where user_id = ${userId}
    limit 1
  `;
  return rows[0] || null;
}

export async function createTradeTicket(ticket) {
  await ensureSchema();
  const db = sql();
  const rows = await db`
    insert into trade_tickets (
      user_id,
      agent_id,
      market_id,
      question,
      market_url,
      side,
      max_amount,
      limit_price,
      rationale,
      status,
      instructions
    ) values (
      ${ticket.userId},
      ${ticket.agentId},
      ${ticket.marketId},
      ${ticket.question || null},
      ${ticket.marketUrl || null},
      ${ticket.side},
      ${Number(ticket.maxAmount || 0)},
      ${ticket.limitPrice == null ? null : Number(ticket.limitPrice)},
      ${ticket.rationale || null},
      ${ticket.status || "staged"},
      ${JSON.stringify(ticket.instructions || {})}::jsonb
    )
    returning *
  `;
  return rows[0] || null;
}

export async function listTradeTickets(userId, limit = 50) {
  await ensureSchema();
  const db = sql();
  return db`
    select *
    from trade_tickets
    where user_id = ${userId}
    order by created_at desc
    limit ${Math.max(1, Math.min(Number(limit) || 50, 100))}
  `;
}

export async function updateTradeTicketStatus(userId, ticketId, status) {
  await ensureSchema();
  const db = sql();
  const rows = await db`
    update trade_tickets
    set status = ${status}, updated_at = now()
    where user_id = ${userId} and id = ${Number(ticketId)}
    returning *
  `;
  return rows[0] || null;
}

export async function recordRealFill(fill) {
  await ensureSchema();
  const db = sql();
  const action = String(fill.action || "BUY").toUpperCase();
  const shares = Number(fill.shares || 0);
  const price = Number(fill.price || 0);
  const fees = Number(fill.fees || 0);

  const rows = await db`
    insert into real_fills (
      user_id,
      ticket_id,
      agent_id,
      market_id,
      question,
      market_url,
      side,
      action,
      shares,
      price,
      fees,
      tx_note,
      filled_at
    ) values (
      ${fill.userId},
      ${fill.ticketId ? Number(fill.ticketId) : null},
      ${fill.agentId || null},
      ${fill.marketId},
      ${fill.question || null},
      ${fill.marketUrl || null},
      ${fill.side},
      ${action},
      ${shares},
      ${price},
      ${fees},
      ${fill.txNote || null},
      ${fill.filledAt ? new Date(fill.filledAt).toISOString() : new Date().toISOString()}
    )
    returning *
  `;

  const existing = await db`
    select *
    from real_positions
    where user_id = ${fill.userId}
      and market_id = ${fill.marketId}
      and side = ${fill.side}
    limit 1
  `;
  const pos = existing[0];

  if (action === "SELL" && pos) {
    const sellShares = Math.min(shares, Number(pos.shares || 0));
    const avgPrice = Number(pos.avg_price || 0);
    const proceeds = sellShares * price - fees;
    const costRemoved = sellShares * avgPrice;
    const nextShares = Number(pos.shares || 0) - sellShares;
    const nextCost = Math.max(0, Number(pos.cost_basis || 0) - costRemoved);
    const realized = Number(pos.realized_pnl || 0) + proceeds - costRemoved;
    await db`
      update real_positions
      set shares = ${nextShares},
          cost_basis = ${nextCost},
          realized_pnl = ${realized},
          current_price = ${price},
          updated_at = now()
      where id = ${pos.id}
    `;
  } else {
    const currentShares = pos ? Number(pos.shares || 0) : 0;
    const currentCost = pos ? Number(pos.cost_basis || 0) : 0;
    const nextShares = currentShares + shares;
    const nextCost = currentCost + shares * price + fees;
    const avgPrice = nextShares > 0 ? nextCost / nextShares : 0;
    await db`
      insert into real_positions (
        user_id,
        agent_id,
        market_id,
        question,
        market_url,
        side,
        shares,
        avg_price,
        cost_basis,
        realized_pnl,
        current_price,
        updated_at
      ) values (
        ${fill.userId},
        ${fill.agentId || null},
        ${fill.marketId},
        ${fill.question || null},
        ${fill.marketUrl || null},
        ${fill.side},
        ${nextShares},
        ${avgPrice},
        ${nextCost},
        ${pos ? Number(pos.realized_pnl || 0) : 0},
        ${price},
        now()
      )
      on conflict (user_id, market_id, side) do update set
        agent_id = coalesce(excluded.agent_id, real_positions.agent_id),
        question = coalesce(excluded.question, real_positions.question),
        market_url = coalesce(excluded.market_url, real_positions.market_url),
        shares = excluded.shares,
        avg_price = excluded.avg_price,
        cost_basis = excluded.cost_basis,
        current_price = excluded.current_price,
        updated_at = now()
    `;
  }

  if (fill.ticketId) {
    await updateTradeTicketStatus(fill.userId, fill.ticketId, "placed_manually");
  }

  return rows[0] || null;
}

export async function updateRealPositionMark(userId, positionId, currentPrice) {
  await ensureSchema();
  const db = sql();
  const rows = await db`
    update real_positions
    set current_price = ${Number(currentPrice)}, updated_at = now()
    where user_id = ${userId} and id = ${Number(positionId)}
    returning *
  `;
  return rows[0] || null;
}

export async function listRealPortfolio(userId) {
  await ensureSchema();
  const db = sql();
  const positions = await db`
    select *
    from real_positions
    where user_id = ${userId}
    order by updated_at desc
  `;
  const fills = await db`
    select *
    from real_fills
    where user_id = ${userId}
    order by filled_at desc
    limit 100
  `;
  return { positions, fills };
}

export async function providerEventSummary() {
  await ensureSchema();
  const db = sql();
  const rows = await db`
    select
      provider,
      count(*)::int as total,
      max(received_at) as latest_received_at,
      count(*) filter (where signature_valid)::int as signature_valid_count
    from provider_events
    group by provider
    order by provider
  `;
  return rows;
}
