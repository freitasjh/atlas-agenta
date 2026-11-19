#!/usr/bin/env node
/**
 * dev-seed-clinica.mjs — fixture H3 da Fase 2 estética (NÃO é o seed default).
 *
 * Contexto: o H3 parcial usou o seed default (`scripts/dev-seed.mjs`), que é
 * `segment=barbearia` sem `aestheticCheckout` — o caminho estética completo
 * (prontuário + pacotes + checkout clínica, ADR-07) não era executável. Esta
 * fixture provisiona um tenant `segment=clinica` com dados mínimos para o H3
 * full: admin, profissional + grade, serviços + vínculos, 1 paciente e
 * 1 crédito de pacote de sessões ativo.
 *
 * Uso (stack Supabase local de pé — `npm run dev:up` ou `npx supabase start`):
 *   npm run dev:seed:clinica
 *   # ou: DEV_CLINICA_PASSWORD=demo12345 node scripts/dev-seed-clinica.mjs
 *
 * Cria (tudo idempotente por e-mail/nome/telefone — rodar 2x não duplica):
 *   - 1 admin (clinica@demo.local; senha de `DEV_CLINICA_PASSWORD` ou `demo12345`)
 *   - 1 tenant `segment=clinica`, `plan=premium` (ex-`clinica` no ladder
 *     atual free/starter/premium/enterprise), `subscription_status=trial`
 *   - 2 serviços (Avaliação inicial 60 min; Retorno 30 min)
 *   - 1 profissional vinculado ao profile do admin + grade seg-sex 08:00–18:00
 *   - vínculo profissional ↔ ambos os serviços
 *   - 1 paciente (Paciente Demo)
 *   - 1 crédito de pacote: 5 sessões de "Avaliação inicial", 90 dias de validade
 *
 * Entitlement: `plan=premium` (ex-`clinica` no ladder atual) já carrega no
 * catálogo SSoT (`public.plans`) as features `prontuario` + `pacotes_sessoes`. O hook `usePlanEntitlements`
 * (ADR-01) lê `tenant.entitlements`, que o backend/ainda não expõe (T1.x) —
 * sem ele o browser degrada para o legado (conteúdo legível, escrita
 * bloqueada + upsell). Ou seja: esta fixture destrava todos os passos de
 * dados do H3; a ativação do checkout clínica no browser (`aestheticCheckout`)
 * acontece quando o T1.x expuser `entitlements` (ou via mock de QA).
 *
 * Credenciais: lidas de `npx supabase status -o env` (service role local) e de
 * `DEV_CLINICA_PASSWORD`. Nenhum segredo é escrito neste arquivo nem impresso.
 * NÃO altera o seed default (`scripts/dev-seed.mjs` intocado).
 */

