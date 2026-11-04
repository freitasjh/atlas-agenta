// D3/D5 no BUNDLE de produção (ADR-14): carrega o `vite preview` e confere
// console sem erro nem aviso (React Router) e favicon 200 — o que o dev server
// não prova sozinho.
import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { launch, newPage, enable, setViewport, goto, evaluate, screenshot, sleep, closeBrowser, Collector } from "./cdp.mjs";

const ROOT = resolve(process.cwd());
const OUT = process.env.QA_OUT ?? join(ROOT, "harness/qa");
const SHOTS = join(OUT, "screenshots");
const BASE = process.env.QA_BASE_URL ?? "http://127.0.0.1:5175";

const evidence = { base: BASE, startedAt: new Date().toISOString() };
let proc;
let cdp;

async function run() {
  mkdirSync(SHOTS, { recursive: true });
  const launched = await launch({ width: 1280, height: 800, port: 9700, profileDir: "/tmp/opencode/atlas-qa/preview" });
  cdp = launched.cdp; proc = launched.proc;
  await newPage(cdp, "about:blank");
  await enable(cdp);
  const collector = new Collector(cdp);
  await setViewport(cdp, 1280, 800, false, 1);

  await goto(cdp, `${BASE}/`, { settle: 2500 });
  const first = {
    problems: collector.problems(),
    favicon: collector.networkList().filter((r) => r.url.includes("favicon")).map((r) => ({ url: r.url, status: r.status, failed: r.failed })),
    failures: collector.failures(),
  };
  await screenshot(cdp, join(SHOTS, "preview-01-landing.png"));

  // Navegação SPA adicional: o aviso do React Router aparece na criação do
  // router, mas a navegação confirma que não há erro em runtime.
  await evaluate(cdp, () => { window.history.pushState({}, "", "/login"); window.dispatchEvent(new PopStateEvent("popstate")); });
  await sleep(1500);
  const text = await evaluate(cdp, () => document.body.innerText);
  await screenshot(cdp, join(SHOTS, "preview-02-login.png"));

  evidence.firstLoad = first;
  evidence.spaNavigation = {
    route: await evaluate(cdp, () => location.pathname),
    loginForm: /Entrar|E-mail|Senha/.test(text),
    problems: collector.problems(),
    failures: collector.failures(),
  };
  evidence.pass =
    first.problems.consoleErrors.length === 0 &&
    first.problems.consoleWarnings.length === 0 &&
    first.problems.logWarnings.length === 0 &&
    first.problems.logErrors.length === 0 &&
    first.favicon.some((r) => r.url.endsWith(".svg") && r.status === 200) &&
    !first.favicon.some((r) => (r.status ?? 0) >= 400 || r.failed);
  evidence.finishedAt = new Date().toISOString();
  writeFileSync(join(OUT, "build-preview.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
}

run()
  .catch((err) => { evidence.error = String(err?.stack ?? err); console.error(err); process.exitCode = 1; })
  .finally(async () => { if (proc) await closeBrowser(proc); });
