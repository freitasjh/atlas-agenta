# TASKS — Fase 0, Batch 0.2 — T1.0a: catálogo SSoT de planos (backend)

**Roadmap:** `roadmap-oficial-v1.md` v1.4 — T1.0 (marco T1.0, seção 6).
**Contexto:** hoje o plano está espelhado em 4 lugares (`supabase/functions/_shared/plans.json`, `plan_price_cents()`/`plan_professional_limit()`/`plan_appointment_limit()` no SQL, `PLANS`/`PLAN_PRESENTATION_LIMITS` no frontend). Este batch estabelece a **fonte única (SSoT)** no backend e o mecanismo de paridade.

## Objetivo
Uma fonte única para planos (preços/quotas/features), eliminando divergência entre UI, banco e Edge Functions.

## Escopo

### 1. Tabela `plans` (SSoT)
- Colunas: `slug` (pk), `name`, `price_cents` (int), `prof_limit` (int null), `appt_limit` (int null), `features` (jsonb), `active` (bool), `sort_order` (int).
- Seed: `free` (novo), `individual`, `clinica`, `pro` (dados atuais; o **rename** vem no Batch 0.3).
- RLS: SELECT para `anon`/`authenticated` (catálogo público); **sem escrita** para clientes.
- RPC de leitura para o frontend (ex.: `get_plans()`), usada no Batch 0.3.

### 2. Functions do banco leem a tabela
- `plan_price_cents`, `plan_professional_limit`, `plan_appointment_limit` passam a ler de `plans` (deixam de ser `immutable`; viram `stable`). Assinaturas preservadas (não quebrar call sites).

### 3. Edge Function `create-subscription-charge`
- Passa a ler o preço da tabela `plans` (service role), removendo `plans.json` como SSoT.
- `plans.json` pode permanecer **temporariamente** para o frontend (marketing), mas deixa de ser canônico.

### 4. TOCTOU (G29)
- `pg_advisory_xact_lock` no topo de `enforce_professional_plan_limit()` e `enforce_appointment_plan_limit()` e no ramo de downgrade de `admin_set_tenant_plan()`.

### 5. Testes
- **Paridade:** tabela × functions × Edge Function (preço/quotas).
- **Concorrência:** duas sessões simultâneas não estouram a quota (advisory lock).
- **RLS:** anon/authenticated leem o catálogo; escrita negada.

## Fora de escopo
- **Rename** Free/Starter/Premium/Enterprise (Batch 0.3).
- **Consumo frontend** via RPC (Batch 0.3).
- **Entitlements/gating** (T1.1).

## Aceite
- `npm run build`, `npm test`, `npm run test:integration`, `npm run test:functions` verdes.
- Teste de paridade e de concorrência novos e verdes.
- Nenhuma divergência de preço/quota entre tabela, functions e Edge.
