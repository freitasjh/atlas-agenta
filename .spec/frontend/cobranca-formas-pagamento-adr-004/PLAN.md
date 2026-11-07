# PLAN — ADR-004 Frontend do fechamento do pagamento

## 1. Contexto e rastreabilidade

- **SPEC alvo:** `.spec/frontend/cobranca-formas-pagamento-adr-004/SPEC.md`
- **ADR de origem:** `.spec/prd/cobranca-formas-pagamento/ADRs/ADR-004-frontend-fechamento-pagamento/ADR.md`
- **Depende de:** ADR-001 (ledger/RLS), ADR-002 (RPC + 5 Edge), ADR-003 (`create-charge` por parcela)
- **Objetivo:** fechar o atendimento com captura de forma de pagamento, comprovante, settlement e i18n, sem tocar backend.
- **Superfície:** `src/**` apenas. `supabase/**`, `harness.config.json`, `.agents/**` intocados.

### 1.1 Validação da SPEC (pré-execução)

| Checagem | Resultado |
|---|---|
| Todo RF do ADR tem requisito na SPEC? | ✅ (§15) |
| Contratos de hooks fechados? | ✅ (§6.1) |
| Catálogo completo? | ✅ (§11) |
| Matriz de permissões fechada? | ✅ (§8) |
| Estados dos diálogos fechados? | ✅ (§9, §10) |
| Gaps de backend declarados? | ✅ (§7.2 — selo na lista para recepção) |
| Risco de regressão em clínica? | Mitigado por `payments === false` + gate de teste (§4.2) |

**Gap declarado (não bloqueia):** selo/filtro na lista para recepção/profissional depende de `payment_status` por atendimento no payload da agenda (adendo à ADR-002, backend). A UI degrada para `unknown` sem mentir.

---

## 2. Estratégia técnica

| Camada | Decisão | Justificativa |
|---|---|---|
| UI | shadcn/ui existente (`Dialog`, `Button`, `Input`, `Label`, `Checkbox`, `Separator`, `Skeleton`, `Badge`) | zero dependência nova (ADR §7 / guide §2) |
| Dinheiro | `MoneyInput` + `formatCentsToBRL` / `parseBRLToCents` | centavos inteiros em todo o estado (RNF-05) |
| Estado de servidor | TanStack Query 5 | já é o padrão do repo |
| Estado de UI | `useState` na shell + redutores puros em `payment-math.ts` | testável e determinístico |
| i18n | catálogo local tipado + `formatMessage` | repo sem `react-i18next` (SPEC §2.2) |
| Tipagem de wire | zod nos hooks + `src/types/payments.ts` puro | contrato externo nunca é confiado |
| Testes | vitest (node para puro, happy-dom para componente/hook) | `npm test` já é o comando canônico |

### 2.1 Fronteiras

```
página (AgendaPage / CobrancasPage)
  └─ shell (PaymentCaptureDialog / AppointmentSettlementDialog / PixQrDialog)
       ├─ hooks (fetch, cache, mutations)
       └─ design system puro (chips, linhas, totais, comprovante, painel de QR)
```

Proibido: pular a camada (componente puro importando `supabase`/`sonner`/`useQuery`).

---

## 3. Estrutura de arquivos (caminhos exatos)

### 3.1 Novos — domínio de pagamentos

