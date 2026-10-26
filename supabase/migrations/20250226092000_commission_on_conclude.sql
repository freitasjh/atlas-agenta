-- Migration: apuração da comissão no gancho de 'concluido' (trigger idempotente) — ADR-03 Fase 1b
-- Ao transitar em_atendimento -> concluido, o sistema apura e persiste a comissão (RF-C2) como um
-- snapshot imutável em appointment_commissions (ADR-02). Fato verificado no código (nota brain
-- gancho-concluido-appointment-nao-implementado): o gancho de 'concluido' NUNCA foi implementado —
-- existia só como comentário em 20250219093000_appointments_state_machine.sql. O único efeito
-- colateral real hoje é o carimbo de confirmed_at ao entrar em 'confirmado'. A tabela charges nem
-- existe. Logo, a apuração de comissão é o PRIMEIRO efeito colateral de domínio real do 'concluido'
-- — código novo num ponto sensível da máquina de estados, não extensão de algo existente.
--
-- Por que recriar a função (não um trigger separado) — RNF-C5:
--   Esta migration RECRIA appointments_validate_transition() com `create or replace`, PRESERVANDO
--   INTEGRALMENTE o corpo atual (early-return de "sem mudança de estado"; guarda de estados finais
--   com errcode check_violation; mapa de transições permitidas; carimbo idempotente de
--   confirmed_at; e o bloco de comentário dos ganchos de fases seguintes PIX/WhatsApp). O único
--   acréscimo é o bloco de apuração de comissão, inserido APÓS o carimbo de confirmed_at e ANTES
--   do comentário dos ganchos futuros. A máquina de estados (transições + carimbo) não muda.
--
-- Segurança / fronteiras (prd.md §4 / analysis-data §2, §6):
--   * A função NÃO é `security definer` (toca só a própria linha + insere comissão no contexto do
--     usuário que concluiu — menor superfície, sem elevação de privilégio). O INSERT da comissão
--     roda sob a RLS do usuário: a policy de INSERT de appointment_commissions (ADR-02) permite
--     escrita por tenant a qualquer papel que possa concluir (admin/receptionist/professional), com
--     WITH CHECK confinando ao tenant. O tenant_id vem de new.tenant_id, já preso pela RLS do
--     appointment -> escrita cross-tenant impossível (RNF-C1).
--   * Sigilo financeiro é na LEITURA: receptionist participa do INSERT ao concluir, mas não lê a
--     comissão de volta (sem policy de SELECT na ADR-02) — RNF-C2.
--   * segment NÃO entra em nenhuma cláusula: a comissão existe independentemente do ramo; o gating
--     por barbearia é só de UI (frontend). A trava é tenant_id/professional_id.
--
-- Arredondamento half-up determinístico (prd.md §7 D-5, RNF-C3):
--   round((base_cents * commission_pct) / 100.0)::int, com a MULTIPLICAÇÃO em `numeric` EXATO antes
--   do ::int (price_cents é int, commission_pct é numeric(5,2) -> produto numeric; a divisão por
--   100.0 mantém numeric; round half-up; ::int só no fim). Nunca float em dinheiro.
--   Ex.: 4500 * 30.00 / 100 = 1350.00 -> 1350 ; 4500 * 33.33 / 100 = 1499.85 -> 1500.
--
-- Idempotência (prd.md §4, RF-C3 — inegociável): concluir o mesmo atendimento não duplica comissão.
--   Três camadas: (1) a máquina de estados torna 'concluido' final (transição de saída barrada);
--   (2) índice único (tenant_id, appointment_id) em appointment_commissions (ADR-02);
--   (3) `on conflict (tenant_id, appointment_id) do nothing` no INSERT abaixo.
--   O left join + coalesce garante que profissional SEM taxa cadastrada apura 0 (não pula a linha).
--
-- Idempotente no re-apply: `create or replace function` + `drop trigger if exists` antes do
-- `create trigger`, mantendo evento/assinatura idênticos ao trigger atual. `supabase db reset` deve
-- terminar com exit 0 duas vezes seguidas, sem duplicar objetos. Nenhum segredo no SQL. Role de app
-- (authenticated) sem BYPASSRLS. Última migration aplicada da fatia: 20250226091000
-- (appointment_commissions) -> próximo livre 20250226092000.

-- ============================================================================
-- appointments_validate_transition — guarda de transição da máquina de estados.
-- Roda BEFORE UPDATE OF status: compara OLD.status com NEW.status e barra transições fora do
-- diagrama; carimba confirmed_at ao entrar em 'confirmado'; apura a comissão ao entrar em
-- 'concluido' (acréscimo desta ADR). Corpo preservado da migration 20250219093000.
-- ============================================================================
create or replace function appointments_validate_transition()
returns trigger
language plpgsql
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
  --   * base_cents    = new.price_cents (snapshot do preço no ato do agendamento);
  --   * commission_pct = taxa vigente do profissional (professional_commissions), 0 se não houver;
  --   * commission_cents = round((base_cents * commission_pct) / 100.0)::int (half-up, numeric exato);
  --   * on conflict (tenant_id, appointment_id) do nothing -> concluir de novo não duplica (RF-C3).
  -- left join + coalesce: profissional sem taxa cadastrada apura 0, nunca pula a inserção (RF-C2).
  -- Roda no contexto do usuário (não security definer): a RLS de INSERT da ADR-02 confina ao tenant.
  if new.status = 'concluido' and old.status <> 'concluido' then
    insert into appointment_commissions
      (tenant_id, appointment_id, professional_id, base_cents, commission_pct, commission_cents)
    select
      new.tenant_id, new.id, new.professional_id, new.price_cents,
      coalesce(pc.commission_pct, 0),
      round( (new.price_cents * coalesce(pc.commission_pct, 0)) / 100.0 )::int
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
-- status não pagam o custo da função. Evento/assinatura idênticos ao trigger da 20250219093000.
drop trigger if exists appointments_transition_guard on appointments;
create trigger appointments_transition_guard
  before update of status on appointments
  for each row
  execute function appointments_validate_transition();
