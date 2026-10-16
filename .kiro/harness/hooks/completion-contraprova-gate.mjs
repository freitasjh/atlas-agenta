#!/usr/bin/env node
// completion-contraprova-gate.mjs — chassi de hook `command` do Kiro para GATE-03.
//
// Registrado por .kiro/hooks/completion-contraprova-gate.json como PreToolUse
// matcher `fs_write|str_replace`. Só age quando a escrita é a CONCLUSÃO do
// dev-pipeline: qa-review.json com verdict "approved". Nesse caso RE-EXECUTA
// commands.suiteFull e NEGA se a suíte não passar (verificador ≠ executor).
//
// Qualquer outra escrita -> não é alvo -> exit 0.
// DenyError -> exit 2 (block) · outro erro -> exit 0 (fail-open) · ok -> exit 0.
//
// NOTA: re-executar ./mvnw verify leva minutos. O hook JSON define um timeout
// generoso; aqui respeitamos contraproveTimeoutMs do config.
import { readFileSync } from "node:fs";
import {
  isKillSwitchOff,
  loadHarnessConfig,
  isCompletionApproval,
  gateCompletionContraprova,
  DenyError,
} from "../lib/gate-lib.mjs";

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
  const toolName = payload?.tool_name ?? payload?.toolName ?? "";
  const toolInput = payload?.tool_input ?? payload?.toolInput ?? {};
  const repoRoot = payload?.cwd ?? process.cwd();

  // Só a escrita de conclusão (qa-review.json approved) é alvo.
  if (!isCompletionApproval({ toolName, toolInput, repoRoot })) process.exit(0);

  try {
    const config = loadHarnessConfig();
    const command = config?.commands?.suiteFull;
    gateCompletionContraprova({
      command,
      timeoutMs: config?.contraproveTimeoutMs ?? 900000,
      cwd: repoRoot,
    });
    process.exit(0);
  } catch (err) {
    if (err instanceof DenyError) {
      process.stderr.write(
        `[harness gate] BLOQUEADO (${err.reason}): a conclusão declara "approved" mas a ` +
          `contraprova (re-execução de suiteFull) não passou ${JSON.stringify(err.details)}. ` +
          `Corrija a suíte antes de aprovar.\n`,
      );
      process.exit(2);
    }
    process.stderr.write(`[harness gate] fail-open (erro inesperado): ${err?.message ?? err}\n`);
    process.exit(0);
  }
}

main();
