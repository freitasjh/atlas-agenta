// Runner do QA visual da ADR-14 — um cenário (viewport × tema) completo.
// Uso: node harness/qa-tools/run-combo.mjs --label 390x844-light --width 390 --height 844 --theme light
import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  launch, newPage, enable, setViewport, goto, evaluate, screenshot,
  pressKey, waitFor, sleep, closeBrowser, Collector,
} from "./cdp.mjs";

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, "harness/qa");
const SHOTS = join(OUT, "screenshots");
const BASE = process.env.QA_BASE_URL ?? "http://127.0.0.1:5174";
const PROVISIONAL = process.env.QA_PROVISIONAL_PASSWORD ?? "AtlasAgenda@123";
const NEW_PASSWORD = process.env.QA_NEW_PASSWORD ?? "NovaSenha@2026";
const TENANT_EMAIL = process.env.QA_TENANT_EMAIL ?? "qa-tenant-admin@teste.local";
const TENANT_PASSWORD = process.env.QA_TENANT_PASSWORD ?? "TenantAdmin@123";

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  if (process.argv[i].startsWith("--")) args[process.argv[i].slice(2)] = process.argv[i + 1];
}
const { label, width: widthArg, height: heightArg, theme } = args;
const width = Number(widthArg);
const height = Number(heightArg);

const evidence = {
  label, viewport: `${width}x${height}`, theme,
  startedAt: new Date().toISOString(),
  items: {}, technical: {}, contrast: {}, perf: {}, screenshots: [],
};

let cdp;
let collector;
let proc;

const record = (item, pass, data) => { evidence.items[item] = { pass, ...data }; };

async function shot(name) {
  const file = join(SHOTS, `${label}-${name}.png`);
  await screenshot(cdp, file);
  evidence.screenshots.push(file);
  return file;
}

const currentPath = () => evaluate(cdp, () => location.pathname + location.search);
const bodyText = () => evaluate(cdp, () => document.body.innerText);

async function fillPasswordFields(first, second) {
  return evaluate(cdp, (a, b) => {
    const inputs = [...document.querySelectorAll("input[type=password]")];
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    const apply = (el, value) => {
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return el.value;
    };
    const out = { count: inputs.length, values: [] };
    if (inputs[0] !== undefined) out.values.push(apply(inputs[0], a));
    if (inputs[1] !== undefined && b !== undefined && b !== null) out.values.push(apply(inputs[1], b));
    return out;
  }, first, second ?? first);
}

async function fillLogin(email, password) {
  return evaluate(cdp, (mail, pass) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    const apply = (el, value) => {
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const emailEl = document.querySelector("input[type=email]") ?? document.querySelector("input[name=email]");
    const passEl = document.querySelector("input[type=password]");
    if (!emailEl || !passEl) return { ok: false, inputs: document.querySelectorAll("input").length };
    apply(emailEl, mail);
    apply(passEl, pass);
    return { ok: true };
  }, email, password);
}

function clickText(text) {
  return evaluate(cdp, (labelText) => {
    const els = [...document.querySelectorAll("button, a")];
    const el = els.find((e) => (e.innerText ?? "").trim() === labelText);
    if (!el) return { clicked: false, candidates: els.map((e) => (e.innerText ?? "").trim()).slice(0, 25) };
    el.click();
    return { clicked: true, tag: el.tagName };
  }, text);
}

async function waitUrl(fragment, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const p = await currentPath();
    if (p.includes(fragment)) return p;
    await sleep(120);
  }
  return await currentPath();
}

async function submitWithEnter() {
  await evaluate(cdp, () => {
    const inputs = [...document.querySelectorAll("input[type=password]")];
    (inputs[1] ?? inputs[0]).focus();
  });
  await pressKey(cdp, "Enter");
}

async function tabOrder() {
  await evaluate(cdp, () => { document.activeElement?.blur?.(); document.body.focus(); });
  const seq = [];
  for (let i = 0; i < 5; i += 1) {
    await pressKey(cdp, "Tab");
    seq.push(await evaluate(cdp, () => {
      const el = document.activeElement;
      if (!el || el === document.body) return { tag: "BODY" };
      const cs = getComputedStyle(el);
      return {
        tag: el.tagName,
        type: el.getAttribute("type"),
        text: (el.innerText ?? "").trim().slice(0, 30) || null,
        visible: (cs.boxShadow && cs.boxShadow !== "none") || (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0),
        boxShadow: cs.boxShadow,
      };
    }));
  }
  return seq;
}

