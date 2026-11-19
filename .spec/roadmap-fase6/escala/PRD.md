# PRD — Fase 6 (Escala: multi-unidade + app mobile/PWA)

> **prd-id**: `escala` (roadmap Fase 6)
> **Tipo de rota**: Feature (dimensão de unidade no domínio + shell mobile/PWA)
> **Segmento**: todos, com gating por plano/entitlement
> **Status**: `draft` (aguarda gate humano)
> **Insumo vinculante**: `.spec/roadmap-fase6/escala/UX-SPEC.md` (classes A–D, D1–D12, W1–W7, Q1–Q5, 24 asserções QA)
> **Base**: F1 agenda · F2 estética · F3 salão/barbearia · F4 retenção · F5 financeiro; entitlements 18 chaves

## 1. Problema e valor

O Atlas é estruturalmente single-unit: agenda, horários, recursos, estoque, caixa e recebimentos assumem um endereço por tenant. Dono com matriz e filial abre tenants separados (perde consolidação) ou mistura tudo (double-booking, caixa sem dono físico, relatórios somando o que não deve). E não há experiência móvel: a casca é desktop comprimida, sem instalação e sem leitura quando a rede cai.

Quando pronta: N unidades com isolamento real e consolidado explícito; profissional nunca agendado em dois lugares ao mesmo tempo; financeiro/relatórios com recorte por unidade sem quebrar a regra de receita; produto instalável no celular com leitura offline. **Tenant de unidade única não vê fricção nova.**

## 2. Escopo

**Entra:**
- **A** Dimensão de unidade no domínio (tabela `units`, `unit_id` nas entidades operacionais, RLS/RBAC por unidade, backfill).
- **B** Contexto de unidade no chrome (`?unidade` + `localStorage`, agregado read-only).
- **C** Consolidação (dashboard com quebra, sumário de agenda por unidade, comparativo em relatórios, `UnitFilter` em financeiro).
- **D** Operação por unidade (agenda, horários, equipe, recursos, PDV/caixa, estoque, lista de espera).
- **E** Wizard de unidade (4 passos + revisão, "copiar da matriz", sem re-semear catálogo).
- **F** App mobile/PWA (shell 5 tabs, `/app/mais`, manifest + SW, instalação, offline **read-only**).
- **G** Limites por plano (`units_limit`, quota na UI, gating `multiUnidade`/`appMobile`).
- **H** Back-office (coluna Unidades, leitura/suspensão em `/internal-admin/empresas/:id/unidades`).

**NÃO entra:** app nativo nas lojas (App Store/Play) · multi-tenant hierárquico (tenant pai/filho) · preço por unidade · franquia fiscal própria (unidade não emite NFCe com CNPJ/IE/CSC próprio) · motor novo de entitlements · mudança do ledger · autoagendamento público/taxa/métricas consolidadas (fase 3 de produto) · escrita otimista/sincronização offline · redesenho de DS.

## 3. Objetivo

N unidades com isolamento real e consolidação explícita; zero double-booking cross-unit; recorte por unidade em financeiro/relatórios/dashboard; produto instalável com degradação offline honesta; monetização de escala por `units_limit` sem motor novo.

## 4. Perfis

| Perfil | Impacto |
|---|---|
| Admin | Todas as unidades + agregado; cria/edita/inativa; financeiro por unidade |
| Recepção | Operação por unidade; agregado leitura; sem financeiro agregado |
| Profissional | Só própria agenda/horário nas unidades com vínculo |
| Cliente final | Recebe endereço correto (`{unidade_endereco}`) |
| Super admin | Leitura + suspender unidade em `/internal-admin`; **não entra em `/app`** |

## 5. Métricas

| Métrica | Meta |
|---|---|
| Cobertura `unit_id` em agendamentos novos | 100% no fim do rollout |
| Backfill do legado | 100% (W3) |
| Double-booking cross-unit persistido | 0 |
| Adoção multi-unidade (≥2 ativas / elegíveis) | ≥25% em 90d |
| Uso do agregado | ≥40% em 30d |
| Tempo de criação de unidade | ≤5 min (mediana) |
| Instalação PWA | ≥25% em 60d |
| Sessão offline sem erro | ≥90% |
| Conversão do CTA de limite | ≥20% em 90d |
| Regressão single-unit | 0 |
| Vazamento cross-unit | 0 |
| Performance da agenda por unidade | ≤1,5s |

## 6. Requisitos funcionais (RF-01..46)

