# SPEC — ADR-005 Relatórios financeiros admin, aba Recebimentos, RBAC final e docs

**Feature slug:** `cobranca-formas-pagamento-adr-005`
**ADR de origem:** `.spec/prd/cobranca-formas-pagamento/ADRs/ADR-005-relatorios-rbac-documentacao/ADR.md` (§1–§7, critérios 1–12)
**Depende de:** ADR-001 (ledger `appointment_payments` + RLS), ADR-002 (RPC/Edge de escrita), ADR-003 (`create-charge`), ADR-004 (settlement UI + `payments-messages.ts`).
**Escopo:** 1 migration (RPC `financial_summary`) + `src/**` (hooks, 2 superfícies UI, catálogo, hub/rota) + 3 arquivos de regra + espelhos `.kiro/steering/*` + testes vitest. Sem Edge nova.
**Stack real:** React 18.3 + TS + Vite + shadcn/ui + TanStack Query 5 + zod + vitest/happy-dom. Sem `react-i18next` (catálogo local, desvio já aceito ADR-004).

---

## 1. Definições financeiras (fonte da verdade — ADR §1, congelado)

| Conceito | Definição | Fonte | Período |
|---|---|---|---|
| Receita de serviço | `sum(amount_cents)` com `voided_at is null` | ledger `appointment_payments` | `received_at ∈ [p_from, p_to)` (caixa) |
| Gorjeta | `sum(tip_cents)` com `voided_at is null` | ledger | `received_at ∈ [p_from, p_to)` |
| Recebido total | serviço + gorjeta (linha separada; nunca somar gorjeta na receita) | ledger | `received_at ∈ [p_from, p_to)` |
| A receber | `sum(charges.amount_cents)` com `status='pendente'`, `asaas_payment_id is not null`, `(expires_at is null or expires_at > now())` | `charges` | **snapshot** agora (não filtrado por período) |
| Em aberto | `sum(greatest(price_cents − paid − reserved, 0))` só `concluido` | `appointments` + ledger + `charges` | `starts_at ∈ [p_from, p_to)` (data do serviço) |
| Comissão | `price_cents` no `concluido` (competência; inalterada, D8) | `appointment_commissions` | concluído |

Invariantes (defeito = qualquer violação):
- I1: nunca ler `charges.status='pago'` como receita. Receita só do ledger.
- I2: nunca somar receita + a receber. Colunas separadas.
- I3: gorjeta fora da receita de serviço e da base de comissão.
- I4: `voided_at is not null` fora de **todas** as somas; permanece no histórico da aba.
- I5: em aberto é indicador operacional; não é receita nem a receber.
- I6: sem `p_tenant_id` vindo do cliente; tenant = `current_tenant_id()`.
- I7: relatório acessível só a admin (`canViewFinancials && payments`); recepção/profissional nunca veem totais.
- I8: período é do **tenant** (`tenantRangeUtc`, fuso `tenants.timezone`); datas UTC cruas na UI = defeito.
- I9: dinheiro sempre em centavos inteiros; `tabular-nums` nos valores; `formatCentsToBRL` na borda.

## 2. Contrato RPC `financial_summary` (ADR §2, congelado)

```text
financial_summary(p_from timestamptz, p_to timestamptz) returns jsonb
  language plpgsql
  security invoker
  set search_path = public, pg_temp
  revoke execute on function ... from public, anon
  grant execute on function ... to authenticated
```

- Autorização: `current_role_name() = 'admin'`; senão `PT403 FORBIDDEN`.
- Validação: `p_from`/`p_to` obrigatórios, `p_to > p_from`, intervalo ≤ 366 dias; senão `PT400 INVALID_PERIOD`. Sem PII na mensagem de erro.
- Sem parâmetro de tenant (RF-29). RLS admin de `appointment_payments`/`charges`/`appointments` recorta; sem service role.
- Retorno (chaves congeladas):

