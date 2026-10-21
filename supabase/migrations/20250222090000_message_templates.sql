-- Migration: message_templates — texto editável das 4 mensagens da régua por tenant (ADR-01 WhatsApp Fase 2, Fatia 1)
-- Materializa a superfície de domínio nova da Fatia 1: uma linha por `(tenant_id, template_key)`
-- para as 4 chaves padrão (`confirmacao`, `lembrete_d1`, `cobranca`, `comprovante`), com `body`
-- pt-BR editável pelo admin do tenant (decisão D3 do PRD: tabela própria, não "defaults de
-- sistema + override difuso"). É a primeira porta por onde um template poderia vazar entre
-- tenants (defeito #1 do PRD) — por isso nasce já sob RLS.
--
-- Isolamento multi-tenant (RNF03, inegociável): `tenant_id` com `default current_tenant_id()`
-- (deriva do JWT/profiles, NUNCA vem do cliente), índice por tenant e RLS habilitado com
-- policies USING + WITH CHECK ancoradas em `current_tenant_id()` / `current_role_name()`
-- (helpers security definer da migration 20250216091000, reutilizados — NÃO recriados, evita
-- recursão de RLS). Lição confirmada (migration 20250218090000): sem o default, o WITH CHECK
-- reprova a escrita do cliente, que por regra de isolamento não envia tenant_id.
--
-- RBAC (PRD §5 / decisão D6): leitura E escrita só do `admin` do tenant — templates são
-- configuração editorial do dono. Recepção/profissional não leem os templates para disparar: a
-- renderização do envio é server-side (Edge Function com service role, bypassa RLS), então
-- restringir a leitura ao admin reduz a superfície SEM quebrar o envio. super_admin sem caminho
-- cross-tenant pelo cliente a esta tabela (coerente com as demais tabelas de domínio); nenhuma
-- policy *_super_admin aqui. A baseline/seed dos 4 padrões roda via service role — é a ADR-02.
--
-- Armadilha conhecida (brain, regra `public-messages-colide-com-realtime-messages`): nomes em
-- `public` podem colidir com tabelas built-in do Supabase. `message_templates` não colide com
-- objeto reservado conhecido; ainda assim a migration qualifica `public.` explicitamente e não
-- assume `search_path`.
--
-- `body` aceita até 2000 chars no banco (teto de segurança); a UI (ADR-05) limita a 1000. O
-- `body` é texto com placeholders — não é segredo nem PII. `template_key` espelha o enum de
-- `messages.template`.
--
-- Convenções: inglês/snake_case/plural; `created_at`/`updated_at` timestamptz (UTC); sem
-- dinheiro aqui. Idempotente no re-apply (create table if not exists / drop policy if exists).
-- Nenhum segredo no SQL. Role de app (`authenticated`) sem BYPASSRLS (herdado).

-- ============================================================================
-- message_templates — texto editável das 4 mensagens da régua, por tenant.
-- Uma linha por (tenant_id, template_key).
-- ============================================================================
create table if not exists public.message_templates (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default current_tenant_id() references public.tenants (id) on delete cascade,
  -- espelha o enum de messages.template (as 4 chaves da régua).
  template_key text not null
               check (template_key in ('confirmacao','lembrete_d1','cobranca','comprovante')),
  -- teto de segurança do banco (2000); a UI limita a 1000 (ADR-05).
  body         text not null check (char_length(body) between 1 and 2000),
  active       boolean not null default true,
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  -- uma linha por chave por tenant — travado no banco, não só na UI.
  constraint message_templates_tenant_key_unique unique (tenant_id, template_key)
);

create index if not exists message_templates_tenant_id_idx on public.message_templates (tenant_id);

alter table public.message_templates enable row level security;

-- SELECT: só admin do tenant (decisão D6 — recepção/profissional não precisam ler para disparar,
-- pois a renderização é server-side). super_admin sem caminho pelo cliente a esta tabela.
drop policy if exists message_templates_select_admin on public.message_templates;
create policy message_templates_select_admin on public.message_templates for select
  using (
    tenant_id = current_tenant_id()
    and current_role_name() = 'admin'
  );

-- Escrita: só admin do tenant. WITH CHECK espelha o USING para barrar gravar/mover linha para
-- outro tenant (combinado com o default current_tenant_id(), o INSERT do cliente — sem tenant_id
-- no corpo — recebe o tenant do JWT e passa; cross-tenant continua barrado). A baseline/seed roda
-- pela ADR-02 via service role (bypassa RLS).
drop policy if exists message_templates_write_admin on public.message_templates;
create policy message_templates_write_admin on public.message_templates for all
  using (
    tenant_id = current_tenant_id()
    and current_role_name() = 'admin'
  )
  with check (
    tenant_id = current_tenant_id()
    and current_role_name() = 'admin'
  );
