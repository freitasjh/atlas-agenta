# QA Report — ADR-004 (fechamento de pagamento)

- **Demand:** `cobranca-formas-pagamento-adr-004` (IT-01 / harness E2E)
- **Agent:** `qa-engineer`
- **Data:** 2026-11-06 (America/Sao_Paulo)
- **Branch:** `adr/cobranca-formas-pagamento/01-schema-ledger-recebimentos` @ `83633c7f1b9862a11fcf2eeb2acf1ae87febb451`
- **Escopo:** evidência E2E; nenhum arquivo de `src/**`, `supabase/**` ou teste foi alterado.

## Ambiente

| Item | Valor |
|---|---|
| Supabase local | `http://127.0.0.1:54321` (stack já ativa; migrations em dia) |
| Edge Functions | `supabase functions serve --env-file supabase/functions/.env` (runtime saudável: `POST signup-tenant {}` → 400) |
| Frontend | `http://127.0.0.1:5174` (Vite) |
| Tenant demo | `04a803ef-fa4d-41b5-84ad-29e90c746817` — `barbearia`, trial, America/Sao_Paulo |
| Asaas | sandbox configurado via `save-asaas-config` para o teste do PIX |
| Massa | 5 atendimentos em 2026-11-06 (3 `em_atendimento`, 1 `concluido` sem pagamento, 1 para PIX) criados por SQL local (dado sintético, não código) |

> Nota de execução: durante uma transição de diálogos, um clique com uid de snapshot obsoleto criou um pagamento de 50,00 no atendimento de 13:00. O lançamento foi **estornado logicamente** (`voided_at`/`voided_by`/`void_reason`) via SQL local antes de continuar. Nenhum código-fonte foi alterado.

### Desvio obrigatório (porta 5173)

`bash scripts/dev-up.sh --no-smoke` **recusa subir** porque a porta 5173 pertence a outro repositório (`/home/joao/fusionlf/wsProjeto/atlas-financeiro`, PID 3230178). O script está correto ao não matar processo alheio. Equivalente executado à mão:

- `supabase functions serve` (runtime já existia servindo só `whatsapp`, reiniciado para servir todas as functions);
- `npm run dev -- --host 127.0.0.1 --port 5174 --strictPort`;
- `node scripts/dev-seed.mjs` (idempotente; tenant demo barbearia confirmado).

## Resultado dos 12 passos (Anexo B)

| # | Passo | Resultado | Evidência |
|---|---|---|---|
| 1 | Login demo admin → agenda | ✅ | `01-agenda-1280.png` |
| 2 | Selo “Pagamento pendente” em `concluido` sem pagamento; `em_atendimento` disponível | ✅ | `01`, `06`, `07` |
| 3 | Concluir com dinheiro 50,00 + gorjeta 5,00 + recebido 60,00 → troco 10,00; **zero** `create-charge` | ✅ | `02`, `03`; network `create-charge` = 0 |
| 4 | Split dinheiro 30,00 + cartão de débito 20,00 → comprovante com 2 linhas | ✅ | `04`, `05` |
| 5 | “Registrar depois” → `sem_pagamento` + selo; toggle filtra | ✅ (com P3 no contador) | `06`, `07` |
| 6 | Abrir “Pagamento” de pendente → Total/Pago/Saldo/A receber/linhas; registrar parcial 40,00/120,00 | ✅ | `08`, `09`, `10` |
| 7 | PIX do sistema | ⚠️ parcial | Sem Asaas: chip desabilitado + mensagem inline correta. Com Asaas: `422 GATEWAY_ERROR` (débito conhecido cpfCnpj); atendimento concluído, **zero** `appointment_payments`, cobrança cancelada — **não marca pago sem webhook** (`12`) |
| 8 | Erro/retry do settlement | ✅ | `11`: `503` (functions paradas) → “Tentar novamente” recarrega. DevTools offline deixou “Carregando pagamento…” > 2 min (sem timeout) — ver P3 |
| 9 | Lista/Dia/Semana + tenant sem feature | ✅ | `13`, `14`; `15`: tenant `clinica` sem ação “Pagamento”, sem selo, sem toggle, e “Concluir” abre `StatusChangeConfirm` legado |
| 10 | 375 px | ✅ (com ressalva) | `16`, `17`, `18`: `scrollWidth == innerWidth` (392), CTA de settlement visível; no capture o `Confirmar` exige scroll interno do diálogo |
| 11 | Console | ✅ | 0 `[ERROR]` / 0 `[WARN]` (preservados das últimas navegações) |
| 12 | Network | ✅ | 0 4xx/5xx inesperados. Provocados: `422 GATEWAY_ERROR`, `409 APPOINTMENT_ALREADY_CONCLUDED`, `503` (functions paradas) |

