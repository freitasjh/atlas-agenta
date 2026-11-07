# TASKS — ADR-004 Frontend do fechamento do pagamento

## 1. Origem

- SPEC: `.spec/frontend/cobranca-formas-pagamento-adr-004/SPEC.md`
- PLAN: `.spec/frontend/cobranca-formas-pagamento-adr-004/PLAN.md`
- ADR: `.spec/prd/cobranca-formas-pagamento/ADRs/ADR-004-frontend-fechamento-pagamento/ADR.md`

**Regra global (vale para toda task FE):** teste primeiro (escrever, ver falhar, então implementar). Toda task termina com `npm run test -- <arquivo>` verde e `npm run typecheck` limpo. Nunca editar `supabase/**`.

## 2. Backlog

| Task | Tipo | Prioridade | Risco | Fase | Status |
|---|---|---|---|---|---|
| FE-01 | Frontend | P0 | Low | F1 | Done |
| FE-02 | Frontend | P0 | Medium | F1 | Done |
| FE-03 | Frontend | P0 | Medium | F1 | Done |
| FE-04 | Frontend | P0 | High | F1 | Done |
| FE-05 | Frontend | P0 | High | F1 | Done |
| FE-06 | Frontend | P0 | Low | F2 | Done |
| FE-07 | Frontend | P0 | Medium | F2 | Done |
| FE-08 | Frontend | P0 | Medium | F2 | Done |
| FE-09 | Frontend | P0 | Medium | F2 | Done |
| FE-10 | Frontend | P0 | Medium | F2 | Done |
| FE-11 | Frontend | P0 | High | F3 | Done |
| FE-12 | Frontend | P0 | High | F3 | Done |
| FE-13 | Frontend | P0 | Medium | F3 | Done |
| FE-14 | Frontend | P0 | High | F3 | Done |
| FE-15 | Frontend | P0 | Medium | F3 | Done |
| FE-16 | Frontend | P0 | High | F4 | Done |
| FE-17 | Frontend | P0 | High | F4 | Done |
| FE-18 | Frontend | P0 | Medium | F4 | Done |
| FE-19 | Frontend | P0 | High | F5 | Done |
| FE-20 | Frontend | P0 | High | F5 | Done |
| FE-21 | Frontend | P0 | Medium | F5 | Done |
| FE-22 | Frontend | P0 | High | F6 | Done |
| FE-23 | Frontend | P0 | High | F6 | Done |
| FE-24 | Frontend | P0 | Medium | F6 | Done |
| IT-01 | Harness | P0 | High | F8 | Done |
| IT-02 | Harness | P0 | Medium | F7 | Done |

---

## 3. Tasks

### FE-01 — Catálogo de mensagens + `formatMessage`

- **Arquivos:** `src/app/agenda/pagamentos/payments-messages.ts`, `payments-messages.test.ts`
- **RF:** RNF-03 (todos os RFs consomem o catálogo)
- **Teste primeiro:** `payments-messages.test.ts` — toda folha é `string` não vazia; `formatMessage("Adicionar {metodo}", { metodo: "Dinheiro" })` → `"Adicionar Dinheiro"`; placeholder sem valor permanece literal (sem `undefined`).
- **BDD:** Dado o catálogo de pagamentos, quando um template é interpolado, então nenhum `{chave}` conhecido sobra e nenhum valor é vazio.
- **DoD:** grupos `gating/method/dialog/fields/actions/status/partial/discard/registerLater/error/receipt/badge/void/settlement/agenda/pix/chargesPage` presentes; textos congelados do ADR §6 idênticos; `PaymentsMessages` exportado.

### FE-02 — Tipos de pagamento (`src/types/payments.ts`)

