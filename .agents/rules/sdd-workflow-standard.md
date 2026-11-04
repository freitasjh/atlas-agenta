# SDD Workflow Standard (MANDATORY)

Esta regra define o contrato rigoroso de organização de arquivos e gestão de estado para todo o ciclo de vida de desenvolvimento (SDD) no projeto Atlas ECM.

## 1. Organização de Arquivos (File Structure)

Todos os artefatos de especificação e planejamento devem ser organizados por camada (backend/frontend) e agrupados por contexto de funcionalidade.

### Estrutura de Diretórios:
- **Backend**: `.spec/backend/[feature-or-bugfix-context]/`
- **Frontend**: `.spec/frontend/[feature-or-bugfix-context]/`
- **Produto (PRD→ADR)**: `.spec/prd/[prd-id]/` — bucket de artefatos de produto, **non-cycle** (mecanismo: `SPEC_NON_CYCLE` inclui `"prd"` em `scripts/sdd-checks.mjs` — ⚠️ **não existe neste repo** — 🟡 processo, sem mecanismo; quando o check roda, o dir nunca é reconhecido como ciclo SDD; layout/contrato em `.agents/rules/prd-adr-pipeline.md`)

### Artefatos Obrigatórios por Funcionalidade:
Cada pasta de funcionalidade deve conter:
1. `SPEC.md`: Especificação técnica prescritiva (gerada pelo `sdd-compiler`).
2. `PLAN.md`: Plano de implementação detalhado (gerado pelo `sdd-compiler`).
3. `TASKS.md`: Backlog de tarefas TDD-ready (gerado pelo `sdd-compiler`).

## 2. Gestão de Estado Global (`workflow-state.json`)

O arquivo `workflow-state.json` deve residir na **raiz do projeto**. Ele é a única fonte de verdade para o progresso do desenvolvimento.

### Campos Obrigatórios:
- `current_feature`: Nome da funcionalidade em desenvolvimento (ou bugfix).
- `current_phase`: Fase atual (Discovery, Planning, Execution, Testing, Completed — ou BugAnalysis, BugFix, BugReview, BugCompleted para bugfixes).
- `previous_phase`: Fase imediatamente anterior.
- `next_phase`: Próxima fase planejada.
- `artifacts`: Caminhos absolutos para SPEC, PLAN e TASKS (ou TASKS.md para bugfix).
- `type`: `feature` ou `bugfix` (indica se é funcionalidade ou correção).
- `last_update`: Timestamp da última alteração.

### Campos Aditivos (opcionais, nunca destrutivos):
- `prd_adr` (SPEC §4.3): `{ prd_id, prd_status: draft|approved|archived, active_adr, adr_order[], snapshots[{adr, follow_ups_count, escalations_count, at}] }`. **Dono**: o orquestrador — escrito/atualizado no **merge de cada ADR** (mesmo dono do bloco). Estritamente aditivo: nenhum campo existente é renomeado/removido e nenhum valor novo de `current_phase` é criado (🟡 processo — sem mecanismo: o `gate.js` só compara com `Completed`, não há conjunto canônico que recuse).
- `follow_ups[].created_at`: **todo** item de `follow_ups[]` carrega `created_at` (ISO-8601; base de derivação declarada em `follow_ups_created_at_basis`). **Dono**: o orquestrador (mesmo dono do bloco `prd_adr`). **Mecanismo**: o guard do teste `prd-checks.spec.mjs` (PAP-12/NFR-6) exige `typeof created_at === "string"` em cada item — um follow-up sem `created_at` deixa a suíte vermelha. **Nível**: 🟡 processo (é o teste que cobra; **não** é deny — o `gate.js` não lê `follow_ups`).

## 3. Registro de Progresso (`spec-developed.md`)

O arquivo `spec-developed.md` na **raiz do projeto** deve listar cronologicamente todas as funcionalidades desenvolvidas e suas respectivas etapas concluídas.

## 4. Portão de Aprovação e Feedback
Antes de avançar entre as fases (SPEC -> PLAN -> TASKS), o `sdd-orquestrador` deve obrigatoriamente:
1. Validar o artefato contra os `asserts` da skill `sdd-compiler`.
2. Invocar skill `spec-review` para revisar SPEC.md contra regras do projeto.
3. Gerar relatório de gaps e conformidade (com scorecard por categoria).
4. Corrigir gaps 🔴 críticos e 🟠 alta prioridade antes de avançar.
5. Solicitar aprovação explícita do usuário via `ask_user`.

## 5. Persistência no Brain
Ao concluir as TASKS, o `planejador` deve consolidar a análise e as lições aprendidas em uma nota estruturada no sistema de memória (brain, ver `BRAIN.MCP.md`).
