#!/usr/bin/env node
/**
 * dev-seed.mjs — cria (ou reutiliza) o tenant DEMO determinístico do ambiente local.
 *
 * Requisitos: stack Supabase local de pé (`npm run dev:up` ou `npx supabase start`).
 * Credenciais: lidas de `npx supabase status -o env` (service role local). Nenhum
 * segredo é escrito neste arquivo nem impresso na saída.
 *
 * Idempotente por e-mail/nome: rodar 2x não duplica tenant, serviços, profissional,
 * grade de horários nem link público.
 *
 * Cria:
 *   - 1 tenant demo em trial, timezone America/Sao_Paulo
 *   - 1 admin (admin@demo.local)
 *   - 2 serviços (30 e 60 min, preço > 0)
 *   - 1 profissional vinculado ao profile do admin
 *   - vínculo profissional ↔ ambos os serviços
 *   - grade seg-sex 09:00–18:00
 *   - 1 link público ativo
 *
 * NÃO cria `tenant_asaas_config` (configuração real é do usuário). Só reporta se existe.
 */

import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const DEMO = {
  email: "admin@demo.local",
  password: process.env.DEV_DEMO_PASSWORD ?? "demo12345",
  fullName: "Admin Demo",
  tradeName: "Agenda Demo",
  segment: "barbearia",
  timezone: "America/Sao_Paulo",
  services: [
    { name: "Corte", durationMinutes: 30, priceCents: 5000 },
    { name: "Coloração", durationMinutes: 60, priceCents: 12000 },
  ],
  professionalName: "Profissional Demo",
  workingHours: [1, 2, 3, 4, 5].map((weekday) => ({
    weekday,
    start: "09:00:00",
    end: "18:00:00",
  })),
};

function fail(message, cause) {
  console.error(`\n✖ ${message}`);
  if (cause) console.error(`  ${cause.message ?? String(cause)}`);
  process.exit(1);
}

/** Lê `supabase status -o env` sem imprimir segredo. */
function readStatusEnv() {
  let out;
  try {
    out = execFileSync("npx", ["supabase", "status", "-o", "env"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    fail(
      "não foi possível ler `supabase status`. Suba a stack primeiro: bash scripts/dev-up.sh",
    );
  }
  const map = {};
  for (const raw of out.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    map[key] = value;
  }
  return map;
}

/** Primeira linha de um resultado ou null. */
async function one(query) {
  const { data, error } = await query;
  if (error) throw error;
  return Array.isArray(data) ? (data[0] ?? null) : (data ?? null);
}

async function findAuthUserByEmail(admin, email) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = (data?.users ?? []).find(
      (user) => (user.email ?? "").toLowerCase() === email.toLowerCase(),
    );
    if (found) return found;
    if (!data?.nextPage || data.nextPage <= page) break;
  }
  return null;
}

/**
 * Reafirma a senha demo de um usuário já existente. Sem isso, uma senha trocada
 * antes (pelo app ou por um seed antigo) deixa o smoke falhando no login e o
 * conselho "rode o seed de novo" não consertava nada.
 */
async function confirmDemoPassword(admin, user) {
  const { data, error } = await admin.updateUserById(user.id, {
    password: DEMO.password,
    email_confirm: true,
  });
  if (error) throw error;
  return data?.user ?? user;
}

async function ensureAdminUser(admin) {
  const existing = await findAuthUserByEmail(admin, DEMO.email);
  if (existing) {
    return { user: await confirmDemoPassword(admin, existing), created: false };
  }

  const { data, error } = await admin.createUser({
    email: DEMO.email,
    password: DEMO.password,
    email_confirm: true,
    user_metadata: { full_name: DEMO.fullName },
  });
  if (error) {
    // Corrida: outra execução criou entre a busca e o create.
    if (error.code === "email_exists" || /already/i.test(error.message ?? "")) {
      const raced = await findAuthUserByEmail(admin, DEMO.email);
      if (raced) {
        return { user: await confirmDemoPassword(admin, raced), created: false };
      }
    }
    throw error;
  }
  return { user: data.user, created: true };
}