- **Arquivos:** `src/types/payments.ts`, `payment-types.ts`
- **RF:** RF-01, RF-07, RF-26
- **Teste primeiro:** arquivo puramente de tipos (sem runtime); a prova é `tsc -b` + fixtures tipadas usadas por `payment-math.test.ts` e `useAppointmentPayments.test.ts` (fora do escopo desta task). Teste executável começa na FE-03/FE-04.
- **BDD:** Dado um `AppointmentSettlement` fixture, quando tipado, então `permissions` contém as 6 flags e `payments[].voided` é booleano (falha de compilação se o contrato divergir).
- **DoD:** sem zod no arquivo de tipos; `PaymentStatus` = união de 4 valores; `PixCharge` com `id|charge_id` normalizado em tipo único.

### FE-03 — `payment-errors.ts`

- **Arquivos:** `src/lib/payment-errors.ts`, `payment-errors.test.ts`
- **RF:** RF-14, RF-16, RF-23, RF-27, RNF-08
- **Teste primeiro:** tabela `code → messageKey/retryable/action` para `AMOUNT_EXCEEDS_REMAINING`, `GATEWAY_ERROR`, `PIX_ALREADY_PENDING`, `IDEMPOTENCY_CONFLICT`, `APPOINTMENT_ALREADY_CONCLUDED`, `FORBIDDEN`, `PROFESSIONAL_NOT_OWNER`, `CHARGE_NOT_PENDING`, `CHARGE_CANCELLED`, `ASAAS_NOT_CONFIGURED`, `NETWORK`, código desconhecido.
- **BDD:** Dado um erro HTTP 422 `GATEWAY_ERROR`, quando mapeado, então `retryable=true` e `action="retry"`; dado um corpo ilegível, então `code="NETWORK"` e nunca lança.
- **DoD:** `PaymentApiError` com `code/status/retryable/settlement/pixAmountCents`; nenhuma comparação por mensagem de texto.

### FE-04 — `payment-math.ts`

- **Arquivos:** `src/app/agenda/pagamentos/payment-math.ts`, `payment-math.test.ts`
- **RF:** RF-02, RF-07, RF-08, RF-09, RF-10, RF-15, RF-22
- **Teste primeiro:** dinheiro 10000/recebido 12000 → troco 2000; recebido 9000 → `cashShort`; soma 11000 com total 10000 → `exceeds`; gorjeta 500 não reduz `draftRemaining`; total 0 → `totalZero=true` e nenhuma linha positiva válida; split 6000+4000 → `draftRemaining=0`.
- **BDD:** Dado total 10000 e linhas 6000+3000, quando validadas, então `draftRemaining=1000`, `requiresPartialConfirm=true` e `canSubmit=true`.
- **DoD:** `derivePaymentStatus` reproduz a precedência da ADR-002 (inclui `aguardando_pix` antes de `parcial`); funções puras, sem I/O, sem `Date.now()`.

### FE-05 — Gating tri-state de segmento

- **Arquivos:** `src/lib/segment-features.ts`, `src/hooks/useSegmentFeatures.ts`, `segment-features.test.ts`
- **RF:** RF-01, RF-06, RNF-12
- **Teste primeiro:** `resolveFeatures("salao")`/`("barbearia")` → `payments: true`; `("clinica")`/`(null)`/`(undefined)` → `false`; `resolveFeatures(null, false)` → `payments: null`; `commission`/`combos` inalterados em todos os casos.
- **BDD:** Dado que o tenant ainda está carregando, quando a agenda renderiza, então `payments === null` e “Concluir” está desabilitado com “Carregando…”.
- **DoD:** `useSegmentFeatures` usa `isLoadingAuth`; nenhum request novo; todos os 8 consumidores atuais de `commission`/`combos` seguem verdes.

### FE-06 — `PaymentStatusBadge`

