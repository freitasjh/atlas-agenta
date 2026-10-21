# ADR-01 — Tabela `message_templates` por tenant (schema + RLS)

**Status:** proposto

**Escopo:** dados

**Depende de:** nenhuma (primeira ADR da fatia). Base: `master`; última migration aplicada é
`20250221091000_schedule_overrides.sql`.

## Contexto

A Fatia 1 do WhatsApp Fase 2 introduz uma superfície de domínio nova: o texto editável das 4
mensagens da régua (`confirmacao`, `lembrete_d1`, `cobranca`, `comprovante`), uma linha por
`(tenant_id, template_key)` por tenant (decisão D3 do PRD / §8.1 de `analysis-data.md`: tabela
própria, não "defaults de sistema + override difuso"). Toda tabela de domínio nasce com `tenant_id`
+ índice + RLS (seguranca-multitenant.md) — e esta é a primeira porta por onde um template poderia
vazar entre tenants (defeito #1 do PRD). O padrão já estabelecido em `whatsapp_instances`/`messages`
usa os helpers `current_tenant_id()` / `current_role_name()` (security definer, migration
`20250216091000_profiles_and_helpers.sql`) — reusar, nunca reimplementar (evita recursão de RLS).

Armadilha conhecida (brain, regra `public-messages-colide-com-realtime-messages`): nomes de tabela
em `public` podem colidir com tabelas built-in do Supabase (`realtime.messages`). `message_templates`
não colide com nenhum objeto reservado conhecido, mas a migration deve criar explicitamente em
`public` e não assumir `search_path`.

## Decisão

Criar **uma migration nova** `supabase/migrations/<timestamp>_message_templates.sql` (timestamp
posterior a `20250221091000`, ex.: `20250222090000`), idempotente, que:

1. `create table if not exists public.message_templates` com as colunas:
   - `id uuid primary key default gen_random_uuid()`
   - `tenant_id uuid not null default current_tenant_id() references tenants(id) on delete cascade`
   - `template_key text not null check (template_key in ('confirmacao','lembrete_d1','cobranca','comprovante'))` — espelha o enum de `messages.template`
   - `body text not null check (char_length(body) between 1 and 2000)` — teto de segurança do banco (decisão da pergunta aberta §7 do PRD: coluna até 2000, UI limita a 1000)
   - `active boolean not null default true`
   - `updated_at timestamptz not null default now()`
   - `created_at timestamptz not null default now()`
   - `constraint message_templates_tenant_key_unique unique (tenant_id, template_key)`
2. `create index if not exists message_templates_tenant_id_idx on public.message_templates (tenant_id)`.
3. `alter table public.message_templates enable row level security`.
4. Políticas RLS (ambas com `drop policy if exists` antes do `create policy` — idempotência):
   - `message_templates_select_admin` (SELECT): `using (tenant_id = current_tenant_id() and current_role_name() = 'admin')` — leitura só admin (decisão D6 do PRD / §7 de `analysis-data.md`).
   - `message_templates_write_admin` (ALL): `using (...) with check (...)` idênticos à cláusula acima — **WITH CHECK espelha o USING** para barrar gravar/mover linha para outro tenant. Com o `default current_tenant_id()`, o INSERT do cliente (sem `tenant_id` no corpo) recebe o tenant do JWT e passa; cross-tenant barrado.

`super_admin` **não** recebe caminho cross-tenant pelo cliente a esta tabela (coerente com as demais
tabelas de domínio). A baseline/seed roda via service role (bypassa RLS) — é a ADR-02, não esta.

Esta ADR é candidata a promoção futura para `docs/` como decisão durável de modelagem; **não copiar
agora**.

## Consequências

- Existe uma superfície nova sob RLS; o isolamento é garantido no banco, não na app.
- `active` fica reservado (Fatia 1 mantém sempre `true` no seed; o editor expõe o toggle — ADR-06).
- Nenhuma migration aplicada é editada; o re-apply (`supabase db reset`) é idempotente.
- A coluna aceita até 2000 chars; a UI (ADR-05) limita a 1000 — o banco é o teto de segurança.

## Arquivos afetados

- `supabase/migrations/<timestamp>_message_templates.sql` (novo)

## Critérios de aceite (testáveis nesta ADR)

- **AC-01:** `supabase db reset` (ou `supabase start`) aplica a migration **sem erro**; a tabela
  `public.message_templates` existe com todas as colunas/constraints acima, `unique (tenant_id,
  template_key)`, índice `message_templates_tenant_id_idx` e RLS habilitada.
  Verificar: `supabase db reset` conclui com exit 0; inspecionar `\d message_templates` e
  `select relrowsecurity from pg_class where relname='message_templates'` → `t`.
- **RLS presente:** `select policyname from pg_policies where tablename='message_templates'` retorna
  as duas políticas; a de escrita tem `with_check` não nulo.
- **Idempotência:** aplicar a migration duas vezes (re-run do `db reset`) não falha.
- Nenhuma linha é semeada ainda (isso é a ADR-02); a validação de isolamento ponta a ponta com duas
  sessões é verificada após a ADR-02 ter dados (AC-03 do PRD).
