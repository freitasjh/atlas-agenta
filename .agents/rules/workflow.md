# Workflow — fonte única do fluxo (v2, por ADR)

> **Dono do fluxo.** Este arquivo é a única descrição do fluxo de desenvolvimento;
> as demais rules apontam para cá e não repetem a esteira. Prosa descreve, runtime
> nega (`gate-contract.md` §1/§2).
> Harness contínuo (H0–H7): `workflow-rules.md` §5 — fusão DOC-02 do antigo `harness-continuous.md`.
> Gate de prompt: `workflow-rules.md` §0.
> Comandos/portas: `harness.config.json` (`commands.*`, `infra.*`, `mcp.required`),
> nunca literal de prosa (`harness-config.md`).

## 0. Vocabulário canônico de fase (V17)

O **estado canônico** é o que vive em `workflow-state.json`. Portões `P0..P6` e os
rótulos da esteira são **rótulos de etapa** mapeados para o canônico (só o canônico é
lido por `gate.js`, I2; rótulo fora do mapa ⇒ aviso, não deny).

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

## 1. Regra de ouro: a unidade de entrega é o ADR

- **Não se gera SPEC/TASKS de funcionalidade inteira** (🟡 **processo** — sem
  mecanismo; a recusa é humana). Cada `ADRs/ADR-00N-{slug}/` é a unidade de
  entrega e carrega os próprios `ADR.md` → `SPEC.md` → `TASKS.md` → `VERIFY.md`.
  O PRD não tem SPEC/TASKS próprios. Por que não há check: `SDD-02` aceita os
  **dois** layouts por retrocompatibilidade (4 artefatos legados **ou**
  `ADR.md`+`SPEC.md`+`TASKS.md` no dir do ADR), então nenhum veredito mecânico
  separa "SPEC de funcionalidade inteira" de "SPEC scoped do ADR". Medição
  prevista em **F4** (marcador de escopo no TASKS + check no `sdd-checks.mjs`
  lendo os dois layouts); até lá, o instrumento é o PR humano.
- 1 ADR = 1 branch = 1 PR = 1 revisão (merge humano). Teto declarado: **5 ADRs por
  PRD**; acima disso o PRD se divide em dois escopos (recusa humana — 🟡 processo).
- **Demanda isenta** (typo, doc, rename interno, formatação, refactor sem
  comportamento observável, bump de patch): sem PRD/ADR, implementa direto.
  Lista canônica: `prd-adr-pipeline.md` §3.
- **Os artefatos nascem no diretório do ADR** (🟡 **processo** — sem mecanismo;
  a recusa é humana). Escrever em `.spec/backend|frontend/<feature>/` é drift
  declarado, mas nenhum check o nega: `SDD-02` resolve o ciclo por ponteiro de
  estado e continua aceitando o layout legado completo (retrocompatibilidade).
  Medição prevista em **F4** (o mesmo marcador de escopo acima); até lá a
  cobrança é a revisão humana do PR.

## 2. Esteira (features)

`Discovery → PRD → RESEARCH → ADR-INDEX → loop por ADR → implementação → verify → archive`

| Etapa | Produz | Portão |
|---|---|---|
| Discovery / PRD | `.spec/prd/{prd-id}/PRD.md` (16 seções; §16 = aprovação humana) | `PRD-01` |
| RESEARCH | `RESEARCH.md` (≥2 alternativas com fonte + trade-off + recomendação) | `ADR-01` |
| ADR-INDEX | `ADR-INDEX.md` (ledger 1:1 com o disco; coluna `unit`) | `ADR-01`/`ADR-02` |
| ADR | `ADRs/ADR-00N-{slug}/ADR.md` (decisão, motivo, `depende-de`, interface congelada) | `ADR-01` |
| P1 — spec | `ADRs/.../SPEC.md` (RF/NFR rastreáveis ao ADR) | `spec-gate` |
| P2 — tasks | `ADRs/.../TASKS.md` (seções `### <ID>`) | `tasks-gate` |
| P3 — implementação | código + testes | `commands.suiteFull` |
| P4 — review/harness | parecer do `code-reviewer` + evidência H1/H3/H4 | `workflow-rules.md` §5 |
| P5 — verify | `ADRs/.../VERIFY.md` (3 dimensões) | `verify-gate` |
| P6 — archive | PRD inteiro → `.spec/archive/[YYYYMMDD]-prd-{prd-id}/` | `VERIFY.md` aprovado + traceability ≥80% (§2.4) |

