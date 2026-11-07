-- Migration: ADR-003 — backfill reexecutável de cutover do ledger de recebimento.
-- Aditiva e idempotente. Nenhuma migration anterior é alterada.
--
-- `reconcile_appointment_payments_backfill(p_tenant_id uuid default null)`:
--   1. conta candidatos (`pago`, com atendimento e sem linha no ledger);
--   2. insere uma linha `pix_sistema/asaas` por candidato (valor da COBRANÇA);
--   3. é idempotente (`not exists` + `on conflict ... do nothing` cobre corrida com `settle`);
--   4. conta `amount_cents <= 0` em `skipped_invalid_amount` sem bloquear;
--   5. se sobrar candidato (`missing_after > 0`) levanta `PT500 BACKFILL_COUNT_MISMATCH`;
--   6. audita `appointment_payments_backfill_reconciled` e retorna as contagens.
--
-- Execução: só `service_role`. Nunca altera `charges`, comissão ou linhas existentes do ledger.

create or replace function public.reconcile_appointment_payments_backfill(
  p_tenant_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_candidates           int := 0;
  v_inserted             int := 0;
  v_missing_after        int := 0;
  v_skipped_invalid      int := 0;
begin
  select count(*)
    into v_candidates
    from public.charges c
   where c.status = 'pago'
     and c.appointment_id is not null
     and c.amount_cents > 0
     and (p_tenant_id is null or c.tenant_id = p_tenant_id)
     and not exists (
       select 1
         from public.appointment_payments p
        where p.tenant_id = c.tenant_id
          and p.charge_id = c.id
     );

  select count(*)
    into v_skipped_invalid
    from public.charges c
   where c.status = 'pago'
     and c.appointment_id is not null
     and c.amount_cents <= 0
     and (p_tenant_id is null or c.tenant_id = p_tenant_id)
     and not exists (
       select 1
         from public.appointment_payments p
        where p.tenant_id = c.tenant_id
          and p.charge_id = c.id
     );

  with inseridas as (
    insert into public.appointment_payments (
      tenant_id, appointment_id, charge_id, method, amount_cents, tip_cents,
      source, received_at, received_by, idempotency_key, line_index
    )
    select
      c.tenant_id,
      c.appointment_id,
      c.id,
      'pix_sistema',
      c.amount_cents,
      0,
      'asaas',
      coalesce(c.paid_at, c.created_at),
      null,
      null,
      0
    from public.charges c
    where c.status = 'pago'
      and c.appointment_id is not null
      and c.amount_cents > 0
      and (p_tenant_id is null or c.tenant_id = p_tenant_id)
      and not exists (
        select 1
          from public.appointment_payments p
         where p.tenant_id = c.tenant_id
           and p.charge_id = c.id
      )
    on conflict (tenant_id, charge_id) where charge_id is not null do nothing
    returning 1
  )
  select count(*) into v_inserted from inseridas;

  select count(*)
    into v_missing_after
    from public.charges c
   where c.status = 'pago'
     and c.appointment_id is not null
     and c.amount_cents > 0
     and (p_tenant_id is null or c.tenant_id = p_tenant_id)
     and not exists (
       select 1
         from public.appointment_payments p
        where p.tenant_id = c.tenant_id
          and p.charge_id = c.id
     );

  if v_missing_after > 0 then
    raise exception 'BACKFILL_COUNT_MISMATCH' using errcode = 'PT500';
  end if;

  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (
    p_tenant_id,
    null,
    'appointment_payments_backfill_reconciled',
    null,
    null,
    jsonb_build_object(
      'candidates', v_candidates,
      'inserted', v_inserted,
      'missing_after', v_missing_after,
      'skipped_invalid_amount', v_skipped_invalid
    )
  );

  return jsonb_build_object(
    'candidates', v_candidates,
    'inserted', v_inserted,
    'missing_after', v_missing_after,
    'skipped_invalid_amount', v_skipped_invalid
  );
end;
$$;

revoke execute on function public.reconcile_appointment_payments_backfill(uuid)
  from public, anon, authenticated;
grant execute on function public.reconcile_appointment_payments_backfill(uuid)
  to service_role;

comment on function public.reconcile_appointment_payments_backfill(uuid) is
  'ADR-003: cutover idempotente de cobranças pagas sem recebimento; service_role only.';

-- Aplicar a migration É o primeiro backfill do cutover; reexecutar é seguro.
select public.reconcile_appointment_payments_backfill();