| Arquivo | Papel |
|---|---|
| `src/types/payments.ts` | `PaymentMethod`, `PaymentStatus`, `AppointmentSettlement`, `SettlementPayment`, `PendingCharge`, `StaleCharge`, `SettlementPermissions`, `PixCharge` (tipos puros, sem zod) |
| `src/app/agenda/pagamentos/payments-messages.ts` | catálogo + `PaymentsMessages` + `formatMessage` |
| `src/app/agenda/pagamentos/payment-types.ts` | `PaymentLineDraft`, `CapturePhase`, `ReceiptData`, `SettlementPhase` |
| `src/app/agenda/pagamentos/payment-math.ts` | `computeDraftRemainingCents`, `computeChangeCents`, `validateDraft`, `derivePaymentStatus`, `paymentStatusOfLines` |
| `src/app/agenda/pagamentos/PaymentStatusBadge.tsx` | componente 1 |
| `src/app/agenda/pagamentos/PaymentMethodChip.tsx` | componente 2 |
| `src/app/agenda/pagamentos/PaymentLineRow.tsx` | componente 3 |
| `src/app/agenda/pagamentos/PaymentLinesEditor.tsx` | componente 4 |
| `src/app/agenda/pagamentos/PaymentTotalsSummary.tsx` | componente 5 |
| `src/app/agenda/pagamentos/PaymentReceipt.tsx` | componente 6 |
| `src/app/agenda/pagamentos/PendingChargeCard.tsx` | componente 7 |
| `src/app/agenda/pagamentos/SettlementPaymentRow.tsx` | componente 8 |
| `src/app/agenda/pagamentos/InlineConfirmStep.tsx` | componente 9 |
| `src/app/agenda/pagamentos/PixQrPanel.tsx` | componente 10 (reusado por `PixQrDialog`) |
| `src/app/agenda/pagamentos/PaymentCaptureDialog.tsx` | shell 1 |
| `src/app/agenda/pagamentos/AppointmentSettlementDialog.tsx` | shell 2 |
| `src/app/cobrancas/PixQrDialog.tsx` | shell de QR extraída de `CobrancasPage` sobre `PixQrPanel` |

### 3.2 Novos — hooks e lib

| Arquivo | Papel |
|---|---|
| `src/hooks/useAppointmentPayments.ts` | settlement, register, cancel, confirm manual, void + schemas zod + transporte |
| `src/hooks/useAgendaPaymentFlags.ts` | flags de pagamento em lote para a agenda (admin) |
| `src/lib/payment-errors.ts` | `PaymentApiError`, `parsePaymentError`, mapa `code → { messageKey, retryable, action }` |

### 3.3 Alterados

| Arquivo | Mudança |
|---|---|
| `src/lib/segment-features.ts` | `payments: boolean \| null` + `tenantResolved` |
| `src/hooks/useSegmentFeatures.ts` | passa `!isLoadingAuth`; sem request novo |
| `src/hooks/usePermissions.ts` | +6 capacidades (SPEC §8.1) |
| `src/hooks/useCharges.ts` | `CreateChargeInput` novo + normalização + invalidação |
| `src/app/agenda/AgendaPage.tsx` | `AgendaItem` com selo/ação; toggle; tri-state “Concluir”; wiring capture/settlement |
| `src/app/agenda/AppointmentBlock.tsx` | props `paymentFlag`, `onOpenPayment`; selo + botão |
| `src/app/agenda/AgendaCalendarDay.tsx` | pass-through das props novas |
| `src/app/agenda/AgendaCalendarWeek.tsx` | pass-through das props novas |
| `src/app/agenda/StatusChangeConfirm.tsx` | preserva legado; QR via `PixQrPanel` (remove markup duplicado) |
| `src/app/cobrancas/CobrancasPage.tsx` | remove `formatCents` local; copy no catálogo; usa `PixQrDialog` extraído |

### 3.4 Testes (co-localizados, `*.test.ts(x)`)

`payments-messages.test.ts`, `payment-math.test.ts`, `payment-errors.test.ts`, `segment-features.test.ts`, `usePermissions.test.ts`, `useAppointmentPayments.test.ts`, `useAgendaPaymentFlags.test.ts`, `useCharges.test.ts` (ampliado), + um `*.test.tsx` por componente e por shell (14 arquivos), `StatusChangeConfirm.test.tsx` (ajustado), `CobrancasPage.test.tsx` (novo).

---

## 4. Fases

