// Prova do GATE-04 (pausa HITL). Testa a lógica pura com persistência em arquivo
// temporário (controle total do estado) e um e2e dos scripts reais.
//
//   node --test .kiro/harness/hooks/__tests__/hitl-gate.spec.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  hitlOnTask,
  hitlOnHumanTurn,
  checkHitl,
  DenyError,
} from "../../lib/gate-lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, "..", "hitl-gate.mjs");
const RESET = join(HERE, "..", "hitl-reset.mjs");
const REAL_STATE = join(HERE, "..", "..", ".state", "hitl.json");

function tmpState() {
  const dir = mkdtempSync(join(tmpdir(), "hitl-"));
  return { path: join(dir, "hitl.json"), dir };
}

// --- Lógica pura ---
test("checkHitl: 1 e 2 permitem, 3 nega", () => {
  assert.equal(checkHitl(1), true);
  assert.equal(checkHitl(2), true);
  assert.throws(() => checkHitl(3), DenyError);
});

test("hitlOnTask: 3ª delegação consecutiva nega", () => {
  const { path, dir } = tmpState();
  try {
    const s = "sess_A";
    assert.equal(hitlOnTask({ sessionId: s, statePath: path }), true); // 1
    assert.equal(hitlOnTask({ sessionId: s, statePath: path }), true); // 2
    assert.throws(() => hitlOnTask({ sessionId: s, statePath: path }), DenyError); // 3
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("turno humano no meio reseta e re-permite", () => {
  const { path, dir } = tmpState();
  try {
    const s = "sess_B";
    hitlOnTask({ sessionId: s, statePath: path }); // 1
    hitlOnTask({ sessionId: s, statePath: path }); // 2
    hitlOnHumanTurn({ sessionId: s, statePath: path }); // reset
    assert.equal(hitlOnTask({ sessionId: s, statePath: path }), true); // 1 de novo
    assert.equal(hitlOnTask({ sessionId: s, statePath: path }), true); // 2
    assert.throws(() => hitlOnTask({ sessionId: s, statePath: path }), DenyError); // 3
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("contador é isolado por sessão", () => {
  const { path, dir } = tmpState();
  try {
    hitlOnTask({ sessionId: "s1", statePath: path });
    hitlOnTask({ sessionId: "s1", statePath: path });
    // outra sessão começa do zero
    assert.equal(hitlOnTask({ sessionId: "s2", statePath: path }), true);
    assert.equal(hitlOnTask({ sessionId: "s2", statePath: path }), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- E2E dos scripts reais (usam o state path real; limpa antes/depois) ---
function cleanRealState() {
  if (existsSync(REAL_STATE)) rmSync(REAL_STATE, { force: true });
}

function runGate(sessionId) {
  const baseEnv = { ...process.env };
  delete baseEnv.HARNESS_GATES;
  const payload = {
    session_id: sessionId,
    hook_event_name: "PreToolUse",
    cwd: "/home/joao/fusionlf/wsProjeto/boleto",
    tool_name: "run_workflow",
    tool_input: { workflowPath: "bundled://investigate" },
  };
  return spawnSync("node", [GATE], { input: JSON.stringify(payload), env: baseEnv, encoding: "utf8" }).status;
}

function runReset(sessionId) {
  const baseEnv = { ...process.env };
  delete baseEnv.HARNESS_GATES;
  const payload = { session_id: sessionId, hook_event_name: "UserPromptSubmit" };
  return spawnSync("node", [RESET], { input: JSON.stringify(payload), env: baseEnv, encoding: "utf8" }).status;
}

test("e2e: scripts reais negam o 3º e reset re-permite", () => {
  cleanRealState();
  try {
    assert.equal(runGate("e2e"), 0); // 1
    assert.equal(runGate("e2e"), 0); // 2
    assert.equal(runGate("e2e"), 2); // 3 -> block
    assert.equal(runReset("e2e"), 0); // turno humano
    assert.equal(runGate("e2e"), 0); // 1 de novo
  } finally {
    cleanRealState();
  }
});

test("e2e: kill-switch HARNESS_GATES=off nunca bloqueia", () => {
  cleanRealState();
  try {
    const payload = {
      session_id: "ks",
      tool_name: "run_workflow",
      tool_input: { workflowPath: "x" },
    };
    const run = () =>
      spawnSync("node", [GATE], {
        input: JSON.stringify(payload),
        env: { ...process.env, HARNESS_GATES: "off" },
        encoding: "utf8",
      }).status;
    assert.equal(run(), 0);
    assert.equal(run(), 0);
    assert.equal(run(), 0); // seria o 3º, mas off
  } finally {
    cleanRealState();
  }
});
