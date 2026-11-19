-- ============================================================================
-- G1 (Fase 0, roadmap-oficial-v1.md §5) — comissão é snapshot do preço do agendamento.
--
-- Causa raiz: o gancho de `concluido` (20250226092000_commission_on_conclude.sql)
-- apurava a comissão com `new.price_cents` NO MOMENTO DA CONCLUSÃO. O comentário dizia
-- "snapshot do preço no ato do agendamento", mas o código não era um snapshot: se o preço
-- mudasse entre agendar e concluir (correção, desconto, erro de lançamento), a comissão
-- usava o preço novo.
--
-- Solução adotada (opção (a) do TASKS): coluna imutável `commission_base_cents` gravada
-- no INSERT do agendamento (derivada de `price_cents`) e lida pelo trigger de conclusão.
--   * Por que (a) e não (b) bloquear `price_cents`: a opção (a) preserva a semântica de
--     snapshot sem proibir correções operacionais de preço antes da conclusão — a comissão
--     continua atrelada ao preço cobrado no ato do agendamento, que é o fato econômico.
--     Bloquear o UPDATE (b) exigiria impedir qualquer correção de preço, inclusive as
--     legítimas (erro de lançamento), e não protegeria agendamentos já existentes.
--   * Backfill: agendamentos existentes preferem o ledger de comissão
--     (`appointment_commissions.base_cents`, o valor efetivamente apurado no
--     `concluido`) e caem para `price_cents` quando não há comissão apurada.
--     Motivo: se o preço mudou antes da conclusão, o ledger guarda a base que foi
--     usada no pagamento — manter o snapshot consistente com o que já foi apurado.
--
-- Imutabilidade: `appointments_freeze_commission_base` barra UPDATE da coluna depois do
-- INSERT (o snapshot é travado no ato). O INSERT sempre deriva de `price_cents` — o cliente
-- não fornece a base. Trava é `before update of commission_base_cents` (só dispara quando a
-- coluna entra no SET), então UPDATEs de status/campos não pagam custo extra.
--
-- Idempotente no re-apply: `add column if not exists`, backfill com `where ... is null`,
-- `create or replace function` e `drop trigger if exists` antes de cada `create trigger`.
-- `db reset` re-executável. Não toca RLS, policies, ledger, charges nem na tabela de
-- comissão (o snapshot de apuração `appointment_commissions` segue imutável). Nenhum segredo.
-- ============================================================================

-- 1) Coluna snapshot + backfill + NOT NULL.
alter table public.appointments
  add column if not exists commission_base_cents int
  check (commission_base_cents >= 0);

update public.appointments a
   set commission_base_cents = coalesce(
     (select c.base_cents from public.appointment_commissions c
       where c.tenant_id = a.tenant_id and c.appointment_id = a.id),
     a.price_cents
   )
 where a.commission_base_cents is null;

alter table public.appointments
  alter column commission_base_cents set not null;

-- 2) Grava o snapshot no INSERT (derivado de price_cents; nunca do cliente).
create or replace function public.appointments_set_commission_base()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.commission_base_cents := new.price_cents;
  return new;
end;
$$;

drop trigger if exists appointments_set_commission_base on public.appointments;
create trigger appointments_set_commission_base
  before insert on public.appointments
  for each row
  execute function public.appointments_set_commission_base();

-- 3) Trava o snapshot após o agendamento (sem update/delete do snapshot).
create or replace function public.appointments_freeze_commission_base()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.commission_base_cents is distinct from old.commission_base_cents then
    raise exception 'commission_base_cents e imutavel apos o agendamento'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_freeze_commission_base on public.appointments;
create trigger appointments_freeze_commission_base
  before update of commission_base_cents on public.appointments
  for each row
  execute function public.appointments_freeze_commission_base();

-- 4) Recria a máquina de estados preservando o corpo e trocando a base da comissão.
--    Único acréscimo: `new.price_cents` -> `new.commission_base_cents` no INSERT da comissão.
create or replace function public.appointments_validate_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
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

  -- ==========================================================================
  -- Efeito colateral (Fase 1b, ADR-03): ao ENTRAR em 'concluido', apurar e persistir a comissão
  -- como snapshot imutável em appointment_commissions (RF-C2). Determinístico e idempotente:
  --   * base_cents    = new.commission_base_cents (snapshot do preço no ato do agendamento,
  --                     gravado no INSERT e travado por trigger — G1/Fase 0);
  --   * commission_pct = taxa vigente do profissional (professional_commissions), 0 se não houver;
  --   * commission_cents = round((base_cents * commission_pct) / 100.0)::int (half-up, numeric exato);
  --   * on conflict (tenant_id, appointment_id) do nothing -> concluir de novo não duplica (RF-C3).
  -- left join + coalesce: profissional sem taxa cadastrada apura 0, nunca pula a inserção (RF-C2).
  -- Roda no contexto do usuário (não security definer): a RLS de INSERT da ADR-02 confina ao tenant.
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
  -- GANCHOS DE FASES SEGUINTES (apenas documentação; NÃO implementar aqui):
  --   - Ao entrar em 'concluido': disparar geração de cobrança PIX (RF13, skill asaas-pix) e a
  --     mensagem de cobrança via WhatsApp. Fará parte da fase financeira (tabela `charges` +
  --     Edge Function com service role). NENHUM código de integração neste trigger.
  --   - Ao entrar em 'confirmado': enfileirar mensagem de confirmação no WhatsApp (skill
  --     whatsapp-evolution, tabela `messages`). Também fase futura.
  -- O ponto de extensão natural é logo após o carimbo acima, mas o disparo de efeitos externos
  -- deve viver fora do caminho do UPDATE (fila/Edge Function), não dentro deste trigger.
  -- ==========================================================================

  return new;
end;
$$;

-- Trigger: dispara só quando a coluna `status` entra no SET do UPDATE — UPDATEs que não mexem em
-- status não pagam o custo da função. Evento/assinatura idênticos ao trigger da 20250226092000.
drop trigger if exists appointments_transition_guard on appointments;
create trigger appointments_transition_guard
  before update of status on appointments
  for each row
  execute function appointments_validate_transition();