Contrato de layout, colunas e níveis de garantia: `prd-adr-pipeline.md` §1/§2/§5.
`PRD-01`/`ADR-01`/`ADR-02` rodam em `.opencode/plugins/lib/prd-adr-pipeline/checks.mjs`
via `scripts/static-checks.mjs` no `commands.suiteFull`.

### 2.1 Layout do ADR e o `unit`

- `unit: adr` (layout v2) ⇒ o diretório do ADR contém `ADR.md` + `SPEC.md` +
  `TASKS.md`, e `VERIFY.md` quando `status: merged`.
- `unit: legacy` (default quando a coluna/valor está ausente) ⇒ só `ADR.md`,
  como os ADRs anteriores à v2. PRD sem marcador `prd_version: 2` continua válido.
- PRD com `prd_version: 2` exige `unit: adr` em toda linha `in-progress`/`merged`.

### 2.2 Operação de branch/PR (sem `gh`)

Por ADR: `git checkout -b adr/{prd-id}/{nn}-{slug}` → `git push -u origin <branch>` →
imprimir a URL de compare (`<remote>/compare/main...<branch>`). O merge é humano;
nenhum push automático e nenhum passo exige `gh` (`prd-adr-pipeline.md` §4).

### 2.3 Feedback obrigatório

Após CADA modo do `sdd-compiler` que gere artefato: 10-point summary
(`.agents/skills/sdd-feedback/SKILL.md`) + brief status `📊 {name} ({stage}) | {progress}%`.
"Fase completa ✅" sem evidência é anti-pattern.

### 2.4 Traceability antes do archive (obrigatória)

Antes de P6 (`archive`), o ciclo presta contas RF→TASK→código:

- **Score mínimo: 80%.** Abaixo disso o archive não acontece (`<60%` volta para
  implementação; `60–79%` revisa os gaps).
- **Assert (a régua, não um comando):**
  `.agents/skills/sdd-compiler/asserts/traceability-gate.md` — critérios,
  pesos, faixas e formato do relatório vivem lá; esta seção não os repete.
- **Quem executa:** o `sdd-compiler` no modo `verify`, sobre o ADR do ciclo
  (`.spec/prd/{prd-id}/ADRs/ADR-00N-{slug}/`), não sobre "a feature".
- **Nível:** 🟡 **processo** — não existe comando dedicado nem check mecânico de
  score; o parecer do `sdd-compiler` + a revisão humana são o portão. Um
  `/sdd.trace` **não existe** e não deve ser citado como se existisse.

## 3. Organização de arquivos (`.spec/**`)

```
.spec/
├── prd/{prd-id}/                  PRD.md · RESEARCH.md · ADR-INDEX.md
│   └── ADRs/ADR-00N-{slug}/       ADR.md · SPEC.md · TASKS.md · VERIFY.md
├── bugs/{contexto}/TASKS.md        bugfix (Fase 1 do §4)
├── tech-debts/{contexto}/          dívida P2
├── roadmap/                        P3
├── backend|frontend/{contexto}/    LEGADO CONGELADO (ver abaixo)
└── archive/[YYYYMMDD]-{contexto}/  destino final (PRD inteiro)
```

