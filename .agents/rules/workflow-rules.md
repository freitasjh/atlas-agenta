# Workflow Rules

Estas regras definem o fluxo de desenvolvimento obrigatório. Devem ser seguidas rigorosamente por todos os agentes de IA.

> **Fusão DOC-02:** este arquivo absorveu `harness-continuous.md` (H0–H7 + anexos,
> agora §5). Referências ao arquivo antigo re-apontam para cá (mapa em
> `.spec/governance/harness-v7/back-refs-DOC-02.md`). Comandos/portas abaixo vêm de
> `harness.config.json` (nunca de literal copiado — SPEC ADR-003).

---

## 0. Prompt Gate — ANÁLISE OBRIGATÓRIA (NON-NEGOTIABLE)

> 🚨 **TODA demanda de MUDANÇA do usuário DEVE ser analisada ANTES de qualquer ação.**
> Comandos de consulta (leitura de estado) pulam o gate — ver "Exceção" abaixo.

### Regra Absoluta

1. **Carregar skill `prompt-optimizer`** via `skill` tool
2. **Carregar skill `brain`** → `brain_search(prompt literal, top_k=3)` para contexto
3. **Contar os 6 elementos AFIRMADOS pelo usuário:**

   | # | Elemento | Ausente = |
   |---|----------|-----------|
   | E1 | Objetivo — o que muda no mundo quando estiver pronto? | crítico |
   | E2 | Escopo — o que entra e o que NÃO entra? | crítico |
   | E3 | Contexto — módulo/domínio/tela/endpoint afetado | alto |
   | E4 | Restrições — o que não pode quebrar? | alto |
   | E5 | Critério de aceite — como se sabe que ficou pronto? | médio |
   | E6 | Intenção de rota — Feature/Bugfix/Refactor/Melhoria? | médio |

   **Presente = o usuário AFIRMOU.** O que a IA deduziu conta como ausente.

4. **Duas rotas por score:**
   - **Rota A (score < 6/6):** PARAR. Máximo 3 perguntas ordenadas por impacto no retrabalho (E1 > E2 > E3 > E4 > E5 > E6). Máximo 2 rodadas; na 2ª, apresentar 2 interpretações e pedir desempate. Nenhuma outra skill, subagente ou artefato antes disso. Nada é criado.
   - **Rota B (score = 6/6):** emitir re-encoding em bloco PICCO com delimiter tags (`<role>/<task>/<context>/<constraints>/<acceptance>/<open_questions>`), fazer 1 confirmação, então seguir o workflow com o bloco como contexto.
5. **Pedido que viola regra do projeto** → rota de conflito: nomear a regra com caminho, oferecer o caminho permitido mais próximo, perguntar sobre exceção explícita (registrada em `workflow-state.json.overrides`)

   **Precedência:** a rota de conflito vence. Não é ambiguidade, é contradição — perguntar por elemento faltando não resolve violação de regra. Se o pedido for violador E incompleto: trate o conflito primeiro, retome a Rota A só para o que falta.

### Proibido

- ❌ Preencher lacuna com default do modelo
- ❌ "Vou assumir que você quer X"
- ❌ Delegar com contexto vago
- ❌ Pular brain_search
- ❌ Tratar dedução da IA como elemento afirmado
- ❌ Bloco PICCO com mais de 10 constraints

### Obrigatório

- ✅ Carregar `prompt-optimizer` via skill tool
- ✅ Contar E1..E6 explicitamente antes de agir
- ✅ Rota B: 1 confirmação antes de executar
- ✅ Salvar patterns de prompts no Brain (quando o padrão se repetir 2x)

### Exceção — comandos de consulta

`show status`, `o que bloqueia X?`, `onde paramos?`, `onde está X?`, `o que Y faz?`, `existe Z?` (consulta factual ao repo — leitura, não mudança), leitura de `workflow-state.json` **pulam** o gate.
`add feature X`, `move X before Y`, `skip X` **não pulam** — alteram estado. Override de 1 palavra ("já vai") também vale.

### Template de Perguntas (Rota A)

```markdown
## Falta contexto — preciso de X resposta(s)

Bloqueio (o que não vou assumir): [elemento ausente, ex: E2 Escopo]

1. **[pergunta de E1]**
2. **[pergunta de E2]**

### Já entendi (afirmado por você)
- E3: módulo `identity`
- E6: Bugfix

### Regra
Não vou assumir o que ficou em branco. Escolher por você é palpite caro.
```

Variações de pergunta por elemento e perguntas de desempate: `.agents/skills/prompt-optimizer/references/clarifying-questions.md`.
Contrato de saída e exemplos (bons e ruins): `.agents/skills/prompt-optimizer/references/picco-template.md`.

---

## 0.1 Divisão de Papéis (NON-NEGOTIABLE)

> 🚨 **REGRA CRÍTICA:** Orchestrator (sdd-orquestrador) **NÃO DESENVOLVE**. Apenas orquestra, governa, documenta, delega.

| Role | Responsabilidade |
|------|------------------|
| **Orchestrator** (este agente) | Triagem, governance, SPEC, PLAN, TASKS, code review, brain, workflow-state.json |
| **developer-engineer** | **Implementação de código** (Java/Vue/SQL/tests) |
| **code-reviewer** | Code review após cada batch |
| **architect** | Decisões arquiteturais (validação) |
| **product-manager** | Validação de negócio |
| **qa-engineer** | Cobertura de testes |
| **security-engineer** | Auditoria de segurança |

