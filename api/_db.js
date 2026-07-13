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