- **Legado congelado (D-B):** `.spec/backend/**` e `.spec/frontend/**` continuam
  válidos como registro histórico e continuam aceitos por `SDD-02` no layout de
  4 artefatos (`PROPOSAL.md`+`SPEC.md`+`PLAN.md`+`TASKS.md`). **Não são migrados
  nem usados como destino de feature nova** — 🟡 **processo**, sem mecanismo: a
  aceitação do layout antigo é deliberada (retrocompatibilidade), então
  `SDD-02` não distingue "registro histórico" de "feature nova nascida aqui", e
  a recusa é humana. Medição prevista em **F4** (marcador de escopo + check
  lendo os dois layouts); até lá, o PR é o portão.
- `.spec/prd/**` é bucket **non-cycle**: nunca resolvido como ciclo SDD
  (`SPEC_NON_CYCLE` em `scripts/sdd-checks.mjs`).
- Delta Specs: quando a SPEC altera docs vivos, o `archive` mescla o delta e
  registra o destino (`.agents/rules/**`, `AGENTS.md`).

## 4. Bugfix (obrigatório para toda correção)

Fases: **BugAnalysis → BugFix → BugReview → BugCompleted** (`current_phase`).

1. **R1 — Harness-first.** Reproduzir o erro REAL (browser/DevTools ou suite)
   antes de codificar: `backend UP/DOWN`, `frontend UP/DOWN`, `console N errors`,
   `network M 2xx/5xx`, `screenshot path`, erro reproduzido ✅/❌. Sem evidência a
   análise é inválida → re-delegar.
2. **R2 — Encerramento limpo.** `lsof -ti :PORT` → conferir dono → `kill` por PID.
   **Nunca `pkill -f`** (`workflow-rules.md` §5 H5).
3. **R3 — Análise antes do dev.** Causa raiz com arquivo:linha + `.spec/bugs/{contexto}/TASKS.md`
   (bug, causa, solução + arquivos + impacto, testes, riscos). Portão HITL B1→B2:
   *"Aprova seguir para implementação?"*.
4. **R4 — Brain.** Erro específico do projeto → `scope="projetos"`; regra de stack
   reutilizável → `scope="global"`. Sem `brain_store` o bug não está fechado.
5. Fechamento: suite completa 0 falhas (H1+H2), `code_review_status`/`harness_status`
   `passed`, `current_phase: Completed`.

## 5. Code review obrigatório (NON-NEGOTIABLE)

Após **qualquer** mudança de código, antes de declarar fase/tarefa concluída,
invocar o agente `code-reviewer`. O veredito é **parecer**; o bloqueio é a âncora
B do gate lendo `code_review_status` (`gate-contract.md` I2).

| Critério | O que verificar |
|---|---|
| Qualidade | naming, estrutura, complexidade, coesão |
| Testes | cobertura, qualidade dos asserts, isolamento |
| Segurança | injeção, exposição de dados, validação de entrada |
| Performance | N+1, streams em caminho crítico, alocação |
| Arquitetura | boundaries, DDD, dependências entre módulos |
| Regras | conformidade com `.agents/rules/*.md` |

Débitos: 🔴 crítico (corrigir antes de concluir) · 🟡 atenção (avaliar/corrigir) ·
🟢 sugestão. Loop até zero 🔴 (máx. 3 iterações; depois, revisão humana).
Registro em `workflow-state.json`:

```json
{ "code_review": { "last_invoked_at": "<ISO>", "last_status": "passed|failed",
  "critical_issues": 0, "attention_issues": 0, "reviewer_notes": "<resumo>" } }
```

Não avançar se `code_review.last_status != "passed"`. Pre-Completion Checklist
vinculante: `workflow-rules.md` §5 H6.

## 6. Estado global e progresso

- `workflow-state.json` na raiz é a **única** fonte do progresso. Campos
  obrigatórios: `current_feature`, `current_phase`, `previous_phase`, `next_phase`,
  `artifacts`, `type` (`feature`|`bugfix`), `last_update`.
