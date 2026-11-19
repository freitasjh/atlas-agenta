# ADR-07 — G5 Checkout clínica (flag aestheticCheckout, reuso Settlement/Capture)

- Status: proposto

## Contexto

Clínica com `payments:false` (segment-features) sem checkout; salão/barbearia com Settlement/Capture + ledger único. PRD exige checkout p/ estética via flag `aestheticCheckout` (entitlement ADR-01), reuso 100%, sem regressão salão. Fronteiras: ledger RF-24, PIX máx 1 por atendimento, gorjeta fora da receita/comissão, parcial com confirmação, estorno lógico, RBAC clínico×financeiro mantido.

## Decisão

Sem componente financeiro novo: habilitar pontos de entrada existentes quando `aestheticCheckout === true`:

- Flag lido de `usePlanEntitlements` (ADR-01), não de `segment-features` (intocado); `payments:false` + `aestheticCheckout:true` → checkout visível; ambos false → fluxo legado.
- Reuso: `AppointmentSettlementDialog` + `PaymentCaptureDialog` + ledger + math/mensagens existentes; botão com valor exato ("Pagar R$ X"); estados skeleton/vazio/erro/sucesso mantidos.
- Sessão de pacote (ADR-06): checkout mostra saldo + opção "usar sessão" vs "cobrar avulso"; cobrança avulsa segue ledger normal; baixa de pacote continua via `redeem` ao concluir (sem dupla cobrança — teste).
- RBAC: recepção registra sem ler faturamento (RLS + UI existentes, sem afrouxar).

## Consequências

- Positivas: zero duplicação financeira; salão sem regressão (flag só soma caminho p/ clínica).
- Risco: clínica ver fluxo salão por engano — mitigado com teste matriz segmento×flag.

## Escopo

Entra: habilitação + matriz + sessão-pacote-no-checkout. Não entra: forma nova, mudança ledger/PIX/comissão, relatório.

## Arquivos afetados

- `src/app/agenda/AgendaPage.tsx`, `src/app/agenda/AppointmentDrawer.tsx` (pontos de entrada condicionais)
- Reuso sem cópia: `src/app/agenda/pagamentos/AppointmentSettlementDialog.tsx`, `PaymentCaptureDialog.tsx`, `payment-math.ts`, `payments-messages.ts`
- Testes: matriz (salao×payments, clinica×aestheticCheckout on/off, legado null-safe) + sessão pacote vs avulso + PIX máx 1 + sem regressão (suíte pagamentos existente verde)

## Critérios de aceite (testáveis)

1. Clínica + `aestheticCheckout:true` → botão checkout com valor exato abre Settlement; `false`/`null` → fluxo legado, sem crash.
2. Salão/barbearia inalterados (testes existentes passam sem modificação de comportamento).
3. 5 formas + parcial + gorjeta fora + estorno lógico funcionam em clínica (mesmos testes do salão, parametrizados).
4. Sessão com saldo: "usar sessão" não gera charge; "avulso" gera ledger normal; PIX 2º no mesmo atendimento recusado.
5. Network sem 4xx/5xx, Console zero; screenshots 375/1280 claro+escuro em `harness/`.

## Dependência

ADR-01 (`aestheticCheckout`) + ADR-06 (saldo no checkout). Independente de ADR-03/04/05.
