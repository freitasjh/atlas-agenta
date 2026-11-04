// gate.js — harness gate core (GATE-01..GATE-05, Batches 3-4/7).
//
// SPEC: .spec/governance/harness-v7/SPEC.md (ADR-001/002/004/006/007/008/009, §6 Hook Registry)
// PLAN: .spec/governance/harness-v7/PLAN.md (Phase 2, GATE-01..GATE-05)
// TASKS: .spec/governance/harness-v7/TASKS.md (GATE-01..GATE-05, FIX-01)
// Contract: .spec/governance/harness-v7/RUNTIME-CONTRACT.md (§2 inventory, H1-H6).
//
// Scope per ticket:
//   GATE-01: DenyError, dispatcher with modes, kill-switch, seal-empty rejection (FU-03).
//   GATE-02: PICCO gate on `task` (ADR-004) — gatePiccoTask.
//   GATE-03: completion gate, anchors A+B + sealed contraprova (ADR-002/ADR-008).
//   GATE-04: HITL pause between batches + correction-loop exemption (I6).
//   GATE-05: shell hygiene + protected-path parse + qa-engineer scope (I7/I9).
// Per-gate checks register via registerCoreGate below; each is a pure
// async (ctx) => void function throwing DenyError to deny.
//
// Contract discipline (a defect is any violation of these):
//   - Every deny is `throw new DenyError(reason, details)` with an ACTIONABLE
//     reason (command, exit code, divergent counts, missing tag, ...).
//   - Any other thrown error NEVER denies: it is logged at error level and the
//     tool call is allowed (fail-open, ADR-006). A crashing plugin must not
//     paralyze the dev loop.
//   - Only hooks confirmed in RUNTIME-CONTRACT §2 are used. In particular this
//     module never touches the forbidden ask hook (H1), never assigns the
//     system-transform output as a scalar (G14/H2), and never filters the
//     nonexistent bus event (N7/H3).
//   - Honesty of guarantee: parse-based checks (GATE-05 bash parse) are
//     evadible and declared as such; the backstop is CI (ADR-007).
//
// Modes:
//
//   DEFAULT_MODE is "enforce" since DOG-01 (Batch 8/8, flip): a DenyError
//   denies the tool call. Pre-flip history ("warn": log + allow) is kept in
//   git history. ADR-001: the effective mode lives in the host-process env —
//   HARNESS_GATE_<GATE>=[enforce|warn] plus HARNESS_GATE_<GATE>_REASON —
//   resolved+announced by announceGateMode (MODO-04, gate.js:278) over the pure
//   resolveGateMode (MODO-01, gate.js:98); modeForGate (gate.js:126) is the frozen
//   reference (SPEC 3.3). DEFAULT_MODE is the fallback for gates without gateName
//   (hygiene) and envs absent/out of domain (fail-closed); config gates.* decides no mode (RF-01).
//   Flip record (DOG-01): gate.spec.mjs green in BOTH modes (helpers
//   deniesBothModes/allowsBothModes) + dogfood.spec.mjs S1-S4 + runbook
//   .spec/governance/harness-v7/FLIP-RUNBOOK.md. Rollback: HARNESS_GATES=off
//   (runtime, ADR-009) or revert this constant + opencode.json registration.
//
// Kill-switch (ADR-009):
//   ONLY the host-process env HARNESS_GATES=off disables enforcement.
//   gates.* in harness.config.json neither disables the SUITE nor downgrades a
//   gate (ADR-001) — the per-gate downgrade channel is the env above, and a
//   motive is required. Every downgrade and every refusal is announced with one
//   WARN per (gate, motive) / (gate, kind) per process (announceGateMode,
//   MODO-04); every `gates.*` key that has no effect is audited once per (key,
//   value) (auditConfigGates, MODO-03). resolveGateMode itself stays pure.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { verifySeal, sha256 } from "./lib/seal.mjs";
import { loadHarnessConfig, REPO_ROOT } from "./lib/config.mjs";

export const DEFAULT_MODE = "enforce";

export const KILL_SWITCH_ENV = "HARNESS_GATES";
export const KILL_SWITCH_OFF = "off";

export const DENY_SEAL_MISMATCH = "sealed-command-mismatch";

// ADR-006: the typed deny signal. The dispatcher propagates DenyError and
// fail-opens on anything else. Gates MUST throw this, never a raw Error.
export class DenyError extends Error {
  constructor(reason, details = {}) {
    super(typeof reason === "string" && reason.length > 0 ? reason : "deny");
    this.name = "DenyError";
    this.reason = typeof reason === "string" && reason.length > 0 ? reason : "deny";
    this.details = details;
  }
}

export function isKillSwitchOff(env = process.env) {
  return env?.[KILL_SWITCH_ENV] === KILL_SWITCH_OFF;
}

// ADR-001 item 4 (MODO-06): the legacy config→mode resolver is gone. The
// config never decides a mode (RF-01); the effective mode comes from the
// host-process env through resolveGateMode/modeForGate below.

// ---------------------------------------------------------------------------
// ADR-001 (MODO-01): the effective mode of a gate lives in the host-process
// env, never in harness.config.json (RF-01). Pure: no I/O, no logging — the
// caller announces refusals and downgrades through announceGateMode (MODO-04).
// Domain is strict {enforce, warn}; everything else is fail-closed to
// enforce/default.
//   HARNESS_GATE_<GATE>            = "enforce" | "warn"
//   HARNESS_GATE_<GATE>_REASON     = non-empty motive for a downgrade
// ---------------------------------------------------------------------------

const GATE_MODE_ENV_PREFIX = "HARNESS_GATE_";
const GATE_MODE_REASON_SUFFIX = "_REASON";

export function resolveGateMode(gateName, env) {
  const envVar = `${GATE_MODE_ENV_PREFIX}${String(gateName).toUpperCase()}`;
  const raw = env?.[envVar];
  if (raw === undefined) {
    return { mode: "enforce", source: "default", envVar: null, reason: null };
  }
  if (raw === "enforce") return { mode: "enforce", source: "env", envVar, reason: null };
  if (raw === "warn") {
    const reason = env?.[`${envVar}${GATE_MODE_REASON_SUFFIX}`];
    if (typeof reason === "string" && reason.trim().length > 0) {
      return { mode: "warn", source: "env", envVar, reason };
    }
    // Downgrade refused (RF-05/INV-3). This resolver is pure (SPEC 3.1) and
    // emits nothing; the caller announces the refusal (announceGateMode).
    return { mode: "enforce", source: "default", envVar, reason: null };
  }
  // Out of domain — null, "ENFORCE", "off", 42, ...: fail-closed. A present but
  // invalid value keeps envVar (it names the key that was refused).
  return { mode: "enforce", source: "default", envVar, reason: null };
}

// ---------------------------------------------------------------------------
// FU-06/ADR-001: per-gate modes. Each core gate carries a gateName; modeForGate
// resolves it from the host-process env through resolveGateMode (MODO-02). A
// gate without its own gateName (hygiene) falls back to DEFAULT_MODE — there is
// no env lookup for it. The config never participates (RF-01).
// ---------------------------------------------------------------------------

export function modeForGate(gateFn, env) {
  const gateName = gateFn?.gateName;
  if (typeof gateName !== "string" || gateName.length === 0) return DEFAULT_MODE;
  return resolveGateMode(gateName, env).mode;
}

// ---------------------------------------------------------------------------
// FU-07: the contraprove cache is only valid when treeHash names real
// content (N11). "unknown" (the default when the caller states no hash)
// disables the cache: every contraprova re-executes. A stale allow from a
// cache hit on unknown content is a defect; a wasted re-run is not.
// ---------------------------------------------------------------------------

