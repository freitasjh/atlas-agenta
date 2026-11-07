-- Migration: ADR-002 (adendo 2026-11-06) — leitura escopada de status de pagamento em lote.
-- Aditiva e idempotente. Nenhuma migration já aplicada é editada.
--
-- Entrega:
--   1. agenda_payment_statuses — status financeiro por atendimento, sem valores nem QR.
--
-- Regras comuns (SPEC §3.1):
--   * security invoker, search_path = public, pg_temp;
--   * execute revogado de public/anon/authenticated e concedido só a service_role;
--   * erros de domínio = SQLSTATE PT4xx com message apenas o código estável;
--   * nenhum grant novo em tabela;
--   * status calculado por appointment_payment_summary (mesma regra do settlement);
--   * recorte por tenant sempre explícito; profissional só os próprios atendimentos.
--
-- Recorte do profissional: `p_professional_id` sem dono comprovado não devolve linha alguma
-- (nem erro). O ator é provado por `professionals.profile_id = p_actor_id`, de modo que a
-- resposta para atendimento alheio é indistinguível da resposta para id inexistente.

-- Overload anterior (sem p_actor_id) sai antes do create: com defaults, duas assinaturas
-- tornariam a chamada de 3 argumentos ambígua.
drop function if exists public.agenda_payment_statuses(uuid, uuid[], uuid);

-- ============================================================================
-- 1) agenda_payment_statuses — rótulo de estado financeiro por atendimento.
--    Retorna apenas (appointment_id, payment_status); nunca valor, saldo, linha,
--    QR ou histórico. Ids inexistentes (ou de outro tenant) ficam fora do retorno.
-- ============================================================================
create or replace function public.agenda_payment_statuses(
  p_tenant_id uuid,
  p_appointment_ids uuid[],
  p_professional_id uuid default null,
  p_actor_id uuid default null
)
returns table (appointment_id uuid, payment_status text)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_tenant_id is null
     or p_appointment_ids is null
     or cardinality(p_appointment_ids) = 0
     or cardinality(p_appointment_ids) > 200 then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  -- Defesa em profundidade: o recorte por profissional só vale para o dono do vínculo.
  -- Sem dono comprovado (ou sem ator), a resposta é vazia — nunca um erro que revele
  -- existência de atendimento alheio.
  if p_professional_id is not null
     and not exists (
       select 1
         from public.professionals p
        where p.tenant_id = p_tenant_id
          and p.id = p_professional_id
          and p.profile_id = p_actor_id
     ) then
    return;
  end if;

  return query
  with requested as (
    -- Deduplica preservando a ordem da primeira ocorrência.
    select t.id, min(t.ord) as ord
      from unnest(p_appointment_ids) with ordinality as t(id, ord)
     where t.id is not null
     group by t.id
  )
  select a.id, s.summary ->> 'payment_status'
    from requested r
    join public.appointments a
      on a.tenant_id = p_tenant_id
     and a.id = r.id
     and (p_professional_id is null or a.professional_id = p_professional_id)
    cross join lateral (
      select public.appointment_payment_summary(p_tenant_id, a.id) as summary
    ) s
   where s.summary is not null
   order by r.ord;
end;
$$;

-- ============================================================================
-- 2) Grants: nenhuma função executável por public/anon/authenticated.
-- ============================================================================
revoke execute on function public.agenda_payment_statuses(uuid, uuid[], uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.agenda_payment_statuses(uuid, uuid[], uuid, uuid)
  to service_role;

comment on function public.agenda_payment_statuses(uuid, uuid[], uuid, uuid) is
  'ADR-002 (adendo): status financeiro por atendimento, sem valores/QR; reusa appointment_payment_summary.';
