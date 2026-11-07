// E2E completo (conta -> super admin) via Chrome headless/CDP.
//
// Cenário: cadastro pela UI (/cadastro) -> páginas do tenant -> tentativa em /admin
// -> bootstrap do super admin (Edge Function) -> login provisório -> /trocar-senha
// -> troca pela UI -> /admin/empresas -> mudança de status (403/200) -> logout
// -> re-login -> RLS (admin de empresa x super admin).
//
// Artefatos: harness/qa/e2e/e2e-report.json + harness/qa/e2e/screenshots/*.png
// Nenhum código de aplicação é alterado. Nenhum `pkill -f`; o Chrome morre por SIGTERM.
//
// Uso:
//   QA_SERVICE_ROLE_KEY=... node harness/qa/e2e/run-e2e.mjs
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  launch, newPage, enable, setViewport, goto, evaluate, screenshot,
  sleep, closeBrowser, Collector,
} from "../tools/cdp.mjs";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, "harness/qa/e2e");
const SHOTS = join(OUT, "screenshots");
const BASE = process.env.QA_BASE_URL ?? "http://127.0.0.1:5174";
const API = process.env.QA_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON = process.env.QA_ANON_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const SERVICE = process.env.QA_SERVICE_ROLE_KEY ?? "";
const BOOTSTRAP_SECRET = readFileSync("/tmp/opencode/atlas-e2e/bootstrap.secret", "utf8").trim();

const COMPANY = { email: "e2e.empresa@atlas.test", password: "Empresa@2026", trade: "Atlas QA E2E", segment: "Clínica" };
const RIVAL = { email: "e2e.rival@atlas.test", password: "Rival@2026", trade: "Atlas QA Rival", segment: "Barbearia" };
const SUPER = { email: "admin@neox.com.br", provisional: "AtlasAgenda@123", password: "NeoX@Segura#2026" };

/** CPF válido e único por execução (ADR-002 exige DV; reuso cairia em 409). */
let cpfCounter = 0;
function uniqueValidCpf() {
  cpfCounter += 1;
  const base = `${Date.now() % 1_000_000_000}${cpfCounter}`
    .replace(/[^0-9]/g, "")
    .padStart(9, "3")
    .slice(-9);
  const digit = (seed, weight) => {
    let sum = 0;
    for (let i = 0; i < seed.length; i += 1) sum += Number(seed[i]) * (weight - i);
    const rem = sum % 11;
    return rem < 2 ? 0 : 11 - rem;
  };
  const d1 = digit(base, 10);
  const d2 = digit(`${base}${d1}`, 11);
  return `${base}${d1}${d2}`;
}

const report = {
  startedAt: new Date().toISOString(),
  base: BASE, api: API,
  accounts: { company: COMPANY.email, rival: RIVAL.email, super: SUPER.email },
  steps: [],
};

let cdp, proc, collector;
const tokens = {};

