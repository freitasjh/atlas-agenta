# always-on — contrato mínimo carregado em todo agente

> Este é o **único** arquivo em `opencode.json.instructions`. As regras completas
> continuam em disco e são referenciadas por caminho na seção 7 — nada foi apagado.
> Prosa descreve; quem nega é `gate.js` + CI (`.agents/rules/gate-contract.md` §1).
> Nível de garantia: 🟢 runtime · 🟠 parcial/CI-dependente · 🟡 processo · 🔴 declarado-aberto.

## 1. Identidade

- Harness v2. Idioma pt_BR. Dados do projeto vêm de `harness.config.json`, nunca de literal de prosa (`.agents/rules/harness-config.md`; gate-contract.md I3 — V3 via CI, 🟢).
- `orchestrator` **não escreve código**: só `.spec/prd/**` (`permission.edit` = `{"*":"deny",".spec/**":"allow"}` em `opencode.json`, resolvido pela última regra que casa — ADR-002 §2.2/§3; 🟢 literal · 🟠 intenção, `bash` contorna).
- `frontend-engineer` e `backend-engineer` escrevem código e testes. `engineer` é md-only (`.spec/**`). `qa-engineer` grava `harness/<demand>.json`: escopo imposto pelo gate, não pela permissão (`isHarnessScoped` gate.js:565 + deny gate.js:669).
- Papéis de parecer, **sem `edit`**: `code-reviewer`, `ux-designer`, `security-engineer`, `design-system-specialist` (no v2 `write` é alias de `edit` — gate-contract.md I5).
- Nunca implementar sem spec (feature) ou análise (bugfix); nunca pular testes nem code review.

## 2. Prompt gate

Fonte completa: `.agents/rules/workflow-rules.md` §0 + skill `prompt-optimizer`.

- **Stage 0**: `brain_search` com o prompt literal + probe somente leitura (`AGENTS.md`, `harness.config.json`, globs de alto nível, eixo detectado). Contexto citável; nunca preencher lacuna do usuário com default do modelo.
- Contar **E1..E6 afirmados pelo usuário** (dedução da IA não conta): E1 objetivo, E2 escopo, E3 contexto, E4 restrições, E5 aceite, E6 intenção. Ausência: E1/E2 crítico, E3/E4 alto, E5/E6 médio.
- score < 6 ⇒ **Rota A**: PARAR; máx. 3 perguntas ordenadas por impacto, máx. 2 rodadas; nada é criado. Premissa não confirmada sobrevivente → `workflow-state.json.prompt_assumptions[]` (nunca vira fato no `<context>`).
- score = 6 ⇒ **Rota B**: bloco PICCO com delimiters `<role>/<task>/<context>/<constraints>/<acceptance>/<open_questions>` + **1 confirmação** antes de agir. `<open_questions>` vazio é válido; >10 constraints é defeito.
- Pedido que contradiz regra do projeto ⇒ **rota de conflito primeiro** (nomear a rule + caminho permitido + exceção explícita), só depois Rota A para o que falta.
- Mecanismo: `gatePiccoTask` (gate.js:490-513) no hook `ctx.tool.hook("execute.before", …)`; nega com `picco-tag-absent`/`picco-tag-nonempty` (gate.js:356-357). 🟢 para a tag obrigatória · 🟡 para E3..E6 (só aviso em `checkPicco`).

## 3. Fluxo — `current_phase` canônico e esteira

O estado canônico vive em `workflow-state.json`; rótulos de etapa são apelidos mapeados para ele (V17). Tabela integral em `.agents/rules/workflow.md` §0:

| Etapa (rótulo) | `current_phase` canônico |
|---|---|
| Explore, Proposal | Discovery |
| SPEC → PLAN → TASKS | Planning |
| PRD, RESEARCH | Discovery |
| ADR-INDEX, ADR | Planning |
| P0 (triagem) | Discovery |
| P1 (spec) | Planning |
| P2 (plan/tasks) | Planning |
| Implementação / P3 | Execution |
| Review + harness / P4 | Testing |
| Verify / P5 | Testing |
| Archive / P6 | Completed |
| Análise de bug | BugAnalysis |
| Correção de bug | BugFix |
| Revisão de bug | BugReview |

