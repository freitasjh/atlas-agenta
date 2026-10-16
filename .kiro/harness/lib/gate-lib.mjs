// gate-lib.mjs — funções puras de gate portadas do harness (opencode).
//
// Fonte: /home/joao/fusionlf/wsProjeto/harness/.opencode/plugins/gate.js + lib/config.mjs
// Port-map: .agents/tasks/harness-kiro-port/port-map.md (§5 "reuso as-is").
//
// Estas funções são Node ESM puras (sem opencode, sem rede, sem MCP). No harness
// elas rodavam dentro do hook `tool.execute.before` e negavam com `throw DenyError`.
// No Kiro, um script de hook `command` (ver ../hooks/*.mjs) importa estas funções,
// roda em try/catch e mapeia:  DenyError -> exit 2 (block)  ·  outro erro -> exit 0
// (fail-open, ADR-006)  ·  sem deny -> exit 0 (allow).
//
// Copiado fiel ao original; só o adaptador de runtime muda, não a lógica de decisão.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// --- Kill-switch (ADR-009) ---------------------------------------------------
// Só o env HARNESS_GATES=off desliga. gates.* no config é informativo, nunca
// desliga. O processo do hook `command` herda o mesmo process.env.
export const KILL_SWITCH_ENV = "HARNESS_GATES";
export const KILL_SWITCH_OFF = "off";

export function isKillSwitchOff(env = process.env) {
  return env?.[KILL_SWITCH_ENV] === KILL_SWITCH_OFF;
}

// --- Sinal tipado de deny (ADR-006) -----------------------------------------
export class DenyError extends Error {
  constructor(reason, details = {}) {
    super(typeof reason === "string" && reason.length > 0 ? reason : "deny");
    this.name = "DenyError";
    this.reason = typeof reason === "string" && reason.length > 0 ? reason : "deny";
    this.details = details;
  }
}

// Deny reasons (SPEC §7.3 do harness).
export const DENY_PKILL = "pkill-f";
export const DENY_PROTECTED = "protected-path-write";

// --- Config loader (CFG-01, RF-01/RF-02, fail-closed) -----------------------
const LIB_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CONFIG_PATH = join(LIB_DIR, "..", "harness.config.json");