async function ensureTenant(db, user) {
  const existingProfile = await one(
    db.from("profiles").select("id, tenant_id, role").eq("id", user.id).limit(1),
  );
  if (existingProfile?.tenant_id) {
    const tenant = await one(
      db.from("tenants").select("*").eq("id", existingProfile.tenant_id).limit(1),
    );
    if (tenant) return { tenant, profile: existingProfile, createdTenant: false };
  }

  const existingTenant = await one(
    db.from("tenants").select("*").eq("owner_email", DEMO.email).limit(1),
  );

  if (existingTenant && !existingProfile) {
    const { error } = await db.from("profiles").insert({
      id: user.id,
      tenant_id: existingTenant.id,
      role: "admin",
      full_name: DEMO.fullName,
    });
    if (error) throw error;
    return { tenant: existingTenant, profile: null, createdTenant: false };
  }

  const { data: tenantId, error } = await db.rpc("create_tenant_with_admin", {
    p_user_id: user.id,
    p_owner_email: DEMO.email,
    p_trade_name: DEMO.tradeName,
    p_full_name: DEMO.fullName,
    p_segment: DEMO.segment,
    p_legal_name: null,
    p_document: "52998224725",
    p_phone: "11987654321",
    p_cep: "01310100",
    p_street: "Avenida Paulista",
    p_number: "1000",
    p_complement: null,
    p_city: "Sao Paulo",
    p_state: "SP",
  });
  if (error) throw error;

  const tenant = await one(
    db.from("tenants").select("*").eq("id", tenantId).limit(1),
  );
  const profile = await one(
    db.from("profiles").select("id, tenant_id, role").eq("id", user.id).limit(1),
  );
  return { tenant, profile, createdTenant: true };
}

async function ensureServices(db, tenantId) {
  const result = [];
  for (const service of DEMO.services) {
    const existing = await one(
      db
        .from("services")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("name", service.name)
        .limit(1),
    );
    if (existing) {
      const { data, error } = await db
        .from("services")
        .update({
          duration_minutes: service.durationMinutes,
          price_cents: service.priceCents,
          active: true,
        })
        .eq("id", existing.id)
        .select()
        .single();
      if (error) throw error;
      result.push(data);
    } else {
      const { data, error } = await db
        .from("services")
        .insert({
          tenant_id: tenantId,
          name: service.name,
          duration_minutes: service.durationMinutes,
          price_cents: service.priceCents,
          active: true,
        })
        .select()
        .single();
      if (error) throw error;
      result.push(data);
    }
  }
  return result;
}