// ---------------------------------------------------------------------------
// helpers de UI
// ---------------------------------------------------------------------------
async function bodyText() {
  return evaluate(cdp, () => document.body.innerText);
}
async function pathName() {
  return evaluate(cdp, () => location.pathname);
}
async function waitPath(prefix, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await pathName();
    if (last.startsWith(prefix)) return last;
    await sleep(150);
  }
  throw new Error(`waitPath(${prefix}) timeout; last=${last}`);
}
async function waitFor(fn, arg, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await evaluate(cdp, fn, arg);
    if (last) return last;
    await sleep(150);
  }
  return last;
}
async function fillByName(name, value) {
  return evaluate(cdp, (n, v) => {
    const el = document.querySelector(`[name="${n}"]`);
    if (!el) return { ok: false, name: n };
    const proto = el instanceof window.HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, value: el.value };
  }, name, value);
}
async function clickAt(selector, scope = null) {
  const rect = await evaluate(cdp, (sel, sc) => {
    const root = sc ? document.querySelector(sc) : document;
    const el = root?.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector, scope);
  if (!rect) return false;
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
  await sleep(250);
  return true;
}
async function clickText(text, scope = null) {
  return evaluate(cdp, (t, sc) => {
    const root = sc ? document.querySelector(sc) : document;
    if (!root) return { clicked: false, reason: "no-scope" };
    const els = [...root.querySelectorAll("button, a")];
    const el = els.find((e) => (e.innerText ?? "").trim() === t);
    if (!el) return { clicked: false, candidates: els.map((e) => (e.innerText ?? "").trim()).slice(0, 20) };
    el.click();
    return { clicked: true };
  }, text, scope);
}
/** Radix Select: abre por ponteiro real e escolhe a opção por texto no portal. */
async function pickOption(triggerSelector, label, scope = null) {
  await clickAt(triggerSelector, scope);
  const picked = await evaluate(cdp, (text) => {
    const options = [...document.querySelectorAll("[role=option]")];
    const labels = options.map((o) => (o.innerText ?? "").trim());
    const target = options.find((o) => (o.innerText ?? "").trim() === text);
    if (!target) return { picked: false, options: labels };
    target.click();
    return { picked: true, options: labels };
  }, label);
  await sleep(300);
  return picked;
}
function readClaims() {
  return evaluate(cdp, () => {
    const raw = Object.keys(localStorage)
      .filter((k) => /auth-token/.test(k))
      .map((k) => localStorage.getItem(k))
      .find(Boolean);
    if (!raw) return null;
    let token = null;
    try {
      const parsed = JSON.parse(raw);
      token = parsed?.access_token ?? parsed?.currentSession?.access_token ?? null;
    } catch {
      return null;
    }
    if (!token) return null;
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return {
      user_role: payload.user_role ?? null,
      tenant_id: payload.tenant_id ?? null,
      must_change_password: payload.must_change_password ?? null,
      sub: payload.sub ?? null,
      token,
    };
  });
}
async function shot(name) {
  const p = join(SHOTS, name);
  await screenshot(cdp, p);
  return p;
}

// ---------------------------------------------------------------------------
// passos instrumentados
// ---------------------------------------------------------------------------
async function step(id, title, fn) {
  const mark = {
    req: collector.requests.size,
    console: collector.console.length,
    logs: collector.logs.length,
  };
  const entry = { id, title, startedAt: new Date().toISOString(), asserts: {} };
  try {
    const extra = await fn(entry);
    if (extra) entry.detail = extra;
    entry.ok = !Object.values(entry.asserts).some((v) => v === false);
  } catch (err) {
    entry.ok = false;
    entry.error = String(err?.stack ?? err);
  }
  entry.finishedAt = new Date().toISOString();
  entry.network = [...collector.requests.values()].slice(mark.req).map((r) => ({
    method: r.method, url: r.url, status: r.status, failed: r.failed, type: r.type,
  }));
  entry.console = collector.console.slice(mark.console);
  entry.logs = collector.logs.slice(mark.logs);
  report.steps.push(entry);
  console.log(`[${entry.ok ? "PASS" : "FAIL"}] ${id} - ${title}${entry.error ? " :: " + entry.error.split("\n")[0] : ""}`);
  return entry;
}
function check(entry, key, cond, detail) {
  entry.asserts[key] = Boolean(cond);
  if (detail !== undefined) {
    entry.details = entry.details ?? {};
    entry.details[key] = detail;
  }
  return Boolean(cond);
}

async function api(path, { method = "GET", token, apikey = ANON, body, headers = {} } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      apikey,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* texto puro */ }
  return { status: res.status, json, text };
}