export function loadHarnessConfig(path = DEFAULT_CONFIG_PATH) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(`harness.config.json: fail-closed — config not found at ${path}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`harness.config.json: fail-closed — invalid JSON at ${path}`);
  }
}

// --- Path helpers (puros, compartilhados) -----------------------------------
export function normalizePath(path) {
  if (typeof path !== "string") return "";
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^(?:\.\/)+/, "")
    .replace(/^\/+/, "")
    .replace(/^["']|["']$/g, "");
}

function escapeRegExp(text) {
  return text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

// Glob mínimo: ** cruza separadores, * não, ? é um caractere não-separador.
export function matchGlob(path, pattern) {
  const segments = normalizePath(pattern).split("**");
  const body = segments
    .map((segment) => {
      let out = "";
      for (const char of segment) {
        if (char === "*") out += "[^/]*";
        else if (char === "?") out += "[^/]";
        else out += escapeRegExp(char);
      }
      return out;
    })
    .join(".*");
  return new RegExp(`^${body}$`).test(normalizePath(path));
}

export function isProtectedPath(path, protectedPaths = []) {
  const normalized = normalizePath(path);
  if (!normalized) return false;
  return (protectedPaths ?? []).some((pattern) => matchGlob(normalized, pattern));
}

// --- GATE-05: higiene de shell (I7) -----------------------------------------
export function extractBashCommand(args) {
  if (typeof args === "string") return args;
  if (!args || typeof args !== "object") return "";
  for (const key of ["command", "cmd", "script", "code"]) {
    if (typeof args[key] === "string" && args[key].length > 0) return args[key];
  }
  return Object.values(args)
    .filter((value) => typeof value === "string")
    .join("\n");
}

export function isPkillF(command) {
  return /\bpkill\b[^\n&;|]*\s-[A-Za-z]*f/i.test(command ?? "");
}

// DECLARADO EVADÍVEL (H4/ADR-007): formas indiretas (interpretadores, comando
// codificado, indireção por variável) escapam do parse de string; o backstop é CI.
export function bashProtectedWrites(command, protectedPaths = []) {
  const hits = [];
  const text = command ?? "";
  const redirectPattern = /(>>?)\s*("[^"]+"|'[^']+'|[^\s;&|>"']+)/g;
  let match;
  while ((match = redirectPattern.exec(text)) !== null) {
    const target = normalizePath(match[2]);
    if (target && isProtectedPath(target, protectedPaths)) {
      hits.push({ via: "redirect", target });
    }
  }
  const teePattern = /\btee\b((?:\s+(?:"[^"]+"|'[^']+'|[^\s;&|>"']+))*)/g;
  while ((match = teePattern.exec(text)) !== null) {
    const parts = match[1].match(/"[^"]+"|'[^']+'|[^\s'"]+/g) ?? [];
    for (let part of parts) {
      if (/^-/.test(part)) continue;
      part = normalizePath(part);
      if (part && isProtectedPath(part, protectedPaths)) hits.push({ via: "tee", target: part });
    }
  }
  return hits;
}

// Gate puro: lança DenyError para negar; retorna true para permitir.
// Espelha gateShellHygiene do harness (sem o acoplamento ao ctx do opencode).
export function gateShellHygiene({ command, protectedPaths = [] } = {}) {
  if (isPkillF(command)) throw new DenyError(DENY_PKILL, { command });
  const hits = bashProtectedWrites(command, protectedPaths);
  if (hits.length > 0) throw new DenyError(DENY_PROTECTED, { hits });
  return true;
}

// --- GATE-02: PICCO na delegação (ADR-004, I1) ------------------------------
// Portado fiel do harness. A tag <open_questions> é OBRIGATÓRIA numa delegação:
//   ausente                 -> deny (picco-tag-absent)
//   presente e não-vazia     -> deny (picco-tag-nonempty)  [ainda há perguntas abertas]
//   vazia / só comentário    -> allow
// Tags de conteúdo E3-E6 ausentes -> allow + warning (advisory).
// Prompt de query de leitura (sem nenhuma tag PICCO) -> pula o gate.
export const DENY_PICCO_ABSENT = "picco-tag-absent";
export const DENY_PICCO_NONEMPTY = "picco-tag-nonempty";
export const PICCO_CONTENT_TAGS = ["role", "task", "context", "constraints", "acceptance"];

const QUERY_PREFIX_RE = /^\s*(show\s+status|o que|onde|qual|existe|list|read|get|status)\b/i;

function stripHtmlComments(text) {
  return String(text).replace(/<!--[\s\S]*?-->/g, "");
}

export function checkPicco(promptText) {
  const text = typeof promptText === "string" ? promptText : "";
  const hasAnyPiccoTag = /<(role|task|context|constraints|acceptance|open_questions)\b/i.test(text);
  if (!hasAnyPiccoTag && QUERY_PREFIX_RE.test(text)) {
    return { verdict: "allow", warnings: [], via: "query" };
  }
  const match = text.match(/<open_questions\b[^>]*>([\s\S]*?)<\/open_questions\s*>/i);
  if (!match) return { verdict: "deny", reason: DENY_PICCO_ABSENT, warnings: [] };
  if (stripHtmlComments(match[1]).trim().length > 0) {
    return { verdict: "deny", reason: DENY_PICCO_NONEMPTY, warnings: [] };
  }
  const warnings = [];
  for (const tag of PICCO_CONTENT_TAGS) {
    if (!new RegExp(`<${tag}\\b`, "i").test(text)) {
      warnings.push(`picco-warning: <${tag}> absent (E3-E6 advisory, allow)`);
    }
  }
  return { verdict: "allow", warnings };
}

// Extrai o texto da demanda de um payload de delegação do Kiro. A delegação é
// `run_workflow`; a demanda vai em tool_input.inputs.task (ver port-map §4,
// confirmado empiricamente pelo shape do stdin do hook). Fallbacks cobrem
// workflowPrompt e outros campos textuais plausíveis.
export function extractDelegationPrompt(toolInput) {
  if (!toolInput || typeof toolInput !== "object") return "";
  const parts = [];
  const push = (v) => {
    if (typeof v === "string" && v.length > 0) parts.push(v);
  };
  push(toolInput.inputs?.task);
  push(toolInput.workflowPrompt);
  push(toolInput.prompt);
  push(toolInput.inputs?.prompt);
  return parts.join("\n");
}

// Gate puro PICCO. Recebe o texto da demanda já extraído.
export function gatePicco({ promptText } = {}) {
  const result = checkPicco(promptText);
  if (result.verdict === "deny") throw new DenyError(result.reason, { promptText });
  return result; // { verdict:"allow", warnings:[...] }
}

// --- GATE-05: path protegido nas tools de escrita ---------------------------
// Portado do checkWriteAccess/extractWriteTargets do harness, adaptado ao shape
// do Kiro (confirmado empiricamente): fs_write/str_replace/fs_append passam o
// alvo em tool_input.path (ABSOLUTO). Diferença do harness: o Kiro manda path
// absoluto; os padrões protectedPaths são relativos à raiz do repo. Logo o alvo
// precisa ser rebaixado a relativo antes do matchGlob.

export const WRITE_TOOLS = new Set(["fs_write", "str_replace", "fs_append", "write", "edit"]);

// Rebaixa um path (possivelmente absoluto) a relativo à raiz do repo. Sem a raiz
// como prefixo, normaliza como veio (já pode ser relativo).
export function toRepoRelative(path, repoRoot) {
  const p = typeof path === "string" ? path.trim().replace(/\\/g, "/").replace(/^["']|["']$/g, "") : "";
  if (!p) return "";
  const root = typeof repoRoot === "string" ? repoRoot.replace(/\\/g, "/").replace(/\/+$/, "") : "";
  if (root && p.startsWith(root + "/")) return normalizePath(p.slice(root.length + 1));
  if (root && p === root) return "";
  return normalizePath(p);
}

// Extrai os paths-alvo de uma chamada de tool de escrita, do tool_input do Kiro.
export function extractWriteTargets(toolName, toolInput) {
  if (!WRITE_TOOLS.has(toolName)) return [];
  if (!toolInput || typeof toolInput !== "object") return [];
  const out = [];
  for (const key of ["path", "file_path", "filePath", "file", "filename", "target"]) {
    if (typeof toolInput[key] === "string" && toolInput[key].length > 0) out.push(toolInput[key]);
  }
  return out;
}

// Gate puro de path protegido. NÃO resolve regras por-agente (allowlist do
// orchestrator, escopo do qa-engineer): o payload do Kiro não traz a identidade
// do agente autor (port-map I11). Essas regras descem para workflow/CI. Aqui
// cobrimos a camada que não depende de agente: escrita em path protegido nega.
export function gateProtectedPathWrite({ toolName, toolInput, protectedPaths = [], repoRoot = "" } = {}) {
  const targets = extractWriteTargets(toolName, toolInput);
  for (const raw of targets) {
    const rel = toRepoRelative(raw, repoRoot);
    if (rel && isProtectedPath(rel, protectedPaths)) {
      throw new DenyError(DENY_PROTECTED, { path: rel, tool: toolName });
    }
  }
  return true;
}

// --- GATE-04: pausa HITL entre batches (I6) ---------------------------------
// Portado do createHitlTracker/gateHitlBatch do harness. Regra fiel: o 3º `task`
// (delegação) consecutivo SEM turno humano no meio nega. O loop de correção
// obrigatório (developer -> code-reviewer = 2 calls) passa por construção (2 < 3).
//
// Diferença do harness: lá o contador vivia num Map em memória do processo do
// plugin, resetado pelo hook `chat.message`. No Kiro cada hook `command` é um
// processo novo e efêmero — não há memória compartilhada. Logo:
//   - o contador é PERSISTIDO em arquivo, por sessão (chave = session_id);
//   - o reset por turno humano usa `UserPromptSubmit` como proxy de `chat.message`.
import { readFileSync as _readFileSync, writeFileSync, mkdirSync } from "node:fs";

export const DENY_HITL = "hitl-pause-required";
export const HITL_CEILING = 3; // 3º task consecutivo nega (fiel ao harness)

// Decisão pura: dado o número de tasks consecutivos JÁ incluindo o atual, nega
// quando atinge/excede o teto. Testável sem I/O.
export function checkHitl(consecutiveCount, ceiling = HITL_CEILING) {
  if (consecutiveCount >= ceiling) {
    throw new DenyError(DENY_HITL, { count: consecutiveCount, ceiling });
  }
  return true;
}

// Estado persistido: { [sessionId]: { count, sequence: [] } }. Arquivo único,
// pequeno, reescrito a cada evento. Corrupção/ausência => estado vazio (o gate
// nunca quebra o loop por causa do próprio armazenamento).
function readHitlState(statePath) {
  try {
    return JSON.parse(_readFileSync(statePath, "utf8")) ?? {};
  } catch {
    return {};
  }
}

function writeHitlState(statePath, state) {
  try {
    mkdirSync(statePath.replace(/\/[^/]*$/, ""), { recursive: true });
    writeFileSync(statePath, JSON.stringify(state), "utf8");
  } catch {
    // Best-effort: falha de escrita não deve negar nem quebrar.
  }
}

// Incrementa o contador da sessão e aplica checkHitl. Retorna true (allow) ou
// lança DenyError (deny no 3º). Persiste o novo contador antes de checar, para
// que a sequência fique registrada mesmo quando nega.
export function hitlOnTask({ sessionId, statePath, label = "task", ceiling = HITL_CEILING } = {}) {
  const key = sessionId || "default";
  const state = readHitlState(statePath);
  const entry = state[key] ?? { count: 0, sequence: [] };
  entry.count += 1;
  entry.sequence.push(label);
  state[key] = entry;
  writeHitlState(statePath, state);
  return checkHitl(entry.count, ceiling);
}

// Reset por turno humano (proxy UserPromptSubmit): zera o contador da sessão.
export function hitlOnHumanTurn({ sessionId, statePath } = {}) {
  const key = sessionId || "default";
  const state = readHitlState(statePath);
  if (state[key]) {
    delete state[key];
    writeHitlState(statePath, state);
  }
  return true;
}

// --- GATE-03: contraprova de conclusão (ADR-002/ADR-008) --------------------
// Portado do completion gate do harness, adaptado à realidade do Kiro.
//
// HONESTIDADE (port-map §9): no harness o gate interceptava a escrita de
// workflow-state.json com current_phase:"Completed" e re-executava o comando
// canônico SELADO (sha256), com "verificador ≠ executor". O Kiro não tem esse
// arquivo-fonte-de-verdade nem a infra de selo. A forma honesta aqui:
//   - a "escrita de conclusão" é escrever qa-review.json com verdict:"approved"
//     (o artefato real de conclusão do dev-pipeline);
//   - o gate RE-EXECUTA commands.suiteFull e NEGA se o exit != 0.
// Preservamos o essencial — o gate roda a suíte, não confia na alegação de
// aprovação — mas SEM o selo sha256 (não há cadeia de selo no Kiro). Essa parte
// da garantia (comando canônico à prova de adulteração) desce para CI. Declarado.
import { execFileSync } from "node:child_process";

export const DENY_COMPLETED_NO_EVIDENCE = "completed-no-evidence";
export const DENY_CONTRAPROVE_DIVERGENT = "contraprove-divergent";
export const DENY_CONTRAPROVE_TIMEOUT = "contraprove-timeout";

// Reconhece a escrita de conclusão: alvo é qa-review.json e o conteúdo declara
// verdict "approved". Qualquer outra escrita não é alvo deste gate.
export function isCompletionApproval({ toolName, toolInput, repoRoot = "" } = {}) {
  if (!WRITE_TOOLS.has(toolName)) return false;
  const targets = extractWriteTargets(toolName, toolInput);
  const touchesReview = targets.some((t) => {
    const rel = toRepoRelative(t, repoRoot);
    return rel.endsWith("qa-review.json");
  });
  if (!touchesReview) return false;
  const content =
    typeof toolInput?.text === "string"
      ? toolInput.text
      : typeof toolInput?.content === "string"
        ? toolInput.content
        : typeof toolInput?.new_string === "string"
          ? toolInput.new_string
          : "";
  if (!content) return false;
  try {
    return JSON.parse(content)?.verdict === "approved";
  } catch {
    return /"verdict"\s*:\s*"approved"/.test(content);
  }
}

// Executor default: roda o comando num shell, timeout, e devolve o exit code.
// Separado para ser injetável nos testes (nunca roda a suíte real no teste).
export function defaultContraproveExec(command, { timeoutMs = 900000, cwd } = {}) {
  try {
    execFileSync(command, { shell: "/bin/sh", timeout: timeoutMs, stdio: "pipe", cwd });
    return { exitCode: 0 };
  } catch (err) {
    if (err?.code === "ETIMEDOUT" || /ETIMEDOUT|timed out/i.test(String(err?.message ?? ""))) {
      return { timedOut: true };
    }
    if (typeof err?.status === "number") return { exitCode: err.status };
    throw err;
  }
}

// Gate puro: re-executa suiteFull; nega se divergir (exit != 0) ou timeout.
// Mantém "verificador ≠ executor": o gate roda a suíte, não lê a alegação.
export function gateCompletionContraprova({
  command,
  execFn = defaultContraproveExec,
  timeoutMs = 900000,
  cwd,
} = {}) {
  if (typeof command !== "string" || command.length === 0) {
    // fail-closed: sem comando canônico não há como provar a conclusão.
    throw new DenyError(DENY_COMPLETED_NO_EVIDENCE, { cause: "missing-command" });
  }
  const observed = execFn(command, { timeoutMs, cwd });
  if (observed?.timedOut === true) {
    throw new DenyError(DENY_CONTRAPROVE_TIMEOUT, { command, timeoutMs });
  }
  if (observed?.exitCode !== 0) {
    throw new DenyError(DENY_CONTRAPROVE_DIVERGENT, { command, observedExit: observed?.exitCode });
  }
  return true;
}
