// Prova de ponta a ponta do gate PICCO (GATE-02).
// Usa o shape de payload do Kiro confirmado empiricamente:
//   { tool_name: "run_workflow", tool_input: { inputs: { task, workdir } } }
//
//   node --test .kiro/harness/hooks/__tests__/picco-gate.spec.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "..", "picco-gate.mjs");

function runGate(toolInput, env = {}) {
  const baseEnv = { ...process.env };
  delete baseEnv.HARNESS_GATES; // host pode ter HARNESS_GATES=off
  const payload = {
    session_id: "sess_test",
    hook_event_name: "PreToolUse",
    cwd: "/home/joao/fusionlf/wsProjeto/boleto",
    tool_name: "run_workflow",
    tool_input: toolInput,
  };
  const res = spawnSync("node", [SCRIPT], {
    input: JSON.stringify(payload),
    env: { ...baseEnv, ...env },
    encoding: "utf8",
  });
  return { code: res.status, stderr: res.stderr ?? "" };
}

const PICCO_OK = `<role>Analisa o diff procurando vazamento de camada</role>
<task>Entregar X em Y.</task>
<context>Projeto boleto</context>
<constraints>Sempre construtor explícito</constraints>
<acceptance>build verde</acceptance>
<open_questions></open_questions>`;

const PICCO_OK_COMMENT = `<task>Entregar X</task>
<open_questions><!-- nenhuma --></open_questions>`;

const PICCO_OPEN = `<task>Entregar X</task>
<open_questions>Qual banco usar?</open_questions>`;

test("permite delegação com PICCO e <open_questions> vazio (exit 0)", () => {
  const { code } = runGate({ inputs: { task: PICCO_OK, workdir: "/x" } });
  assert.equal(code, 0);
});

test("permite <open_questions> só com comentário (exit 0)", () => {
  const { code } = runGate({ inputs: { task: PICCO_OK_COMMENT } });
  assert.equal(code, 0);
});

test("nega delegação sem tag <open_questions> (exit 2, picco-tag-absent)", () => {
  const { code, stderr } = runGate({ inputs: { task: "só faz a feature de planos" } });
  assert.equal(code, 2);
  assert.match(stderr, /BLOQUEADO/);
});

test("nega <open_questions> não-vazio (exit 2, picco-tag-nonempty)", () => {
  const { code } = runGate({ inputs: { task: PICCO_OPEN } });
  assert.equal(code, 2);
});

test("delegação sem texto de demanda não é alvo (exit 0)", () => {
  const { code } = runGate({ inputs: { workdir: "/x" } });
  assert.equal(code, 0);
});

test("lê também workflowPrompt como fonte da demanda (exit 2 sem PICCO)", () => {
  const { code } = runGate({ workflowPrompt: "implementa a fase 1 agora" });
  assert.equal(code, 2);
});

test("kill-switch HARNESS_GATES=off permite tudo (exit 0)", () => {
  const { code } = runGate({ inputs: { task: "sem picco nenhum" } }, { HARNESS_GATES: "off" });
  assert.equal(code, 0);
});
