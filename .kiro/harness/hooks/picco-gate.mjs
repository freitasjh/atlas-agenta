#!/usr/bin/env node
// picco-gate.mjs — chassi de hook `command` do Kiro para GATE-02 (PICCO).
//
// Registrado por .kiro/hooks/picco-gate.json como PreToolUse com matcher
// `run_workflow` (a delegação do Kiro). Shape do stdin confirmado empiricamente:
//   { session_id, hook_event_name, cwd, tool_name, tool_input }
// A demanda delegada vive em tool_input.inputs.task.
//
// Nega (exit 2) quando a delegação não traz o bloco PICCO com <open_questions>
// vazio. Honra o kill-switch. Fail-open em erro inesperado (ADR-006).
import { readFileSync } from "node:fs";
import { isKillSwitchOff, extractDelegationPrompt, gatePicco, DenyError } from "../lib/gate-lib.mjs";

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function parsePayload(raw) {
  if (!raw || raw.trim().length === 0) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function main() {
  if (isKillSwitchOff(process.env)) process.exit(0);

  const payload = parsePayload(readStdin());
  const toolInput = payload?.tool_input ?? payload?.toolInput ?? payload?.input ?? {};

  try {
    const promptText = extractDelegationPrompt(toolInput);
    // Delegação sem nenhum texto de demanda: não é o alvo do PICCO — allow.
    if (!promptText) process.exit(0);
    const result = gatePicco({ promptText });
    for (const w of result.warnings ?? []) process.stderr.write(`[harness gate] ${w}\n`);
    process.exit(0);
  } catch (err) {
    if (err instanceof DenyError) {
      process.stderr.write(
        `[harness gate] BLOQUEADO (${err.reason}): delegação sem bloco PICCO válido ` +
          `(<open_questions> ausente ou não-vazio). Rode o prompt-optimizer antes de delegar.\n`,
      );
      process.exit(2);
    }
    process.stderr.write(`[harness gate] fail-open (erro inesperado): ${err?.message ?? err}\n`);
    process.exit(0);
  }
}

main();