// ---------------------------------------------------------------------------
async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const launched = await launch({
    width: 1280, height: 800,
    port: 9711,
    profileDir: join("/tmp/opencode/atlas-e2e", "chrome-profile"),
  });
  cdp = launched.cdp; proc = launched.proc;
  await newPage(cdp, "about:blank");
  await enable(cdp);
  collector = new Collector(cdp);
  await setViewport(cdp, 1280, 800, false, 1);
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });

  // -------------------------------------------------------------------------
  await step("01", "Cadastro da empresa pela UI em /cadastro", async (e) => {
    await goto(cdp, `${BASE}/cadastro`, { settle: 1200 });
    const form = await evaluate(cdp, () => ({
      path: location.pathname,
      hasTitle: /Criar conta da empresa/.test(document.body.innerText),
      fields: [...document.querySelectorAll("form input")].map((i) => i.getAttribute("name")),
      hasSegment: !!document.querySelector("[role=combobox]"),
      submit: [...document.querySelectorAll("button")].some((b) => (b.innerText ?? "").trim() === "Criar conta"),
    }));
    e.screenshot = await shot("e2e-01-cadastro.png");
    check(e, "form_rendered", form.hasTitle && form.hasSegment && form.submit, form);

    await fillByName("tradeName", COMPANY.trade);
    const pick = await pickOption("[role=combobox]", COMPANY.segment);
    check(e, "segment_picked", pick.picked, pick);
    await fillByName("email", COMPANY.email);
    await fillByName("password", COMPANY.password);
    await fillByName("confirmPassword", COMPANY.password);
    e.screenshotFilled = await shot("e2e-02-cadastro-preenchido.png");

    await clickText("Criar conta");
    e.pathAfter = await waitPath("/app", 40000);
    await sleep(1500);
    const claims = await readClaims();
    tokens.companySignup = claims?.token ?? null;
    const text = await bodyText();
    e.claims = claims ? { user_role: claims.user_role, tenant_id: claims.tenant_id, must_change_password: claims.must_change_password, sub: claims.sub } : null;
    e.screenshotAfter = await shot("e2e-03-app-dashboard.png");
    check(e, "landed_in_app", e.pathAfter.startsWith("/app") && !/Crie sua nova senha/.test(text), e.pathAfter);
    check(e, "claims_admin", claims?.user_role === "admin", claims?.user_role ?? null);
    check(e, "claims_tenant_uuid", typeof claims?.tenant_id === "string" && claims.tenant_id.length === 36, claims?.tenant_id ?? null);
    check(e, "claims_no_password_flag", claims?.must_change_password === false, claims?.must_change_password ?? null);
    check(e, "dashboard_rendered", /Dashboard|Agenda/.test(text));
    tokens.companyTenantId = claims?.tenant_id ?? null;

    // Contraprova no banco (service role): tenant, profile admin e templates da régua.
    if (SERVICE && claims?.tenant_id) {
      const tid = claims.tenant_id;
      const tenant = await api(`/rest/v1/tenants?select=id,trade_name,segment,plan,subscription_status,owner_email&id=eq.${tid}`, { apikey: SERVICE, token: SERVICE });
      const profiles = await api(`/rest/v1/profiles?select=id,role,tenant_id&tenant_id=eq.${tid}`, { apikey: SERVICE, token: SERVICE });
      const templates = await api(`/rest/v1/message_templates?select=template_key&tenant_id=eq.${tid}`, { apikey: SERVICE, token: SERVICE });
      const allTenants = await api(`/rest/v1/tenants?select=id`, { apikey: SERVICE, token: SERVICE });
      e.db = {
        tenant: tenant.json,
        profiles: profiles.json,
        templates: (templates.json ?? []).map((t) => t.template_key).sort(),
        tenantCount: Array.isArray(allTenants.json) ? allTenants.json.length : allTenants.status,
      };
      check(e, "db_tenant_created",
        Array.isArray(tenant.json) && tenant.json.length === 1 &&
        tenant.json[0].segment === "clinica" && tenant.json[0].subscription_status === "trial",
        e.db.tenant);
      check(e, "db_single_tenant_no_orphan", e.db.tenantCount === 1, e.db.tenantCount);
      check(e, "db_profile_admin",
        Array.isArray(profiles.json) && profiles.json.length === 1 &&
        profiles.json[0].role === "admin" && profiles.json[0].tenant_id === tid,
        e.db.profiles);
      check(e, "db_five_templates", e.db.templates.length === 5, e.db.templates);
    }
    // 403 de papel: admin de empresa não passa no gate do admin-subscription.
    if (tokens.companySignup && tokens.companyTenantId) {
      const denied = await api("/functions/v1/admin-subscription", {
        method: "POST",
        token: tokens.companySignup,
        body: { action: "set_status", tenantId: tokens.companyTenantId, status: "ativo" },
      });
      e.roleGate = { status: denied.status, body: denied.json };
      check(e, "admin_subscription_company_admin_403", denied.status === 403, denied.status);
    }
    return null;
  });

  // -------------------------------------------------------------------------
  await step("02", "Páginas do tenant: /app/agenda, /app/clientes, /app/config", async (e) => {
    const pages = [
      { path: "/app/agenda", expect: "Agenda", shot: "e2e-04-app-agenda.png" },
      { path: "/app/clientes", expect: "Clientes", shot: "e2e-05-app-clientes.png" },
      { path: "/app/config", expect: "Configurações", shot: "e2e-06-app-config.png" },
    ];
    e.results = [];
    for (const p of pages) {
      await goto(cdp, `${BASE}${p.path}`, { settle: 1400 });
      const info = await evaluate(cdp, (expected) => ({
        path: location.pathname,
        hasHeading: new RegExp(expected, "i").test(document.body.innerText),
        hasErrorPanel: /Não foi possível carregar|Acesso restrito|404/.test(document.body.innerText),
        bodyLen: document.body.innerText.length,
        heading: [...document.querySelectorAll("h1")].map((h) => h.innerText).slice(0, 3),
      }), p.expect);
      const s = await shot(p.shot);
      e.results.push({ ...p, ...info, screenshot: s });
      check(e, `page_${p.path.replace(/\//g, "_")}`, info.path === p.path && info.hasHeading && info.bodyLen > 40, info);
    }
    return null;
  });

  // -------------------------------------------------------------------------
  await step("03", "Admin de empresa não acessa /admin (403 na UI)", async (e) => {
    await goto(cdp, `${BASE}/admin`, { settle: 1200 });
    await sleep(800);
    const info = await evaluate(cdp, () => ({
      path: location.pathname,
      text: document.body.innerText,
      has403: /erro 403/i.test(document.body.innerText),
      hasAccessDenied: /Acesso restrito/.test(document.body.innerText),
      hasEmpresasTable: !!document.querySelector("table"),
    }));
    e.screenshot = await shot("e2e-07-admin-403.png");
    e.info = { path: info.path, has403: info.has403, hasAccessDenied: info.hasAccessDenied, hasEmpresasTable: info.hasEmpresasTable };
    check(e, "ui_403", info.has403 && info.hasAccessDenied, e.info);
    check(e, "no_admin_table", info.hasEmpresasTable === false, info.hasEmpresasTable);
    return null;
  });

  // -------------------------------------------------------------------------
  await step("04", "Bootstrap do super admin (Edge Function bootstrap-super-admin)", async (e) => {
    const wrong = await api("/functions/v1/bootstrap-super-admin", {
      method: "POST", headers: { "x-bootstrap-secret": "errado" },
      body: { anything: true },
    });
    const get = await api("/functions/v1/bootstrap-super-admin", { method: "GET", headers: { "x-bootstrap-secret": BOOTSTRAP_SECRET } });
    const created = await api("/functions/v1/bootstrap-super-admin", {
      method: "POST", headers: { "x-bootstrap-secret": BOOTSTRAP_SECRET },
      body: {},
    });
    e.responses = {
      wrongSecret: { status: wrong.status, body: wrong.json },
      getMethod: { status: get.status, body: get.json },
      created: { status: created.status, body: created.json },
    };
    check(e, "wrong_secret_401", wrong.status === 401, wrong.status);
    check(e, "get_405", get.status === 405, get.status);
    check(e, "created_201", created.status === 201 && created.json?.status === "criado", created.json);
    tokens.superId = created.json?.user_id ?? null;

    // Contraprova no banco (service role): profile super_admin sem tenant + flag de troca.
    if (SERVICE && tokens.superId) {
      const profile = await api(`/rest/v1/profiles?select=role,tenant_id&id=eq.${tokens.superId}`, { apikey: SERVICE, token: SERVICE });
      const user = await api(`/auth/v1/admin/users/${tokens.superId}`, { apikey: SERVICE, token: SERVICE });
      e.db = {
        profile: profile.json,
        must_change_password: user.json?.app_metadata?.must_change_password ?? null,
      };
      check(e, "profile_super_admin_no_tenant",
        Array.isArray(profile.json) && profile.json.length === 1 &&
        profile.json[0].role === "super_admin" && profile.json[0].tenant_id === null, e.db.profile);
      check(e, "app_metadata_flag_true", e.db.must_change_password === true, e.db.must_change_password);
    }
    return null;
  });

  // -------------------------------------------------------------------------
  await step("05", "Login do super admin com a senha provisória cai em /trocar-senha", async (e) => {
    // A tela 403 de /admin não tem o botão "Sair"; volta ao /app (área do papel) e sai de lá.
    await goto(cdp, `${BASE}/app`, { settle: 1200 });
    await clickText("Sair");
    await waitPath("/login", 20000);
    await sleep(600);
    await fillByName("email", SUPER.email);
    await fillByName("password", SUPER.provisional);
    await clickText("Entrar");
    e.pathAfter = await waitPath("/trocar-senha", 30000);
    await sleep(900);
    const info = await evaluate(cdp, () => ({
      path: location.pathname,
      title: /Crie sua nova senha/.test(document.body.innerText),
      badge: /Primeiro acesso/.test(document.body.innerText),
      adminContent: /Empresas assinantes|Mudar status/.test(document.body.innerText),
      account: /admin@neox\.com\.br/.test(document.body.innerText),
      passwordFields: document.querySelectorAll("input[type=password]").length,
    }));
    const claims = await readClaims();
    tokens.superProvisional = claims?.token ?? null;
    e.info = info;
    e.claims = claims ? { user_role: claims.user_role, tenant_id: claims.tenant_id, must_change_password: claims.must_change_password } : null;
    e.screenshot = await shot("e2e-08-trocar-senha.png");
    check(e, "path_trocar_senha", info.path === "/trocar-senha", info.path);
    check(e, "title_first_access", info.title && info.badge, info);
    check(e, "no_admin_content", info.adminContent === false, info.adminContent);
    check(e, "claims_super_flag_true", claims?.user_role === "super_admin" && claims?.must_change_password === true, e.claims);

    // 403 por flag (gate do servidor) ANTES de trocar a senha.
    if (tokens.superProvisional && tokens.companyTenantId) {
      const flagDenied = await api("/functions/v1/admin-subscription", {
        method: "POST", token: tokens.superProvisional,
        body: { action: "set_status", tenantId: tokens.companyTenantId, status: "ativo" },
      });
      e.flagGate = { status: flagDenied.status, body: flagDenied.json };
      check(e, "admin_subscription_flag_403",
        flagDenied.status === 403 && flagDenied.json?.code === "password_change_required",
        e.flagGate);
    }
    return null;
  });

  // -------------------------------------------------------------------------
  await step("06", "Troca de senha pela UI -> sessão nova -> /admin/empresas", async (e) => {
    await fillByName("password", SUPER.password);
    await fillByName("confirmPassword", SUPER.password);
    await clickText("Salvar nova senha");
    e.pathAfter = await waitPath("/admin/empresas", 40000);
    await sleep(1500);
    const info = await evaluate(cdp, () => ({
      path: location.pathname,
      heading: document.body.innerText.includes("Empresas"),
      bodyLen: document.body.innerText.length,
    }));
    const claims = await readClaims();
    tokens.superFinal = claims?.token ?? null;
    e.info = info;
    e.claims = claims ? { user_role: claims.user_role, tenant_id: claims.tenant_id, must_change_password: claims.must_change_password, sub: claims.sub } : null;
    e.screenshot = await shot("e2e-09-admin-empresas.png");
    check(e, "path_admin_empresas", info.path === "/admin/empresas", info.path);
    check(e, "claims_super_flag_false", claims?.user_role === "super_admin" && claims?.must_change_password === false, e.claims);
    check(e, "content_rendered", info.heading && info.bodyLen > 100, info);
    return null;
  });

  // -------------------------------------------------------------------------
  await step("07", "Super admin lista empresas e muda status (200, badge novo)", async (e) => {
    const list = await evaluate(cdp, () => {
      const rows = [...document.querySelectorAll("table tbody tr")].map((tr) => tr.innerText.replace(/\s+/g, " ").trim());
      return { rows, hasCompany: rows.some((r) => r.includes("Atlas QA E2E")) };
    });
    e.list = list;
    check(e, "list_has_created_company", list.hasCompany, list.rows);

    const opened = await evaluate(cdp, () => {
      const rows = [...document.querySelectorAll("table tbody tr")];
      const row = rows.find((tr) => tr.innerText.includes("Atlas QA E2E"));
      if (!row) return { opened: false };
      const btn = [...row.querySelectorAll("button")].find((b) => (b.innerText ?? "").trim() === "Mudar status");
      if (!btn) return { opened: false, buttons: [...row.querySelectorAll("button")].map((b) => b.innerText.trim()) };
      btn.click();
      return { opened: true };
    });
    await sleep(500);
    const dialog = await evaluate(cdp, () => {
      const d = document.querySelector("[role=dialog]");
      return d ? { present: true, title: d.querySelector("h2")?.innerText ?? "", text: d.innerText.slice(0, 200) } : { present: false };
    });
    e.dialog = dialog;
    check(e, "dialog_opened", opened.opened && dialog.present, { opened, dialog });

    const picked = await pickOption("[role=combobox]", "Ativo", "[role=dialog]");
    e.options = picked.options ?? [];
    check(e, "transitions_offered", picked.picked === true && (picked.options ?? []).length > 0, picked);

    const selected = await evaluate(cdp, () => document.querySelector("[role=dialog] [role=combobox]")?.innerText?.trim() ?? null);
    check(e, "status_selected", selected === "Ativo", selected);
    await evaluate(cdp, () => {
      const d = document.querySelector("[role=dialog]");
      const ta = d?.querySelector("textarea");
      if (!ta) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      setter.call(ta, "QA E2E: ativacao da empresa criada pela UI.");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    });
    e.screenshotDialog = await shot("e2e-10-mudar-status-dialog.png");

    await clickText("Salvar alteração", "[role=dialog]");
    const toast = await waitFor(() => (/Assinatura atualizada/.test(document.body.innerText) ? "Assinatura atualizada." : null), null, 15000);
    await sleep(1200);
    const after = await evaluate(cdp, () => {
      const rows = [...document.querySelectorAll("table tbody tr")];
      const row = rows.find((tr) => tr.innerText.includes("Atlas QA E2E"));
      const dialogStill = !!document.querySelector("[role=dialog]");
      return { row: row?.innerText.replace(/\s+/g, " ").trim() ?? null, dialogStill, badge: row?.innerText.includes("Ativo") ?? false };
    });
    e.screenshotAfter = await shot("e2e-11-status-atualizado.png");
    e.after = after;
    check(e, "toast_success", Boolean(toast), toast);
    check(e, "badge_ativo", after.badge, after);
    check(e, "dialog_closed", after.dialogStill === false, after.dialogStill);
    return null;
  });

  // -------------------------------------------------------------------------
  await step("08", "Logout e re-login do super admin com a senha nova", async (e) => {
    await clickText("Sair");
    await waitPath("/login", 20000);
    await sleep(600);
    const oldPassword = await api("/auth/v1/token?grant_type=password", {
      method: "POST", body: { email: SUPER.email, password: SUPER.provisional },
    });
    e.oldPassword = { status: oldPassword.status, code: oldPassword.json?.error_code ?? null };
    check(e, "old_password_rejected", oldPassword.status === 400, e.oldPassword);

    await fillByName("email", SUPER.email);
    await fillByName("password", SUPER.password);
    await clickText("Entrar");
    e.pathAfter = await waitPath("/admin/empresas", 30000);
    await sleep(1200);
    await goto(cdp, `${BASE}/admin`, { settle: 1200 });
    const adminIdx = await pathName();
    const list = await evaluate(cdp, () => ({
      rows: [...document.querySelectorAll("table tbody tr")].length,
      bodyLen: document.body.innerText.length,
    }));
    e.screenshot = await shot("e2e-12-relogin-admin.png");
    e.adminIndex = adminIdx;
    check(e, "relogin_admin", e.pathAfter === "/admin/empresas", e.pathAfter);
    check(e, "admin_index_redirect", adminIdx === "/admin/empresas", adminIdx);
    check(e, "list_rendered", list.rows >= 1 && list.bodyLen > 100, list);
    return null;
  });

  // -------------------------------------------------------------------------
  await step("09", "Admin de empresa continua funcionando em /app e é barrado em /admin", async (e) => {
    await clickText("Sair");
    await waitPath("/login", 20000);
    await sleep(600);
    await fillByName("email", COMPANY.email);
    await fillByName("password", COMPANY.password);
    await clickText("Entrar");
    e.pathAfter = await waitPath("/app", 30000);
    await sleep(1200);
    await goto(cdp, `${BASE}/app/agenda`, { settle: 1400 });
    const agenda = await evaluate(cdp, () => ({
      path: location.pathname,
      heading: /Agenda/.test(document.body.innerText),
      errorPanel: /Não foi possível carregar/.test(document.body.innerText),
    }));
    const claims = await readClaims();
    tokens.companyFinal = claims?.token ?? null;
    e.screenshot = await shot("e2e-13-empresa-app-agenda.png");
    await goto(cdp, `${BASE}/admin`, { settle: 1200 });
    const denied = await evaluate(cdp, () => ({
      path: location.pathname,
      has403: /erro 403/i.test(document.body.innerText) && /Acesso restrito/.test(document.body.innerText),
    }));
    e.screenshotDenied = await shot("e2e-14-empresa-admin-403.png");
    e.agenda = agenda;
    e.denied = denied;
    check(e, "company_app_ok", e.pathAfter.startsWith("/app") && agenda.path === "/app/agenda" && agenda.heading, agenda);
    check(e, "company_still_blocked_from_admin", denied.has403, denied);
    check(e, "claims_still_admin", claims?.user_role === "admin" && claims?.must_change_password === false, claims && { role: claims.user_role, flag: claims.must_change_password });
    return null;
  });

  // -------------------------------------------------------------------------
  await step("10", "RLS: admin de empresa x super admin (isolamento e visão ampla)", async (e) => {
    const rivalSignup = await api("/functions/v1/signup-tenant", {
      method: "POST",
      body: {
        email: RIVAL.email, password: RIVAL.password, trade_name: RIVAL.trade,
        document: uniqueValidCpf(), phone_empresa: "(11) 98765-4321",
        address_cep: "01310-100", address_street: "Avenida Paulista", address_number: "1000",
        address_city: "Sao Paulo", address_state: "SP", full_name: "Dono Rival",
        segment: "barbearia",
      },
    });
    e.rivalSignup = { status: rivalSignup.status, body: rivalSignup.json };
    check(e, "rival_created", rivalSignup.status === 201, rivalSignup.status);

    let rivalTenantId = null;
    if (SERVICE) {
      const rival = await api(`/rest/v1/tenants?select=id,trade_name,owner_email&owner_email=eq.${encodeURIComponent(RIVAL.email)}`, { apikey: SERVICE, token: SERVICE });
      rivalTenantId = rival.json?.[0]?.id ?? null;
      e.rivalTenant = rival.json?.[0] ?? null;
      if (rivalTenantId) {
        const seed = await api("/rest/v1/customers", {
          method: "POST", apikey: SERVICE, token: SERVICE,
          headers: { prefer: "return=representation" },
          body: { tenant_id: rivalTenantId, name: "Cliente Rival QA", phone: "+5511999998888", whatsapp_opt_in: false },
        });
        e.rivalCustomerSeed = { status: seed.status, id: seed.json?.[0]?.id ?? null };
        check(e, "rival_customer_seeded", seed.status === 201, seed.status);
      }
    }
    check(e, "rival_tenant_found", Boolean(rivalTenantId), rivalTenantId);

    const loginCompany = await api("/auth/v1/token?grant_type=password", {
      method: "POST", body: { email: COMPANY.email, password: COMPANY.password },
    });
    const loginSuper = await api("/auth/v1/token?grant_type=password", {
      method: "POST", body: { email: SUPER.email, password: SUPER.password },
    });
    const companyToken = loginCompany.json?.access_token ?? null;
    const superToken = loginSuper.json?.access_token ?? null;
    check(e, "api_login_company", Boolean(companyToken), loginCompany.status);
    check(e, "api_login_super", Boolean(superToken), loginSuper.status);

    const asCompany = (path) => api(path, { token: companyToken });
    const asSuper = (path) => api(path, { token: superToken });

    const companyTenants = await asCompany("/rest/v1/tenants?select=id,trade_name");
    const superTenants = await asSuper("/rest/v1/tenants?select=id,trade_name");
    const companyTenantRows = Array.isArray(companyTenants.json) ? companyTenants.json : [];
    const superTenantRows = Array.isArray(superTenants.json) ? superTenants.json : [];

    const companyTenantId = tokens.companyTenantId;
    const foreignRead = await asCompany(`/rest/v1/tenants?select=id&id=eq.${rivalTenantId}`);
    const companyCustomers = await asCompany("/rest/v1/customers?select=id,tenant_id");
    const companyProfiles = await asCompany("/rest/v1/profiles?select=id,tenant_id,role");
    const foreignWrite = await api(`/rest/v1/tenants?id=eq.${rivalTenantId}`, {
      method: "PATCH", token: companyToken,
      headers: { prefer: "return=representation" },
      body: { trade_name: "HACKED" },
    });

    e.rls = {
      companyTenants: companyTenantRows,
      superTenantCount: superTenantRows.length,
      superHasBoth: superTenantRows.some((t) => t.trade_name === COMPANY.trade) &&
        superTenantRows.some((t) => t.trade_name === RIVAL.trade),
      foreignTenantReadRows: Array.isArray(foreignRead.json) ? foreignRead.json.length : foreignRead.status,
      companyCustomerRows: Array.isArray(companyCustomers.json) ? companyCustomers.json.length : companyCustomers.status,
      companyProfileTenants: Array.isArray(companyProfiles.json)
        ? [...new Set(companyProfiles.json.map((p) => p.tenant_id))] : companyProfiles.status,
      foreignWriteStatus: foreignWrite.status,
      foreignWriteRows: Array.isArray(foreignWrite.json) ? foreignWrite.json.length : null,
    };

    check(e, "company_sees_only_own_tenant",
      companyTenantRows.length === 1 && companyTenantRows[0].id === companyTenantId,
      e.rls.companyTenants);
    check(e, "company_cannot_read_foreign_tenant",
      Array.isArray(foreignRead.json) && foreignRead.json.length === 0,
      e.rls.foreignTenantReadRows);
    check(e, "company_sees_no_foreign_customer",
      Array.isArray(companyCustomers.json) && companyCustomers.json.length === 0,
      e.rls.companyCustomerRows);
    check(e, "company_profiles_scoped_to_own_tenant",
      Array.isArray(e.rls.companyProfileTenants) && e.rls.companyProfileTenants.length === 1 &&
      e.rls.companyProfileTenants[0] === companyTenantId,
      e.rls.companyProfileTenants);
    check(e, "company_cannot_write_foreign_tenant",
      e.rls.foreignWriteRows === 0 || e.rls.foreignWriteStatus >= 400,
      { status: e.rls.foreignWriteStatus, rows: e.rls.foreignWriteRows });
    check(e, "super_admin_sees_all_tenants",
      e.rls.superTenantCount >= 2 && e.rls.superHasBoth,
      { count: e.rls.superTenantCount, rows: superTenantRows });
    return null;
  });

  // -------------------------------------------------------------------------
  const all = collector.problems();
  const network = collector.networkList();
  const failed = network.filter((r) => (r.status ?? 0) >= 400 || r.failed);
  report.consoleAll = all;
  report.networkSummary = {
    total: network.length,
    byStatus: network.reduce((acc, r) => {
      const key = r.failed ? `FAIL:${r.failed}` : String(r.status);
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
    failed,
  };
  report.finishedAt = new Date().toISOString();
  report.ok = report.steps.every((s) => s.ok);
  writeFileSync(join(OUT, "e2e-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    ok: report.ok,
    steps: report.steps.map((s) => ({ id: s.id, ok: s.ok, asserts: s.asserts })),
    console: all,
    networkFailed: failed,
  }, null, 2));
}

main()
  .catch((err) => {
    report.error = String(err?.stack ?? err);
    try {
      report.completedPartial = true;
      writeFileSync(join(OUT, "e2e-report.json"), JSON.stringify(report, null, 2));
    } catch {}
    console.error("FALHOU:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (proc) await closeBrowser(proc);
  });
