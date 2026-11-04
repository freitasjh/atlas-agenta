// D1 do QA da ADR-14 — cadastro de empresa PELA UI.
//
// Percorre /cadastro como usuário (nome, ramo, e-mail, senha, confirmação),
// envia, e registra: destino final, claims do token criado, console e rede.
// A verificação de banco (tenant, profile admin, 5 templates) é feita depois
// pela wrapper, com SQL — este script só produz a evidência de UI.
//
// Uso:
//   node harness/qa/tools/check-signup.mjs --label 1280x800-light --width 1280 \
//     --height 800 --theme light --email qa-ui@teste.local --password '...' \
//     --company 'QA UI Ltda' --segment clinica
import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  launch, newPage, enable, setViewport, goto, evaluate, screenshot,
  sleep, closeBrowser, Collector,
} from "./cdp.mjs";

const ROOT = resolve(process.cwd());
const OUT = process.env.QA_OUT ?? join(ROOT, "harness/qa");
const SHOTS = join(OUT, "screenshots");
const BASE = process.env.QA_BASE_URL ?? "http://127.0.0.1:5174";

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  if (process.argv[i].startsWith("--")) args[process.argv[i].slice(2)] = process.argv[i + 1];
}
const label = args.label;
const width = Number(args.width);
const height = Number(args.height);
const theme = args.theme ?? "light";
const email = args.email;
const password = args.password;
const company = args.company ?? "QA UI Ltda";
const segment = args.segment ?? "clinica";

const evidence = { label, viewport: `${width}x${height}`, theme, email, company, segment, startedAt: new Date().toISOString() };

let cdp;
let collector;
let proc;

async function clickAt(selector) {
  const rect = await evaluate(cdp, (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
  if (!rect) return false;
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
  await sleep(250);
  return true;
}

async function pickSegment(label) {
  // Radix Select: abre por ponteiro real (o componente escuta pointerdown) e
  // escolhe a opção no portal por texto.
  await clickAt("[role=combobox]");
  const picked = await evaluate(cdp, (text) => {
    const options = [...document.querySelectorAll("[role=option]")];
    const target = options.find((o) => (o.innerText ?? "").trim() === text);
    if (!target) return { clicked: false, options: options.map((o) => (o.innerText ?? "").trim()) };
    target.click();
    return { clicked: true };
  }, label);
  await sleep(300);
  return picked;
}

async function fillField(name, value) {
  return evaluate(cdp, (fieldName, fieldValue) => {
    const el = document.querySelector(`[name="${fieldName}"]`);
    if (!el) return { ok: false, field: fieldName };
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, fieldValue);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, value: el.value };
  }, name, value);
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
    };
  });
}

async function waitPath(prefix, timeout = 25000) {
  const deadline = Date.now() + timeout;
  let last = null;
  while (Date.now() < deadline) {
    last = await evaluate(cdp, () => location.pathname);
    if (last.startsWith(prefix)) return last;
    await sleep(150);
  }
  return last;
}

async function run() {
  mkdirSync(SHOTS, { recursive: true });
  const launched = await launch({
    width, height, port: 9500 + Math.floor(Math.random() * 200),
    profileDir: join("/tmp/opencode/atlas-qa", `signup-${label}`),
  });
  cdp = launched.cdp; proc = launched.proc;
  await newPage(cdp, "about:blank");
  await enable(cdp);
  collector = new Collector(cdp);
  await setViewport(cdp, width, height, width < 500, 1);
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `try { localStorage.setItem("atlas-agenda-theme", ${JSON.stringify(theme)}); } catch (e) {}`,
  });

  await goto(cdp, `${BASE}/cadastro`);
  const form = await evaluate(cdp, () => ({
    path: location.pathname,
    title: /Criar conta da empresa/.test(document.body.innerText),
    inputs: [...document.querySelectorAll("form input")].map((i) => i.getAttribute("name")),
    autoFocus: document.activeElement === document.body
      ? "BODY"
      : `${document.activeElement?.tagName}:${document.activeElement?.getAttribute("name") ?? ""}`,
    horizontal: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    },
  }));
  await screenshot(cdp, join(SHOTS, `${label}-d1-01-cadastro.png`));

  await fillField("tradeName", company);
  const segmentPick = await pickSegment(
    { clinica: "Clínica", barbearia: "Barbearia", salao: "Salão de beleza" }[segment] ?? "Clínica",
  );
  await fillField("email", email);
  await fillField("password", password);
  await fillField("confirmPassword", password);

  const beforeSubmit = await evaluate(cdp, () => ({
    values: [...document.querySelectorAll("form input")].map((i) => i.getAttribute("name") + ":" + (i.value ? "preenchido" : "vazio")),
    segment: document.querySelector("[role=combobox]")?.innerText?.trim() ?? null,
  }));
  await screenshot(cdp, join(SHOTS, `${label}-d1-02-cadastro-preenchido.png`));

  const clicked = await evaluate(cdp, () => {
    const btn = [...document.querySelectorAll("button")].find((b) => (b.innerText ?? "").trim() === "Criar conta");
    if (!btn) return { clicked: false, labels: [...document.querySelectorAll("button")].map((b) => b.innerText.trim()) };
    btn.click();
    return { clicked: true };
  });

  const path = await waitPath("/app", 30000);
  await sleep(1200);
  const finalPath = await evaluate(cdp, () => location.pathname);
  const text = await evaluate(cdp, () => document.body.innerText);
  const claims = await readClaims();
  await screenshot(cdp, join(SHOTS, `${label}-d1-03-app.png`));

  evidence.form = form;
  evidence.segmentPick = segmentPick;
  evidence.beforeSubmit = beforeSubmit;
  evidence.clicked = clicked;
  evidence.pathAfter = path;
  evidence.finalPath = finalPath;
  evidence.claims = claims;
  evidence.landedInApp = finalPath.startsWith("/app") && !/Crie sua nova senha/.test(text);
  evidence.problems = collector.problems();
  evidence.failures = collector.failures();
  evidence.finishedAt = new Date().toISOString();
  evidence.pass =
    form.title &&
    clicked.clicked === true &&
    evidence.landedInApp &&
    claims?.user_role === "admin" &&
    typeof claims?.tenant_id === "string" &&
    claims.tenant_id.length === 36 &&
    claims.must_change_password === false;

  writeFileSync(join(OUT, `d1-signup-${label}.json`), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({
    label, pass: evidence.pass, finalPath, claims, problems: evidence.problems, failures: evidence.failures,
  }, null, 2));
}

run()
  .catch((err) => {
    evidence.error = String(err?.stack ?? err);
    try { writeFileSync(join(OUT, `d1-signup-${label}.json`), JSON.stringify(evidence, null, 2)); } catch {}
    console.error("FALHOU:", err);
    process.exitCode = 1;
  })
  .finally(async () => { if (proc) await closeBrowser(proc); });
