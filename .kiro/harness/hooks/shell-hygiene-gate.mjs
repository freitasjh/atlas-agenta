#!/usr/bin/env node
// shell-hygiene-gate.mjs — chassi de hook `command` do Kiro para GATE-05.
//
// Registrado por .kiro/hooks/shell-hygiene-gate.json como PreToolUse no tool de
// shell. O Kiro passa um JSON no stdin com o contexto da chamada; este script:
//
//   1. honra o kill-switch HARNESS_GATES=off (exit 0 imediato, ADR-009);
//   2. extrai o comando bash do payload;
//   3. roda o gate puro em try/catch:
//        DenyError            -> exit 2  (bloqueia a tool; motivo no stderr)
//        qualquer outro erro  -> exit 0  (fail-open, ADR-006 — plugin quebrado
//                                         nunca paralisa o loop)
//        sem deny             -> exit 0  (allow)
//
// É a tradução fiel do harness: lá `throw DenyError` dentro de
// `tool.execute.before` negava a tool; aqui `process.exit(2)` nega. Mesma força.
import { readFileSync } from "node:fs";
import {
  isKillSwitchOff,
  loadHarnessConfig,
  extractBashCommand,
  gateShellHygiene,
  DenyError,
} from "../lib/gate-lib.mjs";

function readStdin() {
  // Lê todo o stdin (fd 0) de forma síncrona. Sem stdin (TTY/pipe vazio) -> "".
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

// O payload do Kiro traz os argumentos da tool. Procuramos o comando em vários
// shapes plausíveis (toolInput/input/args/parameters) — extractBashCommand faz o
// resto. Se o shape real divergir, ajusta-se aqui, não na lógica de decisão.
function extractCommandFromPayload(payload) {
  const candidates = [
    payload?.toolInput,
    payload?.tool_input,
    payload?.input,
    payload?.args,
    payload?.parameters,
    payload,
  ];
  for (const c of candidates) {
    const cmd = extractBashCommand(c);
    if (cmd && cmd.length > 0) return cmd;
  }
  return "";
}

function main() {
  // 1. Kill-switch: só o env desliga.
  if (isKillSwitchOff(process.env)) process.exit(0);

  const payload = parsePayload(readStdin());

  try {
    const config = loadHarnessConfig();
    const command = extractCommandFromPayload(payload);
    gateShellHygiene({ command, protectedPaths: config?.protectedPaths ?? [] });
    // sem deny -> allow
    process.exit(0);
  } catch (err) {
    if (err instanceof DenyError) {
      // Deny intencional: bloqueia com motivo acionável no stderr.
      process.stderr.write(
        `[harness gate] BLOQUEADO (${err.reason}): ${JSON.stringify(err.details)}\n`,
      );
      process.exit(2);
    }
    // ADR-006: qualquer outro erro faz fail-open (allow). Um gate quebrado não
    // pode paralisar o dev loop.
    process.stderr.write(`[harness gate] fail-open (erro inesperado): ${err?.message ?? err}\n`);
    process.exit(0);
  }
}

main();
