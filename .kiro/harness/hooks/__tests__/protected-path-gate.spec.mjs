// Prova de ponta a ponta do gate de path protegido (GATE-05, tools de escrita).
// Shape do Kiro confirmado empiricamente: fs_write passa path ABSOLUTO em
// tool_input.path; cwd é a raiz do repo usada para rebaixar a relativo.
//
//   node --test .kiro/harness/hooks/__tests__/protected-path-gate.spec.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "protected-path-gate.mjs");
const REPO = "/home/joao/fusionlf/wsProjeto/boleto";

function runGate(toolName, toolInput, env = {}) {
  const baseEnv = { ...process.env };
  delete baseEnv.HARNESS_GATES;
  const payload = {
    session_id: "sess_test",
    hook_event_name: "PreToolUse",
    cwd: REPO,
    tool_name: toolName,
    tool_input: toolInput,
  };
  const res = spawnSync("node", [SCRIPT], {
    input: JSON.stringify(payload),
    env: { ...baseEnv, ...env },
    encoding: "utf8",
  });
  return { code: res.status, stderr: res.stderr ?? "" };
}

test("nega fs_write em .kiro/hooks/** (path absoluto, exit 2)", () => {
  const { code, stderr } = runGate("fs_write", { path: `${REPO}/.kiro/hooks/evil.json`, text: "x" });
  assert.equal(code, 2);
  assert.match(stderr, /protected-path-write/);
});

test("nega str_replace em migration Flyway (exit 2)", () => {
  const { code } = runGate("str_replace", {
    path: `${REPO}/backend/boleto-infrastructure/src/main/resources/db/migration/V2__x.sql`,
  });
  assert.equal(code, 2);
});

test("nega fs_append em steering (exit 2)", () => {
  const { code } = runGate("fs_append", { path: `${REPO}/.kiro/steering/tech.md`, text: "x" });
  assert.equal(code, 2);
});

test("nega escrita em pom.xml do backend (exit 2)", () => {
  const { code } = runGate("fs_write", { path: `${REPO}/backend/pom.xml`, text: "x" });
  assert.equal(code, 2);
});

test("permite escrita em código de aplicação (exit 0)", () => {
  const { code } = runGate("fs_write", {
    path: `${REPO}/backend/boleto-domain/src/main/java/com/boleto/domain/empresa/Empresa.java`,
    text: "x",
  });
  assert.equal(code, 0);
});

test("permite escrita no frontend (exit 0)", () => {
  const { code } = runGate("fs_write", { path: `${REPO}/frontend/src/views/Login.vue`, text: "x" });
  assert.equal(code, 0);
});

test("permite path relativo fora de protegido (exit 0)", () => {
  const { code } = runGate("fs_write", { path: "backend/README.md", text: "x" });
  assert.equal(code, 0);
});

test("nega path relativo em protegido (exit 2)", () => {
  const { code } = runGate("fs_write", { path: ".kiro/harness/lib/gate-lib.mjs", text: "x" });
  assert.equal(code, 2);
});

test("tool não-escrita não é alvo (exit 0)", () => {
  const { code } = runGate("read_file", { path: `${REPO}/.kiro/hooks/evil.json` });
  assert.equal(code, 0);
});

test("kill-switch HARNESS_GATES=off permite tudo (exit 0)", () => {
  const { code } = runGate("fs_write", { path: `${REPO}/.kiro/hooks/evil.json`, text: "x" }, { HARNESS_GATES: "off" });
  assert.equal(code, 0);
});
