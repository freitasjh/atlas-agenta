-- Migration: ADR-06 — contas a pagar (suppliers + payables + settlements + baixa + KPIs).
-- Aditiva e idempotente. Nenhuma migration já aplicada é editada.
--
-- Escopo (ADR-06, RF-13..17 + PRD §7): fornecedores por tenant, lançamento com
-- vencimento/valor/recorrência mensal sem duplicar, baixa total/parcial com resto
-- pendente na mesma conta, anexo em storage privado, KPIs (vencido + próximos 7d).
--
-- Decisões (PRD §10.6–10.7 delegadas):
--   - Resto da baixa parcial vira SALDO pendente na mesma conta (sem nova cobrança
--     automática; `resto = valor - sum(settlements)`).
--   - Anexos: limite 10MB, pdf/jpg-png; retenção 5a (aplicação valida; bucket sem delete).
--   - Escrita direta pelo cliente: nenhuma (sem policy de write); mutações só via
--     RPCs SECURITY DEFINER com gate interno admin, ou via service_role.
--   - Recorrência mensal gera N parcelas com `serie_id` + unique
--     (serie_id, vencimento_at); replay com o mesmo `p_serie_id` volta sem duplicar.
--   - settlements é append-only (trigger barra update/delete, inclusive service_role).
--
-- Convenções: inglês/snake_case/plural; *_cents; timestamptz UTC; FK composta por
-- tenant; security definer + search_path fixo; erros de domínio PT4xx.

-- ============================================================================
-- 1) suppliers — fornecedor do tenant.
-- ============================================================================
create table if not exists public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default current_tenant_id()
                 references public.tenants (id) on delete cascade,
  nome        text not null check (char_length(nome) between 1 and 120),
  documento   text,
  contato     text,
  ativo       bool not null default true,
  created_at  timestamptz not null default now(),
  constraint suppliers_tenant_id_unique unique (tenant_id, id)
);

create index if not exists suppliers_tenant_id_idx
  on public.suppliers (tenant_id);
create index if not exists suppliers_tenant_nome_idx
  on public.suppliers (tenant_id, nome);

alter table public.suppliers enable row level security;

drop policy if exists suppliers_select_tenant_admin on public.suppliers;
create policy suppliers_select_tenant_admin on public.suppliers
  for select
  using (tenant_id = current_tenant_id() and current_role_name() = 'admin');

revoke all on table public.suppliers from anon, authenticated;
grant select on table public.suppliers to authenticated;
grant all on table public.suppliers to service_role;
revoke truncate on table public.suppliers from anon, authenticated;

-- ============================================================================
-- 2) payables — conta a pagar (fornecedor, descrição, vencimento, valor).
-- ============================================================================
create table if not exists public.payables (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default current_tenant_id()
                    references public.tenants (id) on delete cascade,
  supplier_id    uuid,
  descricao      text not null check (char_length(descricao) between 1 and 200),
  categoria      text,
  vencimento_at  timestamptz not null,
  valor_cents    int not null check (valor_cents > 0),
  status         text not null default 'pendente'
                   check (status in ('pendente','parcial','pago','cancelado')),
  recorrencia    text not null default 'none'
                   check (recorrencia in ('none','mensal')),
  serie_id       uuid,
  created_at     timestamptz not null default now(),
  constraint payables_tenant_id_unique unique (tenant_id, id),
  constraint payables_supplier_fk
    foreign key (tenant_id, supplier_id)
    references public.suppliers (tenant_id, id) on delete restrict
);

-- Recorrência sem duplicar: replay da mesma série no mesmo vencimento viola.
create unique index if not exists payables_serie_vencimento_uidx
  on public.payables (serie_id, vencimento_at)
  where serie_id is not null;

create index if not exists payables_tenant_status_idx
  on public.payables (tenant_id, status, vencimento_at);
create index if not exists payables_tenant_vencimento_idx
  on public.payables (tenant_id, vencimento_at);
create index if not exists payables_tenant_supplier_idx
  on public.payables (tenant_id, supplier_id);

alter table public.payables enable row level security;

drop policy if exists payables_select_tenant_admin on public.payables;
create policy payables_select_tenant_admin on public.payables
  for select
  using (tenant_id = current_tenant_id() and current_role_name() = 'admin');

