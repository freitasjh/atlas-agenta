-- Migration: H3 Fase 2 fixes (v1.4 RF-01 + RF-12) — 2 correções provadas no H3 full.
--
-- Causa raiz (1) — ficha 403: a policy `clinical_records_insert` (ADR-06, Fase 1b)
-- só aceitava atendimento em ('em_atendimento','concluido'). O fluxo H3 cria o
-- agendamento via UI (status `pendente`) e abre prontuário/anamnese ANTES de iniciar
-- o atendimento -> PostgREST sem tenant_id no body (defaults corretos do banco)
-- caía no WITH CHECK e voltava 403 (42501) para o admin. v1.4 RF-01 redefine o
-- elegível: ficha/evolução em qualquer status NÃO-final
-- (pendente/confirmado/em_atendimento/concluido). Só cancelado e nao_compareceu
-- (sem cuidado, sem ficha) seguem recusando. RBAC intocado: recepção e
-- super_admin seguem sem nenhum ramo; tenant sempre de current_tenant_id().
--
-- Causa raiz (2) — baixa 0/5: `appointments.package_credit_id` nunca é preenchido
-- pela UI (create/update não enviam a coluna), então o bloco de baixa da
-- 20261116000000 só disparava com vínculo manual e o concluir H3 nunca consumia.
-- RF-12: ao entrar em `concluido` SEM vínculo, o trigger auto-vincula o melhor
-- crédito válido (mesmo tenant+cliente+serviço, status active, não vencido, com
-- saldo, FIFO por vencimento) e baixa 1 no MESMO commit, gravando o vínculo na
-- linha (auditoria de qual crédito consumiu). Sem crédito válido, o concluir
-- segue avulso (não falha: o cuidado aconteceu; a cobrança é outra trilha).
-- Cancelado/nao_compareceu: nada (sem estorno, sem vínculo). Vínculo explícito:
-- comportamento intocado.
--
-- Escopo: NOVA migration (nenhuma aplicada é editada). Recria a policy de insert
-- da ficha (drop+create, resto byte-idêntico à ADR-06) e a máquina de estados
-- (create or replace PRESERVANDO o corpo vigente da 20261116000000 + bloco de
-- auto-vínculo). Sem security definer novo; sem grant novo; sem segredo.
-- Idempotente no re-apply (drop if exists / or replace). `db reset` 2x verde.

-- ============================================================================
-- 1) Ficha: elegível = qualquer status não-final (v1.4 RF-01).
-- ============================================================================
drop policy if exists clinical_records_insert on clinical_records;
create policy clinical_records_insert on clinical_records for insert
  with check (
    tenant_id = current_tenant_id()
    and created_by = auth.uid()
    and created_at = now()
    and appointment_id in (
      select a.id from appointments a
      where a.tenant_id = current_tenant_id()
        and (
          current_role_name() = 'admin'
          or (
            current_role_name() = 'professional'
            and a.professional_id in (
              select p.id from professionals p
              where p.tenant_id = current_tenant_id()
                and p.profile_id = auth.uid()
                and p.active = true
            )
          )
        )
    )
    and exists (
      select 1 from appointments a
      where a.id = clinical_records.appointment_id
        and a.tenant_id = current_tenant_id()
        -- v1.4 RF-01: a ficha acompanha o cuidado (anamnese antes de iniciar,
        -- evolução durante/depois). Só estados finais sem cuidado recusam.
        and a.status in ('pendente', 'confirmado', 'em_atendimento', 'concluido')
    )
    and exists (
      select 1 from tenants t
      where t.id = current_tenant_id()
        and t.subscription_status not in ('bloqueado', 'cancelado')
    )
  );

-- ============================================================================
-- 2) Concluir sem vínculo: auto-vincula o melhor crédito válido e baixa 1
-- (RF-12). Corpo vigente da 20261116000000 preservado; único acréscimo.
-- ============================================================================
create or replace function public.appointments_validate_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_auto_credit uuid;
begin
  -- Sem mudança de estado: UPDATE de outros campos (ex.: corrigir starts_at) passa sem a guarda.
  if new.status = old.status then
    return new;
  end if;

  -- Estados finais são imutáveis: nenhuma saída é permitida.
  if old.status in ('concluido','cancelado','nao_compareceu') then
    raise exception 'Transicao de status invalida: % e um estado final e nao pode mudar para %',
      old.status, new.status
      using errcode = 'check_violation';
  end if;

  -- Transições permitidas a partir de cada estado não-final (ver diagrama no cabeçalho).
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

  -- Efeito colateral (P1): ao entrar em 'confirmado', carimbar confirmed_at uma única vez.
  if new.status = 'confirmado' and new.confirmed_at is null then
    new.confirmed_at := now();
  end if;

  -- Efeito colateral (Fase 1b, ADR-03): comissão snapshot sobre commission_base_cents (G1).
  if new.status = 'concluido' and old.status <> 'concluido' then
    insert into appointment_commissions
      (tenant_id, appointment_id, professional_id, base_cents, commission_pct, commission_cents)
    select
      new.tenant_id, new.id, new.professional_id, new.commission_base_cents,
      coalesce(pc.commission_pct, 0),
      round( (new.commission_base_cents * coalesce(pc.commission_pct, 0)) / 100.0 )::int
    from (select 1) dummy
    left join professional_commissions pc
      on pc.tenant_id = new.tenant_id and pc.professional_id = new.professional_id
    on conflict (tenant_id, appointment_id) do nothing;
  end if;

  -- ==========================================================================
  -- Efeito colateral (Fase 2, ADR-02 + v1.4 RF-12): ao ENTRAR em 'concluido',
  -- baixa 1 sessão no MESMO commit. Vínculo explícito: consome direto
  -- (comportamento da 20261116000000, intocado). Sem vínculo: auto-vincula o
  -- melhor crédito válido do mesmo cliente+serviço (FIFO por vencimento) e
  -- consome; sem crédito válido, o concluir segue avulso. Cancelado não passa
  -- aqui: sem estorno e sem vínculo. Comissão acima é intocada (preço cheio).
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