> Cada fase é **teste-primeiro**: o teste da fase é escrito e visto falhar antes do código de produção. As fases 4–5 consomem os contratos congelados de hooks (SPEC §6.1) via mock; a Fase 6 troca o mock pelos hooks reais sem alterar a shell.

### Fase 0 — Preparação e baseline (30 min)

- Rodar `npm run test`, `npm run typecheck`, `npm run build` e registrar o baseline (H2).
- Criar a pasta `src/app/agenda/pagamentos/` e o diretório de evidência.
- **Saída:** baseline verde documentado; nenhum código novo.

### Fase 1 — Catálogo + tipos + matemática (2–3 h)

- Arquivos: `payments-messages.ts`, `payment-types.ts`, `src/types/payments.ts`, `payment-math.ts`.
- Testes: catálogo (folhas não vazias, `formatMessage`), matemática (remaining/troco/excedente/gorjeta/total zero/precedência de status).
- **Saída:** nenhuma UI ainda; 100% dos cálculos cobertos.

### Fase 2 — Componentes folha (5–6 h)

- `PaymentStatusBadge`, `PaymentMethodChip`, `PaymentTotalsSummary`, `InlineConfirmStep`, `PixQrPanel`.
- Cada um com teste de render, a11y e testid; catálogo-sonda para provar ausência de literal.
- **Saída:** folhas puras prontas e reutilizáveis.

### Fase 3 — Componentes compostos e de linha (6–8 h)

- `PaymentLineRow` (dinheiro/troco/gorjeta/checkbox), `PaymentLinesEditor` (chips + linhas + vazio), `PaymentReceipt`, `PendingChargeCard`, `SettlementPaymentRow`.
- Testes: cartão sem troco; `received < amount` bloqueia; estorno com/sem motivo; QR ausente.
- **Saída:** todos os 10 componentes do design system entregues.

### Fase 4 — Shells (6–8 h)

- `PaymentCaptureDialog`: fases da SPEC §9, idempotência, retry de gateway, travas de fechamento.
- `AppointmentSettlementDialog`: fases da SPEC §10, ações por permissão do servidor.
- `PixQrDialog` extraído + `CobrancasPage` refatorada (copy + `formatCentsToBRL`).
- Testes de fluxo com hooks mockados.
- **Saída:** fluxo completo em teste, ainda sem tocar a agenda.

### Fase 5 — Agenda e selo (4–5 h)

- `AgendaItem` (selo “Pagamento pendente”, ação “Pagamento”, toggle “(N)”).
- `AppointmentBlock` + `AgendaCalendarDay`/`Week` (pass-through).
- `AgendaPage`: `payments === null` bloqueia “Concluir”; `true` abre capture; `false` mantém legado.
- **Saída:** entrada do fluxo na agenda, sem regressão da clínica.

### Fase 6 — Hooks reais (5–6 h)

- `useAppointmentPayments.ts` (settlement/register/cancel/confirm/void), `useAgendaPaymentFlags.ts`, `useCreateCharge` novo, `usePermissions` +6, `useSegmentFeatures` tri-state.
- Testes de body exato, parse, invalidação e polling.
- Substituir os mocks da Fase 4 pelos hooks reais.
- **Saída:** integração ponta a ponta no frontend.

### Fase 7 — Testes de integração de fluxo e acessibilidade (3–4 h)

- Fluxo agenda → capture → settlement → capture(register) sem `Dialog` aninhado (asserção: `document.querySelectorAll('[role="dialog"]').length === 1` em cada fase).
- Teclado: Tab/ESC/Enter nos estados permitidos; foco inicial e retorno.
- Regressão: tenant `clinica` continua chamando `create-charge` pelo `StatusChangeConfirm`.
- **Saída:** suíte completa + `npm run test` / `typecheck` / `build` verdes.

### Fase 8 — E2E Chrome DevTools + evidência (2–3 h)

- `npm run dev:up` → 12 passos da SPEC §17.5 → screenshots em `harness/`.
- Encerrar portas por PID; `brain_store`; relatório do harness.
- **Saída:** aceite do §18 da SPEC.