revoke all on table public.payables from anon, authenticated;
grant select on table public.payables to authenticated;
grant all on table public.payables to service_role;
revoke truncate on table public.payables from anon, authenticated;

-- ============================================================================
-- 3) payable_settlements — baixa (total/parcial com resto). Append-only.
-- ============================================================================
create table if not exists public.payable_settlements (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null default current_tenant_id()
                 references public.tenants (id) on delete cascade,
  payable_id  uuid not null,
  valor_cents int not null check (valor_cents > 0),
  pago_at     timestamptz not null default now(),
  conta       text,
  anexo_path  text,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  constraint payable_settlements_tenant_id_unique unique (tenant_id, id),
  constraint payable_settlements_payable_fk
    foreign key (tenant_id, payable_id)
    references public.payables (tenant_id, id) on delete restrict,
  constraint payable_settlements_created_by_fk
    foreign key (tenant_id, created_by)
    references public.profiles (tenant_id, id) on delete restrict
);

create index if not exists payable_settlements_tenant_payable_idx
  on public.payable_settlements (tenant_id, payable_id, created_at);

alter table public.payable_settlements enable row level security;

drop policy if exists payable_settlements_select_tenant_admin on public.payable_settlements;
create policy payable_settlements_select_tenant_admin on public.payable_settlements
  for select
  using (tenant_id = current_tenant_id() and current_role_name() = 'admin');

revoke all on table public.payable_settlements from anon, authenticated;
grant select on table public.payable_settlements to authenticated;
grant all on table public.payable_settlements to service_role;
revoke truncate on table public.payable_settlements from anon, authenticated;

-- Append-only: update/delete barrados para qualquer role, inclusive service_role.
create or replace function public.payable_settlements_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'payable_settlements é append-only: update/delete proibidos (use linha nova)';
end;
$$;

drop trigger if exists payable_settlements_no_update_delete on public.payable_settlements;
create trigger payable_settlements_no_update_delete
  before update or delete on public.payable_settlements
  for each row execute function public.payable_settlements_immutable();

-- ============================================================================
-- 4) RPCs de escrita (admin-only, SECURITY DEFINER). Sem policy de write: o
--    trava real continua no banco (RLS + gate interno), nunca filtro do cliente.
-- ============================================================================

