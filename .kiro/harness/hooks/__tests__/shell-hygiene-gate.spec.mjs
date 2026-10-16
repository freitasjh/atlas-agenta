// Prova de ponta a ponta do chassi de hook GATE-05.
// Roda o script real como processo filho, alimentando o stdin com payloads
// plausíveis do Kiro, e verifica o exit code: 2 = block, 0 = allow.
//
//   node --test .kiro/harness/hooks/__tests__/shell-hygiene-gate.spec.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "shell-hygiene-gate.mjs");

function runGate(payload, env = {}) {
  // O host pode ter HARNESS_GATES=off no ambiente (kill-switch ligado). Para os
  // casos de enforce, limpamos o env herdado e deixamos o teste declarar o valor.
  const baseEnv = { ...process.env };
  delete baseEnv.HARNESS_GATES;
  const res = spawnSync("node", [SCRIPT], {
    input: JSON.stringify(payload),
    env: { ...baseEnv, ...env },
    encoding: "utf8",
  });
  return { code: res.status, stderr: res.stderr ?? "" };
}

test("nega pkill -f (exit 2)", () => {
  const { code, stderr } = runGate({ toolInput: { command: "pkill -f java" } });
  assert.equal(code, 2);
  assert.match(stderr, /pkill-f/);
});

test("nega escrita por redirect em path protegido (exit 2)", () => {
  const { code, stderr } = runGate({
    toolInput: { command: "echo x > .kiro/hooks/evil.json" },
  });
  assert.equal(code, 2);
  assert.match(stderr, /protected-path-write/);
});

test("nega tee em path protegido (exit 2)", () => {
  const { code } = runGate({
    toolInput: { command: "echo x | tee .kiro/steering/evil.md" },
  });
  assert.equal(code, 2);
});

test("permite comando benigno (exit 0)", () => {
  const { code } = runGate({ toolInput: { command: "ls -la backend" } });
  assert.equal(code, 0);
});

test("permite escrita fora de path protegido (exit 0)", () => {
  const { code } = runGate({
    toolInput: { command: "echo x > backend/boleto-domain/target/out.txt" },
  });
  assert.equal(code, 0);
});

test("kill-switch HARNESS_GATES=off permite tudo (exit 0)", () => {
  const { code } = runGate({ toolInput: { command: "pkill -f java" } }, { HARNESS_GATES: "off" });
  assert.equal(code, 0);
});

test("payload sem comando permite (exit 0)", () => {
  const { code } = runGate({ toolInput: {} });
  assert.equal(code, 0);
});

test("extrai comando de shapes alternativos (args.command)", () => {
  const { code } = runGate({ args: { command: "pkill -f node" } });
  assert.equal(code, 2);
});
