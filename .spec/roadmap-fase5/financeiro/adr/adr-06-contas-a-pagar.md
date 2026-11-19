# ADR-06 — Contas a pagar (fornecedores + lançamentos + baixa + UI)

- **Status**: `proposed`
- **Depende de**: ADR-05 (sequência; paralelizável após ADR-01).
- **RFs**: RF-13, RF-14, RF-15, RF-16, RF-17.

## Contexto

Pagar: fornecedores por tenant, lançamento com vencimento/valor/recorrência sem duplicar, KPIs (vencido + próximos 7d), baixa total/parcial com resto pendente, anexo em storage privado. PRD §10.6–10.7 abertas (resto como nova cobrança vs saldo; retenção anexos).

## Decisão

- `suppliers`: `id, tenant_id, nome, documento, contato, ativo`.
- `payables`: `id, tenant_id, supplier_id nullable, descricao, categoria, vencimento_at, valor_cents, status (pendente|parcial|pago|cancelado), recorrencia (none|mensal), serie_id nullable, created_at`; recorrência gera série com `serie_id` + unique `(serie_id, vencimento_at)` anti-duplicação.
- `payable_settlements`: `id, tenant_id, payable_id FK composta, valor_cents, pago_at, conta, anexo_path nullable, created_by`; baixa parcial mantém `parcial` com resto = valor − sum(settlements); total zera → `pago`; update/delete proibidos (estorno lógico futuro, não neste ADR).
- Anexos: storage bucket privado `payables/` path `tenant_id/payable_id/*`; RLS storage tenant.
- UI `/app/financeiro/pagar` (admin-only, `contasPagar`): filtros status/fornecedor/vencimento; KPI vencido + 7d; tabela; Dialog baixa (valor/data/conta/anexo, parcial mostra resto); Switch recorrência; Dialog fornecedor curto.
- Decisões provisórias §10: resto vira **saldo pendente na mesma conta** (sem nova cobrança automática); anexos limite 10MB/pdf-jpg-png, retenção 5a.

## Consequências

- Positivas: pagar completo sem ERP; recorrência sem duplicar; anexo auditável.
- Negativas: sem estorno lógico neste ADR (débito registrado para ADR futura ou Fase 6).

## Escopo

- Entra: migrations + RLS +settlement RPC/trigger soma + storage bucket + UI + gating.
- Não entra: DRE (ADR-09 consome `payables`), conciliação (ADR-08 linka depois).

## Arquivos afetados

- `supabase/migrations/*_payables.sql`
- `src/app/financeiro/pagar/*`, `src/hooks/usePayables.ts`

## Critérios de aceite (testáveis)

1. Lançamento recorrente gera N parcelas sem duplicar em replay (unique serie).
2. Baixa parcial → status `parcial`, resto correto; baixa total → `pago`; anexo sobe no path tenant e só admin lê.
3. KPIs: vencido e 7d batem com fixtures; gating `contasPagar=false/null` → upsell sem request.
4. RBAC + RLS cross-tenant 0; suite verde.