**Fluxo correto:**
1. User pede nova phase
2. **Prompt optimizer** — analisar prompt (SEÇÃO 0)
3. **Brain search** para contexto (lições passadas, decisões)
4. **Salvar no Brain** aprendizados/erros/decisões
5. **Delegar para `developer-engineer`** via `task` tool
6. **Receber retorno** do developer
7. **Delegar para `code-reviewer`** (regra non-negotiable, ver seção 6)
8. **Aplicar fixes** se necessário (re-invocar developer se crítico)
9. **Atualizar `workflow-state.json`** campo `code_review`
10. **Só então** declarar phase completa

**Erros comuns a evitar:**
- ❌ Orchestrator implementa código diretamente (write tool, edit tool)
- ❌ Pular prompt_optimizer antes de qualquer ação
- ❌ Pular brain_search antes de delegar
- ❌ Não salvar aprendizados no Brain
- ❌ Pular code review após implementação
- ❌ Declarar phase completa sem Pre-Completion Gate (seção 6.3)

---

## 1. Workflow State

- Antes de iniciar **qualquer** desenvolvimento, **SEMPRE** ler `workflow-state.json` na raiz do projeto.
- O arquivo contém o estado atual do workflow: fase ativa, especificações em andamento, tarefas concluídas.
- Após cada alteração relevante, atualizar o `workflow-state.json`.

---

## 2. Economia de Tokens (Caveman Mode)

Para reduzir custos e maximizar eficiência durante o desenvolvimento, **SEMPRE** utilizar modo de comunicação comprimida:

- Ativar caveman ao iniciar sessão: `/caveman` (modo `full`, padrão)
- Níveis disponíveis: `lite` (artigos mantidos), `full` (caveman clássico), `ultra` (telegráfico)
- **Exceções** (desabilitar automaticamente): avisos de segurança, ações irreversíveis, sequências multi-passo onde ambiguidade pode causar erro, usuário pedir esclarecimento
- **SEMPRE** manter em modo caveman para: respostas técnicas, code review, planejamento, debugging
- **NUNCA** usar caveman em: código gerado, mensagens de commit, PRs — estes mantêm prosa normal
- Reactivar após exceção: caveman retoma automaticamente depois da parte crítica
- Ver SKILL.md em `~/.config/opencode/skills/caveman/SKILL.md` para regras completas
- Estatísticas: `/caveman-stats` mostra tokens salvos na sessão

---

## 3. Workflow SDD (obrigatório para toda funcionalidade)

Toda nova funcionalidade/inovação **OBRIGATORIAMENTE** segue o fluxo SDD (Spec-Driven Development). Durante todo o SDD, manter `/caveman` ativo para economia de tokens.

**Ciclo completo**: `Explore (opcional) → Proposal → SPEC → PLAN → TASKS → [implementar] → Verify → Archive`

### Vocabulário canônico de fase (V17)

O **estado canônico** é o de `sdd-workflow-standard.md` (é o que vive em
`workflow-state.json`). Portões `P0..P6` e a esteira `Explore→…→Archive` são
**rótulos de etapa** mapeados para o canônico. Só o canônico é validado por
`gate.js` (I2); rótulo fora do mapa ⇒ aviso, não deny. `verify` ocorre em
`Testing`; `archive` ocorre em `Completed`.

| Etapa (rótulo) | `current_phase` canônico |
|---|---|
| Explore, Proposal | Discovery |
| SPEC, PLAN, TASKS | Planning |
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

### Fase 0 — Exploração & Planejamento Técnico
> Para features com escopo claro, pular direto para Fase 1. Para features complexas/inovações, usar `dev-planner` para planejamento detalhado.

1. Carregar `brain` — health check MCP automático, consultar memória de longo prazo
2. Classificar demanda: **Feature**, **Bugfix** ou **Refactor**
3. **Se Feature complexa ou Inovação** (recomendado para novos módulos, integrações, mudanças arquiteturais):
   - Carregar skill `dev-planner`
   - Executar **Fase 0 (Descubra)**: questionar problema real, usuários, casos de uso → gerar `EXPLORATION.md`
   - Executar **Fase 1 (Analise)**: mapear restrições técnicas, dependências, compliance → gerar `CONSTRAINTS.md`
   - Executar **Fase 2 (Desafie)**: comparar alternativas, registrar ADRs → gerar `DESIGN-DECISIONS.md`
   - Executar **Fase 3 (Projete)**: modelo de dados, API, fluxos → gerar `ARCHITECTURE.md`
   - Executar **Fase 4 (Estime)**: decompor tarefas, estimar esforço, riscos → gerar `PLAN.md`
   - Executar **Fase 5 (Valide)**: consistência, revisão cruzada, handoff para `sdd-compiler`
   - **Portão:** aprovação explícita do usuário em cada fase do dev-planner antes de avançar
4. **Se Feature simples** (CRUD básico, ajuste pontual):
   - Carregar `sdd-compiler` modo `explore`
   - Levantar perguntas, hipóteses e alternativas de abordagem
   - Gerar `.spec/[feature]/EXPLORATION.md`
