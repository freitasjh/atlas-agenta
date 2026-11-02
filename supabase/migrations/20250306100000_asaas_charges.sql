-- Migration: Asaas PIX charges — cobrança por tenant + assinatura (ADR-20)
-- Tabelas: tenant_asaas_config, charges, subscription_charges + RLS + índices.

create table if not exists public.tenant_asaas_config (
  tenant_id                  uuid primary key references public.tenants (id) on delete cascade,
  asaas_api_key_encrypted    text,
  asaas_webhook_token        text,
  asaas_account_id           text,
  environment                text not null default 'sandbox'
                             check (environment in ('sandbox','production')),
  active                     boolean not null default false,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create table if not exists public.charges (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete cascade,
  appointment_id   uuid,
  asaas_payment_id text unique,
  status           text not null default 'pendente'
                   check (status in ('pendente','pago','expirado','cancelado')),
  amount_cents     int not null check (amount_cents >= 0),
  pix_qr_code      text,
  pix_copy_paste   text,
  expires_at       timestamptz,
  paid_at          timestamptz,
  created_at       timestamptz not null default now(),
  constraint charges_appointment_fk
    foreign key (tenant_id, appointment_id)
    references public.appointments (tenant_id, id) on delete restrict
);

create table if not exists public.subscription_charges (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete cascade,
  asaas_payment_id text unique,
  status           text not null default 'pendente'
                   check (status in ('pendente','pago','expirado','cancelado')),
  amount_cents     int not null check (amount_cents >= 0),
  plan             text,
  billing_period   text,
  pix_qr_code      text,
  pix_copy_paste   text,
  expires_at       timestamptz,
  paid_at          timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists tenant_asaas_config_tenant_id_idx on public.tenant_asaas_config (tenant_id);
create index if not exists charges_tenant_id_idx on public.charges (tenant_id);
create index if not exists charges_appointment_id_idx on public.charges (appointment_id);
create unique index if not exists charges_appointment_id_uidx on public.charges (appointment_id) where appointment_id is not null;
create index if not exists charges_status_idx on public.charges (status);
create index if not exists charges_asaas_payment_id_idx on public.charges (asaas_payment_id);
create index if not exists subscription_charges_tenant_id_idx on public.subscription_charges (tenant_id);
create index if not exists subscription_charges_status_idx on public.subscription_charges (status);
create index if not exists subscription_charges_asaas_payment_id_idx on public.subscription_charges (asaas_payment_id);

alter table public.tenant_asaas_config enable row level security;
alter table public.charges enable row level security;
alter table public.subscription_charges enable row level security;

-- tenant_asaas_config: admin lê/escreve própria; super admin lê todas. Escrita de API key via service role.
drop policy if exists tenant_asaas_config_select_own on public.tenant_asaas_config;
create policy tenant_asaas_config_select_own on public.tenant_asaas_config for select
  using (tenant_id = current_tenant_id() and current_role_name() = 'admin');

drop policy if exists tenant_asaas_config_select_super on public.tenant_asaas_config;
create policy tenant_asaas_config_select_super on public.tenant_asaas_config for select
  using (current_role_name() = 'super_admin');


-- charges: admin do tenant lê; service role escreve.
drop policy if exists charges_select_tenant_admin on public.charges;
create policy charges_select_tenant_admin on public.charges for select
  using (tenant_id = current_tenant_id() and current_role_name() = 'admin');

-- subscription_charges: super admin lê/escreve; tenant admin lê própria.
drop policy if exists subscription_charges_select_super on public.subscription_charges;
create policy subscription_charges_select_super on public.subscription_charges for select
  using (current_role_name() = 'super_admin');

drop policy if exists subscription_charges_write_super on public.subscription_charges;
create policy subscription_charges_write_super on public.subscription_charges for all
  using (current_role_name() = 'super_admin')
  with check (current_role_name() = 'super_admin');

drop policy if exists subscription_charges_select_tenant on public.subscription_charges;
create policy subscription_charges_select_tenant on public.subscription_charges for select
  using (tenant_id = current_tenant_id() and current_role_name() = 'admin');



-- webhook_events (Asaas) — idempotência de webhook (ADR-20)
-- Reaproveita a tabela webhook_events existente (WhatsApp), adicionando colunas para Asaas.
alter table public.webhook_events add column if not exists event_id text;
alter table public.webhook_events add column if not exists payment_id text;
alter table public.webhook_events add column if not exists event_type text;
alter table public.webhook_events add column if not exists processed_at timestamptz default now();

-- defaults para colunas not-null legadas, permitindo insert Asaas sem quebrar WhatsApp.
alter table public.webhook_events alter column external_event_id set default '';
alter table public.webhook_events alter column instance_name set default 'asaas';

create unique index if not exists webhook_events_asaas_dedupe_uidx
  on public.webhook_events (event_id, payment_id)
  where event_id is not null and payment_id is not null;

create index if not exists webhook_events_asaas_payment_id_idx on public.webhook_events (payment_id);
create index if not exists webhook_events_asaas_event_id_idx on public.webhook_events (event_id);
