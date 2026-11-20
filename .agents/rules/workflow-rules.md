# Workflow Rules — Prompt Gate + Harness Contínuo

Estas regras são obrigatórias para todos os agentes. **Escopo deste arquivo:**
o Prompt Gate (§0) e o Harness Contínuo H0–H7 (§5 + anexos). O **fluxo** —
esteira PRD → ADR, SDD por ADR, bugfix, code review, papéis e estado — vive em
`workflow.md` (fonte única); aqui não se repete a esteira.

> **Fusão DOC-02:** este arquivo absorveu `harness-continuous.md` (H0–H7 + anexos,
> agora §5). Referências ao arquivo antigo re-apontam para cá (mapa em
> `.spec/governance/harness-v7/back-refs-DOC-02.md`). Comandos/portas abaixo vêm de
> `harness.config.json` (nunca de literal copiado — SPEC ADR-003).

---


## 0. Prompt Gate — ANÁLISE OBRIGATÓRIA (NON-NEGOTIABLE)

> 🚨 **TODA demanda de MUDANÇA do usuário DEVE ser analisada ANTES de qualquer ação.**
> Comandos de consulta (leitura de estado) pulam o gate — ver "Exceção" abaixo.

### Regra Absoluta

1. **Stage 0 — carregar skill e brain literal:** `prompt-optimizer` via `skill` tool, depois `brain_search(query=<prompt do usuário, literal>, top_k=3)`. Paráfrase já é interpretação. Detalhe: `.agents/skills/prompt-optimizer/SKILL.md` §Stage 0.
2. **Stage 0 — probe do repo (somente leitura):** `AGENTS.md`, `harness.config.json` (`targets.*`, `commands.*`), globs de alto nível e eixo detectado. Fornece contexto **citável** (`arquivo:linha` ou brain path) para o `<context>`; nunca preenche lacuna do usuário.
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

6. **Ledger de premissas:** premissa não confirmada que sobreviveu ao estoque (inferência "parcial" da Rota A, ou premissa da 1ª rodada não respondida na 2ª) não entra no PICCO. Registrar em `workflow-state.json.prompt_assumptions[]` com `{texto, elemento, at}`; confirmação do usuário promove o texto para `<context>` citado e remove o item. Detalhe: `.agents/skills/prompt-optimizer/SKILL.md` §Ledger de premissas.

### Proibido

- ❌ Preencher lacuna com default do modelo
- ❌ "Vou assumir que você quer X"
- ❌ Delegar com contexto vago
- ❌ Pular brain_search ou o probe do Stage 0
- ❌ Tratar dedução da IA como elemento afirmado
- ❌ Nunca escrever premissa não confirmada como fato
- ❌ Deixar premissa sobrevivente sem registro no ledger (`prompt_assumptions[]`)
- ❌ Bloco PICCO com mais de 10 constraints

### Obrigatório

- ✅ Stage 0 (brain literal + probe do repo) antes de contar E1..E6
- ✅ Carregar `prompt-optimizer` via skill tool
- ✅ Contar E1..E6 explicitamente antes de agir
- ✅ Ledger de premissas no estado (`workflow-state.json.prompt_assumptions[]`)
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

Skill de referência (contrato operacional completo): `.agents/skills/prompt-optimizer/SKILL.md` (Stage 0, ledger, PICCO).
Variações de pergunta por elemento e perguntas de desempate: `.agents/skills/prompt-optimizer/references/clarifying-questions.md`.
Contrato de saída e exemplos (bons e ruins): `.agents/skills/prompt-optimizer/references/picco-template.md`.
Fixtures com veredito esperado: `.agents/skills/prompt-optimizer/fixtures/` (10 prompts, 7 Rota B / 3 Rota A).

---

## 0.1 Divisão de Papéis (NON-NEGOTIABLE)

> 🚨 **REGRA CRÍTICA:** Orchestrator (`orchestrator`) **NÃO DESENVOLVE**. Apenas orquestra, governa, documenta, delega.

| Role | Responsabilidade |
|------|------------------|
| **Orchestrator** (este agente) | Triagem, governança, delegação via `task`, `workflow-state.json`, code review, brain |
| **engineer** | Insumo em Markdown (RESEARCH, design-decisions); md-only, não decide ADR |
| **architect** | Decisões arquiteturais e ADRs (validação) |
| **product-manager** | Validação de negócio |
| **ux-designer** | Parecer de UX/interface (vinculante no escopo visual) |
| **design-system-specialist** | Templates de componentes reutilizáveis do design system |
| **frontend-engineer** | **Implementação frontend** (Vue/React/CSS/tests) |
| **backend-engineer** | **Implementação backend** (por eixo: Java/Nest/Node/Rust) |
| **code-reviewer** | Code review após cada batch |
| **qa-engineer** | Cobertura de testes |
| **security-engineer** | Auditoria de segurança |