### 6.1 Unidades
- **RF-01** Lista (cards/tabela, estados loading/vazio/erro/gate/limite distintos).
- **RF-02** Criar via wizard (4 passos + revisão; `short_name` ≤12; CEP→endereço; horários; equipe; recursos opcionais; passos 3–4 puláveis; sucesso com 3 CTAs).
- **RF-03** Não re-semear catálogo (W4).
- **RF-04** Editar (tabs Dados/Horários/Equipe/Recursos; fuso herdado; "copiar da matriz").
- **RF-05** Inativar (confirmação por nome com futuros; sai de novas criações; permanece listada para histórico).
- **RF-06** Equipe por unidade (associar/remover; remoção bloqueada com agendamento futuro).
- **RF-07** Auditoria (autor, unidade, antes/depois, UTC).

### 6.2 Contexto
- **RF-08** Seletor só com `units>1 && multiUnidade`.
- **RF-09** `?unidade` válida aplica; inválida → StatePanel sem revelar nome alheio; ausente → localStorage → agregado.
- **RF-10** Agregado read-only (zero CTA primário de escrita).
- **RF-11** Interstitial de escolha para classe B em agregado.
- **RF-12** Classe C: leitura consolidada, edição só em unidade.
- **RF-13** Classe D indiferente ao escopo.
- **RF-14** Persistência (`localStorage`, query keys com `unitId`, drill-down preserva rota/período).

### 6.3 Operação
- **RF-15** Agenda por unidade (grade atual + campo Unidade no drawer + chip só multi).
- **RF-16** Agenda agregada = sumário por unidade (nunca grade lado a lado).
- **RF-17** Conflito cross-unit por profissional (bloqueia citando unidade ocupada; SlotPicker sinaliza).
- **RF-18** Horários por unidade (+copiar de; edição em agregado bloqueada).
- **RF-19** PDV/caixa por unidade (interstitial; fechamento com unidade).
- **RF-20** Estoque por unidade (saldo/movimento; agregado read-only; produto tenant-level).
- **RF-21** Recursos por unidade (anti-sobreposição por recurso+unidade; copiar da matriz).

### 6.4 Financeiro/relatórios
- **RF-22** `unit_id` derivado do atendimento em `appointment_payments`/`charges` (nunca digitado); consolidado = soma das unidades.
- **RF-23** `UnitFilter` + coluna unidade; export avisa; regra receita+a receber preservada.
- **RF-24** DRE por unidade em Tabs; mesma estrutura por unidade.
- **RF-25** Comparativo entre unidades (tabela ordenável ≥md, `<dl>` em 375) + CSV com coluna.
- **RF-26** Dashboard agregado (hero + "Maior: X" + bloco por unidade + drill-down).

### 6.5 Mobile/PWA
- **RF-27** Shell 5 tabs (4ª por capability), `/app/mais` rota, `aria-current`, safe-area.
- **RF-28** Sem `appMobile`: casca idêntica, sem cache novo.
- **RF-29** 4ª tab com fallback determinístico.
- **RF-30** `/app/mais` (nav completa, tema, instalação dispensável, sign out separado).
- **RF-31** Manifest + SW válidos; card de instalação sem interstitial.
- **RF-32** Offline read-only (banner, cache da agenda do dia, escrita disabled, zero escrita otimista, reconexão + refetch).
- **RF-33** Agenda mobile do dia (chips 7 dias, cartão completo, ações 44px sem swipe).

### 6.6 Gating/quotas
- **RF-34** `multiUnidade` ausente/null → upsell, **zero request** a `units`.
- **RF-35** `appMobile` ausente/null → casca atual inalterada.
- **RF-36** `units_limit` no limite → CTA disabled + copy distinguindo limite de falta de entitlement; null = ∞.
- **RF-37** Quota no `PlanCurrentCard` ("Unidades — 2 de 3").
- **RF-38** **Entitlements tolerantes**: payload anterior à fase continua válido; chaves novas assumem `false` (W2, bloqueante de design).

### 6.7 RBAC/back-office
- **RF-39** Admin: tudo nas suas unidades.
- **RF-40** Recepção: operação por unidade; agregado leitura; sem financeiro agregado.
- **RF-41** Profissional: só unidades com vínculo.
- **RF-42** Super admin: listagem/suspensão auditada em `/internal-admin`; sem `/app`.
- **RF-43** RLS: lista filtrada pelo servidor; `?unidade` sem permissão → StatePanel (nunca 403 cru); cross-unit 0 linhas; cliente nunca envia `tenant_id`/`unit_id` de isolamento.

### 6.8 Transversais
- **RF-44** Backfill: legado → unidade matriz; filtro só com `multiUnidade && units>1`; single-unit idêntico.
- **RF-45** Templates com `{unidade_endereco}` (fallback matriz).
- **RF-46** Idempotência (criação/associação/fechamento); `bloqueado` bloqueia escrita por unidade; `cancelado` arquiva e suspende disparos.

## 7. Regras de fronteira