```json
{
  "period": { "from": "...", "to": "..." },
  "received_service_cents": 125000,
  "received_tips_cents": 8500,
  "received_total_cents": 133500,
  "receivable_cents": 30000,
  "open_cents": 15000,
  "by_method": [
    { "method": "dinheiro", "amount_cents": 60000, "tip_cents": 2000, "count": 12 },
    { "method": "pix_sistema", "amount_cents": 30000, "tip_cents": 0, "count": 3 }
  ]
}
```

- `by_method`: só `voided_at is null` e `received_at` no intervalo; 5 métodos (`PAYMENT_METHODS`), incluindo zeros (`count: 0`) para fechar a conta.
- `receivable_cents`: snapshot (query ADR §2 sem filtro de período).
- `open_cents`: só `concluido` com `starts_at` no intervalo; `paid` = ledger ativo do atendimento; `reserved` = charges pendentes não expiradas do atendimento.
- Consulta base SQL = ADR §2 verbatim (receita/gorjeta por método, a receber, em aberto via `LATERAL`).

Hook:

```ts
useFinancialSummary(from: string, to: string): UseQuery<FinancialSummary>
// queryKey: ["financial-summary", from, to]
// enabled: !!timeZone && canViewFinancials && payments === true
// deriva UTC via tenantRangeUtc(start, end, timeZone); RPC recebe ISO
// zod valida resposta; NENHUM tenant_id no args
```

## 3. Contrato da aba Recebimentos (ADR §3 + parecer UX vinculante)

- Local: `CobrancasPage` ganha `Tabs` com **dois** valores: `pix` (existente, `useCharges`) e `recebimentos` (nova). Filtros **dentro de cada `TabsContent`** (não globais). URL como estado: `?aba=recebimentos&de=&ate=&metodo=&situacao=&pag=`.
- Gating: aba só renderizada para `canViewFinancials && payments === true`. Trava real = RLS admin-only de `appointment_payments` (ADR-001). Recepção/profissional: aba não existe no DOM (sem request).
- Sem totais na aba. Sem exportação, sem estorno, sem QR nesta aba (estorno/QR vivem no settlement ADR-004).
- Colunas (desktop `Table`; mobile cards): data/hora recebimento (fuso tenant), cliente, método (`PaymentMethodChip`), valor serviço (`formatCentsToBRL`, `tabular-nums`), gorjeta, operador/origem (`Manual`/`PIX` + `operator_name`), status (`Ativo`/`Estornado`), vínculo PIX (badge `PIX` quando `charge_id != null`).
- Linha estornada: `RealceRow` — `voided_at != null` → estilo apagado (`text-muted-foreground`, `line-through` no valor) + badge `Estornada` + `void_reason` em `title`/expansível. Não some da lista.
- Filtros: período (default mês corrente no fuso tenant, `PeriodFilter` reutilizado), método (todos + 5), situação (`todos|ativos|estornados`). Paginação server-side 25 (`range`, `received_at desc`, `count: exact`). Query direta sob RLS com embed (`appointments(customers(name))`, `profiles(full_name)`) — sem N+1, sem Edge de lista.
- Estados obrigatórios: loading (`Skeleton`), vazio (`"Nenhum recebimento no período."`), erro + retry (mensagem do catálogo). `aria-busy`, `aria-live="polite"` na tabela.

```ts
interface ReceivableRow {
  id: string;
  received_at: string;
  customer_name: string | null;
  method: PaymentMethod;
  amount_cents: number;
  tip_cents: number;
  source: "manual" | "asaas";
  operator_name: string | null;
  voided_at: string | null;
  void_reason: string | null;
  charge_id: string | null;
}
```

`useReceipts({ from, to, method, situacao, page })` — query direta `supabase.from("appointment_payments")`, zod na borda, `enabled` = mesmo gating da aba.

## 4. Contrato do painel `/app/relatorios/financeiro` (ADR §4 + parecer UX vinculante)

