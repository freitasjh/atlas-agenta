// config.mjs — harness.config.json loader (CFG-01, RF-01/RF-02, ADR-009).
// Relocated from scripts/static-checks.mjs in Batch 3/7 (GATE-01/FIX-01).
// Interface kept stable: scripts/static-checks.mjs re-exports every symbol
// below, so existing consumers and tests keep working unchanged.
// Pure Node ESM: no MCP, no network, no filesystem beyond the config read.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const DEFAULT_CONFIG_PATH = join(REPO_ROOT, "harness.config.json");

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

export function resolveCommand(config, key) {
  const cmd = config?.commands?.[key];
  if (typeof cmd !== "string" || cmd.length === 0) {
    throw new Error(`harness.config.json: fail-closed — unknown command key "${key}"`);
  }
  return cmd;
}

// ADR-009: gates.* in the config never disables the SUITE and never picks a mode;
// the downgrade lives in the host-process env (HARNESS_GATE_<GATE> + _REASON) and
// requires a motive; configGatesDisableEnforcement stays false. Executable, not prose.
export function configGatesDisableEnforcement(_gates) {
  return false;
}
