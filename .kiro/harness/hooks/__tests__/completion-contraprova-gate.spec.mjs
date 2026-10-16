// Prova do GATE-03 (contraprova de conclusão).
// A lógica pura é testada com execFn injetado (a suíte real NUNCA roda no teste).
// O e2e do script prova o targeting (só qa-review.json approved é alvo) e o
// kill-switch, sem disparar ./mvnw verify.
//
//   node --test .kiro/harness/hooks/__tests__/completion-contraprova-gate.spec.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  isCompletionApproval,
  gateCompletionContraprova,
  DenyError,
  DENY_CONTRAPROVE_DIVERGENT,
  DENY_CONTRAPROVE_TIMEOUT,
  DENY_COMPLETED_NO_EVIDENCE,
} from "../../lib/gate-lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "completion-contraprova-gate.mjs");
const REPO = "/home/joao/fusionlf/wsProjeto/boleto";

// --- isCompletionApproval ---
test("reconhece escrita de qa-review.json com verdict approved", () => {
  assert.equal(
    isCompletionApproval({
      toolName: "fs_write",
      toolInput: {
        path: `${REPO}/.agents/tasks/dev-pipeline/qa-review.json`,
        text: '{"verdict":"approved"}',
      },
      repoRoot: REPO,
    }),
    true,
  );
});

test("não é alvo: qa-review.json com changes_requested", () => {
  assert.equal(
    isCompletionApproval({
      toolName: "fs_write",
      toolInput: {
        path: `${REPO}/.agents/tasks/dev-pipeline/qa-review.json`,
        text: '{"verdict":"changes_requested","issues":["x"]}',
      },
      repoRoot: REPO,
    }),
    false,
  );
});

test("não é alvo: escrita em outro arquivo", () => {
  assert.equal(
    isCompletionApproval({
      toolName: "fs_write",
      toolInput: { path: `${REPO}/backend/x.java`, text: '{"verdict":"approved"}' },
      repoRoot: REPO,
    }),
    false,
  );
});

// --- gateCompletionContraprova (execFn injetado) ---
test("permite quando a suíte passa (exit 0)", () => {
  assert.equal(
    gateCompletionContraprova({ command: "fake", execFn: () => ({ exitCode: 0 }) }),
    true,
  );
});

test("nega quando a suíte falha (contraprove-divergent)", () => {
  assert.throws(
    () => gateCompletionContraprova({ command: "fake", execFn: () => ({ exitCode: 1 }) }),
    (e) => e instanceof DenyError && e.reason === DENY_CONTRAPROVE_DIVERGENT,
  );
});

test("nega em timeout (contraprove-timeout)", () => {
  assert.throws(
    () => gateCompletionContraprova({ command: "fake", execFn: () => ({ timedOut: true }) }),
    (e) => e instanceof DenyError && e.reason === DENY_CONTRAPROVE_TIMEOUT,
  );
});

test("fail-closed sem comando canônico (completed-no-evidence)", () => {
  assert.throws(
    () => gateCompletionContraprova({ command: "", execFn: () => ({ exitCode: 0 }) }),
    (e) => e instanceof DenyError && e.reason === DENY_COMPLETED_NO_EVIDENCE,
  );
});

// --- E2E do script (sem disparar a suíte real) ---
function runScript(payload, env = {}) {
  const baseEnv = { ...process.env };
  delete baseEnv.HARNESS_GATES;
  const res = spawnSync("node", [SCRIPT], {
    input: JSON.stringify(payload),
    env: { ...baseEnv, ...env },
    encoding: "utf8",
  });
  return { code: res.status, stderr: res.stderr ?? "" };
}

test("e2e: escrita não-conclusão é ignorada (exit 0, não roda suíte)", () => {
  const { code } = runScript({
    cwd: REPO,
    tool_name: "fs_write",
    tool_input: { path: `${REPO}/backend/x.java`, text: "class X {}" },
  });
  assert.equal(code, 0);
});

test("e2e: changes_requested é ignorado (exit 0, não roda suíte)", () => {
  const { code } = runScript({
    cwd: REPO,
    tool_name: "fs_write",
    tool_input: {
      path: `${REPO}/.agents/tasks/dev-pipeline/qa-review.json`,
      text: '{"verdict":"changes_requested"}',
    },
  });
  assert.equal(code, 0);
});

test("e2e: kill-switch off ignora até a conclusão approved (exit 0, não roda suíte)", () => {
  const { code } = runScript(
    {
      cwd: REPO,
      tool_name: "fs_write",
      tool_input: {
        path: `${REPO}/.agents/tasks/dev-pipeline/qa-review.json`,
        text: '{"verdict":"approved"}',
      },
    },
    { HARNESS_GATES: "off" },
  );
  assert.equal(code, 0);
});