- Esteira: `PRD → RESEARCH → ADR-INDEX → ADR (ADR.md + SPEC.md + TASKS.md) → implementação → VERIFY → archive`. Nenhum `ADRs/**` nasce antes do bloco §16 do PRD aprovado.
- Unidade de entrega = ADR: **1 ADR = 1 branch = 1 PR = 1 revisão**, merge humano; teto 5 ADRs por PRD (🟡 processo — sem mecanismo).
- Bugfix: `BugAnalysis → BugFix → BugReview → BugCompleted` — R1 reproduzir o erro real, R2 encerrar portas, R3 causa raiz em `.spec/bugs/`, R4 `brain_store`.
- Code review obrigatório após qualquer mudança: zero 🔴, 🟡 corrigidos/justificados, registro em `workflow-state.json.code_review` (veredito é parecer; bloqueio = âncora B lendo `code_review_status`).

## 4. Gates — onde mora cada negação

Tabela completa em `.agents/rules/gate-contract.md` §1. **Nenhuma linha desta seção nega por si só**: cada uma cita a função/reason em `gate.js` que a sustenta (regra DOC-01).

| ID | Negação | Mecanismo (função / reason em `gate.js`) | Nível |
|---|---|---|---|
| I1 PICCO | `task` sem bloco PICCO válido | `gatePiccoTask` (gate.js:490-513); `picco-tag-absent`, `picco-tag-nonempty`; hook `execute.before` | 🟢 |
| I2 Completed | sem evidência, contagem divergente ou timeout | `gateCompletionAnchorA` + `gatePhaseAnchorB` — âncora A (path-check em `args.filePath`/`args.patchText`) + âncora B (state anterior) + contraprova; `completed-no-evidence`, `sealed-command-mismatch`, `contraprove-divergent`, `contraprove-timeout` (gate.js:758-807) | 🟠 parcial — escape por escrita fora da allowlist, coberto pelo CI |
| I5 Permissões | escrita em path protegido, fora da allowlist, qa fora de `harness/` | `opencode.json.permission.edit` (ordem = resolução) + `isHarnessScoped` (gate.js:565); `protected-path-write`, `orch-write-outside-allowlist`, `qa-scope-violation`, `write-denied-for-role` (gate.js:669-682); CI + trailer `Harness-Gate-Change` | 🟢 literal · 🟠 intenção · 🔴 runtime puro (I9) |
| I6 HITL | 3º `task` consecutivo sem turno humano | `gateHitlBatch` (gate.js:1086); `hitl-pause-required`; fronteira de turno via `V2_TURN_BOUNDARY_TYPES`/`noteTurnBoundary`; exceção: loop implementador → `code-reviewer` (2 calls) | 🟠 parcial |
| I7 Higiene | `pkill -f` em `bash` | `gateShellHygiene` (gate.js:1167); `pkill-f` — parse de comando, evadível por `bash -c`/`python -c`; rede final = CI | 🟠 parcial |
| FRONT | frontend declarado sem `frontend_evidence` válido | `requireFrontendEvidence` chamada por `gateCompletionAnchorA` (gate.js:1505-1524); `frontend-evidence-missing`; condicionalidade lida de `harness.config.json.targets.frontend` | 🟢 runtime condicional |
| SEAL | selo ausente ou divergente | `loadPublishedSeal` (gate.js:927 — `HARNESS_SEAL_JSON` publicado pelo host) + `verifySealOrDeny` (gate.js:146); `sealed-command-mismatch` (`empty-seal`); `scripts/seal.mjs` publica, CI recalcula | 🟠 parcial — trust root no host + CI |
| RF-01/02 · KILL | config ausente/inválido ⇒ fail-closed; chave do config não muda modo | `loadHarnessConfig`/`resolveCommand`; `resolveGateMode`/`modeForGate` (gate.js:98-129), `auditConfigGates` (gate.js:252), env `HARNESS_GATE_<GATE>` + `_REASON`; `isKillSwitchOff` (`HARNESS_GATES=off`, gate.js:77) | 🟢 runtime (ADR-009) |