## Suíte / build (H1)

- `npm test`: **81 arquivos / 684 testes — 0 falhas / 0 skips** (6,91 s).
- `npm run typecheck`: exit 0 (0,39 s).
- `npm run test:integration`: não executado nesta sessão (escopo E2E; sem reset de banco para não perder a massa).

## Defeitos encontrados

### P2 — “Concluir sem pagamento” falha após erro de gateway

- **Passos:** concluir atendimento com linha “PIX do sistema” quando o gateway retorna `422 GATEWAY_ERROR`; clicar em **“Concluir sem pagamento”** (estado `gateway_error` com `persisted=false`).
- **Esperado:** concluir sem pagamento (ou ao menos fechar o fluxo).
- **Atual:** o lote é reenviado com `close_appointment:true` e `payments:[]`; o servidor já havia concluído o atendimento → `409 APPOINTMENT_ALREADY_CONCLUDED`; a UI mostra “Não foi possível concluir a operação. Tente de novo.” e não conclui.
- **Causa provável:** `PaymentCaptureDialog.finishWithoutPix` reenvia `register-appointment-payments` mesmo quando `settlement.appointment.status === "concluido"` (SPEC §9.4 manda usar só o settlement/`create-charge` nesse caso).
- **Evidência:** `12-pix-gateway-erro-1280.png`, req `register-appointment-payments` 1007 (422) e 1009 (409).

### P2 — Overflow horizontal na agenda em 1280 px

- **Passos:** tenant `barbearia` com toggle “Pagamento pendente (N)” visível, viewport 1280×800, visão Lista.
- **Atual:** `document.documentElement.scrollWidth = 1747` vs `clientWidth = 1265` (~482 px de overflow). A barra de filtros não quebra; o toggle novo adiciona ~205 px (escondendo o toggle: 1542 — ainda > 1265, parte pré-existente).
- **Esperado:** RNF-02/SPEC §13 — sem scroll horizontal.
- **Evidência:** `01-agenda-1280.png`, `19-overflow-horizontal-1280.png`.

### P3 — Agenda não invalida após falha de gateway

- **Atual:** o servidor conclui o atendimento durante a request que retorna `422`; como `useRegisterAppointmentPayments` só invalida em `onSuccess`, a lista segue “Em atendimento” até reload.
- **Evidência:** após `12`, lista ainda mostrava “Cliente PIX — Em atendimento”; DB já `concluido`.

### P3 — Contador do toggle inclui `em_atendimento`

- **Atual:** `pendingCount` soma qualquer status ≠ `quitado`/`unknown`, mas o selo só aparece em `concluido`. Com 2 concluídos pendentes + 1 em atendimento, toggle mostra “(3)” e apenas 2 selos.
- **Evidência:** `07-filtro-pendente-1280.png` (N=3; selos em 2 itens; o terceiro é `em_atendimento`).

### P3 — Sem timeout no carregamento do settlement sob rede “offline”

- **Atual:** com DevTools `Offline`, o diálogo permanece “Carregando pagamento…” por > 2 min (o fetch para loopback não rejeita). O caminho de erro/retry real foi validado derrubando o runtime (503).

## Lacunas / não coberto

- Matriz RBAC (recepção/profissional) e ações de estorno/baixa manual/cancelamento de PIX não foram exercitadas nesta sessão (sem usuários/charges pendentes no tenant). O roteiro solicitado cobria o fluxo admin.
- QR PIX/aguardando não foi observado: `create-charge` falha no sandbox pelo débito conhecido de `cpfCnpj` (`.spec/tech-debts/asaas-cpf-cnpj-obrigatorio/TASKS.md`).

## Higiene

Screenshots e este report em `harness/qa/adr-004/`. Report de máquina em `harness/cobranca-formas-pagamento-adr-004.json`. Processos iniciados pela sessão encerrados por PID/porta (nunca `pkill -f`).

---

