#!/usr/bin/env node
// hitl-reset.mjs — hook `command` do Kiro em UserPromptSubmit.
//
// Proxy do `chat.message` do opencode: quando o humano manda uma mensagem, zera
// o contador de delegações consecutivas da sessão (GATE-04). Nunca bloqueia —
// sempre exit 0. É o par do hitl-gate.mjs.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isKillSwitchOff, hitlOnHumanTurn } from "../lib/gate-lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = join(HERE, "..", ".state", "hitl.json");

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function main() {
  if (isKillSwitchOff(process.env)) process.exit(0);
  let payload = {};
  try {
    payload = JSON.parse(readStdin());
  } catch {
    payload = {};
  }
  const sessionId = payload?.session_id ?? payload?.sessionId ?? "default";
  try {
    hitlOnHumanTurn({ sessionId, statePath: STATE_PATH });
  } catch {
    // best-effort; nunca bloqueia.
  }
  process.exit(0);
}

main();