- **RLS por unidade**: `units` com `tenant_id` + índice + policy; toda tabela com `unit_id` valida tenant do JWT **e** membership na unidade. `tenant_id`/`unit_id` de isolamento sempre do JWT, nunca de parâmetro.
- **RBAC por unidade**: autorização = papel no tenant ∩ membership na unidade. Papel não substitui membership.
- **Ledger por unidade**: `appointment_payments` segue SSoT; `unit_id` **derivado** e imutável; `charges` herda; estorno lógico; update de valor/delete proibidos; receita + a receber nunca se somam.
- **Backfill obrigatório e idempotente**: nullable → backfill matriz → constraint só após contagem validada. Nenhum histórico órfão.
- **Conflito cross-unit**: constraint por **profissional × tempo**, sem `unit_id` na chave (incluir unidade reabriria double-booking). Validação banco + aplicação com mensagem por unidade.
- **Quotas**: `units_limit` conta unidades ativas; `prof_limit`/`appt_limit` permanecem tenant-level; null = ∞; limite ≠ falta de entitlement na UI.
- **Catálogo/preço**: serviços/produtos/combos/preços tenant-level (sem preço por unidade); serviço habilitável por unidade via vínculo se Q1 aprovada; criar unidade nunca re-semeia.
- **Dinheiro/tempo**: `*_cents`; `timestamptz` UTC; fuso do tenant herdado pela unidade.
- **Offline**: só leitura em cache com escrita desabilitada; proibido escrita otimista/fila/sync; sem cache de financeiro sensível.
- **Gating**: `null` = `false`; validador **tolerante** a chave ausente; sem entitlement zero request a `units`.
- **Idempotência/segredos**: criação, associação, fechamento e webhooks idempotentes; service role/segredos só em Edge; PII minimizada.
- **LGPD/opt-in**: disparos exigem `whatsapp_opt_in`; endereço de unidade é dado operacional.

## 8. Enquadramento

F1 → F2 → F3 → F4 → F5 → **F6 (este PRD)**. Backend mínimo: `units`; `unit_memberships`; `unit_id` em `appointments`/`working_hours`/`resources`/`stock_*`/`cash_sessions`/`appointment_payments` (+`charges` por herança); `plans.units_limit`; features `multi_unidade` e `app_mobile`; opcional `service_units` se Q1. `units_limit` entra em `usePlanLimits` sem motor novo.

## 9. Aceite QA (DevTools)

Viewports 375/768/1280/1440; sem scroll horizontal; alvos ≥44px; Console zero; Network sem duplicatas e sem 4xx/5xx; **24 asserções do UX-SPEC §11**; RBAC por papel **e por unidade** (role de app, nunca superuser); RLS zero cross-unit/cross-tenant; idempotência por replay; backfill conferido por contagem; single-unit sem diferença; dark AA; `role=img` + valor textual; `aria-sort`/`caption`; screenshots em `.spec/roadmap-fase6/escala/harness/`.

## 10. Perguntas em aberto

**Bloqueiam ADR:**
1. **W1 — Plano × `multi_unidade` × `units_limit`.** Slugs reais hoje: `free` (0 prof, 30 agend.) · `starter` (1, 150) · `premium` (5, ∞) · `enterprise` (∞, ∞). `multi_unidade` está **apenas em `enterprise`**. Proposta do UX-SPEC: free 1 · starter 1 · premium 2 · enterprise ∞. Decidir: (a) adicionar `multi_unidade` a `premium` com `units_limit=2` + `enterprise` ∞ (recomendado), ou (b) manter só `enterprise` (limite só tem efeito lá).
2. **W2 — Validador tolerante de entitlements** (chave ausente = `false`, sem invalidar as 18 de F2–F5) entra **antes** do consumo das chaves novas?

**Escopo:**
3. **Q1** Serviços tenant-level + `service_units` (recomendado) ou catálogo por unidade?
4. **Q2** Preço por unidade fica fora da v1?
5. **Q3** `units_limit` conta unidades ativas e `prof_limit`/`appt_limit` seguem tenant-level?
6. **Q4** Grade de agenda distinta por unidade (sem grade compartilhada)?
7. **Q5** Campanhas/fidelidade permanecem tenant-level (classe D)?

**Derivadas (para ADR):**
8. Fonte do vínculo profissional↔unidade (`unit_memberships` vs `professionals.unit_id` + N:N); profissional atende todas por padrão ou precisa vínculo explícito?
9. Transferir atendimento entre unidades: permitido com revalidação de conflito, ou exige cancelar/recriar?
10. Unidade tem exclusão ou só inativação? Histórico inativo entra no consolidado?
11. Confirma fuso herdado (sem fuso por unidade)?
12. Estoque segregado sem transferência nesta v1, ou transferência entre unidades já entra?
13. Suspender unidade no internal-admin: bloqueia escrita, torna read-only, ou ambos? Efeito em agendamentos futuros?
14. Cache offline: só agenda do dia, ou também clientes/serviços (leitura)?