- **Arquivos:** `PaymentStatusBadge.tsx`, `PaymentStatusBadge.test.tsx`
- **RF:** RF-11, RF-08, RF-05
- **Teste primeiro:** `sem_pagamento`/`parcial`/`aguardando_pix` renderizam texto do catálogo; `quitado` → `null`; `aria-label` interpolado; texto presente (não só cor).
- **BDD:** Dado `payment_status="parcial"`, quando renderizado, então o leitor de tela anuncia “Pagamento pendente (Parcial)”.
- **DoD:** usa tokens `--status-pendente`; `data-testid="payment-badge"`; zero literal.

### FE-07 — `PaymentMethodChip`

- **Arquivos:** `PaymentMethodChip.tsx`, `PaymentMethodChip.test.tsx`
- **RF:** RF-01
- **Teste primeiro:** nome acessível “Adicionar <método>”; **não** possui `aria-pressed`; `disabled` expõe `aria-describedby` com o motivo; `onSelect` dispara 1×.
- **BDD:** Dado que já existe uma linha PIX do sistema, quando o chip PIX renderiza, então está desabilitado e descreve “Este atendimento já tem um PIX pendente”.
- **DoD:** `<button type="button">`, altura ≥ 44 px, `data-testid="payment-method-chip-<method>"`.

### FE-08 — `PaymentTotalsSummary`

- **Arquivos:** `PaymentTotalsSummary.tsx`, `.test.tsx`
- **RF:** RF-07, RF-08, RF-15
- **Teste primeiro:** mostra Total/Já pago/Falta para quitar; gorjeta só quando > 0; `aria-live="polite"` na região de “Falta”; valores por `formatCentsToBRL`.
- **BDD:** Dado `remainingCents=1000`, quando o usuário digita, então a região viva anuncia o novo saldo sem mover o foco.
- **DoD:** `role="group"` rotulado; `data-testid="payment-total"` / `"payment-remaining"`.

### FE-09 — `InlineConfirmStep`

- **Arquivos:** `InlineConfirmStep.tsx`, `.test.tsx`
- **RF:** RF-08, RF-11, RF-13
- **Teste primeiro:** renderiza título/descrição do catálogo; `tone="destructive"` aplica `variant="destructive"`; foco inicial no cancelar; **não** renderiza `role="dialog"`; `busy` desabilita ambos.
- **BDD:** Dado o passo de confirmação parcial, quando o usuário pressiona Enter, então a ação de confirmar dispara uma única vez.
- **DoD:** sem portal, sem `DialogContent`; `data-testid` configurável; `children` aceita textarea (motivo do estorno).

### FE-10 — `PixQrPanel`

- **Arquivos:** `PixQrPanel.tsx`, `.test.tsx`
- **RF:** RF-05, RF-26
- **Teste primeiro:** base64 puro vira `data:image/png;base64,…`; `data:` é preservado; `alt` do catálogo; QR ausente mostra “QR Code indisponível” e **não** renderiza `<img>`; copiar chama `onCopyResult("ok"|"error")`.
- **BDD:** Dado um QR em base64, quando renderizado, então existe uma imagem com `alt` traduzido e o copia-e-cola preenchido.
- **DoD:** sem toast, sem clipboard silencioso; `data-testid="pix-qr-panel"`; valor e expiração formatados por `formatCentsToBRL`/fuso do tenant.

### FE-11 — `PaymentLineRow`

- **Arquivos:** `PaymentLineRow.tsx`, `.test.tsx`
- **RF:** RF-02, RF-03, RF-04, RF-10
- **Teste primeiro:** dinheiro mostra “Valor recebido” e “Troco”; cartões/PIX maquininha **não** mostram troco e exigem checkbox; `MoneyInput` com label; `received < amount` exibe `role="alert"` e `data-invalid`; remover só quando `!disabled`; gorjeta tem `aria-describedby` do hint.
- **BDD:** Dado linha de débito sem “Confirmei na maquininha”, quando o usuário tenta enviar, então o submit está bloqueado com erro em pt-BR.
- **DoD:** sem `type="number"`; sem campos de bandeira/NSU/CVV; um único `<li>`; `data-testid="payment-line-<key>"`.