# Rodada 2 — re-teste dos P2/P3 corrigidos

- **Data:** 2026-11-06 (America/Sao_Paulo)
- **HEAD:** `83633c7f1b9862a11fcf2eeb2acf1ae87febb451` + correções não commitadas (`git status` dirty) — as 5 correções foram lidas no working tree antes do teste.
- **Frontend:** http://127.0.0.1:5174 (Vite; 5173 pertence a `atlas-financeiro`, intocado).
- **Edge Functions:** `supabase functions serve --env-file supabase/functions/.env` (probe `signup-tenant {}` → 400).
- **Massa (dado sintético local, sem código):** `205` quitado com 12.000 (para sobrar 2 pendentes); novo `206` em `em_atendimento` às 15:00. Resultado: 2 concluídos pendentes (`203` parcial 40/120 e `204` sem pagamento) + 1 `em_atendimento` (`206`).
- **Escopo:** nenhum `src/**`, `supabase/**` ou teste alterado.

## Resultado dos cenários (2ª rodada)

| # | Cenário | Resultado | Evidência |
|---|---|---|---|
| 1 | 1280: `scrollWidth === clientWidth`; barra de filtros com todos os controles | ✅ 1280 | `20-r2-agenda-1280.png` — `scrollWidth 1265 === clientWidth 1265`; barra com data, Hoje, Barbeiros, Serviços, Status, “Pagamento pendente (2)” e Lista/Dia/Semana |
| 1 | 375: `scrollWidth === clientWidth` | ❌ | `21-r2-agenda-375.png` — `scrollWidth 392` vs `clientWidth 375` (**17 px**). Culpado: `div.flex.flex-wrap.gap-2` (ações Pagamento/Editar/Enviar mensagem) nos 2 cards com selo “Pagamento pendente”; “Enviar mensage…” cortado. A barra de filtros em si quebra corretamente |
| 2 | Contador “Pagamento pendente (N)” = 2 (2 concluídos pendentes + 1 em atendimento) | ✅ | `20-r2-agenda-1280.png`; DOM: `Pagamento pendente (2)`; 2 selos em `concluido`, nenhum no `em_atendimento` |
| 3 | PIX com gateway quebrado → 422 → “Concluir sem pagamento” | ✅ | `22-r2-pix-gateway-erro-1280.png`, `23-r2-lista-apos-concluir-sem-pagamento-1280.png`; exatamente **1** POST `register-appointment-payments` [422] (req 1492), **zero 409**; diálogo fechou; lista passou a `Concluído` + “Pagamento pendente” sem reload; DB `206=concluido`, 0 pagamentos ativos, charge `cancelado` |
| 4 | Settlement offline → erro em ≤~15 s com “Tentar novamente” | ❌ | `24-r2-settlement-offline-spinner-1280.png` — com DevTools `Offline`, após **18 s** (e >2 min na 1ª tentativa) o diálogo segue “Carregando pagamento…”; nenhum “Tentar novamente”; **0** requests `get-appointment-settlement` despachados |

## Console / Network (rodada 2)

- **Console:** durante o cenário 3, 1 `[error]` “Failed to load resource: 422” (**provocado**) e 1 `[warn]` de acessibilidade (“Blocked aria-hidden on an element because its descendant retained focus”, transição menu “Mudar status” → diálogo Radix). Nenhum erro de aplicação. Após reload final: apenas `[debug]/[info]` do Vite/React.
- **Network:** `register-appointment-payments` no fluxo limpo (após reload) = **1× 422**, **0× 409**. `create-charge` não foi chamado no fluxo. No cenário 4 (offline) não houve request de settlement — a query nem foi despachada.
- **Nota de execução:** uma tentativa exploratória anterior abriu o capture em modo “registrar” (`close_appointment:false`) para um atendimento `em_atendimento` e recebeu `409 APPOINTMENT_INVALID_STATE` (regra do banco: `em_atendimento` exige `close_appointment:true`). O fluxo foi refeito em modo fechar (menu “Mudar status → Concluído”) após reload; o 409 exploratório não faz parte da contagem do cenário 3.

## Status dos defeitos da rodada 1

