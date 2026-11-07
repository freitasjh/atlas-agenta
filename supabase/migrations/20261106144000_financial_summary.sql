-- Migration: ADR-005 — RPC `financial_summary` (resumo financeiro admin, caixa).
-- Aditiva e idempotente (create or replace + revoke/grant). Nenhuma migration já aplicada é editada.
--
-- Contrato (SPEC §2, congelado):
--   financial_summary(p_from timestamptz, p_to timestamptz) returns jsonb
--   security invoker, search_path = public, pg_temp, sem p_tenant_id.
--   tenant de current_tenant_id(); exige current_role_name() = 'admin' (PT403).
--   p_from/p_to obrigatórios, p_to > p_from, intervalo <= 366 dias (PT400).
--
-- Definições (fonte da verdade, ADR §1):
--   recebido serviço/gorjeta/total: ledger com voided_at null, received_at no intervalo.
--   a receber: snapshot de charges pendentes com asaas_payment_id, não expiradas.
--   em aberto: concluidos com starts_at no intervalo, price - paid - reserved.
--   by_method: 5 formas com zeros; nunca lê charges.status='pago' como receita.

create or replace function public.financial_summary(
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_service    int;
  v_tips       int;
  v_receivable int;
  v_open       int;
  v_methods    jsonb;
begin
  if current_role_name() is distinct from 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  if p_from is null or p_to is null
     or p_to <= p_from
     or (p_to - p_from) > interval '366 days' then
    raise exception 'INVALID_PERIOD' using errcode = 'PT400';
  end if;

  select coalesce(sum(p.amount_cents), 0)::int,
         coalesce(sum(p.tip_cents), 0)::int
    into v_service, v_tips
    from public.appointment_payments p
   where p.tenant_id = current_tenant_id()
     and p.voided_at is null
     and p.received_at >= p_from
     and p.received_at < p_to;

  select coalesce(jsonb_agg(m ORDER BY m.method), '[]'::jsonb)
    into v_methods
    from (
      select f.method,
             coalesce(s.amount_cents, 0)::int as amount_cents,
             coalesce(s.tip_cents, 0)::int as tip_cents,
             coalesce(s.count, 0)::int as count
        from (select unnest(ARRAY[
                 'dinheiro','cartao_credito','cartao_debito',
                 'pix_sistema','pix_maquininha'
               ]) as method) f
        left join (
          select p.method,
                 sum(p.amount_cents)::int as amount_cents,
                 sum(p.tip_cents)::int as tip_cents,
                 count(*)::int as count
            from public.appointment_payments p
           where p.tenant_id = current_tenant_id()
             and p.voided_at is null
             and p.received_at >= p_from
             and p.received_at < p_to
           group by p.method
        ) s on s.method = f.method
    ) m;

  select coalesce(sum(c.amount_cents), 0)::int
    into v_receivable
    from public.charges c
   where c.tenant_id = current_tenant_id()
     and c.status = 'pendente'
     and c.asaas_payment_id is not null
     and (c.expires_at is null or c.expires_at > now());

  select coalesce(sum(greatest(
           a.price_cents - coalesce(paid.paid_cents, 0) - coalesce(reserved.reserved_cents, 0),
           0
         )), 0)::int
    into v_open
    from public.appointments a
    left join lateral (
      select sum(p.amount_cents)::int as paid_cents
        from public.appointment_payments p
       where p.tenant_id = a.tenant_id
         and p.appointment_id = a.id
         and p.voided_at is null
    ) paid on true
    left join lateral (
      select sum(c.amount_cents)::int as reserved_cents
        from public.charges c
       where c.tenant_id = a.tenant_id
         and c.appointment_id = a.id
         and c.status = 'pendente'
         and c.asaas_payment_id is not null
         and (c.expires_at is null or c.expires_at > now())
    ) reserved on true
   where a.tenant_id = current_tenant_id()
     and a.status = 'concluido'
     and a.starts_at >= p_from
     and a.starts_at < p_to;

  return jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'received_service_cents', v_service,
    'received_tips_cents', v_tips,
    'received_total_cents', v_service + v_tips,
    'receivable_cents', v_receivable,
    'open_cents', v_open,
    'by_method', v_methods
  );
end;
$$;

revoke execute on function public.financial_summary(timestamptz, timestamptz)
  from public, anon;
grant execute on function public.financial_summary(timestamptz, timestamptz)
  to authenticated;

comment on function public.financial_summary(timestamptz, timestamptz) is
  'ADR-005: resumo financeiro admin (caixa do ledger + snapshot a receber + em aberto).';