### FE-12 — `PaymentLinesEditor`

- **Arquivos:** `PaymentLinesEditor.tsx`, `.test.tsx`
- **RF:** RF-01, RF-07, RF-16
- **Teste primeiro:** 5 chips + “Adicionar forma”; adicionar cria linha com o saldo restante; `pix_sistema` não duplica; remover atualiza; estado vazio com mensagem do catálogo; “Registrar depois” **não** está neste componente.
- **BDD:** Dado total 10000 e uma linha dinheiro 6000, quando “Adicionar forma” é acionado, então a nova linha nasce com 4000.
- **DoD:** apenas composição (sem fetch/estado de servidor); `data-testid="payment-lines-editor"`.

### FE-13 — `PaymentReceipt`

- **Arquivos:** `PaymentReceipt.tsx`, `.test.tsx`
- **RF:** RF-07, RF-10, RF-11, RF-05
- **Teste primeiro:** total, linhas por forma, gorjeta em linha própria, status legível, data/hora no fuso; troco aparece **só** quando `changeCents != null`; nunca renderiza QR/copia-e-cola/token/`charge_id`; `sem_pagamento` não mostra “Pago”.
- **BDD:** Dado recebimento 10000 + gorjeta 500, quando o comprovante renderiza, então “Pago” = R$ 100,00 e “Gorjeta” = R$ 5,00 em linhas distintas.
- **DoD:** `aria-labelledby` no título; `data-testid="payment-receipt"`; zero literal.

### FE-14 — `PendingChargeCard`

- **Arquivos:** `PendingChargeCard.tsx`, `.test.tsx`
- **RF:** RF-16, RF-19, RF-26
- **Teste primeiro:** com QR → “Reexibir QR” habilitado; `pix_qr_code=null` → “PIX não gerado” + “Tentar de novo”, sem `img`; expirada → “Expirado” + “Reemitir PIX”; ações respeitam `canViewQr`/`canCancel`/`canReissue`.
- **BDD:** Dado `can_view_qr=false`, quando o card renderiza, então a ação de QR não existe e o QR não é exibido.
- **DoD:** um `<li>`; valores em centavos formatados; `data-testid="settlement-pending-charge-<id>"`.

### FE-15 — `SettlementPaymentRow`

- **Arquivos:** `SettlementPaymentRow.tsx`, `.test.tsx`
- **RF:** RF-12, RF-13
- **Teste primeiro:** ativa mostra método/valor/gorjeta/origem/data; estornada mostra “Estornada” + motivo quando presente; “Estornar” só com `canVoid && !voided`; origem `manual`/`asaas` traduzida.
- **BDD:** Dado `voided=true` e `void_reason=null` (recepção), quando renderiza, então mostra “Estornada” sem motivo.
- **DoD:** nenhum valor estornado entra em soma na shell; `data-testid="settlement-payment-<id>"`.

### FE-16 — `PaymentCaptureDialog` (shell)

- **Arquivos:** `PaymentCaptureDialog.tsx`, `.test.tsx`
- **RF:** RF-01..RF-11, RF-14, RF-15, RF-16, RF-22, RF-23, RF-27
- **Teste primeiro:** parcial → `confirm_partial` (nada persiste ao voltar); “Registrar depois” envia `payments: []` + `close_appointment: true`; 422 `GATEWAY_ERROR` mantém diálogo e mostra `role="alert"`; retry com settlement `concluido` chama **só** `create-charge`; `IDEMPOTENCY_CONFLICT` regenera chave; ESC/overlay bloqueados em `submitting`; sucesso mostra `PaymentReceipt`; “Concluir” fecha e chama `onCompleted`.
- **BDD:** Dado total 10000, linha 4000 e confirmação explícita, quando o lote é enviado, então `close_appointment=true` e o comprovante mostra `parcial`.
- **DoD:** **um** `Dialog`; nenhum `Dialog` filho; nenhum fetch direto (usa hooks); `data-testid="payment-capture-dialog"`; `mode="register"` exige ≥ 1 linha e envia `close_appointment=false`.

