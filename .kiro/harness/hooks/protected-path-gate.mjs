#!/usr/bin/env node
// protected-path-gate.mjs — chassi de hook `command` do Kiro para GATE-05
// (escrita em path protegido pelas tools de arquivo).
//
// Registrado por .kiro/hooks/protected-path-gate.json como PreToolUse com
// matcher `fs_write|str_replace|fs_append`. Complementa o shell-hygiene-gate
// (que pega redirect/tee via bash): aqui pegamos a escrita direta pelas tools.
//
// Shape do stdin confirmado empiricamente:
//   { session_id, hook_event_name, cwd, tool_name, tool_input:{path, text|...} }
// O Kiro manda path ABSOLUTO; usamos cwd (= raiz do repo) para rebaixar a
// relativo antes de casar contra protectedPaths.
//
// DenyError -> exit 2 (block) · outro erro -> exit 0 (fail-open) · sem deny -> exit 0.
import { readFileSync } from "node:fs";
import {
  isKillSwitchOff,
  loadHarnessConfig,
  gateProtectedPathWrite,
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
  const toolInput = payload?.tool_input ?? payload?.toolInput ?? payload?.input ?? {};
  const repoRoot = payload?.cwd ?? process.cwd();

  try {
    const config = loadHarnessConfig();
    gateProtectedPathWrite({
      toolName,
      toolInput,
      protectedPaths: config?.protectedPaths ?? [],
      repoRoot,
    });
    process.exit(0);
  } catch (err) {
    if (err instanceof DenyError) {
      process.stderr.write(
        `[harness gate] BLOQUEADO (${err.reason}): escrita em path protegido ` +
          `${JSON.stringify(err.details)}. Edite via delegação (developer) ou abra exceção.\n`,
      );
      process.exit(2);
    }
    process.stderr.write(`[harness gate] fail-open (erro inesperado): ${err?.message ?? err}\n`);
    process.exit(0);
  }
}

main();