- `artifacts` aponta para os caminhos vivos do ciclo. Para um ADR, registre
  `adr` (**diretório** ou `ADR.md`) além de `spec`/`tasks`; `SDD-02` aceita os dois
  layouts (4 artefatos legados **ou** `ADR.md`+`SPEC.md`+`TASKS.md` no dir do ADR).
  `artifacts.adr` é **path**: o estado declara explicitamente o diretório do ADR
  e um ADR incompleto ali é drift (`sdd-checks.mjs`, `state.artifacts.adr`).
  O ponteiro diz **onde**, nunca **qual layout**: o `unit` que ele cobra vem do
  `ADR-INDEX.md` (linha/coluna ausente ⇒ `legacy` ⇒ só `ADR.md`), como em
  `active_adr` (`resolveAdrUnit`, `sdd-checks.mjs`).
  Um `artifacts.adr` que **não existe** em disco não é drift — ponteiro mudo não
  é evidência (espelho da política do `active_adr`/FU-38): o candidato é
  descartado e o ciclo legado decide.
- Campos aditivos (nunca destrutivos): `prd_adr` = `{ prd_id, prd_status:
  draft|approved|archived, active_adr, adr_order[], snapshots[...] }` — escrito no
  merge de cada ADR. **`active_adr` guarda o ID (`ADR-002`), não um path**: o
  `SDD-02` resolve ID → diretório pelo `ADR-INDEX.md` do `prd_id` declarado
  (`resolveActiveAdrPointer`, `sdd-checks.mjs`), e só trata como path o valor
  path-shaped (estado antigo, tolerado). Um ID que não existe no ledger não vira
  drift: ponteiro mudo não é evidência (mesma regra do ponteiro stale do FU-38).
  `follow_ups[].created_at` (ISO-8601) obrigatório em cada item — mecanismo
  `prd-checks.spec.mjs` (`PAP-12`, o único teste que lê o estado REAL em disco e
  reprova sem o campo); 🟡 processo (o check roda em `commands.suiteFull`, um
  `follow_ups` criado fora do ciclo não é impedido, só detectado no próximo run).
  Nenhum valor novo de `current_phase` é criado por esses campos (🟡 processo).
- `spec-developed.md` na raiz lista cronologicamente as features e etapas concluídas.
- `workflow-history.jsonl` (append-only) guarda o estado histórico; `workflow-state.json` guarda só as chaves que `gate.js`/SDD/PAP-12 leem; a whitelist vive em `scripts/state-compact.mjs` (`LIVE_KEYS`).
- Recuperação: ler o jsonl e procurar `key`/`ts`; nada é deleted, só movido (`{ts,key,value}` por linha, dedupe por sha256 do valor).
- Auditoria somente leitura: `node scripts/state-compact.mjs --dry-run` imprime contagem de chaves a arquivar e bytes antes/depois sem escrever.

## 7. Papéis, skills e regras gerais

- Papéis/delegação: `workflow-rules.md` §0.1 — o `orchestrator` não desenvolve, delega via `task`.
- Skills por contexto: backend → `java-architecture-specialist` | `nestjs-architecture-specialist` |
  `node-architecture-specialist` | `rust-architecture-specialist`; frontend → `frontend-vue-specialist`
  ou `frontend-react-specialist` + `frontend-design`; spec/tasks/verify/archive → `sdd-compiler`;
  segurança → `security-review`; comunicação → `caveman`.
- Nunca implementar sem spec (feature) ou sem análise (bugfix); nunca pular
  testes; nunca pular code review; sempre atualizar `workflow-state.json` e
  registrar aprendizados no Brain (`.agents/rules/brain-context.md`).
- Referências: `AGENTS.md` (stack/comandos), `harness-config.md` (dados do projeto),
  `prd-adr-pipeline.md` (esteira), `workflow-rules.md` §5 (harness H0–H7 — fonte da
  verdade), `gate-contract.md` (o que é negado e por quê).