import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const CLINICA = {
  email: "clinica@demo.local",
  password: process.env.DEV_CLINICA_PASSWORD ?? "demo12345",
  fullName: "Admin Clínica",
  tradeName: "Clínica Demo",
  segment: "clinica",
  plan: "premium",
  timezone: "America/Sao_Paulo",
  services: [
    { name: "Avaliação inicial", durationMinutes: 60, priceCents: 25000 },
    { name: "Retorno", durationMinutes: 30, priceCents: 10000 },
  ],
  package: {
    serviceName: "Avaliação inicial",
    totalSessions: 5,
    priceCents: 100000,
    validityDays: 90,
  },
  professionalName: "Profissional Clínica",
  customer: { name: "Paciente Demo", phone: "+550090003001" },
  workingHours: [1, 2, 3, 4, 5].map((weekday) => ({
    weekday,
    start: "08:00:00",
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
 * Reafirma a senha demo de um usuário já existente (mesmo motivo do seed
 * default: senha trocada antes não pode quebrar o login do H3).
 */
async function confirmDemoPassword(admin, user) {
  const { data, error } = await admin.updateUserById(user.id, {
    password: CLINICA.password,
    email_confirm: true,
  });
  if (error) throw error;
  return data?.user ?? user;
}

async function ensureAdminUser(admin) {
  const existing = await findAuthUserByEmail(admin, CLINICA.email);
  if (existing) {
    return { user: await confirmDemoPassword(admin, existing), created: false };
  }

  const { data, error } = await admin.createUser({
    email: CLINICA.email,
    password: CLINICA.password,
    email_confirm: true,
    user_metadata: { full_name: CLINICA.fullName },
  });
  if (error) {
    if (error.code === "email_exists" || /already/i.test(error.message ?? "")) {
      const raced = await findAuthUserByEmail(admin, CLINICA.email);
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
    db.from("tenants").select("*").eq("owner_email", CLINICA.email).limit(1),
  );

  if (existingTenant && !existingProfile) {
    const { error } = await db.from("profiles").insert({
      id: user.id,
      tenant_id: existingTenant.id,
      role: "admin",
      full_name: CLINICA.fullName,
    });
    if (error) throw error;
    return { tenant: existingTenant, profile: null, createdTenant: false };
  }

  const { data: tenantId, error } = await db.rpc("create_tenant_with_admin", {
    p_user_id: user.id,
    p_owner_email: CLINICA.email,
    p_trade_name: CLINICA.tradeName,
    p_full_name: CLINICA.fullName,
    p_segment: CLINICA.segment,
    p_legal_name: null,
    p_document: "11144477735",
    p_phone: "11987654399",
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
  for (const service of CLINICA.services) {
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
      .update({ name: CLINICA.professionalName, active: true })
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
      .eq("name", CLINICA.professionalName)
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
      name: CLINICA.professionalName,
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
  for (const slot of CLINICA.workingHours) {
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

async function ensureCustomer(db, tenantId) {
  const existing = await one(
    db
      .from("customers")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("phone", CLINICA.customer.phone)
      .limit(1),
  );
  if (existing) return { customer: existing, created: false };

  const { data, error } = await db
    .from("customers")
    .insert({
      tenant_id: tenantId,
      name: CLINICA.customer.name,
      phone: CLINICA.customer.phone,
      whatsapp_opt_in: false,
      active: true,
    })
    .select()
    .single();
  if (error) throw error;
  return { customer: data, created: true };
}

/**
 * Idempotente: reutiliza o crédito ativo mais próximo do vencimento com saldo
 * para (paciente, serviço do pacote); só insere quando não há nenhum. Rodar
 * 2x nunca duplica.
 */
async function ensurePackageCredit(db, tenantId, customerId, serviceId) {
  const { data, error } = await db
    .from("package_credits")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId)
    .eq("service_id", serviceId)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: true });
  if (error) throw error;
  const reusable = (data ?? []).find(
    (credit) => (credit.used_sessions ?? 0) < (credit.total_sessions ?? 0),
  );
  if (reusable) return { credit: reusable, created: false };

  const { data: credit, error: insertError } = await db
    .from("package_credits")
    .insert({
      tenant_id: tenantId,
      customer_id: customerId,
      service_id: serviceId,
      total_sessions: CLINICA.package.totalSessions,
      used_sessions: 0,
      price_cents: CLINICA.package.priceCents,
      validity_days: CLINICA.package.validityDays,
      expires_at: new Date(
        Date.now() + CLINICA.package.validityDays * 86400000,
      ).toISOString(),
      status: "active",
    })
    .select()
    .single();
  if (insertError) throw insertError;
  return { credit, created: true };
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

  console.log("\n▶ Fixture H3 estética (tenant clínica)");
  const { user, created: userCreated } = await ensureAdminUser(db.auth.admin);
  console.log(
    `  ${userCreated ? "✔" : "•"} admin ${CLINICA.email} ${userCreated ? "criado" : "reutilizado"}`,
  );

  const { tenant, createdTenant } = await ensureTenant(db, user);
  if (!tenant?.id) fail("não foi possível resolver o tenant clínica.");

  const { error: tenantUpdateError } = await db
    .from("tenants")
    .update({
      trade_name: CLINICA.tradeName,
      legal_name: CLINICA.tradeName,
      segment: CLINICA.segment,
      plan: CLINICA.plan,
      subscription_status: "trial",
      timezone: CLINICA.timezone,
    })
    .eq("id", tenant.id);
  if (tenantUpdateError) throw tenantUpdateError;
  console.log(
    `  ${createdTenant ? "✔" : "•"} tenant ${tenant.id} ${createdTenant ? "criado" : "reutilizado"} (segment=${CLINICA.segment}, plan=${CLINICA.plan}, trial)`,
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
  console.log("  ✔ grade seg-sex 08:00–18:00 garantida");

  const { customer, created: customerCreated } = await ensureCustomer(
    db,
    tenant.id,
  );
  console.log(
    `  ${customerCreated ? "✔" : "•"} paciente ${customer.id} ${customerCreated ? "criado" : "reutilizado"}`,
  );

  const packageService = services.find(
    (service) => service.name === CLINICA.package.serviceName,
  );
  if (!packageService) fail("serviço do pacote não resolvido.");
  const { credit, created: creditCreated } = await ensurePackageCredit(
    db,
    tenant.id,
    customer.id,
    packageService.id,
  );
  console.log(
    `  ${creditCreated ? "✔" : "•"} crédito de pacote ${credit.id} ${creditCreated ? "criado" : "reutilizado"} (${credit.used_sessions}/${credit.total_sessions} usadas, expira ${credit.expires_at})`,
  );

  console.log("\n✔ Fixture concluída");
  console.log(`  tenant_id:        ${tenant.id}`);
  console.log(`  admin_profile_id: ${user.id}`);
  console.log(`  professional_id:  ${professional.id}`);
  console.log(`  service_ids:      ${services.map((s) => s.id).join(", ")}`);
  console.log(`  customer_id:      ${customer.id}`);
  console.log(`  package_credit:   ${credit.id}`);
  console.log(`  login H3:         clinica@demo.local (senha de DEV_CLINICA_PASSWORD)`);
  console.log("");
}

main().catch((error) => fail("fixture falhou.", error));
