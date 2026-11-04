# harness-report — contrato de evidência (EV-01)

> Skill de documentação normativa, não de enforcement. Nenhuma linha aqui
> bloqueia tool: o bloqueio vive em `gate.js` + CI (ver
> `.agents/rules/gate-contract.md`). Promessa de enforcement sem mecanismo
> citado = defeito — mesma regra do DOC-01.

## 1. O que é o REPORT

`harness/<demand>.json` é **evidência auto-declarada pelo executor**
(SPEC ADR-002). Ele **não** é prova. A prova é a **contraprova**: o gate
re-executa o comando canônico selado lido de `harness.config.json`
(`commands.suiteFull`) e compara exit code + contagens com o declarado;
divergência ⇒ `DenyError` (SPEC ADR-002; RUNTIME-CONTRACT §6).

- **Schema canônico:** `.agents/schemas/harness-report.schema.json`
  (= SPEC §5.2, campo a campo).
- **Path canônico:** chave `evidence.path` do `harness.config.json`
  (`harness/` neste repo; SPEC §5.1).
- **Comando canônico:** chave `commands.*` do `harness.config.json`,
  nunca copiado de prosa (SPEC ADR-003).
- **Concluído ≠ prosa:** nenhum hook bloqueia declaração em linguagem
  natural (RUNTIME-CONTRACT H5). Concluído = `workflow-state.json` com
  `current_phase: "Completed"` **com contraprova** (SPEC ADR-008).

## 2. Campos (resumo — o normativo é o schema)

| Campo | Obrig. | Nota |
|---|---|---|
| `version`, `demand`, `agent`, `phase`, `gitSha` | ✅ | identificação; `gitSha` é chave de cache da contraprova (SPEC ADR-002) |
| `commands[]` | ✅, ≥1 | `{cmd, exitCode, durationMs, stdoutHash}` por comando |
| `counts.{unit,it,frontend}.{passed,failed,skipped}` | ✅ | inteiros ≥ 0; é o que a contraprova compara |
| `evaluation` | ✅ | H4: telas/negócio/lógica/perf (objeto; `n/a` explícito quando não aplicável) |
| `brainStore` | ✅ | array de paths salvos no Brain |
| `cleanup` | ✅ | objeto: portas/processos liberados (encerramento por `lsof -ti :PORT` + `kill` por PID — nunca `pkill -f`, SPEC I7) |
| `selfReported` | ✅ | `true` quando o exit code não foi observado de forma independente (SPEC ADR-002) |
| `e2e` | condicional | obrigatório quando `escalateOnRisk` dispara (mudança em `riskPaths` — SPEC §5.1) |

## 3. Exemplo VÁLIDO (passa no schema)

```json
{
  "version": 1,
  "demand": "harness-v7-batch6",
  "agent": "developer-engineer",
  "phase": "Execution",
  "gitSha": "unknown-no-git",
  "commands": [
    {
      "cmd": "node --test \".opencode/plugins/__tests__/*.spec.mjs\"",
      "exitCode": 0,
      "durationMs": 1234,
      "stdoutHash": "sha256:placeholder-para-o-hash-real-do-stdout"
    }
  ],
  "counts": {
    "unit": { "passed": 76, "failed": 0, "skipped": 0 },
    "it": { "passed": 0, "failed": 0, "skipped": 0 },
    "frontend": { "passed": 0, "failed": 0, "skipped": 0 }
  },
  "evaluation": {
    "telas": "n/a-docs-sem-ui",
    "negocio": "n/a-refactor-de-governanca",
    "logica": "ok",
    "perf": "n/a"
  },
  "brainStore": [],
  "cleanup": { "ports": [], "note": "nenhum servidor subido neste batch" },
  "selfReported": true
}
```

## 4. Exemplo INVÁLIDO (falha no schema — sem `counts`, sem `selfReported`)

```json
{
  "version": 1,
  "demand": "harness-v7-batch6",
  "agent": "developer-engineer",
  "phase": "Execution",
  "gitSha": "unknown-no-git",
  "commands": [
    {
      "cmd": "node --test \".opencode/plugins/__tests__/*.spec.mjs\"",
      "exitCode": 0,
      "durationMs": 1234,
      "stdoutHash": "sha256:placeholder"
    }
  ],
  "evaluation": {},
  "brainStore": [],
  "cleanup": {}
}
```

Motivo da falha: ausentes `counts` e `selfReported`, ambos em
`required` do schema (mesmo critério de CFG-02/S2 em TASKS.md).

## 5. Como validar (demonstração EV-01)

Validador do subconjunto de JSON Schema usado pelo schema
(`type`, `required`, `properties`, `items`, `minItems`, `minimum`,
`$ref`/`$defs` — cobertura total dos construtos presentes no arquivo):

```sh
node /tmp/harness-batch6/validate.mjs \
  .agents/schemas/harness-report.schema.json \
  /tmp/harness-batch6/valid.json    # esperado: VALID
node /tmp/harness-batch6/validate.mjs \
  .agents/schemas/harness-report.schema.json \
  /tmp/harness-batch6/invalid.json  # esperado: INVALID (counts, selfReported)
```

## 6. Regras de escrita (para o subagente que produz o REPORT)

1. Um REPORT por demanda (`harness/<demand>.json` — sem escrita concorrente, SPEC §5.2).
2. `counts` reflete o que a suite imprimiu; inventar contagem = deny na contraprova (SPEC ADR-002).
3. `selfReported: true` salvo quando o exit code não foi observado de forma independente.
4. Comandos transcritos de `harness.config.json`; selo `sha256` verificado pelo gate — trocar `suiteFull` por `true` ⇒ `DenyError sealed-command-mismatch` (SPEC ADR-002/U6=b).
5. Re-execução além de `contraproveTimeoutMs` ⇒ deny `contraprove-timeout`: inconclusivo ≠ prova (SPEC ADR-002).
6. Quem revisa código (`code-reviewer`) não escreve REPORT; o veredito dele alimenta `code_review_status` via orquestrador (SPEC §5.3, ADR-008 âncora B).