### FE-17 — `AppointmentSettlementDialog` (shell)

- **Arquivos:** `AppointmentSettlementDialog.tsx`, `.test.tsx`
- **RF:** RF-12, RF-13, RF-18, RF-19, RF-20, RF-21, RF-26
- **Teste primeiro:** `loading`/`empty`/`error` obrigatórios; ações condicionadas a `settlement.permissions`; cancelar PIX com confirmação inline; baixa manual só admin; estorno exige motivo (≤ 500) e bloqueia vazio; “Reexibir QR” renderiza `PixQrPanel` **inline** (sem novo `Dialog`); `onRegisterPayment` dispara callback e **não** abre capture dentro desta shell.
- **BDD:** Dado `permissions.can_void=false`, quando o diálogo abre, então nenhum botão de estorno é renderizado.
- **DoD:** `role="dialog"` único; texto do catálogo; `data-testid="settlement-dialog"`.

### FE-18 — `PixQrDialog` + `CobrancasPage` (copy + `formatCents` duplicado)

- **Arquivos:** `src/app/cobrancas/PixQrDialog.tsx` (novo), `src/app/cobrancas/CobrancasPage.tsx`, `CobrancasPage.test.tsx`
- **RF:** RF-26, RNF-03, RNF-05
- **Teste primeiro:** `CobrancasPage` renderiza título/descrição/filtros/vazio/erro a partir de `paymentsMessages.chargesPage`; valor da linha formatado por `formatCentsToBRL`; `PixQrDialog` abre e delega ao `PixQrPanel`.
- **BDD:** Dado uma cobrança de 3000 centavos, quando a lista renderiza, então o valor é “R$ 30,00” e não há função `formatCents` local no arquivo.
- **DoD:** `formatCents` removido de `src/app/cobrancas` (`grep` vazio); copy atualizada (PIX agora é explícito, não “pós-atendimento automático”); QR sem markup duplicado; nenhuma mudança de rota/RBAC.

### FE-19 — Agenda: `AgendaItem` (selo, ação, toggle)

- **Arquivos:** `AgendaPage.tsx`, `AgendaPage.payments.test.tsx`
- **RF:** RF-01, RF-06, RF-11, RF-20, RNF-12
- **Teste primeiro:** `payments === null` → “Concluir” desabilitado e `aria-describedby` “Carregando…”; `payments === true` → “Concluir” abre capture e **não** chama `changeStatus`; `payments === false` → abre `StatusChangeConfirm`; action “Pagamento” visível para `em_atendimento`/`concluido`; toggle mostra `(N)` e filtra.
- **BDD:** Dado tenant `clinica`, quando “Concluir” é acionado, então o fluxo legado é chamado exatamente uma vez (regressão zero).
- **DoD:** nenhuma chamada `create-charge` no caminho novo; toggle com `aria-pressed`; selo só com dado autoritativo (SPEC §7.2).

### FE-20 — `AppointmentBlock` + calendário (dia/semana)

- **Arquivos:** `AppointmentBlock.tsx`, `AgendaCalendarDay.tsx`, `AgendaCalendarWeek.tsx`, testes
- **RF:** RF-01, RF-11
- **Teste primeiro:** bloco recebe `paymentFlag` e `onOpenPayment`; selo aparece em `concluido` pendente; botão “Pagamento” tem nome acessível e não dispara `onOpen` do bloco; pass-through não altera `onOpenAppointment`/`showCommission`.
- **BDD:** Dado atendimento concluído com `parcial`, quando o bloco compacto renderiza, então o selo aparece sem quebrar o layout (`title` inclui o estado).
- **DoD:** um `<button>` por bloco continua; nenhum handler duplicado; sem regressão dos testes existentes do calendário.

### FE-21 — `StatusChangeConfirm` legado preservado