-- 4a) payable_create_supplier — fornecedor curto do Dialog (RF-13).
create or replace function public.payable_create_supplier(
  p_nome text,
  p_documento text default null,
  p_contato text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_role   text;
  v_id     uuid;
begin
  if p_nome is null or char_length(btrim(p_nome)) not between 1 and 120 then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  v_tenant := current_tenant_id();
  v_role := current_role_name();
  if v_tenant is null or coalesce(v_role, '__none') <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  insert into public.suppliers (tenant_id, nome, documento, contato)
  values (v_tenant, btrim(p_nome), nullif(btrim(coalesce(p_documento, '')), ''), nullif(btrim(coalesce(p_contato, '')), ''))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.payable_create_supplier(text, text, text) from public, anon;
grant execute on function public.payable_create_supplier(text, text, text) to authenticated, service_role;

-- 4b) payable_create — lançamento (RF-14). Recorrência mensal expande N parcelas
--     com a mesma serie_id; replay com p_serie_id existente volta os ids sem duplicar.
create or replace function public.payable_create(
  p_descricao text,
  p_vencimento_at timestamptz,
  p_valor_cents int,
  p_supplier_id uuid default null,
  p_categoria text default null,
  p_recorrencia text default 'none',
  p_parcelas int default 1,
  p_serie_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_role   text;
  v_serie  uuid;
  v_n      int;
  v_ids    uuid[] := '{}';
  v_venc   timestamptz;
  v_id     uuid;
  i        int;
begin
  if p_descricao is null or char_length(btrim(p_descricao)) not between 1 and 200
     or p_vencimento_at is null
     or p_valor_cents is null or p_valor_cents <= 0
     or coalesce(p_recorrencia, 'none') not in ('none','mensal') then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  v_tenant := current_tenant_id();
  v_role := current_role_name();
  if v_tenant is null or coalesce(v_role, '__none') <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  if p_supplier_id is not null and not exists (
    select 1 from public.suppliers s
     where s.tenant_id = v_tenant and s.id = p_supplier_id
  ) then
    raise exception 'PAYABLE_SUPPLIER_NOT_FOUND' using errcode = 'PT404';
  end if;

  -- Replay idempotente: serie já lançada volta os ids existentes.
  if p_serie_id is not null and exists (
    select 1 from public.payables p
     where p.tenant_id = v_tenant and p.serie_id = p_serie_id
  ) then
    select coalesce(array_agg(p.id order by p.vencimento_at), '{}') into v_ids
      from public.payables p
     where p.tenant_id = v_tenant and p.serie_id = p_serie_id;
    return jsonb_build_object('payable_ids', v_ids, 'replayed', true);
  end if;

  if coalesce(p_recorrencia, 'none') = 'mensal' then
    if p_parcelas is null or p_parcelas < 2 or p_parcelas > 24 then
      raise exception 'INVALID_BODY' using errcode = 'PT400';
    end if;
    v_n := p_parcelas;
    v_serie := coalesce(p_serie_id, gen_random_uuid());
  else
    v_n := 1;
    v_serie := null;
  end if;

  for i in 1..v_n loop
    v_venc := p_vencimento_at + ((i - 1) || ' months')::interval;
    insert into public.payables
      (tenant_id, supplier_id, descricao, categoria, vencimento_at, valor_cents, recorrencia, serie_id)
    values
      (v_tenant, p_supplier_id, btrim(p_descricao), nullif(btrim(coalesce(p_categoria, '')), ''), v_venc, p_valor_cents, coalesce(p_recorrencia, 'none'), v_serie)
    on conflict (serie_id, vencimento_at) where serie_id is not null do nothing
    returning id into v_id;
    if v_id is null then
      select p.id into v_id from public.payables p
       where p.serie_id = v_serie and p.vencimento_at = v_venc;
    end if;
    v_ids := v_ids || v_id;
  end loop;

  return jsonb_build_object('payable_ids', v_ids, 'replayed', false);
end;
$$;

revoke all on function public.payable_create(text, timestamptz, int, uuid, text, text, int, uuid) from public, anon;
grant execute on function public.payable_create(text, timestamptz, int, uuid, text, text, int, uuid) to authenticated, service_role;

-- 4c) payable_settle — baixa total/parcial (RF-16). Parcial mantém `parcial` com
--     resto = valor - sum(settlements); total zera e vira `pago`.
create or replace function public.payable_settle(
  p_payable_id uuid,
  p_valor_cents int,
  p_pago_at timestamptz default now(),
  p_conta text default null,
  p_anexo_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_role   text;
  v_pay    public.payables%rowtype;
  v_somado int;
  v_novo   int;
begin
  if p_payable_id is null or p_valor_cents is null or p_valor_cents <= 0 then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  v_tenant := current_tenant_id();
  v_role := current_role_name();
  if v_tenant is null or coalesce(v_role, '__none') <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  select * into v_pay from public.payables p
   where p.tenant_id = v_tenant and p.id = p_payable_id
   for update;
  if not found then
    raise exception 'PAYABLE_NOT_FOUND' using errcode = 'PT404';
  end if;
  if v_pay.status = 'cancelado' then
    raise exception 'PAYABLE_CANCELLED' using errcode = 'PT409';
  end if;
  if v_pay.status = 'pago' then
    raise exception 'PAYABLE_ALREADY_PAID' using errcode = 'PT409';
  end if;

  select coalesce(sum(s.valor_cents), 0) into v_somado
    from public.payable_settlements s
   where s.tenant_id = v_tenant and s.payable_id = p_payable_id;

  v_novo := v_somado + p_valor_cents;
  if v_novo > v_pay.valor_cents then
    raise exception 'PAYABLE_OVERPAY' using errcode = 'PT409';
  end if;

  insert into public.payable_settlements
    (tenant_id, payable_id, valor_cents, pago_at, conta, anexo_path, created_by)
  values
    (v_tenant, p_payable_id, p_valor_cents, coalesce(p_pago_at, now()),
     nullif(btrim(coalesce(p_conta, '')), ''), nullif(btrim(coalesce(p_anexo_path, '')), ''), auth.uid());

  if v_novo = v_pay.valor_cents then
    update public.payables set status = 'pago'
     where tenant_id = v_tenant and id = p_payable_id;
  else
    update public.payables set status = 'parcial'
     where tenant_id = v_tenant and id = p_payable_id;
  end if;

  return jsonb_build_object(
    'payable_id', p_payable_id,
    'status', case when v_novo = v_pay.valor_cents then 'pago' else 'parcial' end,
    'resto_cents', v_pay.valor_cents - v_novo
  );
end;
$$;

revoke all on function public.payable_settle(uuid, int, timestamptz, text, text) from public, anon;
grant execute on function public.payable_settle(uuid, int, timestamptz, text, text) to authenticated, service_role;

-- 4d) payable_cancel — cancela conta sem baixa (motivo auditável).
create or replace function public.payable_cancel(
  p_payable_id uuid,
  p_motivo text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_role   text;
  v_pay    public.payables%rowtype;
  v_count  int;
begin
  if p_payable_id is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  v_tenant := current_tenant_id();
  v_role := current_role_name();
  if v_tenant is null or coalesce(v_role, '__none') <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  select * into v_pay from public.payables p
   where p.tenant_id = v_tenant and p.id = p_payable_id
   for update;
  if not found then
    raise exception 'PAYABLE_NOT_FOUND' using errcode = 'PT404';
  end if;
  if v_pay.status = 'pago' then
    raise exception 'PAYABLE_ALREADY_PAID' using errcode = 'PT409';
  end if;

  select count(*) into v_count from public.payable_settlements s
   where s.tenant_id = v_tenant and s.payable_id = p_payable_id;
  if v_count > 0 then
    raise exception 'PAYABLE_HAS_SETTLEMENTS' using errcode = 'PT409';
  end if;

  update public.payables set status = 'cancelado'
   where tenant_id = v_tenant and id = p_payable_id;

  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (
    v_tenant, auth.uid(), 'payable_cancelled', 'payable', p_payable_id,
    jsonb_build_object('motivo', p_motivo)
  );

  return jsonb_build_object('payable_id', p_payable_id, 'status', 'cancelado');
end;
$$;

revoke all on function public.payable_cancel(uuid, text) from public, anon;
grant execute on function public.payable_cancel(uuid, text) to authenticated, service_role;

-- 4e) payable_kpis — vencido + próximos 7d (RF-15). Só contas em aberto
--     (pendente/parcial); o resto entra via settlements, não aqui.
create or replace function public.payable_kpis()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_role   text;
  v_out    jsonb;
