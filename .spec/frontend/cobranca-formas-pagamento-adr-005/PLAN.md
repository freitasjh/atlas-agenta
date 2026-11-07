# PLAN — ADR-005 Relatórios financeiros admin, aba Recebimentos, RBAC final e docs

**SPEC:** `./SPEC.md` · **ADR:** `.spec/prd/cobranca-formas-pagamento/ADRs/ADR-005-relatorios-rbac-documentacao/ADR.md`
**Ordem:** RPC → hooks → painel → aba → hub/rota → docs → testes → E2E. RPC primeiro (contrato congela o resto).

## Fase 0 — Base e verificação (sem código)

1. Confirmar branch com ADR-001..004: `git status -sb`; `ls supabase/migrations/ | grep appointment_payments`.
2. Ler `SPEC.md` §1–§8 + ADR §2 (SQL base) + `src/hooks/useCommissionReport.ts` (padrão RPC+`tenantRangeUtc` a copiar) + `src/app/relatorios/ComissoesPage.tsx` (padrão `PeriodFilter`/gating neutro) + `src/app/cobrancas/CobrancasPage.tsx`.
3. Rodar suite verde antes: `npm test` (vitest) — falha pré-existente = sanear antes (harness H2).

## Fase 1 — RPC `financial_summary` (BE, 1 migration)

Arquivo: `supabase/migrations/{YYYYMMDDHHMMSS}_financial_summary.sql` (timestamp novo, posterior a `20261106143000_*`).
Conteúdo: `create or replace function public.financial_summary(p_from timestamptz, p_to timestamptz) returns jsonb language plpgsql security invoker set search_path = public, pg_temp` com corpo = 3 consultas do ADR §2 + montagem `jsonb_build_object` (chaves §2). Guardas: `p_from/p_to` nulos ou `p_to <= p_from` ou `p_to - p_from > interval '366 days'` → `PT400 INVALID_PERIOD`; `current_role_name() <> 'admin'` → `PT403 FORBIDDEN` (funções helper já existem em `20261106130000_*_helpers.sql` — reutilizar `current_tenant_id()`/`current_role_name()`). Fecho: `revoke execute ... from public, anon; grant execute ... to authenticated;` (+ `comment on function`).
Comandos: `supabase db reset && supabase db diff --use-migra` (só leitura de diff) + SQL manual de verificação (admin/recepção/profissional, período inválido, >366d, snapshot, voided, gorjeta, pago-não-somado).
Risco: `LATERAL` em aberto lento sem índice → mitigado por índices ADR-001 `(tenant_id, received_at)`/`(tenant_id, status)`; limite 366d.

## Fase 2 — Hooks de leitura (FE, 2 arquivos + testes)

1. `src/hooks/useFinancialSummary.ts` — espelho de `useCommissionReport`: `useTenant` (fuso) + `usePermissions` (`canViewFinancials`) + `useSegmentFeatures` (`payments`); `tenantRangeUtc(startDate,endDate,tz)` → `supabase.rpc("financial_summary", {p_from, p_to})`; zod (`FinancialSummary` em `src/types/payments.ts` ou `src/types/financial.ts`); `queryKey ["financial-summary", from, to]`; `enabled = !!timeZone && canViewFinancials && payments === true`; `staleTime 30_000`. Teste: gating (4 combinações), queryKey, zod rejeita `pago` como receita (shape sem campo de charges), `tenant_id` nunca nos args.
2. `src/hooks/useReceipts.ts` — query direta RLS: `supabase.from("appointment_payments").select("id,received_at,method,amount_cents,tip_cents,source,received_by,voided_at,void_reason,charge_id, appointments!inner(customer_id, customers(name))", {count:"exact"})` + filtros (`gte/lt received_at` via `tenantRangeUtc`, `eq method`, `is/null voided_at`) + `order received_at desc` + `range(page*25, +24)`; embed `profiles(full_name)` para operador (2ª query por ids, sem N+1 em loop); zod; mesmo `enabled`. Teste: paginação 25, filtros, embed, `enabled=false` fora do gating.
3. `src/types/payments.ts`: acrescentar `FinancialSummary` + `ReceivableRow` (ADR §interface congelada) — sem zod aqui (zod vive nos hooks).

## Fase 3 — Painel `/app/relatorios/financeiro` (FE, 2 arquivos + teste)