## 11. Riscos

| # | Risco | Mitigação |
|---|---|---|
| W1 | Entitlement × limite incoerentes entre plano e catálogo | Decisão humana antes do ADR + teste de catálogo nos 4 slugs reais |
| W2 | Validador all-or-nothing invalida F2–F5 | Validador tolerante primeiro + teste com payload legado |
| W3 | Backfill ausente esconde histórico | Migration idempotente + contagem + filtro só em multi |
| W4 | Criar unidade duplica catálogo | Wizard não re-semeia + teste |
| W5 | Template sem endereço manda cliente ao lugar errado | Variável obrigatória em multi + fallback matriz |
| W6 | Agenda agregada em grade gera leitura falsa | Sumário por unidade + asserção QA |
| W7 | Dois filtros concorrentes | Switcher manda; `UnitFilter` é recorte explícito |
| R8 | Constraint com `unit_id` reabre double-booking | Chave por profissional × tempo + teste cross-unit |
| R9 | `unit_id` do cliente vira vetor de isolamento | Sempre derivado; RLS valida membership; teste com `unit_id` forjado |
| R10 | Offline virar escrita otimista | Escopo read-only + testes de CTAs disabled |
| R11 | Regressão single-unit | Seletor só com `units>1 && multiUnidade` + suíte dedicada |

## 12. Decisões UX vinculantes

D1 contexto no chrome · D2 agregado read-only · D3 "Unidade" 1º campo em forms no agregado · D4 sem FAB · D5 sem cor por unidade · D6 `short_name` ≤12 · D7 dropdown até 6, dialog acima · D8 inativa listada · D9 shell 5 tabs · D10 offline read-only · D11 `appMobile` gateia shell/instalação/cache · D12 conflito cross-unit.

## 13. Taxonomia de escopo

A agregável (dashboard, relatórios, financeiro, cobranças, clientes) · B unidade obrigatória (agenda, PDV, estoque, lista de espera, recursos) · C mista (profissionais, horários, serviços, mensagens) · D tenant-level (usuários, membros, auditoria, pagamentos, plano, conexão WhatsApp, campanhas, fidelidade).

## 14. Contratos de interface

- **Entitlements (20 chaves):** 18 atuais + `multiUnidade` (`multi_unidade`) + `appMobile` (`app_mobile`); `null`/ausente = `false`.
- **Limites:** `PlanLimits` + `unitsLimit` (null = ∞).
- **Contexto:** `UnitContext { mode: "all"|"single"; unitId: string|null; units: UnitSummary[] }`; query keys incluem `unitId`; escrita exige `unitId` não nulo.
- **Resumo:** nome, `short_name`, status, endereço, equipe; nenhum dado financeiro no seletor.

## 15. Backend mínimo

`units` (id, tenant_id, name, short_name, endereço, phone, timezone herdado, active, timestamps; índice; RLS tenant+membership) · `unit_memberships` (tenant_id, unit_id, profile_id; única por par; índices; RLS) · `unit_id` (nullable→backfill→obrigatório) em appointments/working_hours/resources/stock_*/cash_sessions/appointment_payments; `charges` herda · `plans.units_limit` + features · constraint de conflito **sem** `unit_id` · opcional `service_units`. Migrations aditivas e idempotentes; `plans` segue catálogo global.

## 16. Aprovação humana

> Nenhum `ADRs/**` nasce antes deste bloco estar preenchido.

- **Veredito**: `approved`
- **Data**: 2026-11-14
- **Aprovador**: Product Owner (fundador)
- **Portão**: P0→P1 (aprovado)

**Respostas aprovadas (defaults recomendados):**
- W1: `multi_unidade` em **premium** (`units_limit=2`) e **enterprise** (ilimitado); free/starter 1.
- W2: validador **tolerante** é pré-requisito bloqueante (chave ausente = `false`).
- Q1: serviços tenant-level + vínculo `service_units`.
- Q2: preço por unidade **fora** da v1.
- Q3: `units_limit` conta unidades ativas; `prof_limit`/`appt_limit` seguem tenant-level.
- Q4: grade de agenda **distinta por unidade**.
- Q5: campanhas/fidelidade **tenant-level**.
- Derivadas: vínculo explícito via `unit_memberships`; transferência de atendimento permitida com revalidação de conflito; unidade **só inativação** (histórico inativo entra no consolidado); fuso herdado do tenant; estoque segregado sem transferência na v1; suspensão no internal-admin = **read-only**; cache offline restrito à **agenda do dia**.

Checklist: problema/valor ok · escopo A–H ok e não-escopo correto · W1 resolvido com slugs reais · W2 aceito como bloqueante · métricas ok · fronteiras suficientes · Q1–Q5 respondidas ou delegadas · autorizo ADRs.