begin
  v_tenant := current_tenant_id();
  v_role := current_role_name();
  if v_tenant is null or coalesce(v_role, '__none') <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  with aberto as (
    select p.id, p.valor_cents, p.vencimento_at,
           p.valor_cents - coalesce((
             select sum(s.valor_cents) from public.payable_settlements s
              where s.tenant_id = p.tenant_id and s.payable_id = p.id
           ), 0) as resto_cents
      from public.payables p
     where p.tenant_id = v_tenant
       and p.status in ('pendente','parcial')
  )
  select jsonb_build_object(
    'vencido_cents', coalesce(sum(resto_cents) filter (where vencimento_at < now()), 0),
    'vencido_count', coalesce(count(*) filter (where vencimento_at < now()), 0),
    'proximos7d_cents', coalesce(sum(resto_cents) filter (where vencimento_at >= now() and vencimento_at <= now() + interval '7 days'), 0),
    'proximos7d_count', coalesce(count(*) filter (where vencimento_at >= now() and vencimento_at <= now() + interval '7 days'), 0)
  ) into v_out from aberto;

  return v_out;
end;
$$;

revoke all on function public.payable_kpis() from public, anon;
grant execute on function public.payable_kpis() to authenticated, service_role;

-- ============================================================================
-- 5) Storage privado `payables/` — path `<tenant_id>/<payable_id>/*`, admin-only.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('payables', 'payables', false)
on conflict (id) do nothing;

grant select, insert on storage.objects to authenticated;

drop policy if exists "payables select" on storage.objects;
create policy "payables select" on storage.objects for select
  to authenticated
  using (
    bucket_id = 'payables'
    and (storage.foldername(name))[1] = current_tenant_id()::text
    and current_role_name() = 'admin'
  );

drop policy if exists "payables insert" on storage.objects;
create policy "payables insert" on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'payables'
    and (storage.foldername(name))[1] = current_tenant_id()::text
    and current_role_name() = 'admin'
  );