| ID | Severidade | Status | Nota |
|---|---|---|---|
| QA-ADR004-01 | P2 | ✅ corrigido | “Concluir sem pagamento” não reenvia o lote quando `settlement.appointment.status === "concluido"`; refetch + fecha. Confirmado na UI e na network (1 POST) |
| QA-ADR004-02 | P2 | ⚠️ parcial | 1280 corrigido (0 overflow). Em 375 resta **17 px** de overflow causado pelas ações do card com selo “Pagamento pendente” (a barra de filtros não é mais a causa) |
| QA-ADR004-03 | P3 | ✅ corrigido | `onError` do register invalida `appointments`/`charges`/flags/settlement; lista reflete `Concluído` sem reload |
| QA-ADR004-04 | P3 | ✅ corrigido | `pendingCount` só conta `concluido`; runtime (2) e código (`useAgendaPaymentFlags.ts:104-118`) conferem |
| QA-ADR004-05 | P3 | ❌ aberto | O timeout de 15 s (`SETTLEMENT_TIMEOUT_MS`) existe, mas não dispara no cenário offline: com `navigator.onLine=false` o React Query **pausa** a query (`networkMode: "online"` padrão) e o `queryFn`/`withTimeout` nunca iniciam. `fetch` direto no page em Offline rejeita em 3 ms — logo o bloqueio é a pausa da query, não a rede |

## Causa raiz do P3-5 (evidência)

- DevTools `Offline` ⇒ `navigator.onLine === false`.
- `list_network_requests` após abrir o settlement: **nenhum** request `get-appointment-settlement` (nem pendente).
- `fetch` manual na page sob Offline: rejeita em **3 ms** (`TypeError: Failed to fetch`) — prova que a rede rejeitaria rápido.
- Logo, o spinner infinito vem da query pausada pelo `onlineManager` do React Query; o teto de 15 s só vale quando o `queryFn` chega a rodar (coberto pelo unit test `useAppointmentPayments.test.ts` com `timeoutMs: 10`, que não simula a pausa).

## Higiene (rodada 2)

- Vite 5174 encerrado por PID (`3770606`/`3770605`); `supabase functions serve` encerrado por PID (`3770565`/`3770587`). Confirmado: `5174 free` e `signup-tenant → 503` (mesmo estado do início). Nenhum `pkill -f`. Porta 5173 (`atlas-financeiro`, PID 3230178) intocada. Stack Supabase 54321/54322 permanece ativa (pré-existente).
- Screenshots da rodada 2: `20`–`24`.

---

# Rodada 3 — re-teste do overflow (A) e do offline (B)

- **Data:** 2026-11-06 21:05 (America/Sao_Paulo) / `2026-11-07T00:09Z`
- **HEAD:** `83633c7f1b9862a11fcf2eeb2acf1ae87febb451` + working tree dirty (correções não commitadas, lidas no código antes do teste).
- **Frontend:** `http://127.0.0.1:5174` (Vite, PID 3827591; 5173 de `atlas-financeiro` intocado).
- **Edge Functions:** `supabase functions serve --env-file supabase/functions/.env` (probe `signup-tenant {}` → 400 no início).
- **Massa:** inalterada por esta rodada (dado sintético local). Estado atual: `203` parcial (40/120), `204` sem pagamento, `206` concluído sem pagamento → toggle “Pagamento pendente (3)” e 3 selos.
- **Escopo:** nenhum `src/**`, `supabase/**` ou teste alterado.

## Correções verificadas no código (working tree)

| Falha | Correção observada |
|---|---|
| A — overflow 375 | `AgendaPage.tsx:225` e `:242` — linha de ações `flex w-full min-w-0 flex-wrap ...` + botões `max-w-full`; nenhum controle oculto (`sm:` só muda a direção) |
| B — offline settlement | `useAppointmentPayments.ts:199` e `useAsaasConfig.ts:75` — `networkMode: "always"` (query não é pausada por `navigator.onLine=false`); `SETTLEMENT_TIMEOUT_MS = 15_000` (`:29`) |

## Resultado dos cenários (3ª rodada)

