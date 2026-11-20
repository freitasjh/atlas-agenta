// gate-core.mjs — shared pure core extracted from gate.js (CORE-01).
// Source of truth for reason codes, DenyError and gate modes. gate.js imports
// and re-exports these so the opencode path keeps working unchanged.

export const DEFAULT_MODE = "enforce";

export const KILL_SWITCH_ENV = "HARNESS_GATES";
export const KILL_SWITCH_OFF = "off";

export const DENY_SEAL_MISMATCH = "sealed-command-mismatch";

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
    return { mode: "enforce", source: "default", envVar, reason: null };
  }
  return { mode: "enforce", source: "default", envVar, reason: null };
}

export function modeForGate(gateFn, env) {
  const gateName = gateFn?.gateName;
  if (typeof gateName !== "string" || gateName.length === 0) return DEFAULT_MODE;
  return resolveGateMode(gateName, env).mode;
}

// reason codes (frozen set)
export const DENY_PICCO_ABSENT = "picco-tag-absent";
export const DENY_PICCO_NONEMPTY = "picco-tag-nonempty";
export const DENY_COMPLETED_NO_EVIDENCE = "completed-no-evidence";
export const DENY_FRONTEND_EVIDENCE = "frontend-evidence-missing";
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

// path helpers
export function normalizePath(path) {
  if (typeof path !== "string") return "";
  return path.trim().replace(/\\/g, "/").replace(/^(?:\.\/)+/, "").replace(/^\/+/, "").replace(/^["']|["']$/g, "");
}

export function basenameOf(path) {
  const segments = normalizePath(path).split("/");
  return segments.length > 0 ? segments[segments.length - 1] : "";
}

export const WRITE_TOOLS = new Set(["write", "edit", "apply_patch", "patch"]);

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

const KNOWN_AGENTS = new Set([
  "orchestrator",
  "frontend-engineer",
  "backend-engineer",
  "engineer",
  "product-manager",
  "qa-engineer",
  "architect",
  "security-engineer",
  "code-reviewer",
  "ux-designer",
  "design-system-specialist",
  "general",
  "unknown",
]);

export function sanitizeAgent(agent) {
  return KNOWN_AGENTS.has(agent) ? agent : "unknown";
}

export { KNOWN_AGENTS };