- Rota `relatorios/financeiro` sob o `RequireRole(["admin"])` existente; card novo no `RelatoriosHubPage` (`visible: canViewFinancials && payments === true`, ícone `Wallet`, título/descrição do catálogo). Fora do gating: card não existe; rota direta cai no estado neutro `"Você não tem acesso a este relatório."` sem request (hook `enabled=false`).
- Layout (sem gráfico, sem quinto card):
  - Grupo **Recebido** (base: `"Recebido no período (caixa)"`): 2 cards — `Recebido (serviço)` + `Gorjeta`. Linha `Recebido total` (soma exibida como linha, não card).
  - Grupo **Pendências** (base: `"A receber agora · Em aberto no período"`): 2 cards — `A receber` (snapshot) + `Em aberto`.
  - Nota fixa caixa × competência: `"Comissão é por competência (concluído); este painel é caixa (recebido)."` (catálogo).
  - Tabela **Por forma de pagamento**: 5 linhas fixas (dinheiro, crédito, débito, PIX sistema, PIX maquininha) com valor serviço + gorjeta + contagem; zeros explícitos.
- Período: `PeriodFilter` (mes/mês-passado/personalizado) + `tenantRangeUtc`. Rejeição > 366 dias vira estado de erro `INVALID_PERIOD` do catálogo.
- Estados: loading skeletons, erro + retry, vazio (`"Nenhum recebimento no período."` + zeros). `aria-label` por card com valor lido (`"Recebido em serviços: R$ … no período …"`).

```ts
interface FinancialSummary {
  period: { from: string; to: string };
  received_service_cents: number;
  received_tips_cents: number;
  received_total_cents: number;
  receivable_cents: number;
  open_cents: number;
  by_method: Array<{ method: PaymentMethod; amount_cents: number; tip_cents: number; count: number }>;
}
```

## 5. Matriz RBAC final (ADR §5 — UI esconde, banco nega)

| Capacidade | Admin | Recepção | Profissional |
|---|---|---|---|
| `canRegisterPayments` | ✅ | ✅ | ✅ (próprio) |
| `canViewPaymentTotalsInClosing` | ✅ | ✅ (só no diálogo) | ✅ (próprio) |
| `canViewFinancials` | ✅ | ❌ | ❌ |
| `canViewOwnPayments` | ✅ | ❌ | ✅ (próprio) |
| `canCancelCharge` | ✅ | ✅ | ❌ |
| `canConfirmChargeManual` | ✅ | ❌ | ❌ |
| `canVoidPayment` | ✅ | ❌ | ❌ |
| `canViewCommission` | ✅ | ❌ | ✅ (própria) |

D3: recepção registra sem ler faturamento (sem histórico/período/KPI/total agregado fora do diálogo). D4: profissional só próprio. D5: parcial com confirmação (ADR-004). `usePermissions` já expõe as 8 — **nenhuma capability nova**; esta SPEC só consome `canViewFinancials`/`canViewOwnPayments`. Teste RLS/Edge prova a negação real.

## 6. Flag `payments` (ADR §6, D7)

`resolveFeatures`: `salao` → `{commission:false, combos:true, payments:true}`; `barbearia` → `{commission:true, combos:false, payments:true}`; `clinica`/`null`/inválido → `{commission:false, combos:false, payments:false}`. Já implementado em `src/lib/segment-features.ts` — **nenhuma mudança de regra**; cobertura de teste para os 4 ramos. Liga: diálogo de fechamento, aba Recebimentos, painel financeiro. Nunca fronteira de segurança.

## 7. Docs a atualizar (ADR §7)

