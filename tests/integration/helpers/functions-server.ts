// Ciclo de vida do `supabase functions serve` para a suíte de integração (ADR-13).
//
// A CLI usa o mesmo container `supabase_edge_runtime_<projeto>` para toda execução: não há como
// ter dois `functions serve` simultâneos. Por isso a suíte é DONA do processo: ela encerra o que
// existir (por PID, nunca por `pkill -f`), sobe uma instância com o env file gerenciado e a
// encerra no teardown do global setup.
//
// O env file gerenciado vive fora do repositório (permissão 0600), é montado a partir de
// `supabase/functions/.env` e acrescenta apenas:
//   - `BOOTSTRAP_SECRET`: segredo aleatório por execução, lido daqui pelos testes de bootstrap;
//   - `ATLAS_ENV`: `local` por padrão; o teste de 403 sobe uma instância com `production`.
//
// Nenhum valor de segredo é impresso. Os logs da CLI ficam em arquivo no diretório de estado.
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, openSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, readFunctionsEnv } from "./env.ts";

const PROJECT_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const STATE_DIR = process.env.INTEGRATION_STATE_DIR ?? "/tmp/opencode/atlas-agenda-integration";
const ENV_FILE = join(STATE_DIR, "functions.env");
const PID_FILE = join(STATE_DIR, "functions.pid");
const MODE_FILE = join(STATE_DIR, "functions.mode.json");
const SECRET_FILE = join(STATE_DIR, "bootstrap-secret");
const LOG_FILE = join(STATE_DIR, "functions.log");
const SUPABASE_BIN = process.env.SUPABASE_BIN ?? "supabase";

const READY_FUNCTION = "signup-tenant";
const READY_TIMEOUT_MS = 120_000;
const STOP_TIMEOUT_MS = 30_000;
/**
 * Teto de cada sonda. Sem ele, uma conexão pendurada (runtime saindo, porta em TIME_WAIT)
 * segura a sonda até o timeout do TCP (~60s+) e o restart parece travado.
 */
const PROBE_TIMEOUT_MS = 2_000;

export interface FunctionsMode {
  /** Segredo apresentado no header `x-bootstrap-secret`; `null` quando a função deve parecer ausente. */
  bootstrapSecret: string | null;
  atlasEnv: "local" | "production";
}

function ensureStateDir(): void {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
}