- **Arquivos:** `StatusChangeConfirm.tsx`, `StatusChangeConfirm.test.tsx`
- **RF:** RF-06, RNF-12
- **Teste primeiro:** `to='cancelado'`/`'nao_compareceu'` inalterados; `to='concluido'` com tenant legado ainda chama `create-charge` e mostra QR via `PixQrPanel`; **não** existe segundo `Dialog` (o QR é uma fase do mesmo diálogo).
- **BDD:** Dado tenant `clinica`, quando conclui, então `create-charge` é chamado uma vez e o QR aparece no mesmo diálogo.
- **DoD:** markup de QR duplicado removido; testes antigos adaptados sem perder cobertura; nenhuma mudança para tenants `payments === true` (não passam por aqui).

### FE-22 — `useAppointmentPayments.ts` (5 hooks)

- **Arquivos:** `src/hooks/useAppointmentPayments.ts`, `.test.ts`
- **RF:** RF-05, RF-12, RF-13, RF-14, RF-18, RF-19, RF-26, RF-27
- **Teste primeiro:** `get-appointment-settlement` chamado com `{ appointment_id }`; parse do payload (incl. `stale_charges`, `can_reissue_pix`); 403 → `PaymentApiError` `FORBIDDEN`; `register` envia `payments[]` com `amount_cents`/`tip_cents` e `close_appointment`; cancel/confirm/void com body exato; invalida as 4 keys; `poll=true` liga `refetchInterval` 5 s e desliga em `quitado`.
- **BDD:** Dado um registro bem-sucedido, quando a mutação resolve, então `["appointment-settlement", id]`, `["appointments"]`, `["charges"]` e `["financial-summary"]` são invalidados.
- **DoD:** nenhuma resposta crua sai do hook; erros normalizados; sem `any`.

### FE-23 — `useCreateCharge` novo contrato

- **Arquivos:** `src/hooks/useCharges.ts`, `useCharges.test.ts`
- **RF:** RF-05, RF-27, RNF-11
- **Teste primeiro:** input novo `{appointmentId, amountCents, idempotencyKey}` → body `{appointment_id, amount_cents, idempotency_key}`; input snake_case → mesmo body; legado `{appointment_id}` → body só com `appointment_id`; `amountCents=0` → erro antes do `invoke`; resposta normaliza `charge_id`→`id`.
- **BDD:** Dado retry de PIX após conclusão, quando `useCreateCharge` é chamado com a mesma chave, então o body preserva a chave e o valor da parcela.
- **DoD:** `CHARGES_KEY` invalidado; nenhum consumidor antigo quebrado (busca por `useCreateCharge`).

### FE-24 — `useAgendaPaymentFlags` + `usePermissions` +6

- **Arquivos:** `useAgendaPaymentFlags.ts`, `.test.ts`, `usePermissions.ts`, `usePermissions.test.ts`
- **RF:** RF-11, RF-20, RF-21
- **Teste primeiro:** 2 queries em lote apenas quando `enabled`; `unknown` para todos quando desabilitado; `pendingCount` correto; precedência de status; matriz de permissões por papel (7 capacidades).
- **BDD:** Dado papel `receptionist`, quando o hook roda, então nenhuma query é disparada e o mapa devolve `unknown`.
- **DoD:** `usePermissions` mantém todas as capacidades existentes; `canViewFinancials` é exclusivo de admin; testes dos 3 papéis.

---

### IT-01 — Harness E2E Chrome DevTools

- **Arquivos:** evidência em `.spec/frontend/cobranca-formas-pagamento-adr-004/harness/`
- **RF:** todos os RF de UI; RNF-01/02/04
- **Teste primeiro:** não se aplica (execução após a suíte verde). Pré-condições: `npm run dev:up`; tenant `salao` + Asaas ativo; massa sintética.
- **BDD:** Dado o fluxo de fechamento completo, quando executado em Chrome real 375 px e 1280 px, então console tem zero `[ERROR]`, network sem 4xx/5xx inesperado e os 12 passos da SPEC §17.5 passam.
- **DoD:** screenshots por passo; tabela de rede/console; processos finalizados por PID; relatório do harness no schema `.agents/schemas/harness-report.schema.json`; `brain_store` executado.

