# TASKS — Fase 0, Batch 0.3 — T1.0b: rename planos + consumo frontend

**Roadmap:** roadmap-oficial-v1.md v1.4 — T1.0 (marco T1.0, seção 6). Ladder neutro: Free / Starter / Premium / Enterprise (mapeamento: individual→Starter, clinica→Premium, pro→Enterprise). Premium abrange barbearia/salão/estética.

## Objetivo
Trocar o enum `individual/clinica/pro` por `starter/premium/enterprise` (+ `free` atribuível) e fazer o frontend consumir o catálogo via RPC `get_plans()`.

## Escopo

### 1. Rename no banco
- Nova migration: renomear slugs em `plans`, `tenants.plan`, `tenant_plan_changes.old_plan/new_plan`, `subscription_charges.plan`, CHECKs (`tenants.plan`, `tenant_plan_changes`, `subscription_charges_plan_check`), functions (`plan_professional_limit`, `plan_appointment_limit`, `plan_price_cents` CASEs/espelhos), views/RPCs (telemetria, quota, divergências), seeds.
- `free` passa a ser atribuível (atualizar CHECKs + `admin_set_tenant_plan` whitelist + schema Edge).
- Preservar histórico: `tenant_plan_changes` mantém old slugs? Migrar com mapeamento documentado. `db reset` 2x idempotente.

### 2. Edge Functions
- `create-subscription-charge`: aceitar novos slugs, rejeitar desconhecido/inativo com 400. `plans.json` deixa de ser lido (se ainda for).
- `admin-plan`: aceitar novos slugs + `free`.

### 3. Frontend via RPC
- `src/lib/plans.ts`: ler de `get_plans()` (TanStack Query) com fallback estático? Definir estratégia de cache. Remover `plans.json` como fonte (pode deletar ou manter só para marketing com paridade).
- `src/hooks/useSetPlan.ts`: `PLAN_PRESENTATION_LIMITS` lido do catálogo (ou derivado da RPC), não hardcoded.
- `AssinaturasPage.tsx` e textos citando `plans.json`: atualizar.
- Marketing (`/precos`) consome catálogo (ou mantém cópia com paridade testada).

### 4. Testes
- Paridade: tabela × RPC × frontend × telemetria com novos slugs.
- Migração de slugs: tenant individual→starter preserva limites/uso; histórico auditado.
- RLS: catálogo público leitura; escrita negada.
- `free` atribuível: downgrade/upgrade com free respeita quotas (0/1 prof? definir: free = 1 prof, 30 appt/mês conforme roadmap §6.5).

## Fora de escopo
- Entitlements/gating T1.1 (Fase 1).
- Quotas por feature T1.2.
- 6 tech-debts (Batch 0.4).

## Aceite
- `npm run build`, `npm test`, `npm run test:integration`, `npm run test:functions` verdes.
- Nenhum `individual/clinica/pro` restante em código/migration ativa (grep zero, exceto histórico/migração antiga e mapeamento).
- `supabase db reset` 2x.