---

## 5. Comandos canônicos

```bash
npm run test                       # vitest run (unit + componentes + hooks)
npm run typecheck                  # tsc -b
npm run build                      # tsc -b && vite build
npm run dev:up                     # API 54321 + DB 54322 + Vite 5173
npm run dev:functions              # Edge Functions locais (quando necessário ao E2E)
npm run dev:down                   # encerra a stack
```

Encerramento por porta (nunca `pkill -f`):

```bash
lsof -ti :5173 > /tmp/harness-pids-5173.txt && xargs -r kill < /tmp/harness-pids-5173.txt
lsof -i :5173 || echo "5173 free"
```

---

## 6. Ordem de execução (caminho crítico)

```
F1 catálogo/tipos/math
  → F2 folhas → F3 compostos → F4 shells (mock)
  → F5 agenda/selo
  → F6 hooks reais → reintegra F4
  → F7 suite/a11y/regressão
  → F8 E2E
```

Dependências duras:

- F3 depende de F1 (tipos/math) e F2 (chips).
- F4 depende de F3 e dos contratos de hook (mock).
- F5 depende de F4 (shells exportadas) e de `useAgendaPaymentFlags` (contrato).
- F6 depende de F1 e F5 (consumidores definidos).
- F7/F8 dependem de tudo.

Paralelizável: F2 e F3 por componente; F6 (hooks) em paralelo a F5 se os contratos forem respeitados.

---

## 7. Riscos e mitigação (execução)

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| `Dialog` aninhado ao abrir capture a partir do settlement | Alta | Alto | `onRegisterPayment` fecha o settlement antes de abrir; teste DOM conta `role="dialog" === 1` |
| Duplo submit / lote duplicado | Média | Alto | `disabled` em `submitting` + guarda `isPending` + chave mantida em retry idêntico |
| Chave regenerada em retry e duplicando linhas | Média | Alto | §9.5; teste dedicado de retry |
| `payments: null` cair no legado | Média | Alto | tri-state com teste de unidade + teste de página |
| Literal escapando no JSX | Alta | Médio | catálogo-sonda nos testes de componente + revisão do `code-reviewer` |
| RLS admin-only impedir o selo na lista | Certa (recepção) | Médio | degradação `unknown` declarada; ação “Pagamento” sempre disponível |
| `pix_qr_code` base64 vs data URI | Média | Baixo | normalização no `PixQrPanel` + teste dos dois formatos |
| Payload real divergir do contrato (campos aditivos) | Média | Médio | zod tolerante a aditivos só onde a API é aditiva; teste com fixture real |
| Layout estourar em 375 px | Média | Médio | grid que colapsa; teste visual no E2E passo 12 |
| Polling vazar após fechar | Média | Baixo | `enabled`/`poll` derivados de `open` + fase; teste de desmontagem |
| Regressão da clínica (PIX automático) | Baixa | Alto | teste de regressão explícito em F7; `payments === false` |
| Toast em componente puro | Média | Baixo | revisão: `sonner` só em shells; teste de import |

---

## 8. Rollout

- Sem flag própria: o gate é `useSegmentFeatures().payments`.
- `payments === false` → comportamento idêntico ao atual (clínica/legado).
- `useCreateCharge` mantém o formato legado para a janela de rollout (RNF-11), com o caminho novo preferido sempre que `amountCents`/`idempotencyKey` existirem.
- Nenhuma migração de dados no frontend.

---

## 9. Definição de pronto do PLAN

- [ ] 10 componentes + 2 shells + `PixQrDialog` entregues nos caminhos de §3.
- [ ] `git diff --stat` sem `supabase/**`.
- [ ] `npm run test` / `typecheck` / `build` verdes.
- [ ] E2E 12 passos com screenshots e console limpo.
- [ ] `brain_store` (`arquitetura`, scope `projetos`) com decisões e armadilhas.