| # | Cenário | Resultado | Evidência |
|---|---|---|---|
| A1 | **375×800** — `document.documentElement.scrollWidth === clientWidth` | ✅ **PASS** | `25`–`27` — `scrollWidth 375 === clientWidth 375` (`innerWidth 375`); **0** elementos com `right > clientWidth`; 6 cards / 18 botões de ação |
| A2 | **375×800** — as 3 ações visíveis e sem corte | ✅ **PASS** | `26`, `27` — “Pagamento” (102 px), “Editar” (87 px), “Enviar mensagem” (167 px) em todos os cards: `offsetParent` não nulo, `visibility/display` visíveis e `scrollWidth === clientWidth` (nada truncado); quebram em 2–3 linhas |
| A3 | **1280×800** — `scrollWidth === clientWidth` e ações visíveis | ✅ **PASS** | `28` — `scrollWidth 1265 === clientWidth 1265`; 18 botões, todos visíveis, nenhum cortado; toggle “Pagamento pendente (3)” na mesma faixa dos filtros |
| B1 | **1280×800** — Offline + abrir “Pagamento” de pendente | ✅ **PASS** | `29` — request **despachada**: `POST get-appointment-settlement` → `net::ERR_INTERNET_DISCONNECTED` (req 1743); erro “Não foi possível carregar o pagamento.” + “Tentar novamente” em **8,6 s**; `hasSpinner=false` |
| B2 | **375×800** — mesmo fluxo em outro atendimento (13:00) | ✅ **PASS** | `30` — `POST get-appointment-settlement` → `ERR_INTERNET_DISCONNECTED` (req 2050); erro + “Tentar novamente” em **4,9 s**; sem spinner |
| B3 | Retry volta a funcionar ao reconectar | ✅ **PASS** | Após remover Offline, “Tentar novamente” → `POST get-appointment-settlement [200]` (req 1745) e diálogo com Total 120,00 / Pago 40,00 / Saldo 80,00 |

> B1/B2 encerram o P3 da rodada 2: a query **é** despachada off-line (não é mais pausada pelo `onlineManager`); o erro aparece bem antes do teto de 15 s porque o próprio `fetch` rejeita com `ERR_INTERNET_DISCONNECTED`.

## Console / Network (rodada 3)

- **Console:** por navegação — `[debug] vite connecting/connected`, `[info] React DevTools` e **1** `[error]` provocado (`Failed to load resource: net::ERR_INTERNET_DISCONNECTED`). **0** warnings, **0** erros de aplicação.
- **Network:** 303 requests (1280) / 300 (375); a única falha é o `get-appointment-settlement` provocado em Offline (1743 / 2050). Nenhum 4xx/5xx inesperado; após reconectar, settlement `[200]`.
- **Nota de execução:** trocar a emulação de viewport com `Offline` ativo recarregou a página e caiu na tela `ERR_INTERNET_DISCONNECTED` do Chrome; o teste foi refeito com viewport aplicado **antes** do Offline (sem reload) — não é defeito da aplicação.

## Suíte / build (H1 — rodada 3)

- `npm test`: **81 arquivos / 694 testes — 0 falhas / 0 skips** (10,11 s; +10 testes vs. rodada 2, cobrindo as correções).
- `npm run typecheck`: exit 0.

## Status dos defeitos após a rodada 3

| ID | Severidade | Status | Nota |
|---|---|---|---|
| QA-ADR004-02 | P2 | ✅ **corrigido** | Overflow 0 em 375 (`375 === 375`) e em 1280 (`1265 === 1265`); 3 ações visíveis e sem corte nos dois viewports |
| QA-ADR004-05 | P3 | ✅ **corrigido** | `networkMode: "always"` faz a query rodar off-line; estado de erro com “Tentar novamente” em 4,9–8,6 s; retry recupera ao reconectar |
| QA-ADR004-06 | P3 | 🆕 aberto (cosmético) | `AppointmentSettlementDialog.tsx:215-223` usa `messages.settlement.loading` como `DialogDescription` quando `settlement` é `null` — no estado de erro o subtítulo continua “Carregando pagamento…” acima da mensagem de erro. Não há spinner e o CTA de retry está visível; é inconsistência de texto, não de fluxo |

## Higiene (rodada 3)

- Vite 5174 encerrado por PID (`3827591`); `supabase functions serve` encerrado por PID (`3827563`). Confirmado: `5174 free`, `signup-tenant → 503` (mesmo estado do início) e container `supabase_edge_runtime_atlas-agenda` ausente.
- Nenhum `pkill -f`. Porta 5173 (`atlas-financeiro`, PID 3230178) intocada. Stack Supabase 54321/54322 permanece ativa (pré-existente).
- Screenshots da rodada 3: `25`–`30`.