5. Avançar para Fase 1 somente após clareza suficiente e aprovação do usuário

### Fase 1 — Análise (Requirements + Design)
1. Carregar `brain` — health check MCP automático, consultar memória de longo prazo
2. Carregar `sdd-architecture-board` — arquitetura e decisões técnicas
3. **Se dev-planner foi executado:** incorporar artefatos (`EXPLORATION.md`, `CONSTRAINTS.md`, `DESIGN-DECISIONS.md`, `ARCHITECTURE.md`, `PLAN.md`) como base para SPEC
4. Gerar relatório de análise do domínio
5. **Design Frontend** (se frontend): carregar `frontend-design`, definir direção visual
6. Invocar agente `architect` para validar arquitetura
7. Corrigir gaps identificados
8. **Gerar PROPOSAL**: `sdd-compiler` modo `generate-proposal` → `.spec/[feature]/PROPOSAL.md`
   - Validar contra `asserts/proposal-gate.md` antes de avançar
9. **Gerar SPEC**: `sdd-compiler` modo `generate-spec` → `.spec/[feature]/SPEC.md`
   - SPEC inclui seção **Delta Specs** (impacto em `.doc/`)
10. **Revisar SPEC**: skill `spec-review` — gerar relatório de gaps e conformidade
11. **Corrigir gaps**: endereçar todos 🔴 críticos e 🟠 alta prioridade
12. Salvar artefatos em `.spec/backend/{dominio}/` ou `.spec/frontend/{dominio}/`
13. **Aprovação do usuário**: perguntar se deseja prosseguir com a implementação

### Fase 2 — Implementação
1. Carregar skill de domínio:
   - **Backend**: `java-architecture-specialist`
   - **Frontend**: `frontend-vue-specialist` + `frontend-design`
2. **Gerar PLAN**: `sdd-compiler` modo `generate-plan` → `PLAN.md` a partir do `SPEC.md`
3. **Gerar TASKS**: `sdd-compiler` modo `generate-tasks` → `TASKS.md` a partir do `PLAN.md`
4. Implementar código seguindo as tasks (TDD — teste antes da implementação)
5. Escrever **testes unitários** (JUnit 5 + Mockito) — coverage: 80% service, 90% domain
6. Escrever **testes de integração** (`*IT.java` no módulo `integration-test/`) — todo controller deve ter IT
7. Verificar quebras de contrato com `mvn compile` a cada task concluída

### Fase 3 — Review
1. Invocar agente `code-reviewer` para revisar o código
2. Corrigir todos os débitos 🔴 **Críticos**
3. Avaliar e corrigir débitos 🟡 **Atenção** se aplicável
4. **Ao final**: `mvn clean install` na raiz do backend (zero erros, testes passando)

### Fase 4 — Verify (pós-implementação)
1. Carregar `sdd-compiler` modo `verify`
2. Checar **3 dimensões** contra `asserts/verify-gate.md`:
   - **Completeness**: todos os checkboxes TASKS.md marcados, zero TODOs
   - **Correctness**: build limpo, testes passando, requisitos SPEC cobertos
   - **Coherence**: ADRs refletidos no código, sem vazamento de camada
3. Se frontend: validar com Chrome DevTools (Network + Console — zero erros/warnings)
4. Gerar `.spec/[feature]/VERIFY.md` com resultado
5. **BLOQUEIA archive** se qualquer dimensão falhar — voltar para Fase 2/3

### Fase 5 — Archive (finalização)
> Executar somente com `VERIFY.md` aprovado (todas as 3 dimensões ✅)

1. Carregar `sdd-compiler` modo `archive`
2. Mesclar **Delta Specs** do `SPEC.md` nos documentos `.doc/` correspondentes
3. Mover `.spec/[feature]/` → `.spec/archive/[YYYYMMDD]-[feature]/`
4. **Registrar aprendizados** no Brain (skill `brain`):
   - Tipo: `success` | `decision` | `anti-pattern`
   - Template em `.agents/rules/brain-context.md` (ponte → `BRAIN.MCP.md`, dono brain; detalhe no `BRAIN.MCP.md`, não nesta ponte)
   - Salvar via `brain_store` em `lessons/{tipo}/{subcategoria}/`
5. Commit sugerido pelo `sdd-compiler archive` — confirmar antes de executar

### 3.6 Feedback Obrigatório (10-Point Summary)

> 🚨 **REGRA NON-NEGOTIABLE.** Após CADA comando SDD que gere artefatos, orquestrador DEVE gerar 10-point summary.

**Comandos que exigem summary:**
- `generate-proposal` → ler PROPOSAL.md
- `generate-spec` → ler SPEC.md
- `generate-plan` → ler PLAN.md
- `generate-tasks` → ler TASKS.md
- `generate-integration` → ler INTEGRATION.md
- `verify` → ler VERIFY.md

**Template:** Ver `.agents/skills/sdd-feedback/SKILL.md`

**Fluxo:**
1. Comando SDD executa e gera artefato
2. Orquestrador lê artefato
3. Gera 10-point summary: Decisions → Generated → Review → Watch-outs → Next Steps
4. Inclui brief status: `📊 **{name}** ({stage}) | {progress}%`
5. **OPCIONAL:** brain_store se summary revelar lição relevante