async function ensureProfessional(db, tenantId, profileId) {
  const byProfile = await one(
    db
      .from("professionals")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("profile_id", profileId)
      .limit(1),
  );
  if (byProfile) {
    const { data, error } = await db
      .from("professionals")
      .update({ name: DEMO.professionalName, active: true })
      .eq("id", byProfile.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const byName = await one(
    db
      .from("professionals")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("name", DEMO.professionalName)
      .limit(1),
  );
  if (byName) {
    const { data, error } = await db
      .from("professionals")
      .update({ profile_id: profileId, active: true })
      .eq("id", byName.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await db
    .from("professionals")
    .insert({
      tenant_id: tenantId,
      name: DEMO.professionalName,
      profile_id: profileId,
      active: true,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function ensureServiceProfessionals(db, tenantId, services, professionalId) {
  const rows = services.map((service) => ({
    tenant_id: tenantId,
    service_id: service.id,
    professional_id: professionalId,
  }));
  const { error } = await db
    .from("service_professionals")
    .upsert(rows, {
      onConflict: "tenant_id,service_id,professional_id",
      ignoreDuplicates: true,
    });
  if (error) throw error;
}

async function ensureWorkingHours(db, tenantId, professionalId) {
  for (const slot of DEMO.workingHours) {
    const existing = await one(
      db
        .from("working_hours")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("professional_id", professionalId)
        .eq("weekday", slot.weekday)
        .eq("start_time", slot.start)
        .eq("end_time", slot.end)
        .limit(1),
    );
    if (existing) continue;
    const { error } = await db.from("working_hours").insert({
      tenant_id: tenantId,
      professional_id: professionalId,
      weekday: slot.weekday,
      start_time: slot.start,
      end_time: slot.end,
    });
    if (error) throw error;
  }
}

async function ensureBookingLink(db, tenantId) {
  const { data: active, error } = await db
    .from("public_booking_links")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("created_at", { ascending: false });
  if (error) throw error;

  let link = active?.[0] ?? null;
  if (!link) {
    const { data, error: insertError } = await db
      .from("public_booking_links")
      .insert({ tenant_id: tenantId, active: true })
      .select()
      .single();
    if (insertError) throw insertError;
    link = data;
  } else if ((active?.length ?? 0) > 1) {
    const staleIds = active.slice(1).map((row) => row.id);
    const { error: deactivateError } = await db
      .from("public_booking_links")
      .update({ active: false })
      .in("id", staleIds);
    if (deactivateError) throw deactivateError;
  }
  return link;
}

async function reportAsaasConfig(db, tenantId) {
  const { data, error } = await db
    .from("tenant_asaas_config")
    .select("tenant_id, environment, active, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

async function main() {
  const status = readStatusEnv();
  const url = status.API_URL;
  const serviceRole = status.SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    fail(
      "API_URL/SERVICE_ROLE_KEY ausentes em `supabase status`. A stack local está de pé?",
    );
  }

  const db = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("\n▶ Seed do tenant demo");
  const { user, created: userCreated } = await ensureAdminUser(db.auth.admin);
  console.log(
    `  ${userCreated ? "✔" : "•"} admin ${DEMO.email} ${userCreated ? "criado" : "reutilizado"}`,
  );

  const { tenant, createdTenant } = await ensureTenant(db, user);
  if (!tenant?.id) fail("não foi possível resolver o tenant demo.");

  const { error: tenantUpdateError } = await db
    .from("tenants")
    .update({
      trade_name: DEMO.tradeName,
      legal_name: DEMO.tradeName,
      subscription_status: "trial",
      timezone: DEMO.timezone,
    })
    .eq("id", tenant.id);
  if (tenantUpdateError) throw tenantUpdateError;
  console.log(
    `  ${createdTenant ? "✔" : "•"} tenant ${tenant.id} ${createdTenant ? "criado" : "reutilizado"} (trial, ${DEMO.timezone})`,
  );

  const services = await ensureServices(db, tenant.id);
  console.log(`  ✔ ${services.length} serviços garantidos`);
  for (const service of services) {
    console.log(
      `      - ${service.name} (${service.duration_minutes} min, ${service.price_cents} cents)`,
    );
  }

  const professional = await ensureProfessional(db, tenant.id, user.id);
  console.log(
    `  ✔ profissional ${professional.id} vinculado ao profile ${user.id}`,
  );

  await ensureServiceProfessionals(db, tenant.id, services, professional.id);
  console.log("  ✔ vínculos serviço ↔ profissional garantidos");

  await ensureWorkingHours(db, tenant.id, professional.id);
  console.log("  ✔ grade seg-sex 09:00–18:00 garantida");

  const link = await ensureBookingLink(db, tenant.id);
  console.log(`  ✔ link público ativo: token ${link.token}`);

  const asaas = await reportAsaasConfig(db, tenant.id);
  if (asaas) {
    console.log(
      `  • tenant_asaas_config existente (environment=${asaas.environment}, active=${asaas.active})`,
    );
  } else {
    console.log(
      "  • tenant_asaas_config ausente (esperado; configurar pelo app → Configurações → Pagamentos)",
    );
  }

  console.log("\n✔ Seed concluído");
  console.log(`  tenant_id:        ${tenant.id}`);
  console.log(`  admin_profile_id: ${user.id}`);
  console.log(`  professional_id:  ${professional.id}`);
  console.log(`  service_ids:      ${services.map((s) => s.id).join(", ")}`);
  console.log(`  booking_link:     http://localhost:5173/agendar/${link.token}`);
  console.log("");
}

main().catch((error) => fail("seed falhou.", error));
