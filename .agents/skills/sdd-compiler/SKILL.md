---
name: sdd-compiler
description: "Deterministic Architectural Compiler, v2: produces SPEC and TASKS per ADR (spec-from-adr, tasks-from-adr) plus verify and archive. Legacy whole-feature modes are documented but inactive."
---

# SDD Compiler v2 — por ADR (unidade de entrega)

O compilador da metodologia SDD. Desde a v2 a **unidade de entrega é o ADR**
(`workflow.md` §1): não existe SPEC/TASKS de funcionalidade inteira. O ciclo é
`PRD → RESEARCH → ADR-INDEX → loop por ADR (ADR.md → SPEC.md → TASKS.md →
implementar → VERIFY.md) → archive`, com 1 ADR = 1 branch = 1 PR.

Todo artefato nasce em `.spec/prd/{prd-id}/ADRs/ADR-00N-{slug}/` — o `PRD.md` e o
`RESEARCH.md` são insumo, não destino. Fluxo e portões: `.agents/rules/workflow.md`;
contrato da esteira: `.agents/rules/prd-adr-pipeline.md`.

---

## 🛠️ Modos ativos

### 1. `spec-from-adr` (SPEC do ADR)

**Entradas**: `ADRs/ADR-00N-{slug}/ADR.md`, `PRD.md` (escopo/§9), `RESEARCH.md`,
regras vivas (`.agents/rules/**`, `AGENTS.md`) e código afetado.

**Processo**
1. Ler a decisão, o `depende-de` e a **interface congelada** do ADR — a SPEC é
   a especificação *daquela* decisão, não do produto inteiro.
2. Aplicar `references/spec-template.md`.
3. Numerar requisitos rastreáveis ao ADR: `RF-0N`/`NFR-0N` com o item do ADR que
   os origina (decisão, interface congelada, consequências).
4. Critérios de aceite **executáveis** (comando/asserção), não adjetivos.
5. Delta Specs quando a decisão altera doc vivo (`references/delta-template.md`).
6. Nunca criar `PLAN.md`: o ADR já é o plano; `TASKS.md` vem do modo 2.

**Saída**: `ADRs/ADR-00N-{slug}/SPEC.md`.
**Asserts**: `asserts/spec-gate.md` (RF/NFR, invariantes, test strategy, delta).
**Atomicidade**: o `ADR-INDEX.md` deve ter `unit: adr` na linha deste ADR e o
`PRD.md` pode declarar `prd_version: 2` (`ADR-02` exige `unit: adr` em
`in-progress`/`merged` nesse caso).

---

### 2. `tasks-from-adr` (TASKS do ADR)

**Entradas**: `SPEC.md` do ADR + `ADR.md` (interface congelada). `PLAN.md` não é
requisito nem destino.

**Processo**
1. Explodir cada `RF`/`NFR` da SPEC em tickets TDD-ready.
2. Enriquecer cada ticket: risco, prioridade, tipo, arquivos físicos, cenários
   BDD (sucesso, falha, borda), teste **antes** da implementação.
3. Emitir cada tarefa como seção `### <ID> — <título>`, onde `<ID>` casa
   `[A-Z]+(?:-[A-Z]+)*-\d+` (ex.: `### F3A-01 — Checks de layout`). É o formato
   que `extractTaskSections` reconhece (`scripts/sdd-checks.mjs`).
4. Tabela de sprint-summary é **opcional**; se existir, todo ID da tabela precisa
   de seção 1:1 (sem órfãos).

**Saída**: `ADRs/ADR-00N-{slug}/TASKS.md`.
**Asserts**: `asserts/tasks-gate.md`.

---

### 3. `verify` (pós-implementação, no diretório do ADR)

**Entradas**: `ADR.md`, `SPEC.md`, `TASKS.md` (com checkboxes), código, comando
canônico de `harness.config.json` (`commands.suiteFull`).

**Processo**
1. **Completeness**: todos os checkboxes de `TASKS.md` marcados; zero TODO/FIXME
   novo; nenhuma task "N/A" sem justificativa.
2. **Correctness**: `commands.suiteFull` verde; cada `RF`/`NFR` da SPEC tem
   correspondência verificável no código.
3. **Coherence**: a interface congelada do ADR aparece no código; naming e
   boundaries respeitados; Delta Specs refletidos nos docs vivos.
4. Frontend: Chrome DevTools (Network + Console — zero `[ERROR]`/`[WARN]`).
5. Reportar as 3 dimensões com ✅/❌ e os gaps.