## 5. Harness contínuo H0–H7

Texto completo: `.agents/rules/workflow-rules.md` §5 + anexos A/B. Comandos vêm de `harness.config.json.commands.*`.

- **H0** — teste falhando = defeito do produto; suite completa sempre; E2E com DB real + browser real nos pontos de virada.
- **H1** — toda task/bug/PR roda `commands.suiteFull`; falha ⇒ PARAR, reportar, causa raiz, corrigir, re-rodar tudo, registrar no Brain.
- **H2** — zero tolerância a falha pré-existente: 0 falhas, 0 erros, 0 skips não autorizados antes de qualquer dev novo.
- **H3** — E2E greenfield (wipe + re-cadastro pela UI, 12 passos, Network/Console limpos, screenshots) no fim de sub-fase SDD, bug UI/fullstack, sprint e release.
- **H4** — avaliação contínua: telas; negócio (RBAC, tenancy sem leak, auditoria); lógica (N+1 → `@EntityGraph`+`distinct`, transações no boundary, idempotência); performance (paginação, debounce).
- **H5** — encerrar portas por PID via `lsof -ti :PORT` → conferir dono → `kill` (nunca `pkill -f`); `brain_store` por achado (`regras`/`estudos`/`arquitetura`/`sessoes`).
- **H6** — portão de conclusão: suite 0 falhas · front test+build 0 erros · H3 quando aplicável · `code-reviewer` sem 🔴 · `brain_store` + `workflow-state.json` (`code_review_status: passed`, `harness_status: passed`) · portas livres. **Qualquer ❌ = fase não completa.**
- **H7** — cadência: suite por task, E2E por sub-fase/sprint, H4 por entrega UI, saneamento de débito P1 antes de feature nova.

## 6. Deepsearch

Fonte completa: `.agents/rules/deepsearch.md` + skill `deepsearch`. Nível 🟡 processo — nenhum gate negocia por isto (gate-contract.md §2); a cobrança é revisão de código.

- Antes de recomendar biblioteca, API ou padrão: `websearch`/`webfetch` em documentação oficial, changelog ou RFC. Cite **URL + data** da consulta no parecer.
- Nunca aceite assinatura de API de memória: verifique a assinatura na fonte consultada antes de escrever código.
- Sem fonte disponível ⇒ declare "inferência" explicitamente e proponha verificação; nunca apresente chute como fato.

## 7. Regras completas (sob demanda — carregue conforme a tarefa)

| Caminho | Cobre |
|---|---|
| `.agents/rules/workflow.md` | fonte única do fluxo: vocabulário §0 (V17), esteira §2, layout `.spec/**` §3, bugfix §4, code review §5, estado §6 |
| `.agents/rules/workflow-rules.md` | prompt gate §0, papéis §0.1, harness H0–H7 §5 + anexos A/B, testes por eixo §5.1–5.4 |
| `.agents/rules/gate-contract.md` | tabela I1..I12 + RF-01/02/04, KILL, TIME, FRONT, SEAL; não-promessas §2; higiene de prosa §3 |
| `.agents/rules/harness-config.md` | mapa de chaves do config, fail-closed, kill-switch, selo, sincronizador |
| `.agents/rules/prd-adr-pipeline.md` | contrato PRD → RESEARCH → ADR-INDEX → ADR, colunas, cerimônia, branch/PR sem `gh` |
| `.agents/rules/brain-context.md` | ponte para o repo `brain`: `brain_search` antes, `brain_store` depois, pin G1 |
| `.agents/rules/deepsearch.md` | hierarquia de fontes e template de citação |
| `.agents/rules/frontend-coding-standards.md` | ponteiro Vue 3 (`<script setup>`, shadcn-vue, Pinia, Vitest/happy-dom) |
| `.agents/rules/frontend-react-coding-standards.md` | ponteiro React 18+ (hooks, shadcn/ui, Zustand/Redux, Vitest/happy-dom) |

Capacidades relacionadas: `.agents/agents/*/AGENT.md` (papéis), `.agents/skills/` (playbooks), `.agents/schemas/harness-report.schema.json` (evidência).