**Fluxo correto:**
1. User pede nova phase
2. **Prompt optimizer** — analisar prompt (SEÇÃO 0)
3. **Brain search** para contexto (lições passadas, decisões)
4. **Salvar no Brain** aprendizados/erros/decisões
5. **Delegar para `frontend-engineer`/`backend-engineer`** via `task` tool
6. **Receber retorno** do implementador
7. **Delegar para `code-reviewer`** (regra non-negotiable, ver seção 6)
8. **Aplicar fixes** se necessário (re-invocar o implementador se crítico)
9. **Atualizar `workflow-state.json`** campo `code_review`
10. **Só então** declarar phase completa

**Erros comuns a evitar:**
- ❌ Orchestrator implementa código diretamente (write tool, edit tool)
- ❌ Pular prompt_optimizer antes de qualquer ação
- ❌ Pular brain_search antes de delegar
- ❌ Não salvar aprendizados no Brain
- ❌ Pular code review após implementação
- ❌ Declarar phase completa sem Pre-Completion Gate (`workflow-rules.md` §5 H6)


### Economia de tokens (caveman)

Ativar `/caveman` (`full` padrão; níveis `lite`/`full`/`ultra`) durante o desenvolvimento.
Exceções que desligam o modo: avisos de segurança, ações irreversíveis, sequências em que
ambiguidade causa erro, usuário pedindo esclarecimento. **Nunca** em código gerado,
mensagens de commit e PRs (prosa normal). Regras completas:
`~/.config/opencode/skills/caveman/SKILL.md`; estatísticas: `/caveman-stats`.

---


## 1. Fluxo de desenvolvimento (aponta)

O fluxo completo — `Discovery → PRD → RESEARCH → ADR-INDEX → loop por ADR
(ADR.md + SPEC.md + TASKS.md + VERIFY.md) → implementação → verify → archive`,
o layout `.spec/**`, o vocabulário canônico de fase (V17), bugfix (R1–R4), code
review e a gestão de `workflow-state.json` — está em **`workflow.md`**, fonte
única. Nenhuma seção deste arquivo redefine a esteira.

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
- **Detecção ao delegar:** o orquestrador roda a suite **antes da implementação (P3)**; N falhas → bloquear dev + TASKS de saneamento.
- Proibido `@Disabled`/`@Ignore`/`assumeTrue`/skip comentado para "passar".

### H3. Harness E2E Greenfield (Wipe + Re-cadastro)
**Quando (MANDATORY):** fim de cada sub-fase SDD, cada bug UI/fullstack, fim de sprint, release, mudança em stack/router/i18n/auth/migration base.
**Protocolo:** subir dependências (`infra.composeFile` se houver) → WIPE + recreate → subir backend/frontend (comando de execução do `AGENTS.md` do destino; o instalador publica só `suiteFull`/`unit`/`analyze` — chave de execução ausente no eixo ⇒ comando documentado — portas de `infra.ports`) → Chrome DevTools (`new_page` na URL do front → snapshot).
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
Build+testes (suite completa 0 falhas; front test+build 0 erros) · H3 quando aplicável (12 passos OK, Network/Console limpos, screenshots em `.spec/prd/{prd}/ADRs/{adr}/harness/`) · H4 avaliado (P1→bugs, P2/P3 registradas) · review (`code-reviewer` após última mudança, zero 🔴, 🟡 corrigidos/justificados) · Brain+state (`brain_store` executado; `workflow-state.json` com `code_review_status: passed` + `harness_status: passed`) · encerramento (portas livres). **Qualquer ❌ = não completa.**

### H7. Cadência
Suite por task/bug/feature (`frontend-engineer`/`backend-engineer`) · E2E por sub-fase/sprint/release (`qa-engineer`/`frontend-engineer`/`backend-engineer`, ~30–60min) · H4 por entrega UI · Brain por achado (2–5min) · saneamento quando débito > 0 · auditoria mensal (`architect`+`qa-engineer`).