export function isCacheableTreeHash(treeHash) {
  return typeof treeHash === "string" && treeHash.length > 0 && treeHash !== "unknown";
}

// FU-03: empty commands or an empty seal is fail-closed. An empty command map
// (or an empty command value) most likely means the config failed to load or
// was tampered with — silently allowing would bless an unverified run.
export function verifySealOrDeny(commands, seal) {
  if (!commands || typeof commands !== "object" || Array.isArray(commands) || Object.keys(commands).length === 0) {
    throw new DenyError(DENY_SEAL_MISMATCH, { cause: "empty-commands" });
  }
  for (const [key, value] of Object.entries(commands)) {
    if (typeof value !== "string" || value.length === 0) {
      throw new DenyError(DENY_SEAL_MISMATCH, { cause: "empty-command", key });
    }
  }
  if (!seal || typeof seal !== "object" || Array.isArray(seal) || Object.keys(seal).length === 0) {
    throw new DenyError(DENY_SEAL_MISMATCH, { cause: "empty-seal" });
  }
  const { ok, mismatches } = verifySeal(commands, seal);
  if (!ok) throw new DenyError(DENY_SEAL_MISMATCH, { mismatches });
  return true;
}

function logWarn(logger, err) {
  try {
    logger?.warn?.(err instanceof Error ? err.message : String(err));
  } catch {
    // Logging is best-effort; it never changes the verdict.
  }
}

function logError(logger, err) {
  // I10: message-only, same as logWarn. The full Error object carries
  // DenyError.details (paths, counts) and a stack; serializing loggers
  // (app log JSON, console.error(err)) would echo that verbatim. The
  // actionable signal is the reason/message string; details stay on the
  // thrown DenyError for the caller, never in the log line.
  try {
    logger?.error?.(err instanceof Error ? err.message : String(err));
  } catch {
    // Logging is best-effort; it never changes the verdict.
  }
}

// ---------------------------------------------------------------------------
// ADR-001 (MODO-03/MODO-04) — observability of the mode decision (RF-05,
// SPEC 3.2/3.4, INV-3). Two facts must never be silent:
//
//   - a downgrade in force, or a downgrade that was REFUSED (missing motive /
//     out-of-domain value) — the resolver above stays pure (SPEC 3.1), so the
//     caller announces it through announceGateMode;
//   - a `gates.*` key that has no effect, because the config never decides a
//     mode (RF-01) — a silent `"warn"` sitting there reads as a downgrade that
//     is not one.
//
// Dedupe is per process, per FACT (this runs on the hot path, every tool call):
//
//   audit      -> (key, value)   — re-reading the same config is the same fact;
//                                  a new value for the same key is a new one.
//   downgrade  -> (gate, motive) — `evidence` names two anchors; one line.
//   refusal    -> (gate, kind)   — one line per kind, never one per call.
//
// I10 scope of these lines, stated honestly: they add NO path (none of the
// fields below is a path, and no argument/state file path is ever read here).
// They DO echo, verbatim, the config key + value and the downgrade motive —
// SPEC 3.4 and 3.2 require exactly those fields, and the motive is the
// operator's own declaration. What is deliberately NOT echoed is the raw ENV
// value behind a refusal (a mistyped secret would land in the log): a refusal
// names the env and the enum cause only. The config VALUE is echoed because it
// is the config's declared content, not a secret-bearing free-form env.
// ---------------------------------------------------------------------------

const auditedConfigGates = new Set();
const announcedDowngrades = new Set();
const announcedRefusals = new Set();

export const REFUSAL_MISSING_MOTIVE = "motivo ausente";
export const REFUSAL_INVALID_VALUE = "valor inválido";

// Test seam and consumer reset: the dedupe sets are process-scoped state.
export function resetGateObservability() {
  auditedConfigGates.clear();
  announcedDowngrades.clear();
  announcedRefusals.clear();
}

function announceOnce(seen, fact, logger, message) {
  if (seen.has(fact)) return false;
  seen.add(fact);
  logWarn(logger, message);
  return true;
}