async function measureTrocarSenha() {
  return evaluate(cdp, () => {
    const card = document.querySelector("[class*='rounded-lg'][class*='border']");
    const inputs = [...document.querySelectorAll("input[type=password]")];
    const buttons = [...document.querySelectorAll("button")];
    const form = document.querySelector("form");
    const submit = buttons.find((b) => (b.innerText ?? "").includes("Salvar nova senha"));
    const sair = buttons.find((b) => (b.innerText ?? "").trim() === "Sair");
    const doc = document.documentElement;
    const cardRect = card?.getBoundingClientRect();
    const cardPad = card ? parseFloat(getComputedStyle(card).paddingLeft) : 0;
    const styleOf = (el, prop) => (el ? getComputedStyle(el)[prop] : null);
    const title = [...document.querySelectorAll("h1,h2,h3,[class*='tracking-tight']")].find((e) => /Crie sua nova senha/.test(e.innerText));
    const desc = [...document.querySelectorAll("p")].find((e) => /provisória/.test(e.innerText));
    const active = document.activeElement;
    return {
      inputs: inputs.map((el) => ({
        fontSize: styleOf(el, "fontSize"),
        borderColor: styleOf(el, "borderColor"),
        ariaInvalid: el.getAttribute("aria-invalid"),
        describedBy: el.getAttribute("aria-describedby"),
      })),
      labels: [...document.querySelectorAll("label")].map((l) => ({
        text: l.innerText, htmlFor: l.htmlFor, target: !!document.getElementById(l.htmlFor),
      })),
      submit: submit ? {
        height: submit.getBoundingClientRect().height,
        width: submit.getBoundingClientRect().width,
        bg: styleOf(submit, "backgroundColor"),
        color: styleOf(submit, "color"),
      } : null,
      sair: sair ? { height: sair.getBoundingClientRect().height, color: styleOf(sair, "color") } : null,
      card: cardRect ? {
        left: cardRect.left, right: cardRect.right, width: cardRect.width, top: cardRect.top,
        contentWidth: cardRect.width - 2 * cardPad, bg: styleOf(card, "backgroundColor"),
      } : null,
      formWidth: form ? form.getBoundingClientRect().width : null,
      titleColor: title ? styleOf(title, "color") : null,
      descriptionColor: desc ? styleOf(desc, "color") : null,
      horizontal: { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, overflow: doc.scrollWidth - doc.clientWidth },
      sidePanels: { aside: document.querySelectorAll("aside").length, nav: document.querySelectorAll("nav").length },
      htmlClass: doc.className,
      colorScheme: doc.style.colorScheme,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      autoFocus: active && active !== document.body
        ? { tag: active.tagName, type: active.getAttribute("type") }
        : { tag: "BODY" },
    };
  });
}