**Anti-pattern eliminado:** "Fase completa ✅" sem evidência do que foi gerado.

### 3.7 Feature Status Dashboard

> Dashboard automático para rastrear progresso de features.

**Fonte de verdade:** `workflow-state.json` campo `features`

**Brief status** (em todo summary):
```
📊 **{name}** ({stage}) | {progress}% | {done}/{total} features
```

**Detailed status** (sob demanda: "show status", "what blocks X?"):
```markdown
📊 Project Feature Status Dashboard
🎯 CURRENT: {name} ({pct}%)
✅ COMPLETED: {n}
📋 UPCOMING: {n}
⚠️  BLOCKED: {n}
```

**Natural language management:**
- "add feature X" → criar entry
- "move X before Y" → reordenar
- "skip X" → marcar deferred
- "what blocks X?" → check dependencies

**Skill:** `.agents/skills/feature-status-dashboard/SKILL.md`

### 3.8 Traceability Validation (antes de Archive)

> 🚨 OBRIGATÓRIO antes de archive. Verifica se specs batem com código.

**Comando:** `/sdd.trace [feature]`

**Critérios:**
- RF→Task mapping ≥80%
- Task→Code mapping ≥80%
- Zero orphaned specs
- Score geral ≥80%

**Assert:** `.agents/skills/sdd-compiler/asserts/traceability-gate.md`

**Bloqueia archive** se score <60%. Warn se 60-79% (arquivo com justificativa).

### 3.10 Esteira PRD → ADR → SDD (features)

Fluxo: PRD aprovado → RESEARCH → ADR-INDEX → ADR (unidade/branch) → SDD scoped.
Contrato completo, limiar de isenção e níveis de garantia: `.agents/rules/prd-adr-pipeline.md`.
Nível: `PRD-01`/`ADR-01`/`ADR-02` em `.agents/skills/prd-adr-pipeline/checks.mjs`,
via `scripts/static-checks.mjs` no `suiteFull` (🟢 neste repo; 🟡 processo em repo-destino
até F3). Bug fora do funil (§4). Limiar de isenção: mudança sem comportamento observável
não gera PRD/ADR. Os rótulos `PRD`/`RESEARCH`/`ADR-INDEX`/`ADR` mapeiam para o canônico
(tabela V17 acima) — **não** são valores novos de `current_phase`.

---

## 4. Workflow Bugfix (obrigatório para toda correção de bug)

Toda correção de bug (backend, frontend ou fullstack) **OBRIGATORIAMENTE** segue as 4 fases abaixo. Manter `/caveman` ativo.

### 4.0 Regras Mandatórias de Harness e Análise (NON-NEGOTIABLE)

> 🚨 **Violação = retrabalho completo do bugfix.**

#### R1 — Harness-First: ver o erro REAL na tela antes de codificar
- O agente (`developer-engineer` ou `qa-engineer`) **DEVE**: subir o sistema com os comandos de `harness.config.json` (`commands.backendRun`/`frontendRun`, portas de `infra.ports`); abrir via **Chrome DevTools** (`new_page` → `take_snapshot` → `list_network_requests` → `list_console_messages` → `take_screenshot`); reproduzir o fluxo exato e confirmar o erro (status 4xx/5xx, console `[ERROR]`/`[WARN]`, snapshot vazio).
- **PROIBIDO adivinhar no escuro.** Sem evidência de harness, a análise é inválida → re-delegar.
- Retorno obrigatório: `backend UP/DOWN`, `frontend UP/DOWN`, `console N errors`, `network M 2xx/5xx`, `screenshot path`, erro reproduzido ✅/❌.

#### R2 — Encerramento limpo
- Ao terminar o DevTools, **SEMPRE** finalizar front+backend iniciados. Nunca deixar órfão em `infra.ports`. Caminho único: `lsof -ti :PORT` → conferir dono (`ps -o pid,command`) → `kill` por PID (ver §5 H5.1). **Nunca `pkill -f`.**
- Retorno declara `processos finalizados ✅/❌`; aberto = débito técnico.

#### R3 — Análise detalhada ANTES do desenvolvimento
- Causa raiz com arquivo:linha, camada, módulo — só depois, codificar.
- Artefato obrigatório **antes** de delegar a correção: `.spec/bugs/{contexto}/TASKS.md` (Bug, Causa raiz, Solução + arquivos + impacto, Testes, Riscos).
- **Portão B1→B2 (HITL):** apresentar bug + causa + evidências e perguntar *"Aprova seguir para implementação?"* — aguardar resposta explícita.

#### R4 — Persistência de erros no Brain
- Todo erro vai ao Brain: específico do projeto → `scope="projetos"`; regra de stack reutilizável → `scope="global"`.
- Tipos: `sessoes/projeto/<data>` + `estudos/projeto/<feature>/<conceito>` + `regras/projeto/<regra>`.
- Sem `brain_store` com scope correto, o bug NÃO está fechado.

