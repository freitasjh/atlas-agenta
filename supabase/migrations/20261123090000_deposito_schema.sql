-- Migration: depósito/sinal (ADR-02 Fase 4) — schema backend mínimo.
-- Estende services com config de depósito, appointments.status com 'aguardando_deposito',
-- guarda de transição, índice em charges. Idempotente (if not exists / drop if exists).
-- RLS: services já tem policy admin write; charges policy existente (admin read).
-- Dinheiro em *_cents int; timestamps timestamptz UTC.

-- ============================================================================
-- 1. services — config de depósito por serviço.
-- ============================================================================
alter table public.services
  add column if not exists deposit_enabled boolean not null default false;

alter table public.services
  add column if not exists deposit_type text
  check (deposit_type is null or deposit_type in ('percent','fixed'));

alter table public.services
  add column if not exists deposit_value int not null default 0
  check (deposit_value >= 0);

alter table public.services
  add column if not exists deposit_deadline_hours int not null default 24
  check (deposit_deadline_hours > 0);

alter table public.services
  add column if not exists deposit_refund_policy text not null default 'none'
  check (deposit_refund_policy in ('total','partial','none'));

alter table public.services
  add column if not exists deposit_refund_percent int
  check (deposit_refund_percent is null or deposit_refund_percent between 0 and 100);

-- ============================================================================
-- 2. appointments.status — inclui 'aguardando_deposito'.
-- ============================================================================
alter table public.appointments drop constraint if exists appointments_status_check;
alter table public.appointments
  add constraint appointments_status_check
  check (status in ('pendente','confirmado','em_atendimento','concluido','cancelado','nao_compareceu','aguardando_deposito'));

create or replace function public.appointments_validate_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_origin text;
  v_pct numeric(5,2);
  v_backbar int;
  v_type text;
  v_commission int;
  v_auto_credit uuid;
  v_current int;
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
    or (old.status = 'aguardando_deposito'
      and new.status in ('pendente','confirmado','cancelado'))
  ) then
    raise exception 'Transicao de status invalida: % -> %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  if new.status = 'confirmado' and new.confirmed_at is null then
    new.confirmed_at := now();
  end if;

  if new.status = 'concluido' and old.status <> 'concluido' then
    if new.product_id is not null then
      v_origin := 'product';
      select coalesce(p.commission_pct, 0) into v_pct
        from public.products p
       where p.tenant_id = new.tenant_id and p.id = new.product_id;
      if v_pct is null then v_pct := 0; end if;
      v_backbar := 0;
      v_type := 'price';

      insert into public.appointment_product_commissions
        (tenant_id, appointment_id, product_id, professional_id, price_cents,
         commission_pct, commission_cents, backbar_cost_cents, origin)
      values
        (new.tenant_id, new.id, new.product_id, new.professional_id, new.price_cents,
         v_pct, round((new.price_cents * v_pct) / 100.0)::int, 0, 'product')
      on conflict (tenant_id, appointment_id, product_id) do nothing;

      -- Consumo de estoque idempotente (venda_pdv). Bloqueia se insuficiente.
      select stock_qty into v_current
        from public.products
       where tenant_id = new.tenant_id and id = new.product_id
       for update;
      if v_current is null then
        raise exception 'STOCK_PRODUCT_NOT_FOUND' using errcode = '23503';
      end if;
      if v_current - new.product_qty < 0 then
        raise exception 'STOCK_INSUFFICIENT' using errcode = 'PT409';
      end if;
      if not exists (
        select 1 from public.stock_movements
         where tenant_id = new.tenant_id
           and appointment_id = new.id
           and product_id = new.product_id
           and movement_type = 'consume'
      ) then
        insert into public.stock_movements
          (tenant_id, product_id, movement_type, qty_delta, reason, appointment_id, created_by)
        values
          (new.tenant_id, new.product_id, 'consume', -new.product_qty, 'venda_pdv', new.id, auth.uid());
      end if;
    elsif new.combo_id is not null then
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

    -- appointment_commissions apenas para service/combo (produto usa tabela própria).
    if new.product_id is null then
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
  end if;

  -- package credit auto-vinculo (só serviço).
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

-- ============================================================================
-- 3. charges — índice (tenant, appointment, status) para consulta de cobrança pendente.
-- ============================================================================
create index if not exists charges_tenant_appointment_status_idx
  on public.charges (tenant_id, appointment_id, status);