async function measureContrast(state) {
  return evaluate(cdp, (st) => {
    const cssVar = (name) => {
      const probe = document.createElement("span");
      probe.style.color = `hsl(var(${name}))`;
      document.body.appendChild(probe);
      const rgb = getComputedStyle(probe).color;
      probe.remove();
      return rgb;
    };
    const parse = (value) => {
      const m = value?.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const parts = m[1].split(/[,/ ]+/).filter(Boolean).map(Number);
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    };
    const composite = (fg, bg) => ({
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
      a: 1,
    });
    const channel = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const lum = (c) => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
    const ratio = (a, b) => {
      const l1 = lum(a); const l2 = lum(b);
      const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
      return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
    };
    const card = document.querySelector("[class*='rounded-lg'][class*='border']");
    const cardBg = parse(getComputedStyle(card ?? document.body).backgroundColor);
    const title = [...document.querySelectorAll("h1,h2,h3,[class*='tracking-tight']")].find((e) => /Crie sua nova senha/.test(e.innerText));
    const mutedEls = [...document.querySelectorAll("[class*='text-muted-foreground']")].filter((e) => (e.innerText ?? "").trim().length > 10);
    const desc = mutedEls.find((e) => /provis/i.test(e.innerText)) ?? mutedEls[0];
    const submit = [...document.querySelectorAll("button")].find((b) => (b.innerText ?? "").includes("Salvar nova senha"));
    const input = document.querySelector("input[type=password]");
    const alert = document.querySelector("[role=alert]");
    const link = alert?.querySelector("a");
    const pairs = [];
    const push = (pair, fgColor, bgColor, minimum, note) => {
      if (!fgColor || !bgColor) return pairs.push({ pair, ratio: null, minimum, note: note ?? "elemento ausente" });
      pairs.push({
        pair, ratio: ratio(fgColor, bgColor), minimum, note: note ?? null,
        fg: `rgb(${Math.round(fgColor.r)},${Math.round(fgColor.g)},${Math.round(fgColor.b)})`,
        bg: `rgb(${Math.round(bgColor.r)},${Math.round(bgColor.g)},${Math.round(bgColor.b)})`,
      });
    };
    push("foreground/card", title ? parse(getComputedStyle(title).color) : null, cardBg, 4.5);
    push("muted-foreground/card", desc ? parse(getComputedStyle(desc).color) : null, cardBg, 4.5);
    if (submit) push("primary-foreground/primary", parse(getComputedStyle(submit).color), parse(getComputedStyle(submit).backgroundColor), 4.5);
    if (link) push("link primary/card", parse(getComputedStyle(link).color), cardBg, 4.5, "estado sessão expirada");
    else pairs.push({ pair: "link primary/card", ratio: null, minimum: 4.5, note: `estado=${st}: sem link na tela` });
    if (input) push("borda input/card", parse(getComputedStyle(input).borderColor), cardBg, 3, "1.4.11");
    push("anel/bg (token --ring)", parse(cssVar("--ring")), parse(cssVar("--background")), 3, "não textual");
    if (alert) {
      const composed = composite(parse(getComputedStyle(alert).backgroundColor), cardBg);
      push("foreground/fundo do alerta", parse(getComputedStyle(alert).color), composed, 4.5, "destructive a 10% composto no card");
    } else {
      pairs.push({ pair: "foreground/fundo do alerta", ratio: null, minimum: 4.5, note: `estado=${st}: sem alerta` });
    }
    push("destructive/card (token; tela sem ícone destructive)", parse(cssVar("--destructive")), cardBg, 3);
    push("primary/card (token)", parse(cssVar("--primary")), cardBg, 4.5);
    return { state: st, cardBg: getComputedStyle(card ?? document.body).backgroundColor, pairs };
  }, state);
}

async function waitPausedPost(timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const others = collector.paused.filter((p) => p.request.method !== "POST");
    for (const p of others) {
      collector.paused = collector.paused.filter((x) => x.requestId !== p.requestId);
      await cdp.send("Fetch.continueRequest", { requestId: p.requestId }).catch(() => {});
    }
    const post = collector.paused.find((p) => p.request.method === "POST");
    if (post) return post;
    await sleep(100);
  }
  return null;
}

/**
 * Intercepta o primeiro POST de change-password e aplica `action`.
 * O preflight OPTIONS é sempre liberado; se o POST já tiver sido resolvido
 * (Invalid InterceptionId), espera o próximo.
 */
async function interceptChangePasswordPost(action, timeout = 25000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const post = await waitPausedPost(Math.max(200, end - Date.now()));
    if (!post) return null;
    collector.paused = collector.paused.filter((x) => x.requestId !== post.requestId);
    try {
      await action(post);
      return post;
    } catch (err) {
      if (/Invalid InterceptionId/i.test(String(err))) continue;
      throw err;
    }
  }
  return null;
}