### Fase 1 — Análise do Bug
1. `brain_search` por lições relacionadas; reproduzir (esperado vs atual + stack trace + evidências R1); causa raiz (camada/módulo/arquivo via grep/glob/explore); criar `.spec/bugs/{contexto}/TASKS.md`; atualizar `workflow-state.json`.

### Fase 2 — Implementação da Correção
Executar TASKS.md na ordem (skills `java-architecture-specialist` + `frontend-vue-specialist` se fullstack); corrigir código + testes (`*.spec.ts` / unitários); compilar a cada task (`mvn compile -pl {modulo} -am` / `vite build`); IT no `integration-test/` se aplicável.

### Fase 3 — Revisão Obrigatória (Iterativa)
1. Invocar `code-reviewer` com diff/contexto; 🔴/🟡 → Fase 2; só 🟢 → avaliar.
2. Loop até zero 🔴/🟡 (máx 3 iterações; excedeu → revisão manual).
3. **Frontend — Chrome DevTools OBRIGATÓRIO:** Network (sem `/api/api/`, métodos/headers/payload corretos, 200/201, nunca 4xx/5xx) + Console (zero `[ERROR]`/`[WARN]`) + UI (renderiza, sem tela branca). Falhou → Fase 2. Correção só-backend pula esta etapa.

### Fase 4 — Finalização
Suite completa com zero falhas **incluindo pré-existentes** (ver §5 H1+H2); `workflow-state.json` (`current_feature`, `current_phase: Completed`); `brain_store` tipo `error` (causa, solução, prevenção, severity, frequency; tags `eng/*` + `type/error` + `bugfix`); débito técnico em `related_notes` se regressão.

---

## 5. Harness Contínuo (NON-NEGOTIABLE — fonte da verdade H1–H7)

> 🚨 **REGRA MÁXIMA.** Testes não são débito; suite completa roda sempre; funciona na mão, não só no CI; tela quebrada = sistema quebrado; regressão bloqueia release. Em conflito com outra seção, este §5 prevalece.
> Comandos/portas-infra: `harness.config.json` (`commands.*`, `infra.*`, `mcp.required`) — nunca literal de prosa (SPEC ADR-003).
> Origem: entregas quebradas apesar de regras (2026-09-02).

### H0. Princípios Invioláveis
1. Teste falhando = defeito do produto, não do teste. 2. Suite completa antes de declarar done, mesmo p/ 1 linha. 3. Harness E2E com DB real + browser real obrigatório nos pontos de virada. 4. Frontend é sistema. 5. Provar ponta-a-ponta antes de declarar completo. 6. Teste que quebrava antes e quebra agora = bloqueia até root cause + fix.

### H1. Suite Completa em Todo Desenvolvimento
**Gatilhos:** task concluída, sub-fase SDD, bug corrigido, PR/merge, fim de sprint/release — sempre suite completa (`commands.suiteFull`; E2E junto em release).
**Diante de falha (novo/existente/pré-existente):** PARAR → reportar (classe:linha, mensagem, stack, suíte) → causa raiz (R3) → corrigir código ou teste → re-rodar tudo → registrar no Brain (`regras`/`estudos`, scope correto). Não avançar com falha.

### H2. Zero Tolerância a Falhas Pré-existentes
- Referência: suite completa = **0 falhas, 0 erros, 0 skips não-autorizados** antes de QUALQUER dev novo. Débito pré-existente = bug P1 (saneamento em `.spec/tech-debts/{contexto}/TASKS.md`: classificar P1/P2/P3, resolver P1 antes da feature do domínio, via mesmo workflow).
- **Detecção ao delegar:** orquestrador roda suite antes da Fase 2; N falhas → bloquear dev + TASKS de saneamento.
- Proibido `@Disabled`/`@Ignore`/`assumeTrue`/skip comentado para "passar".

### H3. Harness E2E Greenfield (Wipe + Re-cadastro)
**Quando (MANDATORY):** fim de cada sub-fase SDD, cada bug UI/fullstack, fim de sprint, release, mudança em stack/router/i18n/auth/migration base.
**Protocolo:** subir dependências (`infra.composeFile` se houver) → WIPE + recreate → subir backend/frontend (`commands.backendRun`/`frontendRun`, portas de `infra.ports`) → Chrome DevTools (`new_page` na URL do front → snapshot).
**Re-cadastro manual via UI:** login → admin → 2 employees → team → project → workflow → kanban → task completa → transicionar TODOS os status → dashboard/backlog → i18n (trocar locale) → logout.
**Por passo (DevTools):** Network sem rota duplicada e sem 4xx/5xx; Console zero `[ERROR]`/`[WARN]`; snapshot renderiza; screenshot bate com o padrão visual; navegação preserva state; 1280x800 + 375x800; aria-labels + foco visível.
Testes unitários/integração **não pegam** tela branca, rota duplicada, i18n faltando, CORS/auth em browser real — só este harness pega.

### H4. Avaliação Contínua (Telas, Regras, Melhorias)
Por entrega UI/fullstack avaliar: **Telas** (padrão de lista/filtro, loading/empty/error, form tabs+preview, i18n total, contraste/foco); **Negócio** (edge cases, RBAC por perfil, tenancy sem leak, auditoria populada); **Lógica** (N+1 → `@EntityGraph`+`distinct`, transações nos boundaries, idempotência de consumers, validação server-side); **Performance** (paginação, debounce, lazy load).
Melhorias: P1 (quebra UX) → `.spec/bugs/`; P2 → `.spec/tech-debts/`; P3 → `.spec/roadmap/`; achados relevantes → `brain_store(regras, projeto/ux-patterns/*)`.