### IT-02 — Suite canônica + varreduras de conformidade

- **Arquivos:** nenhuma alteração de código; evidência no relatório
- **RF:** RNF-12
- **Teste primeiro:** não se aplica.
- **BDD:** Dado o repositório ao final da implementação, quando as varreduras rodam, então não há violação de escopo nem de padrão.
- **DoD (comandos exatos):**
  - `npm test` verde e `npm run typecheck` / `npm run build` limpos;
  - `git diff --stat -- supabase/` vazio;
  - `grep -rn 'type="number"' src/app/agenda/pagamentos` vazio;
  - `grep -rn "formatCents(" src/app/cobrancas` vazio;
  - `grep -rln "sonner\|@tanstack/react-query\|lib/supabase" src/app/agenda/pagamentos` retorna **apenas** as 2 shells;
  - `grep -c "DialogContent" src/app/agenda/pagamentos/*.tsx` == 2.

---

## 4. Matriz RF → tasks

| RF | Tasks |
|---|---|
| RF-01 | FE-02, FE-05, FE-07, FE-12, FE-16, FE-19, FE-20 |
| RF-02 | FE-04, FE-11, FE-16 |
| RF-03 | FE-11, FE-16 |
| RF-04 | FE-11 |
| RF-05 | FE-10, FE-16, FE-22, FE-23 |
| RF-06 | FE-05, FE-19, FE-21 |
| RF-07 | FE-04, FE-12, FE-13, FE-16 |
| RF-08 | FE-04, FE-09, FE-13, FE-16 |
| RF-09 | FE-04, FE-11 |
| RF-10 | FE-03, FE-11, FE-13 |
| RF-11 | FE-06, FE-09, FE-16, FE-19, FE-20 |
| RF-12 | FE-15, FE-17, FE-22 |
| RF-13 | FE-09, FE-15, FE-17, FE-22 |
| RF-14 | FE-03, FE-16, FE-22 |
| RF-15 | FE-04, FE-08 |
| RF-16 | FE-07, FE-12, FE-14 |
| RF-18 | FE-17, FE-22 |
| RF-19 | FE-14, FE-17, FE-22 |
| RF-20 | FE-17, FE-19, FE-24 |
| RF-21 | FE-17, FE-24 |
| RF-22 | FE-04, FE-16 |
| RF-23 | FE-03, FE-12, FE-16 |
| RF-26 | FE-10, FE-14, FE-17, FE-18, FE-22 |
| RF-27 | FE-03, FE-16, FE-22, FE-23 |
| RNF-01 | FE-22 (polling), FE-16 |
| RNF-02 | FE-11, FE-16, FE-17, IT-01 |
| RNF-03 | FE-01, todos os componentes |
| RNF-04 | FE-06..FE-10, FE-16, FE-17, IT-01 |
| RNF-08 | FE-03, FE-15, FE-17 |
| RNF-12 | FE-05, FE-19, FE-21, IT-02 |

---

## 5. Gate de conclusão (todas as tasks)

- [x] Cada task FE tem teste escrito antes e verde depois.
- [x] `Dialog` nunca aninhado (IT-02 prova por grep + teste de DOM).
- [x] Zero literal de UI nos arquivos novos (catálogo-sonda).
- [x] Zero `formatCents` duplicado; `CobrancasPage` usa `formatCentsToBRL`.
- [x] Nenhum arquivo `supabase/**` alterado.
- [x] E2E 12 passos com evidência e portas encerradas.
- [x] `harness_status` e `code_review_status` atualizados no `workflow-state.json` pela orquestração.
