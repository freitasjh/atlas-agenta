// Driver CDP mínimo (Node 26, WebSocket global) para o QA visual da ADR-14.
// Equivalente funcional ao chrome-devtools MCP (viewport, mídia, screenshot,
// console, rede, trace). Usado porque o perfil compartilhado do MCP está
// travado por outra sessão concorrente de outro projeto.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Set();
    this.sessionId = undefined;
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data ?? "")})`));
        else resolve(msg.result);
        return;
      }
      for (const l of this.listeners) l(msg);
    };
  }

  send(method, params = {}, sessionId = this.sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout ${method}`));
        }
      }, 60000);
    });
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}

export async function launch({ port = 9333, width = 1280, height = 800, profileDir, headless = true }) {
  mkdirSync(profileDir, { recursive: true });
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-search-engine-choice-screen",
    "--disable-extensions",
    "--password-store=basic",
    "--use-mock-keychain",
    "--force-color-profile=srgb",
    `--window-size=${width},${height}`,
  ];
  if (headless) args.unshift("--headless=new");
  args.push("about:blank");
  const proc = spawn("/usr/bin/google-chrome", args, { stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  proc.stderr.on("data", (d) => { log += d.toString(); });

  const deadline = Date.now() + 20000;
  let wsUrl;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      const json = await res.json();
      wsUrl = json.webSocketDebuggerUrl;
      if (wsUrl) break;
    } catch {}
    await sleep(150);
  }
  if (!wsUrl) throw new Error(`Chrome não abriu CDP. log=${log.slice(-500)}`);

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const cdp = new CDP(ws);
  return { cdp, proc, port };
}

export async function newPage(cdp, url = "about:blank") {
  const { targetId } = await cdp.send("Target.createTarget", { url });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  cdp.sessionId = sessionId;
  return { targetId, sessionId };
}

/** Coletor de eventos: console, log do browser, rede, interceptação, navegação. */
export class Collector {
  constructor(cdp) {
    this.console = [];
    this.logs = [];
    this.requests = new Map();
    this.paused = [];
    this.nav = [];
    this.off = cdp.on((msg) => {
      if (!msg.method) return;
      const p = msg.params ?? {};
      switch (msg.method) {
        case "Runtime.consoleAPICalled": {
          const text = p.args?.map((a) => a.value ?? a.description ?? a.unserializableValue ?? "").join(" ") ?? "";
          this.console.push({ type: p.type, text, ts: Date.now() });
          break;
        }
        case "Log.entryAdded":
          this.logs.push({ level: p.entry.level, text: p.entry.text, url: p.entry.url, ts: Date.now() });
          break;
        case "Network.requestWillBeSent":
          this.requests.set(p.requestId, {
            url: p.request.url, method: p.request.method, type: p.type,
            status: null, failed: null, ts: Date.now(),
          });
          break;
        case "Network.responseReceived": {
          const r = this.requests.get(p.requestId);
          if (r) r.status = p.response.status;
          break;
        }
        case "Network.loadingFailed": {
          const r = this.requests.get(p.requestId);
          if (r) r.failed = p.errorText;
          break;
        }
        case "Fetch.requestPaused":
          this.paused.push(p);
          break;
        case "Page.frameNavigated":
          if (!p.frame.parentId) this.nav.push({ url: p.frame.url, ts: Date.now() });
          break;
        default:
      }
    });
  }

  resetConsole() { this.console = []; this.logs = []; }
  resetNetwork() { this.requests = new Map(); }

  problems() {
    return {
      consoleErrors: this.console.filter((m) => m.type === "error").map((m) => m.text),
      consoleWarnings: this.console.filter((m) => m.type === "warning").map((m) => m.text),
      logErrors: this.logs.filter((m) => m.level === "error").map((m) => m.text),
      logWarnings: this.logs.filter((m) => m.level === "warning").map((m) => m.text),
    };
  }

  networkList() {
    return [...this.requests.values()].map((r) => ({
      url: r.url, method: r.method, type: r.type, status: r.status, failed: r.failed,
    }));
  }

  failures() {
    return this.networkList().filter((r) => (r.status ?? 0) >= 400 || r.failed);
  }
}

export async function enable(cdp) {
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  await cdp.send("Log.enable");
}

export async function setViewport(cdp, width, height, mobile = false, dpr = 1) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width, height, deviceScaleFactor: dpr, mobile,
    screenWidth: width, screenHeight: height,
  });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
}

export async function goto(cdp, url, { settle = 900, timeout = 25000 } = {}) {
  const loaded = new Promise((resolve) => {
    const off = cdp.on((m) => {
      if (m.method === "Page.loadEventFired") { off(); resolve(); }
    });
    setTimeout(() => { off(); resolve(); }, timeout);
  });
  await cdp.send("Page.navigate", { url });
  await loaded;
  await sleep(settle);
}

export async function evaluate(cdp, fn, ...args) {
  const expression = `(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(",")})`;
  const r = await cdp.send("Runtime.evaluate", {
    expression, awaitPromise: true, returnByValue: true, userGesture: true,
  });
  if (r.exceptionDetails) {
    throw new Error(`evaluate: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  }
  return r.result.value;
}

export async function screenshot(cdp, filePath, { fullPage = false } = {}) {
  const r = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: fullPage });
  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(filePath, Buffer.from(r.data, "base64"));
  return filePath;
}

export async function pressKey(cdp, key, { shift = false } = {}) {
  const map = {
    Tab: { code: "Tab", vk: 9, text: undefined },
    Enter: { code: "Enter", vk: 13, text: "\r" },
    Escape: { code: "Escape", vk: 27, text: undefined },
  }[key];
  if (!map) throw new Error(`tecla não mapeada: ${key}`);
  const modifiers = shift ? 8 : 0;
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown", key, code: map.code, windowsVirtualKeyCode: map.vk,
    nativeVirtualKeyCode: map.vk, modifiers,
    ...(map.text ? { text: map.text, unmodifiedText: map.text } : {}),
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp", key, code: map.code, windowsVirtualKeyCode: map.vk,
    nativeVirtualKeyCode: map.vk, modifiers,
  });
  await sleep(120);
}

export async function waitFor(cdp, fn, { timeout = 8000, interval = 100 } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await evaluate(cdp, fn);
      if (last) return last;
    } catch (e) { last = String(e); }
    await sleep(interval);
  }
  return last;
}

export async function closeBrowser(proc) {
  try { proc.kill("SIGTERM"); } catch {}
  await sleep(300);
}