### H5. Encerramento Limpo + Brain Obrigatório
Toda vez que o harness subir portas de `infra.ports`, encerrar ao terminar:
```bash
lsof -ti :PORT > /tmp/harness-pids-PORT.txt   # pela PORTA, nunca por nome
ps -o pid,command -p "$(head -1 /tmp/harness-pids-PORT.txt)"  # confere o dono
xargs -r kill -9 < /tmp/harness-pids-PORT.txt  # só o deste projeto
lsof -i :PORT || echo "PORT free"              # evidência obrigatória no report
```
#### 🚨 Proibido `pkill -f` (B8.3, 2026-09-27)
Casa por command line, não por porta — já derrubou stack de outro projeto. **Nunca `pkill -f`.** Porta de outro projeto ⇒ não mata, declara ocupação e usa alternativa. Derrubar stack alheia = incidente a reportar, nunca nota de rodapé.
**Brain por achado:** erro → `regras`/`estudos`; ADR → `arquitetura`; conceito → `estudos`; sessão → `sessoes`; anti-pattern → `regras` (scope `projetos` se específico, `global` se universal).
**Retorno do subagente sem `processos finalizados ✅` + `brain_store ✅` + `suite OK ✅` = re-delegar.**

### H6. Portão de Conclusão Expandido
Antes de declarar QUALQUER fase completa, tudo verdadeiro:
Build+testes (suite completa 0 falhas; front test+build 0 erros) · H3 quando aplicável (12 passos OK, Network/Console limpos, screenshots em `.spec/{feature}/harness/`) · H4 avaliado (P1→bugs, P2/P3 registradas) · review (`code-reviewer` após última mudança, zero 🔴, 🟡 corrigidos/justificados) · Brain+state (`brain_store` executado; `workflow-state.json` com `code_review_status: passed` + `harness_status: passed`) · encerramento (portas livres). **Qualquer ❌ = não completa.**

### H7. Cadência
Suite por task/bug/feature (`developer-engineer`) · E2E por sub-fase/sprint/release (`qa-engineer`/`developer-engineer`, ~30–60min) · H4 por entrega UI · Brain por achado (2–5min) · saneamento quando débito > 0 · auditoria mensal (`architect`+`qa-engineer`).

### Anexo A — Comandos
Resolver sempre de `harness.config.json`: `commands.suiteFull` (referência absoluta), `commands.unit`, e por stack `integration`/`frontendTest`/`frontendBuild`/`backendRun`/`frontendRun` (ausente com justificativa `N/A` quando a stack não existe). Infra: `infra.composeFile` + `infra.ports`. Neste repo: `node --test ".opencode/plugins/__tests__/*.spec.mjs" && node scripts/static-checks.mjs`.

### Anexo B — Template de Relatório de Harness
Retorno de developer/qa que executou H1/H3/H4 **DEVE** conter: H1 (comando, ✅/❌, counts unit/IT, falhas classe:linha); H2 (débito antes do dev + ação); H3 (wipe, UPs, 12 passos, Network/Console, screenshots, processos finalizados); H4 (telas/regras/lógica/perf); H5 (brain_store paths); conclusão + bloqueios.

### Governança do §5
Mudanças exigem aprovação do orquestrador + `workflow-state.json`. Violação = retrabalho completo. Auditoria mensal (H7).

---

## 5.1 Backend — Testes Unitários (obrigatório)

- **Service**: todo `*ServiceImpl` cobre happy path, erros (validação, não-encontrado, conflito) e bordas. **Domain**: invariantes, fábricas, validações. **Converters** (construtor privado + `of()` estático, nunca MapStruct): testar direto, nunca mockar. **Validators** e **Utils** puros: testar direto.
- **Proibido no unitário:** repository/controller (`*IT.java`), `@SpringBootTest`, `@WebMvcTest`, H2/banco, Lombok, `Thread.sleep()` (usar Awaitility).
- Ferramentas: JUnit 5 (`@ExtendWith(MockitoExtension.class)`), Mockito (`@Mock`/`@InjectMocks`/`verify`/`ArgumentCaptor`), AssertJ, Fakes em `src/test/java/.../fake/`, padrão `when{Action}_then{Expected}`.
- Execução: `mvn test` / `mvn test -pl {modulo}` (ou `commands.unit` do config).

## 5.2 Backend — Testes de Integração (obrigatório)

- **Controllers**: todo controller tem `*IT.java` (200/201/204, 400/404/409, 401/403, isolamento multi-tenant). **Repositories**: queries/`@Query`/paginação/constraints. **Cross-module** (outbox, eventos) e **Flyway** (bootstrap valida migrations).
- Regras: `*IT.java` só em `integration-test/`; PostgreSQL real via Testcontainers (nunca H2); base `WebIntegrationTest`; limpeza com `DatabaseCleaner.reset()` (nunca `deleteAll`); auth via `JwtTestHelper`; dados via `TestUserFactory`/`seedCommonData()`. Proibido `@WebMvcTest` e RestAssured (usar MockMvc).
- Execução: `mvn verify -pl integration-test` / `-Dit.test=XxxIT` (ou `commands.integration`).