function writePrivateFile(path: string, content: string): void {
  writeFileSync(path, content, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Confere o diretório de trabalho do PID para nunca derrubar o stack de outro projeto. */
function belongsToProject(pid: number): boolean {
  try {
    const cwd = readlinkSync(`/proc/${pid}/cwd`);
    return cwd === PROJECT_ROOT || cwd.startsWith(`${PROJECT_ROOT}/`);
  } catch {
    // Sem `/proc` (ex.: macOS): só o PID registrado no estado é considerado deste projeto.
    return false;
  }
}

/** PIDs de `supabase functions serve` vivos, incluindo os iniciados em execuções anteriores. */
function findServePids(): number[] {
  const result = spawnSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout) return [];
  const pids: number[] = [];
  for (const line of result.stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    const args = match[2];
    if (pid === process.pid || pid === process.ppid) continue;
    if (!/supabase\s+functions\s+serve/.test(args)) continue;
    if (args.startsWith("ps ")) continue;
    if (!belongsToProject(pid)) continue;
    pids.push(pid);
  }
  return pids;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDeath(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await sleep(200);
  }
  return !isAlive(pid);
}

/** Status da função de prontidão; `null` quando a chamada nem chega ao servidor. */
async function probeReady(): Promise<number | null> {
  const env = loadEnv();
  try {
    const response = await fetch(`${env.apiUrl}/functions/v1/${READY_FUNCTION}`, {
      method: "POST",
      headers: { apikey: env.anonKey, "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return response.status;
  } catch {
    return null;
  }
}

function isReadyStatus(status: number | null): boolean {
  if (status === null) return false;
  if (status === 404 || status === 503) return false;
  return status > 0 && status < 500;
}

/** Status do bootstrap com um header controlado, para distinguir a instância em execução. */
async function probeBootstrap(secret: string | null): Promise<number | null> {
  const env = loadEnv();
  const headers: Record<string, string> = {
    apikey: env.anonKey,
    "Content-Type": "application/json",
  };
  if (secret !== null) headers["x-bootstrap-secret"] = secret;
  try {
    const response = await fetch(`${env.apiUrl}/functions/v1/bootstrap-super-admin`, {
      method: "POST",
      headers,
      body: "{}",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return response.status;
  } catch {
    return null;
  }
}

/**
 * Confere que a instância corrente está no modo pedido. A sonda usa a própria função de bootstrap,
 * porque `signup-tenant` responde igual em qualquer modo e não distingue instância antiga de nova:
 *   - sem segredo no env → 404, qualquer que seja o header;
 *   - produção → 403 com o segredo correto (nunca cria nada);
 *   - local → 401 com um segredo propositalmente errado (nunca cria nada).
 */
async function probeMode(mode: FunctionsMode): Promise<boolean> {
  if (mode.bootstrapSecret === null) {
    const status = await probeBootstrap("probe");
    return status === 404;
  }
  if (mode.atlasEnv === "production") {
    const status = await probeBootstrap(mode.bootstrapSecret);
    return status === 403;
  }
  const status = await probeBootstrap("__ready_probe__");
  return status === 401;
}

function signalPid(pid: number, signal: NodeJS.Signals, group = false): void {
  if (group) {
    try {
      process.kill(-pid, signal);
    } catch {
      // Sem grupo próprio: cai no sinal individual abaixo.
    }
  }
  try {
    process.kill(pid, signal);
  } catch {
    // Processo já saiu.
  }
}

/** Nome do container do edge runtime do projeto, lido de `supabase/config.toml`. */
function edgeContainerName(): string {
  try {
    const config = readFileSync(join(PROJECT_ROOT, "supabase", "config.toml"), "utf8");
    const match = /^project_id\s*=\s*"([^"]+)"/m.exec(config);
    if (match) return `supabase_edge_runtime_${match[1]}`;
  } catch {
    // Sem config legível: cai no nome derivado do diretório, como o CLI faz.
  }
  return `supabase_edge_runtime_${PROJECT_ROOT.replace(/\/+$/, "").split("/").pop() ?? "local"}`;
}

/** Remove o container do runtime para não sobrar instância antiga servindo o env anterior. */
function removeEdgeContainer(): void {
  spawnSync("docker", ["rm", "-f", edgeContainerName()], { encoding: "utf8" });
}

/** Encerra qualquer `functions serve` vivo (por PID/grupo) e espera o runtime sair. */
export async function stopFunctions(): Promise<void> {
  // Repete a varredura: a CLI pode criar o processo real depois do wrapper e deixar um órfão.
  for (let round = 0; round < 3; round += 1) {
    const recorded = readJson<{ pid: number }>(PID_FILE);
    const pids = new Set<number>(findServePids());
    if (recorded && isAlive(recorded.pid)) pids.add(recorded.pid);
    if (recorded) signalPid(recorded.pid, "SIGTERM", true);
    if (pids.size === 0) break;

    for (const pid of pids) {
      signalPid(pid, "SIGTERM");
      if (!(await waitForDeath(pid, STOP_TIMEOUT_MS / 6))) {
        signalPid(pid, "SIGKILL");
        await waitForDeath(pid, STOP_TIMEOUT_MS / 6);
      }
    }
    await sleep(500);
  }

  removeEdgeContainer();

  const deadline = Date.now() + STOP_TIMEOUT_MS / 2;
  while (Date.now() < deadline) {
    if (!isReadyStatus(await probeReady())) break;
    await sleep(500);
  }

  rmSync(PID_FILE, { force: true });
}

function defaultBootstrapSecret(): string {
  ensureStateDir();
  if (process.env.INTEGRATION_BOOTSTRAP_SECRET) return process.env.INTEGRATION_BOOTSTRAP_SECRET;
  if (existsSync(SECRET_FILE)) {
    const stored = readFileSync(SECRET_FILE, "utf8").trim();
    if (stored !== "") return stored;
  }
  const generated = randomBytes(24).toString("hex");
  writePrivateFile(SECRET_FILE, generated);
  return generated;
}

function composeEnvFile(mode: FunctionsMode): void {
  const base = readFunctionsEnv();
  const hookSecret = base.CUSTOM_ACCESS_TOKEN_HOOK_SECRET;
  if (!hookSecret) {
    throw new Error(
      "CUSTOM_ACCESS_TOKEN_HOOK_SECRET ausente em supabase/functions/.env. O hook do GoTrue não sobe sem ele.",
    );
  }

  const env: Record<string, string> = { ...base, ATLAS_ENV: mode.atlasEnv };
  // Gateway determinístico: a suíte aponta o Asaas para uma porta fechada. Nenhum teste
  // depende de sandbox.asaas.com (SPEC §12.2).
  env.ASAAS_API_BASE_URL = process.env.ASAAS_API_BASE_URL ?? "http://127.0.0.1:1";
  if (mode.bootstrapSecret === null) {
    delete env.BOOTSTRAP_SECRET;
  } else {
    env.BOOTSTRAP_SECRET = mode.bootstrapSecret;
  }

  const lines = Object.entries(env).map(([key, value]) => `${key}=${value}`);
  writePrivateFile(ENV_FILE, `${lines.join("\n")}\n`);
}

async function waitUntilReady(mode: FunctionsMode, timeoutMs: number, pid?: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeMode(mode)) return true;
    if (pid !== undefined && !isAlive(pid)) return false;
    await sleep(1000);
  }
  return probeMode(mode);
}

/** Sobe uma instância com o modo pedido. Encerra a anterior antes. */
export async function startFunctions(mode: FunctionsMode): Promise<FunctionsMode> {
  ensureStateDir();
  composeEnvFile(mode);

  const attempts = 3;
  const perAttemptMs = Math.floor(READY_TIMEOUT_MS / attempts);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await stopFunctions();
    // O runtime anterior pode estar "marked for removal" no Docker por alguns segundos.
    await sleep(attempt === 1 ? 2_000 : 5_000);

    const logFd = openSync(LOG_FILE, "a", 0o600);
    const child = spawn(SUPABASE_BIN, ["functions", "serve", "--env-file", ENV_FILE], {
      cwd: PROJECT_ROOT,
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
    child.unref();
    if (!child.pid) throw new Error("Não foi possível iniciar `supabase functions serve`.");
    writePrivateFile(PID_FILE, String(child.pid));
    writePrivateFile(MODE_FILE, JSON.stringify(mode));

    if (await waitUntilReady(mode, perAttemptMs, child.pid)) return mode;
  }

  await stopFunctions();
  throw new Error(
    `Edge Functions não ficaram prontas em ${Math.round(READY_TIMEOUT_MS / 1000)}s ` +
      `(3 tentativas). Confira ${LOG_FILE} e rode \`supabase start\` antes da suíte.`,
  );
}

/** Confere que a instância em execução está no modo padrão e responde; senão, sobe uma. */
export async function ensureFunctionsDefault(): Promise<FunctionsMode> {
  const mode = readJson<FunctionsMode>(MODE_FILE);
  const secret = defaultBootstrapSecret();
  if (
    mode &&
    mode.bootstrapSecret === secret &&
    mode.atlasEnv === "local" &&
    (await probeMode(mode))
  ) {
    return mode;
  }
  return startFunctions({ bootstrapSecret: secret, atlasEnv: "local" });
}

/** Segredo padrão do bootstrap (o mesmo gravado no env file da instância local). */
export function getBootstrapSecret(): string {
  const mode = readJson<FunctionsMode>(MODE_FILE);
  if (!mode || mode.bootstrapSecret === null) {
    throw new Error("Bootstrap sem segredo na instância atual. Chame ensureFunctionsDefault antes.");
  }
  return mode.bootstrapSecret;
}

/** Encerra a instância e remove os arquivos de estado. Usado no teardown do global setup. */
export async function teardownFunctions(): Promise<void> {
  await stopFunctions();
  await sleep(1_000);
  await stopFunctions();
  rmSync(STATE_DIR, { recursive: true, force: true });
}
