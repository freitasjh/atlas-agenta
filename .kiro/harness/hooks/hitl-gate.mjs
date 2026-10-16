#!/usr/bin/env node
// hitl-gate.mjs — chassi de hook `command` do Kiro para GATE-04 (pausa HITL).
//
// Registrado por .kiro/hooks/hitl-gate.json como PreToolUse matcher `run_workflow`.
// Incrementa o contador de delegações consecutivas da sessão (persistido em
// arquivo, pois cada hook é processo novo) e NEGA o 3º sem turno humano no meio.
//
// O reset por turno humano é feito pelo hook irmão hitl-reset.mjs (UserPromptSubmit),
// proxy do `chat.message` do opencode.
//
// DenyError -> exit 2 (block) · outro erro -> exit 0 (fail-open) · sem deny -> exit 0.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isKillSwitchOff, hitlOnTask, DenyError } from "../lib/gate-lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = join(HERE, "..", ".state", "hitl.json");

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
  const sessionId = payload?.session_id ?? payload?.sessionId ?? "default";
  const toolInput = payload?.tool_input ?? payload?.toolInput ?? {};
  const label = toolInput?.workflowPath ?? toolInput?.runLabel ?? "run_workflow";

  try {
    hitlOnTask({ sessionId, statePath: STATE_PATH, label });
    process.exit(0);
  } catch (err) {
    if (err instanceof DenyError) {
      process.stderr.write(
        `[harness gate] BLOQUEADO (${err.reason}): ${err.details?.count} delegações consecutivas ` +
          `sem turno humano. Pare e peça confirmação ao usuário antes de delegar de novo.\n`,
      );
      process.exit(2);
    }
    process.stderr.write(`[harness gate] fail-open (erro inesperado): ${err?.message ?? err}\n`);
    process.exit(0);
  }
}

main();
