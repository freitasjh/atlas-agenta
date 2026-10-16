-- Migration: tenants (ADR-02)
-- Cria a tabela-âncora do multi-tenant (uma linha por empresa assinante) com RLS habilitado.
--
-- Escopo desta migration (ADR-02): tabela + índices + `enable row level security`.
-- As policies de `tenants` dependem das funções helper `current_tenant_id()` /
-- `current_role_name()`, que nascem na migration da ADR-03 (profiles + helpers). Por isso
-- NENHUMA policy é criada aqui: a regra dura de ordenação (PRD §9) é "função security definer
-- antes das policies que a chamam". Entre esta migration e a da ADR-03, `tenants` fica com
-- RLS on e zero policy = deny-all (comportamento seguro por padrão); como um `db reset` aplica
-- 02 -> 03 em sequência, não há janela real de exposição.
--
-- Convenções: dinheiro não aparece aqui (sem *_cents); todo tempo é timestamptz (UTC).
-- Os literais de `plan` e `subscription_status` espelham exatamente os enums de
-- src/types/domain.ts (SUBSCRIPTION_STATUSES) e produto.md — não divergir.

-- gen_random_uuid() vem do pgcrypto.
create extension if not exists pgcrypto;

create table if not exists tenants (
  id                  uuid primary key default gen_random_uuid(),
  legal_name          text not null,                     -- razão social
  trade_name          text,                              -- nome fantasia
  document            text,                              -- CNPJ/CPF (formato validado na app; único quando presente)
  owner_email         text not null,
  phone               text,
  segment             text,                              -- ramo de atuação
  plan                text not null default 'individual'
                      check (plan in ('individual','clinica','pro')),
  subscription_status text not null default 'trial'
                      check (subscription_status in
                            ('trial','ativo','pendente','bloqueado','cancelado')),
  trial_ends_at       timestamptz,
  timezone            text not null default 'America/Sao_Paulo',
  created_at          timestamptz not null default now()
);

-- document é opcional (pode faltar no trial) mas único quando presente:
-- evita duas empresas com o mesmo CNPJ/CPF.
create unique index if not exists tenants_document_key
  on tenants (document) where document is not null;

-- RLS habilitado já nesta migration. Policies entram na ADR-03 (dependem das funções helper).
-- Com RLS on e nenhuma policy, a tabela fica deny-all para o cliente até a 03 completar as
-- policies de leitura própria / super_admin / update por admin.
alter table tenants enable row level security;
