-- Migration: ADR-04 — comissão por produto + fórmula (preço−backbar)×% (backend).
-- Aditiva: colunas em services, professional_commissions, appointment_commissions +
-- tabela appointment_product_commissions + trigger atualizado + RPC report_commissions com p_origin.
-- Idempotente (if not exists / create or replace / drop trigger if exists).

-- 1) services: backbar por serviço (opcional).
alter table public.services
  add column if not exists backbar_cost_cents int not null default 0
    check (backbar_cost_cents >= 0);

-- 2) professional_commissions: tipo de comissão do serviço.
alter table public.professional_commissions
  add column if not exists commission_type text not null default 'price'
    check (commission_type in ('price','margin'));

-- 3) appointment_commissions: origem + backbar snapshot.
alter table public.appointment_commissions
  add column if not exists origin text not null default 'service'
    check (origin in ('service','product','combo'));
alter table public.appointment_commissions
  add column if not exists backbar_cost_cents int not null default 0
    check (backbar_cost_cents >= 0);

-- 4) appointment_product_commissions: comissão por produto vendido no atendimento.
create table if not exists public.appointment_product_commissions (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default current_tenant_id()
                    references tenants (id) on delete cascade,
  appointment_id  uuid not null,
  product_id      uuid not null,
  professional_id uuid not null,
  price_cents     int not null check (price_cents >= 0),
  commission_pct  numeric(5,2) not null
                    check (commission_pct >= 0 and commission_pct <= 100),
  commission_cents int not null check (commission_cents >= 0),
  backbar_cost_cents int not null default 0 check (backbar_cost_cents >= 0),
  origin          text not null default 'product'
                    check (origin = 'product'),
  calculated_at   timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  constraint appointment_product_commissions_appointment_unique
    unique (tenant_id, appointment_id, product_id),
  constraint appointment_product_commissions_appointment_fk
    foreign key (tenant_id, appointment_id)
    references appointments (tenant_id, id) on delete cascade,
  constraint appointment_product_commissions_product_fk
    foreign key (tenant_id, product_id)
    references products (tenant_id, id) on delete restrict,
  constraint appointment_product_commissions_professional_fk
    foreign key (tenant_id, professional_id)
    references professionals (tenant_id, id) on delete restrict
);

create index if not exists appointment_product_commissions_tenant_id_idx
  on public.appointment_product_commissions (tenant_id);
create index if not exists appointment_product_commissions_tenant_prof_calc_idx
  on public.appointment_product_commissions (tenant_id, professional_id, calculated_at);

alter table public.appointment_product_commissions enable row level security;

drop policy if exists appointment_product_commissions_select on public.appointment_product_commissions;
create policy appointment_product_commissions_select on public.appointment_product_commissions for select
  using (
    tenant_id = current_tenant_id()
    and (
      current_role_name() = 'admin'
      or (
        current_role_name() = 'professional'
        and professional_id in (
          select p.id from professionals p
          where p.tenant_id = current_tenant_id()
            and p.profile_id = auth.uid()
        )
      )
    )
  );

drop policy if exists appointment_product_commissions_insert on public.appointment_product_commissions;
create policy appointment_product_commissions_insert on public.appointment_product_commissions for insert
  with check (tenant_id = current_tenant_id());

-- 5) Trigger: fórmula por tipo + origin combo.
create or replace function public.appointments_validate_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_origin text;
  v_pct numeric(5,2);
  v_backbar int;
  v_type text;
  v_commission int;
  v_auto_credit uuid;