1. `src/app/relatorios/FinanceiroPage.tsx` — `PeriodFilter` + `useFinancialSummary`; grupos Recebido/Pendências (§4 SPEC); cards shadcn (`Card`+`tabular-nums`+`formatCentsToBRL`+`formatDateInTenantTz`); por-método 5 linhas com zeros; nota caixa×competência; estados loading/erro/vazio; guards neutros (fora de `payments` → `"disponível apenas para salões e barbearias"`; sem `canViewFinancials` → `"Você não tem acesso"`; sem request nos dois casos).
2. `src/app/relatorios/__tests__/FinanceiroPage.test.tsx` — grupos e rótulos de base, 5 métodos com zeros, gorjeta separada, total como linha (não card), sem gráfico (assert ausência `svg.recharts`), gating sem request, fuso tenant nas datas, a11y (`aria-label` cards, `aria-busy`).
3. Catálogo: estender `payments-messages.ts` com `financialSummary.*` (títulos, grupos, bases, nota, vazio/erro/retry, métodos via `method.*` existente).

## Fase 4 — Aba Recebimentos (FE, 3 arquivos + teste)

1. `src/app/cobrancas/RecebimentosTab.tsx` — `TabsContent value="recebimentos"`: filtros próprios (período/método/situação) + `Table` desktop / cards mobile + `RealceRow` estornada + `PaymentMethodChip` + paginação (`page`, 25) + estados. URL como estado via `useSearchParams` (hook fino local ou `nuqs`-free: `URLSearchParams` + `setSearchParams`).
2. `CobrancasPage.tsx` — envolve conteúdo em `Tabs` (`pix`/`recebimentos`), `TabsList` só mostra trigger Recebimentos sob gating; cada `TabsContent` com seus filtros (UX vinculante). Rota `/app/cobrancas` segue `RequireRole admin` (já existe — sem mudança de rota).
3. `src/app/cobrancas/__tests__/RecebimentosTab.test.tsx` — tabs, filtros por `TabsContent`, URL ↔ estado, paginação 25, RealceRow, sem totais/exportação/estorno na aba, RLS nega recepção (mock 403/empty + aba ausente no DOM).
4. Catálogo: `payments-messages.ts` += `receipts.*` (tabs, colunas, filtros, situações, vazio/erro/retry, `line-through` sem literal).

## Fase 5 — Hub/rota/docs (FE + DO, arquivos exatos)

1. `RelatoriosHubPage.tsx`: + card `{to:"/app/relatorios/financeiro", icon: Wallet, visible: canViewFinancials && payments === true}` com `titulo/descricao` do catálogo.
2. `src/router.tsx`: `+ { path: "financeiro", element: <FinanceiroPage /> }` sob `relatorios` (herda `RequireRole admin`).
3. Docs: editar `.agents/rules/dominio.md`, `.agents/rules/produto.md`, `.agents/rules/seguranca-multitenant.md` + espelhos `.kiro/steering/*.md` se existirem (checar `ls .kiro/steering`), conteúdo = ADR §7 verbatim adaptado. Sem tocar `stack.md`/`db-migration-supabase.md`/`harness.config.json`.
4. Teste: `resolveFeatures` 4 ramos (estender `useSegmentFeatures.test.ts` ou teste puro de `lib/segment-features`); `usePermissions.test.ts` sem regressão (nenhuma capability nova).

## Fase 6 — Testes + E2E

Comandos: `npm test` (vitest full) + `npx tsc --noEmit` + `npm run build` (Vite). Integração RPC contra Postgres real (`supabase db reset` + seed: atendimento quitado dinheiro + PIX pendente + linha estornada + gorjeta). E2E harness: wipe + admin (painel/aba ok) + recepção (sem aba/card, RLS nega) + 375/1280 + console zero erros.

## Riscos

| Risco | Mitigação |
|---|---|
| Receita dupla ledger+`pago` | painel/aba nunca leem `charges.pago`; teste dedicado |
| `p_tenant_id` no cliente | RPC sem param; teste de assinatura da função |
| Período gigante | 366d + `tenantRangeUtc`; teste de borda |
| Gorjeta na receita | campos separados + teste `tip>0` |
| Estorno somado | `voided_at is null` em todo agregado + teste |
| Recepção vê finanças | gating + RLS; teste DOM + teste RLS |
| Fuso errado | `tenantRangeUtc`/`formatDateInTenantTz`; teste DST |
| Clínica/legado quebra | `payments=false` esconde sem erro; teste de regressão |
| Comissão × caixa | nota fixa na UI; sem "correção" no v1 |

## Dependências

ADR-001 (RLS/índices/helpers `current_*`), ADR-002 (padrão `security invoker` + `PT4xx`), `PeriodFilter`/`PaymentMethodChip`/`PageHeader`/`StatePanel`/`Table`/`Tabs` existentes, `tenantRangeUtc` + `formatCentsToBRL`, catálogo `payments-messages.ts` (+ spy de literais).