function formatGateValue(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isRegisteredGateName(name) {
  return CORE_GATES.some((gateFn) => gateFn?.gateName === name);
}

// SPEC 3.4: exactly one WARN per (key, value) with value != "enforce", naming
// the key, its value, whether the key names a registered gate, and the
// remediation that depends on that answer. It never states the RESOLVED mode:
// the env may downgrade the same gate in the same run, and claiming "the
// effective mode is enforce" would then contradict the downgrade line in the
// unsafe direction. What it states is the mechanism — the config does not
// change the effective mode. "enforce" is silent: there is nothing to say.
export function auditConfigGates(config, logger) {
  const gates = config?.gates;
  if (!gates || typeof gates !== "object" || Array.isArray(gates)) return 0;
  let announced = 0;
  for (const [key, value] of Object.entries(gates)) {
    if (value === DEFAULT_MODE) continue;
    const envName = `${GATE_MODE_ENV_PREFIX}${String(key).toUpperCase()}`;
    const registered = isRegisteredGateName(key);
    // An inert key cannot be REMEDIED through an env: no gate carries its
    // name, so HARNESS_GATE_<KEY> would do nothing either (SPEC 3.4).
    const remediation = registered
      ? `o canal é ${envName} + ${envName}${GATE_MODE_REASON_SUFFIX}`
      : "chave inerte: nenhum gate tem esse nome; remover a chave ou registrar o gate";
    const message =
      `config gates.${key}=${formatGateValue(value)} não altera o modo efetivo ` +
      `(gate registrado: ${registered ? "sim" : "não"}) — ${remediation}`;
    const fact = `${key}\u0000${formatGateValue(value)}`;
    if (announceOnce(auditedConfigGates, fact, logger, message)) announced += 1;
  }
  return announced;
}

// SPEC 3.2: resolve the gate mode AND announce the outcome. Returns the mode,
// so `decide()` keeps its shape and its semantics (INV-6). The cause of a
// refusal is re-derived from the raw env value (option (a) of MODO-04): the
// frozen resolveGateMode contract stays 4 fields, no cause field added.
export function announceGateMode(gateFn, env, logger) {
  const gateName = gateFn?.gateName;
  if (typeof gateName !== "string" || gateName.length === 0) return DEFAULT_MODE;
  const resolved = resolveGateMode(gateName, env);
  if (resolved.mode === "warn") {
    announceOnce(
      announcedDowngrades,
      `${gateName}\u0000${resolved.reason}`,
      logger,
      `gate "${gateName}" rebaixado para "warn" por ${resolved.envVar}: ${resolved.reason}`,
    );
    return resolved.mode;
  }
  // SPEC 3.2: a refusal exists ONLY when the resolution fell back
  // (source === "default") on a present env key. `"enforce"` resolves with
  // source "env" — a normal resolution that logs nothing. Gating on `envVar`
  // alone turned the most valid value of the domain into a false "valor
  // inválido" WARN.
  if (resolved.source === "default" && resolved.envVar) {
    // The two remaining refusal causes: "warn" without a non-empty motive, or
    // a value out of {enforce,warn}. Only the enum cause is named — the raw
    // env value is not echoed (it may be a mistyped secret).
    const kind = env?.[resolved.envVar] === "warn" ? REFUSAL_MISSING_MOTIVE : REFUSAL_INVALID_VALUE;
    const detail =
      kind === REFUSAL_MISSING_MOTIVE
        ? `${resolved.envVar}=warn exige ${resolved.envVar}${GATE_MODE_REASON_SUFFIX} não vazio`
        : `${resolved.envVar} fora do domínio {enforce,warn}`;
    announceOnce(
      announcedRefusals,
      `${gateName}\u0000${kind}`,
      logger,
      `gate "${gateName}": rebaixamento recusado (${kind}) — ${detail}; modo efetivo "${DEFAULT_MODE}"`,
    );
  }
  return resolved.mode;
}

// ADR-006 dispatcher. Pure and hook-agnostic so it is unit-testable without
// MCP or network. Returns a verdict object; only DenyError in enforce mode
// escapes as a throw (which is what denies the tool call at runtime).
export async function decide({ gateFn = null, mode = DEFAULT_MODE, ctx = {}, env = process.env, logger = console } = {}) {
  if (isKillSwitchOff(env)) return { verdict: "allow", via: "kill-switch" };
  try {
    if (gateFn) await gateFn(ctx);
    return { verdict: "allow" };
  } catch (err) {
    if (!(err instanceof DenyError)) {
      logError(logger, err);
      return { verdict: "allow", via: "plugin-error-fail-open" };
    }
    if (mode !== "enforce") {
      logWarn(logger, err);
      return { verdict: "allow", via: "warn", reason: err.reason };
    }
    throw err;
  }
}

// Core gate registry. GATE-02..05 append their pure gates here
// (each: async (ctx) => void, throwing DenyError to deny).
const CORE_GATES = [];

export function registerCoreGate(gateFn) {
  CORE_GATES.push(gateFn);
  return () => {
    const index = CORE_GATES.indexOf(gateFn);
    if (index >= 0) CORE_GATES.splice(index, 1);
  };
}

export function listCoreGates() {
  return [...CORE_GATES];
}

// ---------------------------------------------------------------------------
// Shared deny reasons (one per fixture row, SPEC §7.3).
// ---------------------------------------------------------------------------

export const DENY_PICCO_ABSENT = "picco-tag-absent";
export const DENY_PICCO_NONEMPTY = "picco-tag-nonempty";
export const DENY_COMPLETED_NO_EVIDENCE = "completed-no-evidence";
export const DENY_CONTRAPROVE_DIVERGENT = "contraprove-divergent";
export const DENY_CONTRAPROVE_TIMEOUT = "contraprove-timeout";
export const DENY_PREV_CYCLE = "prev-cycle-not-completed";
export const DENY_HITL = "hitl-pause-required";
export const DENY_PKILL = "pkill-f";
export const DENY_PROTECTED = "protected-path-write";
export const DENY_ALLOWLIST = "orch-write-outside-allowlist";
export const DENY_QA_SCOPE = "qa-scope-violation";
export const DENY_ROLE_WRITE = "write-denied-for-role";
export const DENY_CONFIG_UNAVAILABLE = "config-unavailable";
export const DENY_STATE_CORRUPT = "state-corrupt";

// ---------------------------------------------------------------------------
// FU-05: config→gate border. The loader throws a plain Error; decide() would
// fail-open on it (ADR-006) and RF-01 fail-closed would silently become allow.
// Mapping the catch to DenyError here keeps fail-closed enforceable.
// ---------------------------------------------------------------------------

export function loadConfigOrDeny(path) {
  try {
    return loadHarnessConfig(path);
  } catch (err) {
    // I10: never echo the loader's raw message (it embeds the failing
    // path, which may be attacker-controlled). The actionable signal is
    // the reason; the cause stays an enum.
    throw new DenyError(DENY_CONFIG_UNAVAILABLE, {
      cause: err?.code ?? "load-error",
    });
  }
}

export function ensureConfig(ctx = {}) {
  // MODO-03: the config is read at three points (runGatesShim, here, and
  // readEvidenceReport). The audit runs at the two that have a logger and is
  // deduped by (key, value), so a second read in the same run adds no line.
  if (ctx?.config) {
    auditConfigGates(ctx.config, ctx.logger);
    return ctx.config;
  }
  const config = loadConfigOrDeny(ctx?.configPath);
  auditConfigGates(config, ctx?.logger);
  return config;
}

// ---------------------------------------------------------------------------
// Session→agent map (I11). The deny primitive carries no agent identity —
// only {tool, sessionID, callID} plus args — so per-agent rules resolve the
// subject through this map, fed by the execute.before payload (v2: gate.js:1181).
// Without an entry, no per-agent rule applies (SPEC G8): allow.
// ---------------------------------------------------------------------------

const sessionAgentMap = new Map();

// Bound on session entries: the map is fed by the execute.before payload (one entry per
// sessionID). Unbounded growth across long-lived hosts is a memory leak;
// evict the oldest insertion when over cap (Map preserves insertion order).
// Cap is generous on purpose: eviction only drops the agent hint, which
// fail-opens per-agent rules to allow (SPEC G8), never to deny.
export const MAX_SESSION_AGENTS = 1000;

export function recordSessionAgent(sessionID, agent) {
  if (sessionID && agent) {
    if (!sessionAgentMap.has(sessionID) && sessionAgentMap.size >= MAX_SESSION_AGENTS) {
      const oldest = sessionAgentMap.keys().next().value;
      sessionAgentMap.delete(oldest);
    }
    sessionAgentMap.set(sessionID, agent);
  }
}

export function resolveSessionAgent(ctx = {}) {
  if (ctx?.sessionAgent) return ctx.sessionAgent;
  if (ctx?.sessionID && sessionAgentMap.has(ctx.sessionID)) return sessionAgentMap.get(ctx.sessionID);
  return undefined;
}

export function clearSessionAgents() {
  sessionAgentMap.clear();
}

export function noteChatParams(input = {}) {
  const sessionID = input?.sessionID ?? input?.params?.sessionID;
  const agent =
    input?.agent ?? input?.params?.agent ?? input?.params?.subagent_type ?? input?.subagent_type;
  if (sessionID && agent) recordSessionAgent(sessionID, agent);
}

export function isHumanMessage(input = {}, output) {
  // FU-19 (a): the real chat.message input ({sessionID,agent,model,...}
  // per @opencode-ai/plugin dist/index.d.ts) carries NO role — role lives
  // in the second arg output.message.role. Legacy single-arg shapes stay.
  const role =
    input?.role ?? input?.message?.role ?? input?.params?.role ?? output?.message?.role ?? output?.role;
  return role === "human" || role === "user";
}

// ---------------------------------------------------------------------------
// GATE-02 — PICCO gate on `task` (ADR-004, I1).
//
// Exact contract: the <open_questions> tag is MANDATORY. Absent, or present
// with non-empty content, => deny (E1/E2). Empty or whitespace/HTML-comment
// only => allow. Missing E3-E6 content tags => allow + warn (advisory).
// Read-only query prompts carry no PICCO block and skip the gate.
// ---------------------------------------------------------------------------

export const PICCO_CONTENT_TAGS = ["role", "task", "context", "constraints", "acceptance"];

// Narrow on purpose: only bare state-reading queries skip. Anything shaped
// like a delegation (any PICCO tag present) is evaluated, never skipped.
const QUERY_PREFIX_RE = /^\s*(show\s+status|o que|onde|qual|existe|list|read|get|status)\b/i;

export function extractPromptText(args) {
  if (typeof args === "string") return args;
  if (!args || typeof args !== "object") return "";
  const parts = [];
  for (const key of ["prompt", "description", "task", "message", "text", "content"]) {
    if (typeof args[key] === "string" && args[key].length > 0) parts.push(args[key]);
  }
  if (parts.length === 0) {
    for (const value of Object.values(args)) {
      if (typeof value === "string" && value.length > 0) parts.push(value);
    }
  }
  return parts.join("\n");
}

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

export async function gatePiccoTask(ctx = {}) {
  if (ctx.tool !== "task") return true;
  const result = checkPicco(extractPromptText(ctx.args));
  if (result.verdict === "deny") throw new DenyError(result.reason, { tool: "task" });
  for (const warning of result.warnings) {
    try {
      ctx.logger?.warn?.(warning);
    } catch {
      // Best-effort; never changes the verdict.
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Path helpers shared by anchors A (GATE-03) and hygiene (GATE-05).
// ---------------------------------------------------------------------------

export function normalizePath(path) {
  if (typeof path !== "string") return "";
  return path.trim().replace(/\\/g, "/").replace(/^(?:\.\/)+/, "").replace(/^\/+/, "").replace(/^["']|["']$/g, "");
}

function escapeRegExp(text) {
  return text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

// Minimal glob: ** spans separators, * does not, ? is one non-separator char.
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

// Orchestrator allowlist, anchor A (SPEC N12): ONLY .spec/** plus the state
// file. Everything else (notably rules/schemas/plugins/config) is denied here
// and writable solely via developer-engineer under delegation (CI backstop).
export function isOrchAllowlisted(path) {
  const normalized = normalizePath(path);
  return (
    normalized.startsWith(".spec/") ||
    normalized === "workflow-state.json" ||
    normalized.endsWith("/workflow-state.json")
  );
}

export function isHarnessScoped(path) {
  const normalized = normalizePath(path);
  return normalized === "harness" || normalized.startsWith("harness/");
}

export function isProtectedPath(path, protectedPaths = []) {
  const normalized = normalizePath(path);
  if (!normalized) return false;
  return (protectedPaths ?? []).some((pattern) => matchGlob(normalized, pattern));
}

const WRITE_TOOLS = new Set(["write", "edit", "apply_patch", "patch"]);

export function parsePatchPaths(text) {
  const found = new Set();
  const patterns = [
    /^\+\+\+\s+b\/(\S+)/gm,
    /^---\s+a\/(\S+)/gm,
    /\*\*\*\s*Update File:\s*(\S+)/gi,
    /"(?:filePath|path)"\s*:\s*"([^"]+)"/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const candidate = match[1].replace(/["',;]+$/, "");
      if (candidate && candidate !== "/dev/null" && candidate !== "dev/null") found.add(candidate);
    }
  }
  return [...found];
}

// Covers both runtime arg shapes (contract H6): {filePath, ...} and {path, ...}.
export function extractWriteTargets(tool, args) {
  const targets = [];
  if (!WRITE_TOOLS.has(tool)) return targets;
  if (tool === "apply_patch" || tool === "patch") {
    const text =
      typeof args === "string"
        ? args
        : (args?.patchText ?? args?.patch ?? args?.diff ?? args?.content ?? "");
    if (typeof text === "string" && text.length > 0) {
      for (const path of parsePatchPaths(text)) targets.push({ kind: "patch", path });
    }
    return targets;
  }
  const candidates =
    typeof args === "string"
      ? [args]
      : [args?.filePath, args?.file_path, args?.path, args?.file, args?.filename, args?.target].filter(
          (value) => typeof value === "string" && value.length > 0,
        );
  for (const path of candidates) targets.push({ kind: "path", path });
  return targets;
}

// ---------------------------------------------------------------------------
// I10 detail hygiene (🟡-2 sec). DenyError.details travels to the caller
// and (via fail-open logging) to log lines, so it must never echo raw
// user-controlled strings (secrets, absolute paths in `args`). Allowed
// keys are registry metadata ({tool, gateId, timing}) plus small enums;
// any path is reduced to its allowlisted form below: basename (never a
// directory, never absolute). Agents are reduced to the known enum — an
// unknown/malicious agent string becomes "unknown" instead of leaking.
// ---------------------------------------------------------------------------

export function basenameOf(path) {
  const segments = normalizePath(path).split("/");
  return segments.length > 0 ? segments[segments.length - 1] : "";
}

const KNOWN_AGENTS = new Set([
  "orchestrator",
  "developer-engineer",
  "qa-engineer",
  "code-reviewer",
  "ux-designer",
  "design-system-specialist",
  "unknown",
]);

export function sanitizeAgent(agent) {
  return KNOWN_AGENTS.has(agent) ? agent : "unknown";
}

export function sanitizePathForDetails(path) {
  return basenameOf(path);
}

export function checkWriteAccess({ agent, tool, targets = [], protectedPaths = [] } = {}) {
  for (const target of targets) {
    const normalized = normalizePath(target.path);
    if (!normalized || normalized === "dev/null") continue;
    if (isProtectedPath(normalized, protectedPaths)) {
      // Sole exception: developer-engineer under delegation; the trailer
      // requirement itself is enforced out-of-band by CI (ADR-007).
      if (agent === "developer-engineer") continue;
      throw new DenyError(DENY_PROTECTED, {
        tool,
        path: sanitizePathForDetails(normalized),
        agent: sanitizeAgent(agent ?? "unknown"),
      });
    }
    if (agent === "orchestrator" && !isOrchAllowlisted(normalized)) {
      throw new DenyError(DENY_ALLOWLIST, { tool, path: sanitizePathForDetails(normalized) });
    }
    if (agent === "qa-engineer" && !isHarnessScoped(normalized)) {
      throw new DenyError(DENY_QA_SCOPE, { tool, path: sanitizePathForDetails(normalized) });
    }
    if (agent === "code-reviewer" || agent === "ux-designer" || agent === "design-system-specialist") {
      throw new DenyError(DENY_ROLE_WRITE, {
        tool,
        path: sanitizePathForDetails(normalized),
        agent: sanitizeAgent(agent),
      });
    }
  }
  return true;
}

export function extractWriteContent(args) {
  if (!args || typeof args !== "object") return null;
  for (const key of ["content", "text", "newContent", "data", "new_string", "newString"]) {
    if (typeof args[key] === "string" && args[key].length > 0) return args[key];
  }
  return null;
}

export function isCompletionWrite({ tool, targets = [], args } = {}) {
  if (!WRITE_TOOLS.has(tool)) return false;
  const touchesState = targets.some((target) => {
    const normalized = normalizePath(target.path);
    return normalized === "workflow-state.json" || normalized.endsWith("/workflow-state.json");
  });
  if (!touchesState) return false;
  const content = extractWriteContent(args);
  if (!content) return false;
  try {
    return JSON.parse(content)?.current_phase === "Completed";
  } catch {
    return /"current_phase"\s*:\s*"Completed"/.test(content);
  }
}

// ---------------------------------------------------------------------------
// GATE-03 — completion gate (ADR-002/ADR-008).
//
// Anchor A: structured path-check on write/edit/patch. Anchor B: the next
// `task` requires the previous cycle closed (Completed + passed + passed).
// The contraprova re-runs the sealed canonical command and compares exit
// code plus counts; timeout is a deny (inconclusive is not proof).
// ---------------------------------------------------------------------------

const contraproveCache = new Map();

export function clearContraproveCache() {
  contraproveCache.clear();
}

export function contraproveCacheKey({ demand, report, treeHash = "unknown" } = {}) {
  return `${demand}::${sha256(JSON.stringify(report))}::${treeHash}`;
}

export function defaultContraproveExec(command, { timeoutMs } = {}) {
  try {
    execFileSync(command, { shell: "/bin/sh", timeout: timeoutMs, stdio: "pipe" });
    return { exitCode: 0, counts: null };
  } catch (err) {
    if (err?.code === "ETIMEDOUT" || /ETIMEDOUT|timed out/i.test(String(err?.message ?? ""))) {
      return { timedOut: true };
    }
    if (typeof err?.status === "number") return { exitCode: err.status, counts: null };
    throw err;
  }
}

export async function runContraprova({
  demand,
  report,
  commands,
  seal,
  execFn = defaultContraproveExec,
  timeoutMs = 900000,
  treeHash = "unknown",
} = {}) {
  // Seal first (U6=b): a tampered canonical command denies before anything runs.
  verifySealOrDeny(commands, seal);
  if (!demand || typeof demand !== "string") {
    throw new DenyError(DENY_COMPLETED_NO_EVIDENCE, { cause: "missing-demand" });
  }
  if (!report || typeof report !== "object") {
    throw new DenyError(DENY_COMPLETED_NO_EVIDENCE, { demand });
  }
  const key = contraproveCacheKey({ demand, report, treeHash });
  const cacheable = isCacheableTreeHash(treeHash);
  if (cacheable && contraproveCache.has(key)) return { verdict: "allow", via: "cache", key };
  let observed;
  try {
    observed = await execFn(commands.suiteFull, { timeoutMs });
  } catch (err) {
    if (
      err &&
      (err.code === "ETIMEDOUT" || err.timedOut === true || /timed out/i.test(err.message ?? ""))
    ) {
      throw new DenyError(DENY_CONTRAPROVE_TIMEOUT, { demand, timeoutMs });
    }
    // ADR-006: an exec harness failure that is not a timeout verdict is a
    // plugin error, not a deny — it propagates and decide() fail-opens.
    throw err;
  }
  if (observed?.timedOut === true) {
    throw new DenyError(DENY_CONTRAPROVE_TIMEOUT, { demand, timeoutMs });
  }
  const expectedExit = report?.commands?.[0]?.exitCode;
  if (typeof expectedExit === "number" && observed?.exitCode !== expectedExit) {
    throw new DenyError(DENY_CONTRAPROVE_DIVERGENT, {
      demand,
      expectedExit,
      observedExit: observed?.exitCode,
    });
  }
  const expectedCounts = report?.counts ?? null;
  const observedCounts = observed?.counts ?? null;
  // C-1 / D-15 (owner decision, option a): a count the executor CANNOT observe
  // is NON-COMPARABLE, never "divergent". The default executor observes exit
  // codes only (defaultContraproveExec => counts: null), while the REPORT schema
  // REQUIRES counts — denying a schema-valid report for declaring them made this
  // branch dead code and left H1 counts never contraproved.
  // Real divergence is preserved: when BOTH sides state counts and they differ,
  // the claim is refuted => DENY (never weakened).
  if (
    expectedCounts &&
    observedCounts &&
    JSON.stringify(expectedCounts) !== JSON.stringify(observedCounts)
  ) {
    throw new DenyError(DENY_CONTRAPROVE_DIVERGENT, { demand, expectedCounts, observedCounts });
  }
  if (cacheable) contraproveCache.set(key, { ok: true });
  if (expectedCounts && !observedCounts) {
    // Declared, not silent: the allow records WHY the counts were not checked.
    return { verdict: "allow", via: "counts-unverifiable", key };
  }
  return { verdict: "allow", key };
}

// ---------------------------------------------------------------------------
// Minimal JSON-Schema validator (declared limit: only the subset the report
// schema actually uses — `$ref` to `#/$defs/*`, `type`, `required`,
// `properties`, `items`, `minItems`, `minimum`). Keywords outside the subset
// (oneOf/anyOf/pattern/format/enum/...) are NOT evaluated: they are absent from
// `.agents/schemas/harness-report.schema.json`, and this function never claims
// more than it checks. The authoritative report check for real files is the
// spec that runs this over `harness/*.json` (report-schema.spec.mjs) — nothing
// else validated the real evidence before C-1.
// ---------------------------------------------------------------------------

const JSON_TYPE_CHECKS = {
  object: (value) => value !== null && typeof value === "object" && !Array.isArray(value),
  array: (value) => Array.isArray(value),
  string: (value) => typeof value === "string",
  number: (value) => typeof value === "number" && Number.isFinite(value),
  integer: (value) => Number.isInteger(value),
  boolean: (value) => typeof value === "boolean",
  null: (value) => value === null,
};

export const SCHEMA_SUBSET_KEYWORDS = [
  "$ref",
  "type",
  "required",
  "properties",
  "items",
  "minItems",
  "minimum",
];

export function resolveSchemaRef(ref, root) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) return null;
  let node = root;
  for (const key of ref.slice(2).split("/")) {
    if (node === null || typeof node !== "object") return null;
    node = node[key];
  }
  return node ?? null;
}

export function validateAgainstSchema(value, schema, root = schema, path = "$") {
  const violations = [];
  if (!schema || typeof schema !== "object") return violations;
  if (schema.$ref) {
    const target = resolveSchemaRef(schema.$ref, root);
    if (target) violations.push(...validateAgainstSchema(value, target, root, path));
    return violations;
  }
  if (typeof schema.type === "string") {
    const check = JSON_TYPE_CHECKS[schema.type];
    if (check && !check(value)) {
      violations.push({ path, keyword: "type", expected: schema.type, message: `${path}: expected ${schema.type}` });
    }
  }
  const isObject = value !== null && typeof value === "object" && !Array.isArray(value);
  if (Array.isArray(schema.required) && isObject) {
    for (const key of schema.required) {
      if (!(key in value)) {
        violations.push({ path: `${path}.${key}`, keyword: "required", missing: key, message: `${path}: missing required "${key}"` });
      }
    }
  }
  if (schema.properties && isObject) {
    for (const [key, sub] of Object.entries(schema.properties)) {
      if (key in value) violations.push(...validateAgainstSchema(value[key], sub, root, `${path}.${key}`));
    }
  }
  if (schema.items && Array.isArray(value)) {
    value.forEach((item, index) => {
      violations.push(...validateAgainstSchema(item, schema.items, root, `${path}[${index}]`));
    });
  }
  if (typeof schema.minItems === "number" && Array.isArray(value) && value.length < schema.minItems) {
    violations.push({ path, keyword: "minItems", expected: schema.minItems, message: `${path}: minItems ${schema.minItems}` });
  }
  if (typeof schema.minimum === "number" && typeof value === "number" && value < schema.minimum) {
    violations.push({ path, keyword: "minimum", expected: schema.minimum, message: `${path}: minimum ${schema.minimum}` });
  }
  return violations;
}

// A missing `required` key is tolerated ONLY when the report itself DECLARES the
// deviation for that exact key (field + action "omitted-on-purpose" +
// schemaRequires true) — declared, never silent. Every other violation (type,
// nested shape, minimum, ...) always counts. Historical reports that omitted
// `counts` under conflict C-1 carry that declaration; a NEW omission without it
// is a violation and leaves the spec red.
export function isDeclaredDeviation(report, key) {
  const dev = report?.deviation;
  if (!dev || typeof dev !== "object") return false;
  const entries = Array.isArray(dev.fields) ? dev.fields : [dev];
  return entries.some(
    (entry) =>
      entry &&
      entry.field === key &&
      entry.action === "omitted-on-purpose" &&
      entry.schemaRequires === true,
  );
}

export function reportSchemaViolations(report, schema) {
  return validateAgainstSchema(report, schema).filter(
    (violation) =>
      !(violation.keyword === "required" && isDeclaredDeviation(report, violation.missing)),
  );
}

// Published seal (U6=b): the trust root is rollout step 1, not the worktree.
// Absent seal => verifySealOrDeny denies (fail-closed), never allows.
export function loadPublishedSeal(ctx = {}) {
  if (ctx?.publishedSeal) return ctx.publishedSeal;
  const raw = ctx?.env?.HARNESS_SEAL_JSON ?? process.env?.HARNESS_SEAL_JSON;
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return null;
}

export async function gateCompletionAnchorA(ctx = {}) {
  const tool = ctx.tool;
  if (!WRITE_TOOLS.has(tool)) return true;
  const targets = extractWriteTargets(tool, ctx.args);
  if (targets.length === 0) return true;
  const config = ensureConfig(ctx);
  checkWriteAccess({
    agent: resolveSessionAgent(ctx),
    tool,
    targets,
    protectedPaths: config?.protectedPaths ?? [],
  });
  if (!isCompletionWrite({ tool, targets, args: ctx.args })) return true;
  const report = ctx.report ?? null;
  if (!report) throw new DenyError(DENY_COMPLETED_NO_EVIDENCE, { demand: ctx.demand ?? null });
  await runContraprova({
    demand: ctx.demand ?? report?.demand ?? "workflow-state",
    report,
    commands: config?.commands,
    seal: loadPublishedSeal(ctx),
    execFn: ctx.contraproveExec ?? defaultContraproveExec,
    timeoutMs: ctx.timeoutMs ?? config?.contraproveTimeoutMs ?? 900000,
    treeHash: ctx.treeHash ?? "unknown",
  });
  return true;
}

export function loadWorkflowState(statePath) {
  const resolved = statePath ?? join(REPO_ROOT, "workflow-state.json");
  let raw;
  try {
    raw = readFileSync(resolved, "utf8");
  } catch (err) {
    // Absent state is bootstrap: no previous cycle to gate => allow (null).
    if (err?.code === "ENOENT") return null;
    // Any other read failure denies fail-closed (FU-08): an unreadable
    // state must not silently bless a new cycle. I10: details carry the
    // basename + errno enum only, never the absolute path.
    throw new DenyError(DENY_STATE_CORRUPT, { statePath: basenameOf(resolved), cause: err?.code ?? "read-error" });
  }
  try {
    return JSON.parse(raw);
  } catch {
    // Corrupt state denies fail-closed (FU-08). Only ENOENT above allows.
    // I10: parse errors never echo file content (may hold secrets).
    throw new DenyError(DENY_STATE_CORRUPT, {
      statePath: basenameOf(resolved),
      cause: "parse-error",
    });
  }
}

export function checkAnchorB({ state = null, startsNewCycle = false } = {}) {
  if (!startsNewCycle) return true;
  const closed =
    state?.current_phase === "Completed" &&
    state?.harness_status === "passed" &&
    state?.code_review_status === "passed";
  if (!closed) {
    throw new DenyError(DENY_PREV_CYCLE, {
      current_phase: state?.current_phase ?? null,
      harness_status: state?.harness_status ?? null,
      code_review_status: state?.code_review_status ?? null,
    });
  }
  return true;
}

// Heuristic, declared partial: a task that names the open cycle's feature
// continues it; one that does not, starts a new cycle and must find the
// previous one closed. Prose claims (H5) stay outside runtime by design.
export function inferNewCycle(promptText, state) {
  if (!state) return false;
  if (
    state.current_phase === "Completed" &&
    state.harness_status === "passed" &&
    state.code_review_status === "passed"
  ) {
    return false;
  }
  const feature = state.current_feature;
  if (
    typeof feature === "string" &&
    feature.length > 0 &&
    typeof promptText === "string" &&
    promptText.toLowerCase().includes(feature.toLowerCase())
  ) {
    return false;
  }
  return true;
}

export async function gatePhaseAnchorB(ctx = {}) {
  if (ctx.tool !== "task") return true;
  const state = ctx.workflowState ?? loadWorkflowState(ctx.statePath);
  if (!state) return true;
  const startsNewCycle = ctx.startsNewCycle ?? inferNewCycle(extractPromptText(ctx.args), state);
  checkAnchorB({ state, startsNewCycle });
  return true;
}

// Best-effort evidence lookup for the runtime wrapper: the demand under
// completion is the state's current feature. Missing => null, and the
// completion gate then denies fail-closed (fixture completed-no-evidence).
export function readEvidenceReport(ctx = {}) {
  try {
    if (ctx.report) return ctx.report;
    const state = ctx.workflowState ?? loadWorkflowState(ctx.statePath);
    const feature = state?.current_feature;
    if (!feature) return null;
    const config = ctx.config ?? loadHarnessConfig(ctx.configPath);
    const dir = config?.evidence?.path ?? "harness";
    return JSON.parse(readFileSync(join(REPO_ROOT, dir, `${feature}.json`), "utf8"));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GATE-04 — HITL pause between batches (I6).
//
// Rule: the 3rd consecutive `task` without an intervening human turn denies.
// The mandatory correction loop (developer-engineer -> code-reviewer (renamed RENAME, Batch 7)
// as the first two calls) therefore always passes — the exemption is
// structural (2 < 3), not a special case. Human turns arrive via the
// event stream (v2 turn-boundary events), which resets the per-session counter.
// ---------------------------------------------------------------------------

export function createHitlTracker() {
  const tasks = [];
  return {
    onTask(subagentType) {
      tasks.push(subagentType ?? "unknown");
    },
    onHumanMessage() {
      tasks.length = 0;
    },
    pending() {
      return tasks.length;
    },
    sequence() {
      return [...tasks];
    },
    check() {
      if (tasks.length >= 3) {
        throw new DenyError(DENY_HITL, { count: tasks.length, sequence: [...tasks] });
      }
      return true;
    },
  };
}

const hitlTrackers = new Map();

export function hitlTrackerFor(sessionID) {
  const key = sessionID ?? "default";
  if (!hitlTrackers.has(key)) hitlTrackers.set(key, createHitlTracker());
  return hitlTrackers.get(key);
}

export function resetHitlTracker(sessionID) {
  if (sessionID === undefined) hitlTrackers.clear();
  else hitlTrackers.delete(sessionID);
}

export async function gateHitlBatch(ctx = {}) {
  if (ctx.tool !== "task") return true;
  const tracker = ctx.hitlTracker ?? hitlTrackerFor(ctx.sessionID);
  tracker.onTask(ctx.args?.subagent_type ?? ctx.args?.subagentType ?? "unknown");
  tracker.check();
  return true;
}

// ---------------------------------------------------------------------------
// GATE-05 — hygiene (I7/I9/RF-06).
//
//   - `pkill -f` in any bash call => deny.
//   - Redirection/tee into a protected path via bash => deny by parse.
//     DECLARED EVADIBLE (H4/ADR-007): indirect forms (interpreters, encoded
//     commands, variable indirection) bypass string parse; CI is the backstop.
//   - qa-engineer writes outside harness/ => deny (subject via session map).
// ---------------------------------------------------------------------------

const SHELL_TOOLS = new Set(["bash", "shell"]);

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

export async function gateShellHygiene(ctx = {}) {
  if (!SHELL_TOOLS.has(ctx.tool)) return true;
  const command = extractBashCommand(ctx.args);
  if (isPkillF(command)) throw new DenyError(DENY_PKILL, { tool: ctx.tool });
  const config = ensureConfig(ctx);
  const hits = bashProtectedWrites(command, config?.protectedPaths ?? []);
  // I10: hits carry raw redirect/tee targets (attacker-controlled paths).
  // Details keep only the enum via + basename target, never the full path.
  if (hits.length > 0) {
    throw new DenyError(DENY_PROTECTED, {
      tool: ctx.tool,
      hits: hits.map((h) => ({ via: h.via, target: sanitizePathForDetails(h.target) })),
    });
  }
  return true;
}

// Gate registration (Batch 4/7). GATE-03 contributes both anchors.
// FU-06/ADR-001: each gate carries a gateName so modeForGate(gateFn, env) can
// resolve its mode from HARNESS_GATE_<GATE>. Hygiene carries no gateName on
// purpose: it falls back to DEFAULT_MODE (declared in modeForGate).
registerCoreGate(gatePiccoTask);
registerCoreGate(gateCompletionAnchorA);
registerCoreGate(gatePhaseAnchorB);
registerCoreGate(gateHitlBatch);
registerCoreGate(gateShellHygiene);
gatePiccoTask.gateName = "picco";
gateCompletionAnchorA.gateName = "evidence";
gatePhaseAnchorB.gateName = "evidence";
gateHitlBatch.gateName = "hitlBatch";

// ---------------------------------------------------------------------------
// The v1 doc-contract entry `HarnessGate` (returned "tool.execute.before" +
// "chat.params" + "chat.message") was REMOVED in opencode-v2-only (Batch 1
// review, 🟡-4): the v2 loader never registers it, so the two session keys it
// returned were a registered-but-dead surface and the old comment claiming
// they were "confirmed hooks" was false. chat.params/chat.message are NOT v2
// hooks. The v2 surfaces that replace them are the single ctx.tool.hook below
// (agent identity from the payload) and the confirmed event stream
// (turn boundary). The envelope shims kept further down (runGatesShim,
// noteChatParamsShim, humanBoundaryShim) are test/consumer helpers over the
// SAME pure cores — never a second registered entry.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// V2 adapter — opencode v2.0.32 (opencode-v2-only, EX2-BE-01/EX2-BE-02).
//
// The contract below is MEASURED against the installed binary (v2.0.32) and the
// official source (packages/core/src/plugin/module.ts + plugin/promise/adapter.ts)
// — not against the prose of the docs page, which prescribes "a function that
// returns a hooks object" and does NOT match the installed loader:
//   - The module default export MUST be an OBJECT { id, setup | effect }. A bare
//     function default is rejected by the loader schema ("Expected object at
//     [\"default\"]") — measured with a probe plugin, not theorised.
//   - `setup(ctx)` registers hooks through the v2 ctx API and MUST return
//     `undefined` (or a cleanup function). The runtime hands the return value to
//     Effect.acquireRelease, so a truthy object is CALLED as a function — that is
//     exactly the `TypeError: t is not a function (In 't()', ... is an instance
//     of Object)` that kept enforcement OFF (58x since 2026-10-15).
//   - Confirmed v2 APIs used here (measured in the binary):
//       ctx.tool.hook("execute.before", handler) — handler receives
//         {tool, sessionID, agent, messageID, id, input}; a throw denies the call.
//       ctx.event.subscribe() — AsyncIterable of {id, created, type, [durable],
//         location, data} bus events.
//   - chat.params / chat.message are NOT v2 hooks (absent from the runtime ctx
//     and from the binary). The two v1 feeds are replaced by CONFIRMED v2
//     sources, never by a registered-but-dead hook (golden rule): the
//     session→agent map from the tool-hook payload (`event.agent`) and the
//     human-turn boundary from the event stream. Nothing v1 is dropped silently.
//   - Only the hooks confirmed above are registered: never the forbidden ask hook
//     (H1), never a scalar system-transform (H2), never a dead bus event (H3),
//     never prose blocking (H5).
// ---------------------------------------------------------------------------

// Confirmed v2 tool hook name. A single registration covers every gate-bearing
// tool; the per-gate filter lives in the pure cores (ctx.tool === "task" |
// write-shaped | shell).
export const V2_TOOL_HOOK = "execute.before";

// Tools covered by the single execute.before hook (documentation + test matrix).
export const V2_TOOL_KEYS = ["task", "write", "edit", "apply_patch", "patch", "bash", "shell"];

// Hooks this adapter must never register (H1). Kept narrow on purpose: H2
// (scalar transform output), H3 (dead bus event) and H5 (prose blocking) are not
// hook names and are enforced structurally (static greps + the table below).
export const V2_FORBIDDEN_HOOKS = ["ask"];

// v1 → v2 mapping (gap-1 evidence). Sources: the installed binary (ctx shape and
// the execute.before payload) plus the official source (module.ts schema,
// promise/adapter.ts ctx). Rows with api "no-hook" are v1 feeds whose confirmed
// v2 source is not a hook at all.
export const V2_HOOK_TABLE = [
  {
    v1: "tool.execute.before",
    v2: { api: "ctx.tool.hook", name: "execute.before" },
    core: "all CORE_GATES via decide (GATE-01..05)",
    note: "one registration; gates filter by event.tool",
  },
  {
    v1: "chat.params",
    v2: { api: "no-hook", field: "event.agent" },
    core: "recordSessionAgent via resolveSessionAgent",
    note: "v2 has no chat.params hook; the execute.before payload carries agent",
  },
  {
    v1: "chat.message",
    v2: { api: "ctx.event.subscribe", name: "session.idle|message.updated|session.step.ended" },
    core: "resetHitlTracker on the turn boundary",
    note: "v2 has no chat.message hook; the event stream carries the boundary",
  },
];

// Turn-boundary events — the confirmed v2 replacement for the v1 chat.message
// human turn: session.idle = the turn finished; message.updated(role user) = a
// human message; session.step.ended(finish stop) = the assistant step that ends
// the turn. Any one of them resets the per-session HITL counter.
export const V2_TURN_BOUNDARY_TYPES = ["session.idle", "message.updated", "session.step.ended"];

export function isTurnBoundaryEvent(event = {}) {
  const type = event?.type;
  if (type === "session.idle") return true;
  if (type === "message.updated") {
    const role = event?.data?.info?.role ?? event?.properties?.info?.role ?? event?.info?.role;
    return role === "user" || role === "human";
  }
  if (type === "session.step.ended") {
    const finish = event?.data?.finish ?? event?.data?.rawFinish ?? event?.properties?.finish;
    return finish === "stop";
  }
  return false;
}

// Feeds the HITL counter from a bus event. Counter maintenance never denies and
// never logs raw event content (I10).
export function noteTurnBoundary(event = {}) {
  try {
    if (!isTurnBoundaryEvent(event)) return false;
    const sessionID = event?.data?.sessionID ?? event?.properties?.sessionID ?? event?.sessionID;
    resetHitlTracker(sessionID);
    return true;
  } catch {
    return false;
  }
}

// v2 tool-hook handler. Normalizes the confirmed v2 event shape
// ({tool, sessionID, agent, messageID, id, input}) plus the legacy envelope and
// two-arg shapes (H6), then runs the identical decide + CORE_GATES loop as the
// doc-contract entry above. Deny escapes as DenyError via decide; the runtime
// turns a throw into a failed tool call.
export async function runGatesShim(v2Payload = {}, v2Output) {
  const twoArgs = v2Output !== undefined;
  let toolInput = {};
  let toolOutput = {};
  let payloadObj = {};
  if (typeof v2Payload === "string") {
    toolOutput = { args: v2Payload };
  } else {
    payloadObj = v2Payload && typeof v2Payload === "object" ? v2Payload : {};
    if (twoArgs) {
      toolInput = payloadObj;
      toolOutput = v2Output && typeof v2Output === "object" ? v2Output : {};
    } else {
      const isEvent =
        typeof payloadObj.tool === "string" &&
        "input" in payloadObj &&
        !("args" in payloadObj) &&
        !("toolInput" in payloadObj) &&
        !("toolOutput" in payloadObj);
      toolInput = isEvent ? payloadObj : (payloadObj.toolInput ?? payloadObj);
      toolOutput = isEvent ? { args: payloadObj.input } : (payloadObj.toolOutput ?? payloadObj);
    }
  }
  const sessionID = toolInput.sessionID ?? payloadObj.sessionID;
  const agent = toolInput.agent ?? payloadObj.agent;
  const logger = toolInput.logger ?? payloadObj.logger ?? console;
  const base = {
    tool: toolInput.tool ?? payloadObj.tool,
    sessionID,
    callID: toolInput.callID ?? toolInput.id ?? payloadObj.callID ?? payloadObj.id,
    args: toolOutput.args ?? toolInput.args ?? payloadObj.args,
    defaultMode: DEFAULT_MODE,
    logger,
    statePath: toolInput.statePath ?? payloadObj.statePath,
    configPath: toolInput.configPath ?? payloadObj.configPath,
    env:
      toolInput.env ??
      payloadObj.env ??
      (toolInput.config ?? payloadObj.config ? {} : process.env),
  };
  // The v2 tool-hook payload carries the agent identity (I11): the session→agent
  // map is fed here instead of the removed chat.params hook.
  if (agent) recordSessionAgent(sessionID, agent);
  let config = toolInput.config ?? payloadObj.config ?? null;
  if (!config) {
    try {
      config = loadConfigOrDeny(base.configPath);
    } catch {
      config = null;
    }
  }
  // MODO-03: whatever config this run is about to use — injected or loaded —
  // is audited before any gate reads it. Deduped per (key, value), so the
  // ensureConfig audit inside a gate adds nothing for the same config.
  auditConfigGates(config, logger);
  // ADR-001 (MODO-05, SPEC 3.5/INV-4): order is config load + audit → suite
  // kill-switch → per-gate mode resolution. The audit above is a config FACT,
  // not a mode resolution, so it stays before this cut. With HARNESS_GATES=off
  // nothing below runs: no resolveGateMode, no announceGateMode (zero
  // downgrade/refusal WARN) and no gate execution. Same verdict shape decide()
  // returns for the kill-switch, which stays there as the second line of
  // defence.
  if (isKillSwitchOff(base.env)) return { verdict: "allow", via: "kill-switch" };
  const ctx = {
    ...base,
    config: config ?? undefined,
    sessionAgent:
      toolInput.sessionAgent ??
      payloadObj.sessionAgent ??
      (agent ?? (sessionID ? sessionAgentMap.get(sessionID) : undefined)),
    // Optional explicit seams (test/consumer injection only — prod callers leave
    // every one undefined and fall through to the same lazy defaults the
    // doc-contract entry uses: workflowState via loadWorkflowState,
    // startsNewCycle via inferNewCycle, hitlTracker via hitlTrackerFor,
    // contraproveExec via defaultContraproveExec, timeoutMs via
    // config.contraproveTimeoutMs, treeHash "unknown" = cache bypass.
    workflowState: toolInput.workflowState ?? payloadObj.workflowState ?? undefined,
    startsNewCycle: toolInput.startsNewCycle ?? payloadObj.startsNewCycle ?? undefined,
    hitlTracker: toolInput.hitlTracker ?? payloadObj.hitlTracker ?? undefined,
    contraproveExec: toolInput.contraproveExec ?? payloadObj.contraproveExec ?? undefined,
    timeoutMs: toolInput.timeoutMs ?? payloadObj.timeoutMs ?? undefined,
    treeHash: toolInput.treeHash ?? payloadObj.treeHash ?? undefined,
    publishedSeal: loadPublishedSeal(),
  };
  ctx.report = toolInput.report ?? payloadObj.report ?? readEvidenceReport(ctx);
  let outcome = { verdict: "allow" };
  for (const gateFn of CORE_GATES) {
    const result = await decide({
      gateFn,
      // MODO-04: resolve AND announce (one WARN per gate+motive / gate+kind,
      // per process). decide() itself is untouched (INV-6).
      mode: announceGateMode(gateFn, base.env, logger),
      ctx,
      env: base.env,
      logger,
    });
    if (result && typeof result === "object") {
      if (result.via && !outcome.via) outcome = result;
      else if (!outcome.via) outcome = result;
    }
  }
  return outcome;
}

// Legacy session shim kept for the pure-core tests: feeds the same
// session→agent map the v2 tool hook now feeds. Map maintenance never denies.
export function noteChatParamsShim(input = {}) {
  try {
    noteChatParams(input);
  } catch {
    // Map maintenance never denies.
  }
}

// Legacy human-turn shim kept for the pure-core tests: same reset the v2 event
// stream triggers via noteTurnBoundary. Counter maintenance never denies.
export function humanBoundaryShim(messageInput = {}, output) {
  try {
    if (isHumanMessage(messageInput, output)) {
      resetHitlTracker(messageInput?.sessionID ?? messageInput?.params?.sessionID);
    }
  } catch {
    // Counter maintenance never denies.
  }
}

const v2SetupSeen = new WeakSet();

// v2 plugin entry (the module default's `setup`). Registers the single confirmed
// tool hook plus the turn-boundary subscription and returns `undefined` — the
// runtime hands the return value to acquireRelease, so anything truthy would be
// invoked as a cleanup function (the TypeError this cycle fixes). A missing
// ctx.tool.hook raises a VISIBLE error, never silence; a rejected registration
// throws GATE-ABSENT (fail-closed — a half-registered adapter must not bless an
// unverified run). Idempotent per ctx object (second call registers nothing and
// still returns undefined).
export async function setup(ctx = {}) {
  if (v2SetupSeen.has(ctx)) return undefined;
  const toolHook = ctx?.tool?.hook;
  if (typeof toolHook !== "function") {
    throw new Error("HOOK-NO-EQUIV:ctx.tool.hook");
  }
  try {
    await toolHook(V2_TOOL_HOOK, runGatesShim);
  } catch {
    throw new Error(`GATE-ABSENT:${V2_TOOL_HOOK}`);
  }
  const subscribe = ctx?.event?.subscribe;
  if (typeof subscribe === "function") {
    try {
      const stream = subscribe();
      if (stream && typeof stream[Symbol.asyncIterator] === "function") {
        // Detached on purpose: the subscription lives for the plugin scope and
        // must not block activation. A dropped stream only loses the HITL reset.
        void (async () => {
          try {
            for await (const event of stream) noteTurnBoundary(event);
          } catch {
            // Best-effort; never denies.
          }
        })();
      } else {
        console.error("[harness-gate] HOOK-NO-EQUIV:ctx.event.subscribe(not-async-iterable)");
      }
    } catch {
      console.error("[harness-gate] HOOK-NO-EQUIV:ctx.event.subscribe");
    }
  } else {
    console.error("[harness-gate] HOOK-NO-EQUIV:ctx.event.subscribe(turn-boundary)");
  }
  v2SetupSeen.add(ctx);
  return undefined;
}

// v2 plugin module default export. The installed loader requires an OBJECT
// {id, setup}; a bare function default is rejected ("Expected object at
// [\"default\"]"). No `Plugin.define` (absent from the runtime) and no `server`
// key — this repo is v2-only.
export default { id: "harness-gate", setup };