## 5.3 Frontend — Testes (obrigatório)

Stores (Pinia), views, serviços API e componentes: Vitest + happy-dom (nunca jsdom), `src/**/__tests__/*.spec.ts`, coverage ≥70% no novo. Execução: `npm test` + `npm run build` (ou `commands.frontendTest`/`commands.frontendBuild` de `harness.config.json`, dono do comando).

## 5.4 Regra Geral
Testes passam **antes** de commit/push — novo, existente ou pré-existente. Falhou ⇒ corrigir até passar (H1.2). Suite completa 0 falhas antes de finalizar a tarefa **e** antes do próximo dev (H2.2).

---

## 6. Code Review Obrigatório

### 6.1 Invocação e Aplicação

> 🚨 **REGRA ABSOLUTA — NÃO PULAR.** Pular o code review após implementação = violar o harness. Sem exceção.

Após finalizar a implementação de **QUALQUER** tarefa, sub-fase ou mudança de código (incluindo sub-fases de SDD, bugfixes, ou qualquer modificação em `src/`), invocar **OBRIGATORIAMENTE** o agente `code-reviewer` antes de:

- Declarar a tarefa como concluída
- Avançar para a próxima sub-fase
- Marcar TODOs como completos
- Reportar status como "done" para o usuário

**A revisão DEVE verificar:**

| Critério | O que verificar |
|----------|-----------------|
| **Qualidade** | Naming, estrutura, complexidade, coesão |
| **Testes** | Cobertura adequada, qualidade dos asserts, isolamento |
| **Segurança** | SQL injection, exposição de dados sensíveis, validação de entrada |
| **Performance** | N+1 queries, streams em caminhos críticos, alocação de coleções |
| **Arquitetura** | Package boundaries, DDD, dependências entre módulos |
| **Regras** | Conformidade com `.agents/rules/*.md` |

**Classificação dos débitos:**
- 🔴 **Crítico** — DEVE ser corrigido antes de concluir a tarefa
- 🟡 **Atenção** — DEVE ser avaliado e corrigido se aplicável
- 🟢 **Sugestão** — Fica a critério, mas deve ser considerada

### 6.2 Loop de Correção (MANDATORY)

Após o code review, executar loop de correção **SEM SAIR** até zero 🔴:

```
1. Receber review do code-reviewer
2. Se 🔴 existir: corrigir TODOS os críticos
3. Se 🟡 existir: avaliar caso a caso, corrigir os aplicáveis
4. Re-executar build/tests
5. Re-invocar code-reviewer
6. Repetir 2-5 até zero 🔴
7. Máximo 3 iterações; após 3 iterações, escalar para revisão manual do user
```

### 6.3 Checklist Pré-Conclusão (MANDATORY)

> Resumo desta seção; o portão vinculante é o §5 H6.

Antes de declarar QUALQUER fase de implementação como completa, **TODOS** os itens abaixo devem ser verdadeiros:

```markdown
## Pre-Completion Checklist (Harness Gate — NON-NEGOTIABLE)

- [ ] `code-reviewer` foi invocado APÓS a última mudança de código
- [ ] Zero débitos 🔴 Críticos no report mais recente
- [ ] Suite completa → 0 falhas (H1 + H2)
- [ ] E2E Greenfield executado quando aplicável (H3) — DB wipe + re-cadastro UI 12 passos
- [ ] Avaliação contínua H4 (telas + regras + lógica + performance) preenchida
- [ ] `brain_store` de lições executado (H5.2)
- [ ] Processos finalizados (H5.1)
```

**Se QUALQUER item falhar → fase NÃO está completa.** Voltar e corrigir.

### 6.4 Tracking em `workflow-state.json`

Após cada code review, atualizar o `workflow-state.json` com:

```json
{
  "code_review": {
    "last_invoked_at": "2026-07-30T19:30:00Z",
    "last_status": "passed | failed",
    "critical_issues": 0,
    "attention_issues": 0,
    "reviewer_notes": "Resumo dos principais achados"
  }
}
```

**Não avançar para próxima fase se `code_review.last_status != "passed"`.**

### 6.5 Em Que Momento Invocar

| Momento | Invocar? |
|---------|----------|
| Após cada sub-fase de SDD (1.0, 1.1, 1.2, ...) | ✅ SIM — sempre |
| Após criar/modificar qualquer arquivo `.java`, `.ts`, `.vue`, `.sql` | ✅ SIM — ao final do batch |
| Antes de dizer "Phase X completa" para o user | ✅ SIM — sem exceção |
| Antes de iniciar nova fase | ✅ SIM — se última fase não revisada |
| Durante o desenvolvimento (mid-task) | ❌ NÃO — esperar fim do batch |

**Definição de "batch"**: conjunto de mudanças relacionadas que entregam uma unidade funcional (ex: Phase 1.6 = 3 tasks FE-01..03 = um batch = um review).

---

## 7. Uso Obrigatório de Skills

Para **TODO** desenvolvimento, as skills apropriadas **OBRIGATORIAMENTE** devem ser carregadas:

| Contexto | Skill | Propósito |
|----------|-------|-----------|
| **Prompt Gate** | `prompt-optimizer` | Análise obrigatória de toda demanda de mudança (6 elementos, 2 rotas) antes de qualquer ação — ver seção 0 |
| **Análise inicial** | `brain` | Consultar memória de longo prazo do sistema |
| **Planejamento Técnico** | `dev-planner` | Planejamento detalhado de features: descoberta, análise de restrições, desafio de soluções, projeto de arquitetura, estimativa e validação (6 fases, gera artefatos para sdd-compiler) |
| **Arquitetura** | `sdd-architecture-board` | Decisões arquiteturais, ADRs, validação de design |
| **Desenvolvimento Backend** | `java-architecture-specialist` | DDD, JPA, serviços, segurança, testes |
| **Desenvolvimento Backend** | `nestjs-architecture-specialist` | NestJS, módulos, DI, guards, testes |
| **Desenvolvimento Backend** | `node-architecture-specialist` | Node.js, Express/Fastify, módulos, testes |
| **Desenvolvimento Backend** | `rust-architecture-specialist` | Rust, Axum/Actix, Cargo, async, testes |
| **Desenvolvimento Frontend** | `frontend-vue-specialist` + `frontend-design` | Componentes, stores, router, API, testes + design visual |
| **Desenvolvimento Frontend** | `frontend-react-specialist` + `frontend-design` | Componentes React, stores, router, API, testes + design visual |
| **Design System / Templates** | `template-structure` + `template-best-practices` + `template-deepsearch` (subagente `design-system-specialist`) | Templates de componentes reutilizáveis (props/slots/estados/variantes), boas práticas, estado da arte via deepsearch |
| **SDD Compiler** | `sdd-compiler` | Geração de SPEC, PLAN, TASK com validação |
| **Revisão de Spec** | `spec-review` | Revisar SPEC.md contra regras do projeto, gerar relatório de gaps e conformidade |
| **Revisão de Segurança** | `security-review` | Revisão de segurança integrada ao SDD (Fase 1, 3, 4.5) — OWASP, ASVS, MASVS |
| **Revisão de Código** | *(invocar agente `code-reviewer`)* | Code review completo |
| **Microtasks** | `jira-microtask-breaker` | Quebrar tarefas complexas em microtasks |
| **Comunicação** | `caveman` | Modo ultra-comprimido (~65% menos tokens) durante desenvolvimento |

**Regra:** O desenvolvedor (agente) SEMPRE deve carregar a skill correspondente ao que está implementando. As skills contêm templates, exemplos e boas práticas que garantem consistência e qualidade.

---

## 8. Regras Gerais

- **Nunca** pular a leitura do `workflow-state.json`.
- **Nunca** implementar sem spec (features) ou sem análise (bugfixes).
- **Nunca** pular a fase de testes — testes unitários + integração são obrigatórios.
- **Nunca** pular o code review — invocar `code-reviewer` é obrigatório. **Esta regra é NON-NEGOTIABLE.** Ver seção 6 para protocolo completo.
- **Nunca** declarar fase completa sem o Code Review Gate da seção 6.3.
- **Economia de tokens:** Utilizar caveman mode (`/caveman`) como padrão durante desenvolvimento para reduzir consumo de tokens (~65%). Exceções: avisos de segurança, ações irreversíveis, usuário solicitar "normal mode".
- Atualizar o workflow state ao concluir cada fase ou milestone.
- Registrar aprendizados no Brain ao final de cada tarefa.

---

## 9. Documentos de Referência

| Documento | Propósito |
|-----------|-----------|
| `.doc/stacks.md` | Stacks e versões |
| `.doc/arquitetura-backend.md` | Arquitetura detalhada do sistema |
| `.doc/especificacao-sistema.md` | Especificação completa do sistema |
| `.spec/backend/sdd-etapa{N}-{dominio}.md` | SDD de cada domínio |
| `.agents/rules/backend-unit-tests.md` | Regras detalhadas de testes unitários |
| `.agents/rules/backend-integration-tests.md` | Regras detalhadas de testes de integração |
| `.agents/rules/backend-coding-standards.md` | Padrões de codificação backend |
| `.agents/rules/frontend-coding-standards.md` | Padrões de codificação frontend |
| `.agents/rules/db-migration-flyway.md` | Regras de migração Flyway |
| `.agents/rules/security-standard.md` | **Fonte da verdade** de segurança (OWASP) — web, API, mobile |
| `.agents/rules/brain-context.md` | Ponte fina → `BRAIN.MCP.md` (dono brain) |
| `.agents/rules/sdd-workflow-standard.md` | Padrão do workflow SDD |
| `.agents/skills/dev-planner/SKILL.md` | **Planejamento técnico detalhado** — 6 fases (Descubra→Analise→Desafie→Projete→Estime→Valide), gera artefatos para sdd-compiler |
| `AGENTS.md` | Visão geral do projeto e comandos essenciais |
| `~/.config/opencode/skills/caveman/SKILL.md` | Regras completas do modo caveman |
| **`workflow-rules.md` §5** | **FONTE DA VERDADE** do harness (H0–H7) — fundido do `harness-continuous.md` (DOC-02) |