### Anexo A — Comandos
Resolver sempre de `harness.config.json`: `commands.suiteFull` (referência absoluta), `commands.unit` e, quando o eixo declarar, `commands.analyze` — o instalador publica só `suiteFull`/`unit`/`analyze`, logo chave de integração, de front test/build ou de execução do eixo ausente ⇒ use `commands.suiteFull` (e, para subir o sistema, o comando de execução documentado no `AGENTS.md` do destino; `N/A` quando a stack não existe). Infra: `infra.composeFile` + `infra.ports`. Neste repo: `node --test ".opencode/plugins/__tests__/*.spec.mjs" && node scripts/static-checks.mjs`.

### Anexo B — Template de Relatório de Harness
Retorno de developer/qa que executou H1/H3/H4 **DEVE** conter: H1 (comando, ✅/❌, counts unit/IT, falhas classe:linha); H2 (débito antes do dev + ação); H3 (wipe, UPs, 12 passos, Network/Console, screenshots, processos finalizados); H4 (telas/regras/lógica/perf); H5 (brain_store paths); conclusão + bloqueios.

### Governança do §5
Mudanças exigem aprovação do orquestrador + `workflow-state.json`. Violação = retrabalho completo. Auditoria mensal (H7).

---

## 5.1 Backend (Java) — Testes Unitários (obrigatório)

- **Service**: todo `*ServiceImpl` cobre happy path, erros (validação, não-encontrado, conflito) e bordas. **Domain**: invariantes, fábricas, validações. **Converters** (construtor privado + `of()` estático, nunca MapStruct): testar direto, nunca mockar. **Validators** e **Utils** puros: testar direto.
- **Proibido no unitário:** repository/controller (`*IT.java`), `@SpringBootTest`, `@WebMvcTest`, H2/banco, Lombok, `Thread.sleep()` (usar Awaitility).
- Ferramentas (backend=java): JUnit 5 (`@ExtendWith(MockitoExtension.class)`), Mockito (`@Mock`/`@InjectMocks`/`verify`/`ArgumentCaptor`), AssertJ, Fakes em `src/test/java/.../fake/`, padrão `when{Action}_then{Expected}`.
- Execução (backend=java): `mvn test` / `mvn test -pl {modulo}` (ou `commands.unit` do config).

## 5.2 Backend (Java) — Testes de Integração (obrigatório)

- **Controllers** (backend=java): todo controller tem `*IT.java` (200/201/204, 400/404/409, 401/403, isolamento multi-tenant). **Repositories**: queries/`@Query`/paginação/constraints. **Cross-module** (outbox, eventos) e **Flyway** (bootstrap valida migrations).
- Regras (backend=java): `*IT.java` só em `integration-test/`; PostgreSQL real via Testcontainers (nunca H2); base `WebIntegrationTest`; limpeza com `DatabaseCleaner.reset()` (nunca `deleteAll`); auth via `JwtTestHelper`; dados via `TestUserFactory`/`seedCommonData()`. Proibido `@WebMvcTest` e RestAssured (usar MockMvc).
- Execução (backend=java): `mvn verify -pl integration-test` / `-Dit.test=XxxIT` (ou `commands.suiteFull`, pois o instalador não publica chave de integração do eixo).

## 5.3 Frontend (Vue/React) — Testes (obrigatório)

- **Obrigatório**: Stores (Pinia), views, serviços API e componentes: Vitest + happy-dom (nunca jsdom), `src/**/__tests__/*.spec.ts`, coverage ≥70% no novo. Execução: `npm run test:run` + `npm run build` (ou `commands.suiteFull`, pois o instalador não publica chave de front test/build).

## 5.4 Regra Geral
Testes passam **antes** de commit/push — novo, existente ou pré-existente. Falhou ⇒ corrigir até passar (H1.2). Suite completa 0 falhas antes de finalizar a tarefa **e** antes do próximo dev (H2.2). Eixos sem seção própria (ex.: eixo `node`, `nestjs`, `rust`) resolvem a obrigação de testar por `commands.suiteFull`/`commands.unit` do `harness.config.json` do destino; chave do eixo ausente ⇒ use `commands.suiteFull`.

---

## 6. Code Review Obrigatório (aponta)

Regra **NON-NEGOTIABLE**: após qualquer mudança de código, invocar o agente
`code-reviewer` antes de declarar tarefa/fase concluída. Critérios, loop de
correção, checklist pré-conclusão e tracking em `workflow-state.json` estão em
**`workflow.md` §5**; o portão vinculante é o §5 H6 deste arquivo.

---