begin
  if new.status = old.status then
    return new;
  end if;

  if old.status in ('concluido','cancelado','nao_compareceu') then
    raise exception 'Transicao de status invalida: % e um estado final e nao pode mudar para %',
      old.status, new.status
      using errcode = 'check_violation';
  end if;

  if not (
    (old.status = 'pendente'
      and new.status in ('confirmado','em_atendimento','cancelado','nao_compareceu'))
    or (old.status = 'confirmado'
      and new.status in ('em_atendimento','cancelado','nao_compareceu'))
    or (old.status = 'em_atendimento'
      and new.status in ('concluido','cancelado'))
  ) then
    raise exception 'Transicao de status invalida: % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  if new.status = 'confirmado' and new.confirmed_at is null then
    new.confirmed_at := now();
  end if;

  if new.status = 'concluido' and old.status <> 'concluido' then
    if new.combo_id is not null then
      v_origin := 'combo';
      select coalesce(pc.commission_pct,0), coalesce(pc.commission_type,'price')
        into v_pct, v_type
        from professional_commissions pc
       where pc.tenant_id = new.tenant_id and pc.professional_id = new.professional_id;
      if v_pct is null then v_pct := 0; end if;
      v_backbar := 0;
      v_type := 'price';
    else
      v_origin := 'service';
      select coalesce(pc.commission_pct,0), coalesce(pc.commission_type,'price')
        into v_pct, v_type
        from professional_commissions pc
       where pc.tenant_id = new.tenant_id and pc.professional_id = new.professional_id;
      if v_pct is null then v_pct := 0; end if;
      select coalesce(s.backbar_cost_cents,0) into v_backbar
        from services s
       where s.tenant_id = new.tenant_id and s.id = new.service_id;
      if v_backbar is null then v_backbar := 0; end if;
    end if;

    if v_type = 'margin' and v_origin = 'service' then
      v_commission := round( ((new.commission_base_cents - v_backbar) * v_pct) / 100.0 )::int;
    else
      v_commission := round( (new.commission_base_cents * v_pct) / 100.0 )::int;
    end if;
    if v_commission < 0 then v_commission := 0; end if;

    insert into appointment_commissions
      (tenant_id, appointment_id, professional_id, base_cents, commission_pct, commission_cents, origin, backbar_cost_cents)
    values
      (new.tenant_id, new.id, new.professional_id, new.commission_base_cents, v_pct, v_commission, v_origin, v_backbar)
    on conflict (tenant_id, appointment_id) do nothing;
  end if;

  -- ==========================================================================
  -- Efeito colateral (Fase 2, ADR-02 + v1.4 RF-12): ao ENTRAR em 'concluido',
  -- baixa 1 sessão no MESMO commit. Vínculo explícito: consome direto. Sem
  -- vínculo: auto-vincula o melhor crédito válido do mesmo cliente+serviço.
  -- ==========================================================================
  if new.status = 'concluido' and old.status <> 'concluido' then
    if new.package_credit_id is null
       and new.customer_id is not null
       and new.service_id is not null then
      select c.id into v_auto_credit
        from public.package_credits c
       where c.tenant_id = new.tenant_id
         and c.customer_id = new.customer_id
         and c.service_id = new.service_id
         and c.status = 'active'
         and c.expires_at > now()
         and c.used_sessions < c.total_sessions
       order by c.expires_at asc, c.created_at asc
       limit 1;
      if v_auto_credit is not null then
        new.package_credit_id := v_auto_credit;
      end if;
    end if;
    if new.package_credit_id is not null then
      perform public.package_consume(new.package_credit_id, new.id, true);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_transition_guard on public.appointments;
create trigger appointments_transition_guard
  before update of status on public.appointments
  for each row
  execute function public.appointments_validate_transition();

-- 6) report_commissions RPC with p_origin and new columns.
drop function if exists public.report_commissions(timestamptz, timestamptz, uuid);
create or replace function public.report_commissions(
  p_start           timestamptz,
  p_end             timestamptz,
  p_professional_id uuid default null,
  p_origin          text default null
)
returns table (
  professional_id        uuid,
  professional_name      text,
  origin                 text,
  total_commission_cents bigint,
  total_backbar_cost_cents bigint,
  appointment_count      bigint
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select
    ac.professional_id,
    p.name as professional_name,
    ac.origin,
    sum(ac.commission_cents)::bigint as total_commission_cents,
    sum(ac.backbar_cost_cents)::bigint as total_backbar_cost_cents,
    count(*)::bigint as appointment_count
  from public.appointment_commissions ac
  join public.professionals p
    on p.tenant_id = ac.tenant_id
   and p.id = ac.professional_id
  where ac.calculated_at >= p_start
    and ac.calculated_at <  p_end
    and (p_professional_id is null or ac.professional_id = p_professional_id)
    and (p_origin is null or ac.origin = p_origin)
  group by ac.professional_id, p.name, ac.origin

  union all

  select
    apc.professional_id,
    p.name as professional_name,
    'product'::text as origin,
    sum(apc.commission_cents)::bigint as total_commission_cents,
    sum(apc.backbar_cost_cents)::bigint as total_backbar_cost_cents,
    count(*)::bigint as appointment_count
  from public.appointment_product_commissions apc
  join public.professionals p
    on p.tenant_id = apc.tenant_id
   and p.id = apc.professional_id
  where apc.calculated_at >= p_start
    and apc.calculated_at <  p_end
    and (p_professional_id is null or apc.professional_id = p_professional_id)
    and (p_origin is null or p_origin = 'product')
  group by apc.professional_id, p.name
  order by professional_name asc, origin asc;
$$;

comment on function public.report_commissions(timestamptz, timestamptz, uuid, text) is
  'Relatorio de comissao por periodo (ADR-04): origem service/product/combo, backbar.';

grant execute on function public.report_commissions(timestamptz, timestamptz, uuid, text) to authenticated;
revoke all on function public.report_commissions(timestamptz, timestamptz, uuid, text) from anon;
revoke all on function public.report_commissions(timestamptz, timestamptz, uuid, text) from public;
