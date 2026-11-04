#!/usr/bin/env node
/**
 * dev-smoke.mjs — prova o aceite CADASTRO → AGENDA → PIX contra o stack local.
 *
 * Passos:
 *   1. POST /functions/v1/signup-tenant (e-mail único)  → 201
 *   2. login do usuário recém-criado                     → 200 (token só em memória)
 *   3. agenda: cria appointment 'concluido' do tenant demo
 *   4. PIX (PARCIAL): garante tenant_asaas_config ativo (via Edge Function),
 *      pré-registra o cliente no Asaas (bypass do gap de cpfCnpj) e chama
 *      /functions/v1/create-charge                       → 200 + payload PIX
 *   5. autoagendamento: public-slots + public-book        → 200 / 201
 *
 * O passo 4 NÃO prova o aceite PIX do ADR-20: o caminho real (create-charge
 * criando o cliente sem CPF/CNPJ) falha com 400 no Asaas. O bypass está
 * registrado em .spec/tech-debts/asaas-cpf-cnpj-obrigatorio/TASKS.md.
 *
 * Não imprime token, telefone nem e-mail completo. Em falha, mostra status,
 * `error` do corpo e a última linha do log das functions.
 *
 * Uso: node scripts/dev-smoke.mjs
 */

import { execFileSync } from "node:child_process";
import { createDecipheriv, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const STATE_DIR = process.env.ATLAS_DEV_STATE_DIR ?? "/tmp/atlas-dev";
const FUNCTIONS_LOG = `${STATE_DIR}/functions.log`;
const TIMEOUT_MS = 45_000;

const DEMO = {
  email: "admin@demo.local",
  password: process.env.DEV_DEMO_PASSWORD ?? "demo12345",
  customerName: "Cliente Smoke",
  customerPhone: "+5511999999999",
  /** CPF de teste (dígitos válidos), usado só no sandbox do Asaas. */
  sandboxCpf: "39053344705",
};

const steps = [];

function mark(name, ok, detail = "", opts = {}) {
  const partial = opts.partial === true;
  steps.push({ name, ok, detail, partial });
  const icon = ok === true ? (partial ? "⚠️ " : "✅") : ok === "skip" ? "⚠️ " : "❌";
  console.log(`  ${icon} ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(message, cause) {
  if (cause) {
    console.error(`\n  causa: ${cause.message ?? String(cause)}`);
  }
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

function readStatusEnv() {
  let out;
  try {
    out = execFileSync("npx", ["supabase", "status", "-o", "env"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    fail("não foi possível ler `supabase status`. Rode `bash scripts/dev-up.sh`.");
  }
  const map = {};
  for (const raw of out.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    map[line.slice(0, eq).trim()] = value;
  }
  return map;
}

function readDotenv(path) {
  const map = {};
  let raw = "";
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return map;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    map[trimmed.slice(0, eq).trim()] = value;
  }
  return map;
}

function lastLogLine() {
  try {
    const lines = readFileSync(FUNCTIONS_LOG, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length > 0) return lines.at(-1);
  } catch {
    // log do `functions serve` ausente (runtime iniciado pelo `supabase start`)
  }
  try {
    return execFileSync(
      "docker",
      ["logs", "--tail", "1", "supabase_edge_runtime_atlas-agenda"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    )
      .trim()
      .split("\n")
      .filter(Boolean)
      .at(-1) ?? "";
  } catch {
    return "";
  }
}

async function request(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    return { status: response.status, body, text };
  } finally {
    clearTimeout(timer);
  }
}

function authHeaders(anonKey, accessToken) {
  const headers = { "Content-Type": "application/json", apikey: anonKey };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

async function login(apiUrl, anonKey, email, password) {
  return request(`${apiUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: authHeaders(anonKey),
    body: JSON.stringify({ email, password }),
  });
}

function serverError(result) {
  const code = result.body?.error ?? result.body?.code ?? "";
  const message = result.body?.message ?? "";
  const detail = [code, message].filter(Boolean).join(": ");
  return `status ${result.status}${detail ? ` (${detail})` : ""}`;
}

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

/** Próximo dia útil (seg-sex) a partir de `offsetDays` dias à frente, em São Paulo. */
function nextBusinessDate(offsetDays = 1) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const today = formatter.format(new Date());
  const cursor = new Date(`${today}T12:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + offsetDays);
  for (let i = 0; i < 7; i += 1) {
    const dow = cursor.getUTCDay();
    if (dow >= 1 && dow <= 5) return cursor.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return cursor.toISOString().slice(0, 10);
}

async function asaasFetch(baseUrl, apiKey, path, method = "GET", body) {
  return request(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      access_token: apiKey,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

/**
 * Decripta a API key do tenant com a mesma construção de `_shared/asaas.ts`
 * (AES-256-GCM, chave = SHA-256 do ASAAS_MASTER_KEY, IV de 12 bytes prefixado,
 * tag de 16 bytes no fim). Usado só para pré-aquecer o cliente Asaas na MESMA
 * conta configurada pelo tenant. Nunca imprime a chave.
 */
function decryptAsaasKey(encryptedB64, masterKey) {
  if (!encryptedB64 || !masterKey) return null;
  try {
    const buf = Buffer.from(encryptedB64, "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(buf.length - 16);
    const ciphertext = buf.subarray(12, buf.length - 16);
    const key = createHash("sha256").update(masterKey).digest();
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

async function main() {
  console.log("\n▶ Smoke test — cadastro → agenda → PIX");

  const status = readStatusEnv();
  const apiUrl = status.API_URL;
  const anonKey = status.ANON_KEY;
  const serviceRole = status.SERVICE_ROLE_KEY;
  if (!apiUrl || !anonKey || !serviceRole) {
    fail("API_URL/ANON_KEY/SERVICE_ROLE_KEY ausentes em `supabase status`.");
  }

  const functionsEnv = readDotenv("supabase/functions/.env");
  const asaasKey =
    functionsEnv.ASAAS_SUPER_ADMIN_API_KEY || functionsEnv.ASAAS_API_KEY || "";
  const asaasEnv = functionsEnv.ASAAS_SUPER_ADMIN_ENVIRONMENT || "sandbox";
  const asaasBase =
    asaasEnv === "production"
      ? "https://api.asaas.com/v3"
      : "https://sandbox.asaas.com/api/v3";

  if (!asaasKey) {
    fail(
      "ASAAS_SUPER_ADMIN_API_KEY ausente em supabase/functions/.env — o passo PIX não roda.",
    );
  }

  const db = createClient(apiUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // -------------------------------------------------------------------------
  // 1. Cadastro de empresa
  // -------------------------------------------------------------------------
  const stamp = Date.now();
  const signupEmail = `smoke+${stamp}@demo.local`;
  const signupPassword = `Smoke!${stamp}`;
  const signup = await request(`${apiUrl}/functions/v1/signup-tenant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: signupEmail,
      password: signupPassword,
      trade_name: `Smoke ${stamp}`,
      segment: "barbearia",
    }),
  });
  mark(
    "cadastro de empresa (signup-tenant → 201)",
    signup.status === 201,
    signup.status === 201 ? "" : serverError(signup),
  );
  if (signup.status !== 201) {
    console.error(`    última linha do log: ${lastLogLine() || "(vazio)"}`);
    fail("cadastro falhou — corrija a causa e rode de novo.");
  }

  // -------------------------------------------------------------------------
  // 2. Login do usuário recém-criado
  // -------------------------------------------------------------------------
  const newLogin = await login(apiUrl, anonKey, signupEmail, signupPassword);
  const newToken = newLogin.body?.access_token;
  mark(
    "login do usuário recém-criado (auth → 200)",
    newLogin.status === 200 && Boolean(newToken),
    newLogin.status === 200 ? "" : serverError(newLogin),
  );
  if (!newToken) {
    console.error(`    última linha do log: ${lastLogLine() || "(vazio)"}`);
    fail("login pós-cadastro falhou.");
  }

  // -------------------------------------------------------------------------
  // 3. Agenda do tenant demo
  // -------------------------------------------------------------------------
  const demoUser = await findAuthUserByEmail(db.auth.admin, DEMO.email);
  if (!demoUser) fail("admin demo não encontrado. Rode `node scripts/dev-seed.mjs`.");
  const demoProfile = await one(
    db.from("profiles").select("id, tenant_id").eq("id", demoUser.id).limit(1),
  );
  if (!demoProfile?.tenant_id) fail("profile do admin demo sem tenant. Rode o seed.");

  const tenantId = demoProfile.tenant_id;
  const service = await one(
    db
      .from("services")
      .select("id, name, duration_minutes, price_cents")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("duration_minutes", { ascending: true })
      .limit(1),
  );
  const professional = await one(
    db
      .from("professionals")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .limit(1),
  );
  if (!service || !professional) {
    fail("serviço/profissional demo ausente. Rode `node scripts/dev-seed.mjs`.");
  }

  let customer = await one(
    db
      .from("customers")
      .select("id, name, email, phone")
      .eq("tenant_id", tenantId)
      .eq("name", DEMO.customerName)
      .limit(1),
  );
  if (!customer) {
    const { data, error } = await db
      .from("customers")
      .insert({
        tenant_id: tenantId,
        name: DEMO.customerName,
        phone: DEMO.customerPhone,
        whatsapp_opt_in: false,
      })
      .select("id, name, email, phone")
      .single();
    if (error) fail("não foi possível criar o cliente do smoke.", error);
    customer = data;
  }

  // Horário único por execução (evita a constraint de não-sobreposição).
  const uniqueOffsetMinutes = 90 * 24 * 60 + (stamp % 86_400);
  const startsAt = new Date(Date.now() + uniqueOffsetMinutes * 60_000);
  const endsAt = new Date(
    startsAt.getTime() + service.duration_minutes * 60_000,
  );

  const { data: appointment, error: appointmentError } = await db
    .from("appointments")
    .insert({
      tenant_id: tenantId,
      customer_id: customer.id,
      professional_id: professional.id,
      service_id: service.id,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      price_cents: service.price_cents,
      status: "concluido",
    })
    .select("id, status, price_cents")
    .single();

  if (appointmentError || !appointment) {
    mark("agenda: criar appointment concluído", false, appointmentError?.message ?? "sem registro");
    fail("não foi possível criar o agendamento do smoke.");
  }
  mark(
    "agenda: appointment concluído criado",
    appointment.status === "concluido" && appointment.price_cents > 0,
    `id ${appointment.id} · ${appointment.price_cents} cents`,
  );

  // -------------------------------------------------------------------------
  // 4. PIX
  // -------------------------------------------------------------------------
  const demoLogin = await login(apiUrl, anonKey, DEMO.email, DEMO.password);
  const demoToken = demoLogin.body?.access_token;
  if (!demoToken) {
    mark("login do admin demo", false, serverError(demoLogin));
    console.error(`    última linha do log: ${lastLogLine() || "(vazio)"}`);
    fail("login do admin demo falhou (senha mudou? rode o seed de novo).");
  }

  let asaasConfig = await one(
    db
      .from("tenant_asaas_config")
      .select("tenant_id, environment, active, asaas_api_key_encrypted")
      .eq("tenant_id", tenantId)
      .limit(1),
  );

  if (!asaasConfig?.active) {
    const save = await request(`${apiUrl}/functions/v1/save-asaas-config`, {
      method: "POST",
      headers: authHeaders(anonKey, demoToken),
      body: JSON.stringify({ apiKey: asaasKey, environment: asaasEnv }),
    });
    mark(
      "PIX: configurar Asaas do tenant demo (save-asaas-config → 200)",
      save.status === 200,
      serverError(save),
    );
    if (save.status !== 200) {
      console.error(`    última linha do log: ${lastLogLine() || "(vazio)"}`);
      fail("configuração do Asaas falhou.");
    }
    asaasConfig = await one(
      db
        .from("tenant_asaas_config")
        .select("tenant_id, environment, active, asaas_api_key_encrypted")
        .eq("tenant_id", tenantId)
        .limit(1),
    );
  } else {
    mark(
      "PIX: tenant_asaas_config já ativo (reutilizado)",
      true,
      `environment=${asaasConfig.environment}`,
    );
  }

  // Usa a MESMA conta Asaas do tenant (key decriptada) quando disponível; o
  // fallback é a key do ambiente, que é a usada quando o próprio smoke cria a
  // configuração do tenant demo.
  const tenantApiKey =
    decryptAsaasKey(
      asaasConfig?.asaas_api_key_encrypted,
      functionsEnv.ASAAS_MASTER_KEY || "",
    ) || asaasKey;

  // DÍVIDA CONHECIDA (bypass explícito, NÃO é prova de aceite): o create-charge
  // cria o cliente no Asaas sem CPF/CNPJ e o sandbox exige o documento. Aqui o
  // cliente é pré-registrado com o externalReference local para que a Edge
  // Function o reutilize — caminho que o usuário real NÃO percorre.
  // Ver .spec/tech-debts/asaas-cpf-cnpj-obrigatorio/TASKS.md.
  const lookup = await asaasFetch(
    asaasBase,
    tenantApiKey,
    `/customers?externalReference=${encodeURIComponent(customer.id)}`,
  );
  const existingAsaasCustomer =
    lookup.status === 200 && Array.isArray(lookup.body?.data)
      ? lookup.body.data[0]
      : null;

  if (!existingAsaasCustomer) {
    const created = await asaasFetch(asaasBase, tenantApiKey, "/customers", "POST", {
      name: customer.name,
      cpfCnpj: DEMO.sandboxCpf,
      email: customer.email ?? undefined,
      externalReference: customer.id,
    });
    if (created.status !== 200 || !created.body?.id) {
      mark(
        "PIX: preparar cliente no Asaas sandbox",
        false,
        serverError(created),
        { partial: true },
      );
      fail("sandbox do Asaas recusou o cliente de teste (CPF/chave/chave Pix).");
    }
  }
  mark(
    "PIX: cliente Asaas pré-registrado (bypass do gap cpfCnpj)",
    "skip",
    "não conta como prova do aceite #3 do ADR-20",
    { partial: true },
  );

  const charge = await request(`${apiUrl}/functions/v1/create-charge`, {
    method: "POST",
    headers: authHeaders(anonKey, demoToken),
    body: JSON.stringify({ appointment_id: appointment.id }),
  });
  const pixOk =
    charge.status === 200 &&
    Boolean(charge.body?.charge_id) &&
    Boolean(charge.body?.pix_qr_code) &&
    Boolean(charge.body?.pix_copy_paste);
  mark(
    "PIX: create-charge → 200 com QR + copia-e-cola (parcial — cpfCnpj pendente)",
    pixOk,
    pixOk
      ? `charge ${charge.body.charge_id}`
      : `${serverError(charge)} · log: ${lastLogLine() || "(vazio)"}`,
    { partial: true },
  );

  if (pixOk) {
    const stored = await one(
      db
        .from("charges")
        .select("id, asaas_payment_id, status, amount_cents")
        .eq("id", charge.body.charge_id)
        .limit(1),
    );
    const persistedOk =
      Boolean(stored?.asaas_payment_id) &&
      stored?.status === "pendente" &&
      stored?.amount_cents === appointment.price_cents;
    mark(
      "PIX: cobrança persistida (asaas_payment_id, status pendente, valor do agendamento)",
      persistedOk,
      stored
        ? `status=${stored.status} · ${stored.amount_cents} cents (esperado ${appointment.price_cents})`
        : "linha não encontrada em charges",
      { partial: true },
    );
    if (!persistedOk) {
      fail("cobrança persistida divergiu do esperado (status/valor/asaas_payment_id).");
    }
  } else {
    fail("fluxo PIX falhou.");
  }

  // -------------------------------------------------------------------------
  // 5. Autoagendamento público (opcional)
  // -------------------------------------------------------------------------
  const link = await one(
    db
      .from("public_booking_links")
      .select("token, active")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(1),
  );

  if (!link?.token) {
    mark("autoagendamento: link público", "skip", "sem link ativo (rode o seed)");
  } else {
    // Procura um dia útil com slot livre a partir de amanhã. Evita esgotar o
    // mesmo dia quando o smoke roda várias vezes seguidas.
    let chosenDate = null;
    let available = [];
    let slotsStatus = 0;
    let slotsError = "";
    for (const offset of [1, 2, 3, 4, 5]) {
      const date = nextBusinessDate(offset);
      const query = new URLSearchParams({
        token: link.token,
        service_id: service.id,
        professional_id: professional.id,
        date,
      });
      const slots = await request(
        `${apiUrl}/functions/v1/public-slots?${query.toString()}`,
        { headers: { apikey: anonKey } },
      );
      slotsStatus = slots.status;
      slotsError = serverError(slots);
      const found = Array.isArray(slots.body?.slots) ? slots.body.slots : [];
      if (slots.status === 200 && found.length > 0) {
        chosenDate = date;
        available = found;
        break;
      }
    }

    const slotsOk = slotsStatus === 200 && available.length > 0;
    mark(
      "autoagendamento: public-slots → 200 com slot livre",
      slotsOk,
      slotsStatus !== 200
        ? slotsError
        : slotsOk
          ? `${available.length} slot(s) em ${chosenDate}`
          : "0 slots em 5 dias úteis (o seed garante grade seg-sex 09:00–18:00)",
    );

    // Com o seed aplicado, 0 slots em dia útil é defeito de produto — não um
    // "ambiente sem disponibilidade" que possa virar skip.
    if (slotsStatus === 200 && available.length === 0) {
      fail("public-slots devolveu 0 slots em dias úteis com o seed aplicado.");
    }

    if (slotsOk) {
      const slot = available[0];
      const book = await request(`${apiUrl}/functions/v1/public-book`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: anonKey },
        body: JSON.stringify({
          token: link.token,
          service_id: service.id,
          professional_id: professional.id,
          starts_at: slot.slot_start,
          customer_name: "Cliente Público Smoke",
          customer_phone: "+5511988887777",
        }),
      });
      mark(
        "autoagendamento: public-book → 201",
        book.status === 201,
        book.status === 201
          ? `appointment ${book.body?.appointment_id}`
          : serverError(book),
      );
    }
  }

  // -------------------------------------------------------------------------
  // Resumo
  // -------------------------------------------------------------------------
  const failed = steps.filter((step) => step.ok === false);
  const skipped = steps.filter((step) => step.ok === "skip");

  const partial = steps.filter((step) => step.partial);

  console.log("\n  ── resumo ──");
  for (const step of steps) {
    const icon =
      step.ok === true
        ? step.partial
          ? "⚠️ "
          : "✅"
        : step.ok === "skip"
          ? "⚠️ "
          : "❌";
    console.log(`  ${icon} ${step.name}`);
  }
  console.log(
    `\n  ${steps.length - failed.length - skipped.length} ok · ${skipped.length} pulado(s) · ${failed.length} falha(s)`,
  );

  if (partial.length > 0) {
    console.log(`
  ── PIX (parcial — cpfCnpj pendente) ──
  O Asaas foi configurado e o cliente foi PRÉ-REGISTRADO no sandbox com um CPF
  fixo (bypass). O caminho que o usuário real percorre — create-charge criando o
  cliente sem CPF/CNPJ — NÃO foi exercitado e o Asaas responde 400.
  Logo, a prova do aceite #3 do ADR-20 (PIX ponta a ponta) NÃO foi feita.
  Débito: .spec/tech-debts/asaas-cpf-cnpj-obrigatorio/TASKS.md`);
  }

  if (failed.length > 0) {
    console.error("\n✖ Smoke test FALHOU\n");
    process.exit(1);
  }
  if (partial.length > 0) {
    console.log(
      "\n✔ Smoke test passou (PIX PARCIAL — aceite #3 do ADR-20 não provado; ver débito cpfCnpj)\n",
    );
  } else {
    console.log("\n✔ Smoke test passou\n");
  }
}

main().catch((error) => fail("smoke test abortou.", error));