1. `.agents/rules/dominio.md` + espelho `.kiro/steering/dominio.md` (se existir; senão só `.agents`): remover resquício de "gera cobrança PIX ao concluir" (já removido — validar); acrescentar ledger fonte única, 5 métodos v1, PIX só por escolha / máx 1 por atendimento, estados `sem_pagamento|parcial|quitado|aguardando_pix`, `pago+reservado+novo <= price_cents`, gorjeta fora de receita/comissão, estorno lógico, receita = ledger por `received_at`, a receber = snapshot pendente.
2. `.agents/rules/produto.md` + espelho: formas v1, gating salão/barbearia, parcial com confirmação, saldo restrito ao admin, gorjeta explícita, PIX por escolha, recepção sem faturamento / profissional só próprio.
3. `.agents/rules/seguranca-multitenant.md` + espelho: `appointment_payments` RLS admin-only sem grant de escrita ao cliente, leitura operacional por Edge escopada, nenhum dado de cartão armazenado.
- **Não atualizar:** `stack.md`, `db-migration-supabase.md`, `harness.config.json`.

## 8. RFs (derivados dos critérios 1–10 do ADR)

RF-20: `financial_summary(p_from,p_to)` existe, `security invoker`, sem `p_tenant_id`, exige admin (403 senão), rejeita período > 366d (400). [critério 1]
RF-21: admin vê serviço/gorjeta/total/a receber/em aberto/por-método; recepção/profissional 403. [critério 2]
RF-24: dinheiro + PIX pendente → recebido = dinheiro, a receber = cobrança, sem soma cruzada. [critério 3]
RF-25: PIX pago + linha ledger = contado 1× pelo ledger; nenhum card lê `charges.pago`. [critério 4]
RF-26: linha estornada fora das somas, presente no histórico. [critério 5]
RF-27: gorjeta em linha própria; não altera receita nem comissão. [critério 6]
RF-28: aba Recebimentos admin-only, filtros período/método/situação + paginação 25 funcionam, RLS nega demais papéis. [critério 7]
RF-29: sem `p_tenant_id` no cliente; tenant de `current_tenant_id()`. [implícito critério 1]
RF-30: `resolveFeatures` com `payments` por ramo (salao/barbearia true; clinica/null false). [critério 8]
RF-31: matriz §5 vale na UI e no banco (RLS/Edge negam de verdade). [critério 9]
RF-32: regras atualizadas sem "PIX automático ao concluir". [critérios 10–12]

## 9. Fora de escopo

Exportação/CSV, nota fiscal, envio WhatsApp, caixa/turno, relatórios além de painel+aba, `receivable_created_cents` (pergunta aberta 1), `concluded_at` (pergunta aberta 2), migração de segmento legado (pergunta aberta 3), gráfico, totais na aba, estorno/QR na aba, backfill novo, Edge nova, `create-charge`/webhook (ADR-003), componentes de captura (ADR-004).

## 10. Estratégia de teste

- Migration: `supabase db reset` local + SQL de verificação (papel admin ok / recepção 403 / período inválido 400 / sem `p_tenant_id` na assinatura / snapshot a receber ignora período / voided fora das somas / gorjeta separada / `charges.pago` nunca somado). Teste de integração vitest cobrindo os cenários RF-20/21/24/25/26 contra Postgres real (nunca H2).
- Unit vitest: `resolveFeatures` 4 ramos; `tenantRangeUtc`/fuso (DST-safe, semiaberto); `formatCentsToBRL`; `payments-messages` sem literal fora do catálogo (spy já existente estendido); `usePermissions` matriz §5.
- Componentes/hooks (happy-dom + MSW ou mock supabase): `useFinancialSummary` gating + zod + queryKey; painel grupos/cards/por-método/nota; aba tabs/filtros/URL/paginação/RealceRow/skeleton/vazio/erro; hub card gating; rota `financeiro` sob `RequireRole admin`.
- RNF: RNF-05 (a11y: labels, foco, `aria-pressed`/`aria-busy`/`aria-live`, teclado, 375/1280), RNF-06 (paginação 25 sem N+1, RPC ≤ 366d), RNF-08 (RBAC negado de verdade), RNF-09 (i18n via catálogo, zero literal), RNF-12 (sem regressão clínica/legado: `payments=false` esconde tudo sem quebrar).
- E2E harness (Fase PLAN): wipe + admin vê painel/aba; recepção não vê aba nem card; gorjeta/estorno refletem após refetch.