async function run() {
  mkdirSync(SHOTS, { recursive: true });
  const launched = await launch({
    width, height, profileDir: join("/tmp/opencode/atlas-qa", `profile-${label}`),
    port: 9400 + Math.floor(Math.random() * 200),
  });
  cdp = launched.cdp; proc = launched.proc;
  await newPage(cdp, "about:blank");
  await enable(cdp);
  collector = new Collector(cdp);
  // Console acumulado do cenário inteiro (o `resetConsole` por item não limpa
  // estes arrays): o critério "sem erro nem aviso" vale para a navegação toda,
  // não só para o último passo.
  const allConsole = { errors: [], warnings: [] };
  const allLogs = { errors: [], warnings: [] };
  cdp.on((msg) => {
    if (msg.method === "Runtime.consoleAPICalled") {
      const p = msg.params;
      const text = p.args?.map((a) => a.value ?? a.description ?? a.unserializableValue ?? "").join(" ") ?? "";
      if (p.type === "error") allConsole.errors.push(text);
      if (p.type === "warning") allConsole.warnings.push(text);
    }
    if (msg.method === "Log.entryAdded") {
      const e = msg.params.entry;
      if (e.level === "error") allLogs.errors.push(e.text);
      if (e.level === "warning") allLogs.warnings.push(e.text);
    }
  });
  await setViewport(cdp, width, height, width < 500, 1);
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `try { localStorage.setItem("atlas-agenda-theme", ${JSON.stringify(theme)}); } catch (e) {}`,
  });

  // Item 1 — sem sessão, rotas privadas vão para /login
  collector.resetConsole(); collector.resetNetwork();
  await goto(cdp, `${BASE}/app/agenda`);
  const p1a = await currentPath();
  await goto(cdp, `${BASE}/admin/empresas`);
  const p1b = await currentPath();
  await shot("01-login");
  evidence.technical.faviconFirstLoad = collector.networkList()
    .filter((r) => r.url.includes("favicon"))
    .map((r) => ({ url: r.url, status: r.status, failed: r.failed }));
  record(1, p1a.startsWith("/login") && p1b.startsWith("/login"), {
    agendaPath: p1a, adminPath: p1b, problems: collector.problems(), failures: collector.failures(),
  });

  // Item 2 — login do super admin com a senha provisória
  collector.resetConsole(); collector.resetNetwork();
  await goto(cdp, `${BASE}/login`);
  await fillLogin("admin@neox.com.br", PROVISIONAL);
  await clickText("Entrar");
  await sleep(1800);
  const p2 = await currentPath();
  const text2 = await bodyText();
  const dom2 = {
    title: /Crie sua nova senha/.test(text2),
    badge: /Primeiro acesso/.test(text2),
    adminContent: /Empresas|CNPJ|Nova empresa/.test(text2),
  };
  await shot("02-trocar-senha");
  const metrics = await measureTrocarSenha();
  const tabSeq = await tabOrder();
  const contrastNormal = await measureContrast("normal");
  record(2, p2.startsWith("/trocar-senha") && dom2.title && !dom2.adminContent, {
    path: p2, dom: dom2, metrics, tabOrder: tabSeq, problems: collector.problems(), failures: collector.failures(),
  });

  evidence.technical.layout = {
    viewport: `${width}x${height}`, themeClass: metrics.htmlClass,
    horizontalOverflowPx: metrics.horizontal.overflow,
    noHorizontalScroll: metrics.horizontal.overflow <= 0,
    inputFontSizes: metrics.inputs.map((i) => i.fontSize),
    inputsAtLeast16: metrics.inputs.every((i) => parseFloat(i.fontSize) >= 16),
    submitHeight: metrics.submit?.height ?? null,
    submitAtLeast44: (metrics.submit?.height ?? 0) >= 44,
    submitFillsCardContent: metrics.submit && metrics.formWidth
      ? Math.abs(metrics.submit.width - metrics.formWidth) < 2 : null,
    cardCentered: metrics.card ? Math.abs((metrics.card.left + metrics.card.right) / 2 - width / 2) < 2 : null,
    cardTop: metrics.card?.top ?? null,
    sidePanels: metrics.sidePanels,
    labelsBound: metrics.labels.every((l) => l.target),
    descriptionsBound: metrics.inputs.every((i) => !!i.describedBy),
    autoFocus: metrics.autoFocus,
    bodyBg: metrics.bodyBg, colorScheme: metrics.colorScheme,
    requirementScope: width < 500
      ? "390px: fonte>=16, botão>=44 e botão na largura do card são exigidos"
      : "1280px: fonte>=16 e botão>=44 não são exigidos (sm:text-sm / sm:h-10); card centralizado e sem painel lateral",
  };
  evidence.technical.layout.compliant = width < 500
    ? evidence.technical.layout.noHorizontalScroll
      && evidence.technical.layout.inputsAtLeast16
      && evidence.technical.layout.submitAtLeast44
      && evidence.technical.layout.submitFillsCardContent
    : evidence.technical.layout.noHorizontalScroll
      && evidence.technical.layout.cardCentered
      && metrics.sidePanels.aside === 0 && metrics.sidePanels.nav === 0;
  evidence.technical.tabOrder = tabSeq;
  evidence.technical.focusVisible = tabSeq.map((s) => ({ tag: s.tag, text: s.text, visible: s.visible }));
  evidence.contrast.normal = contrastNormal;

  // Item 3 — acesso direto permanece em /trocar-senha
  collector.resetConsole(); collector.resetNetwork();
  await goto(cdp, `${BASE}/admin/empresas`);
  const p3a = await currentPath();
  await goto(cdp, `${BASE}/app/agenda`);
  const p3b = await currentPath();
  record(3, p3a.startsWith("/trocar-senha") && p3b.startsWith("/trocar-senha"), {
    directAdmin: p3a, directApp: p3b, problems: collector.problems(),
  });

  // Item 4 — senha de 7 caracteres (Enter testado primeiro; clique como fallback de diagnóstico)
  collector.resetConsole(); collector.resetNetwork();
  await goto(cdp, `${BASE}/trocar-senha`);
  await fillPasswordFields("Abc1234");
  await submitWithEnter();
  await sleep(1000);
  const readP4 = () => evaluate(cdp, () => {
    const inputs = [...document.querySelectorAll("input[type=password]")];
    return {
      ariaInvalid: inputs.map((i) => i.getAttribute("aria-invalid")),
      messages: [...document.querySelectorAll("[id$='-form-item-message']")].map((e) => e.innerText.trim()).filter(Boolean),
      activeIsFirstPassword: document.activeElement === inputs[0],
      activeTag: document.activeElement?.tagName,
      activeType: document.activeElement?.getAttribute("type"),
    };
  });
  let p4 = await readP4();
  const enterSubmits = p4.messages.length > 0 || p4.ariaInvalid.some((v) => v === "true");
  if (!enterSubmits) {
    await clickText("Salvar nova senha");
    await sleep(1000);
    p4 = await readP4();
  }
  evidence.technical.enterSubmits = enterSubmits;
  await shot("03-erro-senha-curta");
  record(4, p4.ariaInvalid[0] === "true" && p4.messages.some((m) => m.includes("ao menos 8")) && p4.activeIsFirstPassword, {
    path: await currentPath(), evidence: p4, enterSubmits, problems: collector.problems(),
  });

  // Item 5 — senhas diferentes
  collector.resetConsole(); collector.resetNetwork();
  await fillPasswordFields(NEW_PASSWORD, `${NEW_PASSWORD}x`);
  await submitWithEnter();
  await sleep(900);
  const readP5 = () => evaluate(cdp, () => ({
    messages: [...document.querySelectorAll("[id$='-form-item-message']")].map((e) => e.innerText.trim()).filter(Boolean),
  }));
  let p5 = await readP5();
  if (!p5.messages.some((m) => m.includes("coincidem"))) {
    await clickText("Salvar nova senha");
    await sleep(900);
    p5 = await readP5();
  }
  record(5, p5.messages.some((m) => m.includes("As senhas não coincidem.")), {
    path: await currentPath(), evidence: p5, problems: collector.problems(),
  });

  // Item 7 — sessão expirada (401) [antes do sucesso, para não consumir a troca]
  // O 401 é injetado na resposta da Edge Function (Fetch.fulfillRequest), sem
  // adulterar a sessão: assim o estado de login continua válido para os itens 8 e 6.
  collector.resetConsole(); collector.resetNetwork();
  await goto(cdp, `${BASE}/trocar-senha`);
  await fillPasswordFields(NEW_PASSWORD);
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*change-password*", requestStage: "Request" }] });
  await clickText("Salvar nova senha");
  const pausedPost = await interceptChangePasswordPost(async (post) => {
    await cdp.send("Fetch.fulfillRequest", {
      requestId: post.requestId,
      responseCode: 401,
      responseHeaders: [
        { name: "content-type", value: "application/json" },
        { name: "access-control-allow-origin", value: new URL(BASE).origin },
        { name: "access-control-allow-headers", value: "authorization, apikey, content-type, x-client-info" },
      ],
      body: Buffer.from(JSON.stringify({ code: "unauthenticated", message: "Sessão inválida ou expirada." })).toString("base64"),
    });
  }, 25000);
  const p7fulfilled = pausedPost !== null;
  await cdp.send("Fetch.disable", {});
  await waitFor(cdp, () => !!document.querySelector("[role=alert]"), { timeout: 15000 });
  const p7 = await evaluate(cdp, () => {
    const alert = document.querySelector("[role=alert]");
    const link = alert?.querySelector("a");
    return { alertText: alert?.innerText ?? null, linkText: link?.innerText ?? null, linkHref: link?.getAttribute("href") ?? null };
  });
  const statuses7 = collector.networkList()
    .filter((r) => r.url.includes("change-password") && r.method === "POST")
    .map((r) => r.status);
  evidence.contrast.expired = await measureContrast("sessao-expirada");
  await shot("04-sessao-expirada");
  record(7, /Sua sessão expirou\. Entre novamente\./.test(p7.alertText ?? "") && p7.linkHref === "/login" && (statuses7.includes(401) || p7fulfilled), {
    path: await currentPath(), evidence: p7, intercepted: p7fulfilled, changePasswordStatuses: statuses7, problems: collector.problems(),
  });

  // Item 8 — rede desligada
  collector.resetConsole(); collector.resetNetwork();
  await goto(cdp, `${BASE}/trocar-senha`);
  const formReady = await evaluate(cdp, () => ({
    passwords: document.querySelectorAll("input[type=password]").length,
    path: location.pathname,
  }));
  if (formReady.passwords !== 2) {
    record(8, false, { path: formReady.path, note: "formulário ausente: a troca anterior já limpou a flag", problems: collector.problems() });
  } else {
  // Rede desligada simulada por falha de rede determinística no CDP
  // (Fetch.failRequest + InternetDisconnected), equivalente ao modo offline.
  await fillPasswordFields(NEW_PASSWORD);
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*change-password*", requestStage: "Request" }] });
  await clickText("Salvar nova senha");
  const offlinePost = await interceptChangePasswordPost(async (post) => {
    await cdp.send("Fetch.failRequest", { requestId: post.requestId, errorReason: "InternetDisconnected" });
  }, 25000);
  await cdp.send("Fetch.disable", {});
  const offlineAlert = await waitFor(cdp, () => document.querySelector("[role=alert]")?.innerText ?? null, { timeout: 20000 });
  await sleep(500);
  const p8 = await evaluate(cdp, () => {
    const btn = [...document.querySelectorAll("button")].find((b) => (b.innerText ?? "").trim().startsWith("Salvar"));
    return { alertText: document.querySelector("[role=alert]")?.innerText ?? null, buttonDisabled: btn?.disabled ?? null, buttonText: btn?.innerText?.trim() ?? null };
  });
  await shot("05-rede-offline");
  record(8, /Não foi possível salvar a nova senha\. Tente novamente\./.test(p8.alertText ?? "") && p8.buttonDisabled === false, {
    path: await currentPath(), evidence: { ...p8, offlineAlert }, problems: collector.problems(),
  });
  }

  // Item 6 — duplo clique: uma requisição; botão disabled durante a chamada
  collector.resetConsole(); collector.resetNetwork();
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*change-password*", requestStage: "Request" }] });
  const doubleResult = await evaluate(cdp, () => {
    const btn = [...document.querySelectorAll("button")].find((b) => (b.innerText ?? "").includes("Salvar nova senha"));
    if (!btn) return { clicked: false, buttons: [...document.querySelectorAll("button")].map((b) => b.innerText.trim()) };
    btn.click();
    btn.click();
    return { clicked: true };
  });
  if (!doubleResult.clicked) throw new Error(`item 6: botão de submit ausente (${JSON.stringify(doubleResult)})`);
  const firstPost = await waitPausedPost(20000);
  const during = await evaluate(cdp, () => {
    const btn = document.querySelector("form button[type=submit]");
    return {
      buttonDisabled: btn?.disabled ?? null,
      label: btn?.innerText?.trim() ?? null,
      statusAnnouncement: !!document.querySelector("[role=status]"),
    };
  });
  if (firstPost) {
    collector.paused = collector.paused.filter((x) => x.requestId !== firstPost.requestId);
    await cdp.send("Fetch.continueRequest", { requestId: firstPost.requestId }).catch(() => {});
  }
  // Se o guard falhasse, uma segunda submissão apareceria enquanto a primeira está em voo.
  await sleep(1500);
  const extraPosts = collector.paused.filter((p) => p.request.method === "POST");
  for (const p of collector.paused) {
    await cdp.send("Fetch.continueRequest", { requestId: p.requestId }).catch(() => {});
  }
  await cdp.send("Fetch.disable", {});
  const afterSave = await waitUrl("/admin/empresas", 15000).then(async (p) => {
    if (p.startsWith("/admin/empresas")) return p;
    await sleep(3000);
    return await currentPath();
  });
  const changePosts = [...collector.requests.entries()]
    .filter(([, r]) => r.url.includes("change-password") && r.method === "POST");
  const changeStatuses = changePosts.map(([, r]) => r.status);
  const authCalls = collector.networkList().filter((r) => r.url.includes("/auth/v1/"));
  let responseBody = null;
  let requestBody = null;
  if (changePosts.length > 0) {
    requestBody = changePosts[0][1].postData ?? null;
    try {
      const body = await cdp.send("Network.getResponseBody", { requestId: changePosts[0][0] });
      responseBody = body.body;
    } catch (e) { responseBody = `erro:${e.message}`; }
  }
  if (afterSave.startsWith("/admin/empresas")) await shot("06-admin-empresas");
  record(6, changePosts.length === 1 && during.buttonDisabled === true, {
    doubleClicked: true, extraPausedPosts: extraPosts.length, during, afterPath: afterSave,
    changePasswordPosts: changePosts.length, postStatuses: changeStatuses,
    authCalls, responseBody, requestBody, problems: collector.problems(),
  });
  evidence.technical.changePasswordResponse = {
    statuses: changeStatuses, body: responseBody, requestBody,
    leaks: {
      newPassword: /NovaSenha@2026/.test(responseBody ?? ""),
      provisionalPassword: /AtlasAgenda@123/.test(responseBody ?? ""),
      serviceRole: /service_role|SERVICE_ROLE/i.test(responseBody ?? ""),
      bootstrapSecretName: /BOOTSTRAP_SECRET/.test(responseBody ?? ""),
      secretWord: /secret/i.test(responseBody ?? ""),
    },
  };
  evidence.technical.changePasswordResponse = {
    statuses: changeStatuses, body: responseBody, requestBody,
    leaks: {
      newPassword: /NovaSenha@2026/.test(responseBody ?? ""),
      provisionalPassword: /AtlasAgenda@123/.test(responseBody ?? ""),
      serviceRole: /service_role|SERVICE_ROLE/i.test(responseBody ?? ""),
      bootstrapSecretName: /BOOTSTRAP_SECRET/.test(responseBody ?? ""),
      secretWord: /secret/i.test(responseBody ?? ""),
    },
  };

  // Item 9 — após 200, a página renova o token e navega para /admin/empresas.
  // O destino é registrado como veio (defeito do refresh entra como evidência).
  collector.resetConsole(); collector.resetNetwork();
  const tokenRefreshCalls = evidence.items["6"]?.authCalls ?? [];
  let revisit = null;
  if (afterSave.startsWith("/admin/empresas")) {
    await goto(cdp, `${BASE}/trocar-senha`);
    revisit = await waitUrl("/admin/empresas", 10000);
  } else {
    // Recupera a sessão para os itens 10 e 11 (o defeito do refresh já está registrado).
    await goto(cdp, `${BASE}/login`);
    await fillLogin("admin@neox.com.br", NEW_PASSWORD);
    await clickText("Entrar");
    await waitUrl("/admin/empresas", 20000);
    await goto(cdp, `${BASE}/trocar-senha`);
    revisit = await waitUrl("/admin/empresas", 10000);
  }
  record(9, afterSave.startsWith("/admin/empresas") && revisit.startsWith("/admin/empresas"), {
    afterSave, revisitTrocarSenha: revisit, tokenRefreshCalls, problems: collector.problems(),
  });
  if (revisit.startsWith("/admin/empresas")) await shot("06-admin-empresas");

  // Item 10 — /admin leva a /admin/empresas
  collector.resetConsole(); collector.resetNetwork();
  await goto(cdp, `${BASE}/admin`);
  const p10 = await waitUrl("/admin/empresas", 10000);
  record(10, p10.startsWith("/admin/empresas"), { path: p10, problems: collector.problems() });

  // Item 11 — sair, senha inicial recusada, senha nova entra
  collector.resetConsole(); collector.resetNetwork();
  await evaluate(cdp, () => {
    [...document.querySelectorAll("button")].find((b) => (b.innerText ?? "").trim() === "Sair")?.click();
  });
  const p11logout = await waitUrl("/login", 15000);
  await fillLogin("admin@neox.com.br", PROVISIONAL);
  await clickText("Entrar");
  const wrong = await waitFor(cdp, () => document.querySelector("[role=alert]")?.innerText ?? null, { timeout: 15000 });
  const p11a = await currentPath();
  await fillPasswordFields(NEW_PASSWORD);
  await clickText("Entrar");
  const p11b = await waitUrl("/admin/empresas", 20000);
  record(11, /incorretos/i.test(wrong ?? "") && p11a.startsWith("/login") && p11b.startsWith("/admin/empresas"), {
    logoutPath: p11logout, initialPasswordPath: p11a, initialPasswordMessage: wrong, newPasswordPath: p11b,
    problems: collector.problems(),
  });

  // Item 12 — admin de empresa entra em /app
  collector.resetConsole(); collector.resetNetwork();
  await evaluate(cdp, () => {
    [...document.querySelectorAll("button")].find((b) => (b.innerText ?? "").trim() === "Sair")?.click();
  });
  await waitUrl("/login", 15000);
  await goto(cdp, `${BASE}/login`);
  await fillLogin(TENANT_EMAIL, TENANT_PASSWORD);
  await clickText("Entrar");
  await waitUrl("/app", 20000);
  await sleep(1500);
  const p12path = await currentPath();
  const p12text = await bodyText();
  await shot("07-app-dashboard");
  record(12, p12path.startsWith("/app") && !p12path.includes("trocar-senha") && !/Crie sua nova senha/.test(p12text), {
    path: p12path, problems: collector.problems(), failures: collector.failures(),
  });

  // Cold start de /app/agenda (admin de tenant)
  collector.resetConsole(); collector.resetNetwork();
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.__perf = { lcp: null, fcp: null };
      try {
        new PerformanceObserver((l) => { const e = l.getEntries(); window.__perf.lcp = e[e.length-1].startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === "first-contentful-paint") window.__perf.fcp = e.startTime; }).observe({ type: "paint", buffered: true });
      } catch (e) {}
      window.addEventListener("load", () => {
        const nav = performance.getEntriesByType("navigation")[0];
        if (nav) { window.__perf.domContentLoaded = nav.domContentLoadedEventEnd; window.__perf.loadEventEnd = nav.loadEventEnd; }
      });`,
  });
  const traceChunks = [];
  const offTrace = cdp.on((m) => {
    if (m.method === "Tracing.dataCollected" && Array.isArray(m.params.value)) traceChunks.push(...m.params.value);
  });
  await cdp.send("Tracing.start", { categories: "devtools.timeline,blink.user_timing,loading", transferMode: "ReportEvents" });
  const t0 = Date.now();
  await goto(cdp, `${BASE}/app/agenda`, { settle: 2500 });
  const wallMs = Date.now() - t0;
  await cdp.send("Tracing.end");
  await sleep(1500);
  offTrace();
  writeFileSync(join(OUT, `trace-${label}.json`), JSON.stringify(traceChunks));
  const perf = await evaluate(cdp, () => window.__perf ?? null);
  const profileReqs = collector.networkList().filter((r) => r.url.includes("/rest/v1/profiles"));
  const agendaRendered = await evaluate(cdp, () => /Agenda|Hoje|Dashboard|Painel|sem agendamentos|Nenhum/i.test(document.body.innerText));
  const perfPath = await currentPath();
  await shot("08-app-agenda");
  evidence.perf = {
    path: perfPath, wallMsToSettle: wallMs,
    lcpMs: perf?.lcp ?? null, fcpMs: perf?.fcp ?? null,
    domContentLoadedMs: perf?.domContentLoaded ?? null, loadEventEndMs: perf?.loadEventEnd ?? null,
    lcpUnder1500: (perf?.lcp ?? Infinity) < 1500,
    profileRequests: profileReqs.map((r) => ({ url: r.url, status: r.status })),
    agendaRendered,
    faviconColdStart: collector.networkList()
      .filter((r) => r.url.includes("favicon"))
      .map((r) => ({ url: r.url, status: r.status, failed: r.failed })),
    traceFile: join(OUT, `trace-${label}.json`),
    problems: collector.problems(), failures: collector.failures(),
  };
  record("cold-start", profileReqs.length === 0 && (perf?.lcp ?? Infinity) < 1500, evidence.perf);

  evidence.technical.faviconOk =
    (evidence.technical.faviconFirstLoad ?? []).some((r) => r.url.endsWith(".svg") && r.status === 200) &&
    !(evidence.technical.faviconFirstLoad ?? []).some((r) => (r.status ?? 0) >= 400 || r.failed);
  evidence.technical.consoleAll = {
    consoleErrors: allConsole.errors,
    consoleWarnings: allConsole.warnings,
    logErrors: allLogs.errors,
    logWarnings: allLogs.warnings,
  };
  evidence.technical.console = collector.problems();
  evidence.finishedAt = new Date().toISOString();
  writeFileSync(join(OUT, `${label}.json`), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({
    label,
    items: Object.fromEntries(Object.entries(evidence.items).map(([k, v]) => [k, v.pass])),
    perf: evidence.perf,
    layout: evidence.technical.layout,
    console: evidence.technical.console,
  }, null, 2));
}

run()
  .catch((err) => {
    evidence.error = String(err?.stack ?? err);
    try { writeFileSync(join(OUT, `${label}.json`), JSON.stringify(evidence, null, 2)); } catch {}
    console.error("FALHOU:", err);
    process.exitCode = 1;
  })
  .finally(async () => { if (proc) await closeBrowser(proc); });