**Saída**: `ADRs/ADR-00N-{slug}/VERIFY.md` (ADR `merged` exige este arquivo —
`ADR-01` quando `unit: adr`).
**Asserts**: `asserts/verify-gate.md`. **BLOQUEIA archive** se qualquer dimensão falhar.

---

### 4. `archive` (fechamento do PRD)

**Pré-condições**: `VERIFY.md` aprovado em **todos** os ADRs `merged` do PRD;
`ADR-INDEX.md` 1:1 com o disco.

**Processo**
1. Mesclar as **Delta Specs** de cada SPEC nos docs alvo (`.agents/rules/**`,
   `AGENTS.md`): ADDED cria, MODIFIED substitui, REMOVED move para `## Deprecated`
   com data.
2. Mover o **PRD inteiro**: `.spec/prd/{prd-id}/` → `.spec/archive/[YYYYMMDD]-prd-{prd-id}/`
   (ADR-INDEX, PRD, RESEARCH e todos os `ADRs/**` vão juntos; nada fica para trás).
3. Registrar data, duração e arquivos alterados no `PRD.md` arquivado.
4. Sugerir o commit (nunca executar sem confirmação):
   ```
   feat: archive prd-{prd-id} — SDD per ADR complete

   Spec: .spec/archive/[YYYYMMDD]-prd-{prd-id}/
   Delta merged into: .agents/rules/[affected-docs]
   ```

---

## 🧭 Modo de investigação

### `explore` (pré-PRD)
Investigar requisitos incertos ANTES de criar artefatos: perguntas em aberto,
sistemas tocados, hipóteses e alternativas. **Saída**: nenhum artefato próprio —
é insumo em prosa (o documento de exploração é do `engineer`, autor único).
**NÃO gera SPEC.md.**

---

## 🗄️ Modos legados (inativos — só para ciclos de 4 artefatos)

Mantidos para ciclos `unit: legacy`/congelados (`.spec/backend|frontend/**`).
Não são o caminho de feature nova (`workflow.md` §3).

| Modo | Saída | Assert | Template |
|---|---|---|---|
| `generate-proposal` | `PROPOSAL.md` | `proposal-gate.md` | `references/proposal-template.md` |
| `generate-spec` | `SPEC.md` | `spec-gate.md` | `references/spec-template.md` |
| `generate-plan` | `PLAN.md` | `plan-gate.md` | `references/plan-template.md` |
| `generate-tasks` | `TASKS.md` | `tasks-gate.md` | `references/task-template.md` |

Os **templates continuam versionados** para esses ciclos; a lista ativa é a dos
modos 1–4 acima.

---

## 🚦 Portões de Validação (Asserts)

| Fase (v2) | Assert File |
|------|-------------|
| SPEC do ADR (`spec-from-adr`) | `.agents/skills/sdd-compiler/asserts/spec-gate.md` |
| TASKS do ADR (`tasks-from-adr`) | `.agents/skills/sdd-compiler/asserts/tasks-gate.md` |
| VERIFY (`verify`) | `.agents/skills/sdd-compiler/asserts/verify-gate.md` |
| Traceability (pré-archive) | `.agents/skills/sdd-compiler/asserts/traceability-gate.md` |

Legado: `proposal-gate.md`, `plan-gate.md`.

---

## 📚 Referências (Templates)

Pasta `.agents/skills/sdd-compiler/references/`:
- `spec-template.md`, `task-template.md`, `delta-template.md`, `trace-template.md`
- Legado: `proposal-template.md`, `plan-template.md`
- Domínio: `healthcare.md`, `fintech.md`, `saas-multitenant.md`, `api.md`,
  `backend.md`, `frontend.md`, `database.md`, `cloud.md`, `security.md`,
  `ecommerce.md`

---

## 🔗 Regras Críticas (MANDATÓRIO)

1. **Unidade = ADR**: SPEC/TASKS existem dentro de `ADRs/ADR-00N-{slug}/`; nunca
   na raiz de `.spec/backend|frontend/**` para feature nova.
2. **Rastreabilidade 1:1**: todo `RF`/`NFR` da SPEC vira task; toda task da tabela
   (quando houver) tem seção.
3. **TDD First**: o teste aparece ANTES da implementação em cada task.
4. **Multi-tenancy / Event Integrity**: isolamento de tenant e ciclo
   Producer → Outbox → Broker → Consumer validados quando aplicáveis.
5. **Verify antes de archive**: nunca arquivar sem `VERIFY.md` aprovado.
6. **Delta rastreável**: toda SPEC que altera doc vivo declara o delta.
7. **`unit: adr`**: o índice marca o layout; `ADR-02` cobra em PRD `prd_version: 2`.
