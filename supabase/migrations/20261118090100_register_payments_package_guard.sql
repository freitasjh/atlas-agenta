-- Migration: guarda anti-dupla-cobrança em register_appointment_payments (review CHANGES_REQUIRED, 1 🔴).
--
-- Causa raiz: o auto-vínculo do trigger (20261118090000, RF-12) invalida os guards do
-- frontend que leem `appointments.package_credit_id` pré-concluir (sempre null na sessão
-- do pacote). Sequência: capture abre → registra pagamento/PIX → fecha → trigger
-- auto-vincula e consome → sessão do pacote + PIX novo = cliente paga 2x.
--
-- Correção (defesa em profundidade, parte 1/3 — servidor): `register_appointment_payments`
-- recusa lote com `p_payments` não-vazio quando existe crédito válido (mesmo
-- tenant+cliente+serviço, `active`, `expires_at > now()`, com saldo) — novo erro tipado
-- `PACKAGE_CREDIT_AVAILABLE` (PT409). Só o servidor fecha a race.
--
-- Completa o caminho do pacote pela RPC: `package_consume` derivava o tenant SÓ do JWT
-- (`current_tenant_id()`), então concluir via Edge (service_role, sem JWT — ex.:
-- capture "registrar depois" com lote vazio) abortava com 42501 mesmo com crédito
-- válido. A rotina agora usa o tenant do JWT quando presente (autenticado, inalterado)
-- e cai para o tenant da linha do atendimento quando ausente (serviço/definer, sem
-- RLS) — sem mudança de privilégio: autenticado nunca cai no fallback.
--
-- Regras preservadas:
--   - lote vazio + `close=true` é o caminho do pacote (trigger consome no concluir)
--     e segue permitido;
--   - replay idempotente (bloco de retorno antecipado acima) não escreve nada e segue
--     permitido — a guarda vive DEPOIS do retorno do replay;
--   - sem crédito válido (só vencido/esgotado/outro serviço), o lote segue avulso.
--
-- Escopo: NOVA migration (nenhuma aplicada é editada). Recria
-- `register_appointment_payments` com `create or replace` PRESERVANDO o corpo vigente da
-- 20261106132000 (§7b colisão de chave em charges) + bloco da guarda, e
-- `package_consume` com fallback de tenant para contexto de serviço. Sem security
-- definer novo; sem grant novo; sem segredo; sem PII em mensagem (código fixo).
-- Idempotente no re-apply (or replace). `db reset` 2x verde.

-- ============================================================================
-- 0) package_consume: fallback de tenant para contexto de serviço (sem JWT).
-- Corpo idêntico ao da 20261116000000, exceto a derivação do tenant.
-- ============================================================================
create or replace function public.package_consume(p_credit_id uuid, p_appointment_id uuid, p_skip_status_check boolean default false)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant    uuid;
  v_credit    public.package_credits%rowtype;
  v_customer  uuid;
  v_service   uuid;
  v_status    text;
begin
  v_tenant := current_tenant_id();
  if v_tenant is null then
    -- Contexto de serviço (Edge service_role, sem JWT — ex.: concluir via
    -- register_appointment_payments): deriva o tenant da linha do atendimento
    -- (SECURITY DEFINER, sem RLS). Chamadas autenticadas sempre têm JWT e nunca
    -- caem aqui — o tenant do JWT segue autoritativo, sem mudança de privilégio.
    select a.tenant_id into v_tenant
      from public.appointments a
     where a.id = p_appointment_id;
  end if;
  if v_tenant is null then
    raise exception 'package consume requires authenticated tenant context'
      using errcode = '42501';
  end if;

  -- Só o trigger (profundidade > 0) pode usar skip=true; chamada direta com
  -- skip=true seria bypass de papel + status check (recepção pula o gate).
  if coalesce(p_skip_status_check, false) and pg_trigger_depth() = 0 then
    raise exception 'PACKAGE_REDEEM_DENIED'
      using errcode = '42501';
  end if;

  -- Gate interno da via direta: o trigger passa p_skip_status_check=true e segue
  -- sem gate (efeito automático do concluir); chamada direta exige admin/professional.
  if not coalesce(p_skip_status_check, false) and coalesce(current_role_name(), '__none') not in ('admin','professional') then
    raise exception 'PACKAGE_REDEEM_DENIED'
      using errcode = '42501';
  end if;

  select a.customer_id, a.service_id, a.status
    into v_customer, v_service, v_status
    from public.appointments a
   where a.tenant_id = v_tenant and a.id = p_appointment_id;
  if not found then
    raise exception 'PACKAGE_APPOINTMENT_NOT_FOUND'
      using errcode = 'P0001';
  end if;
  if not coalesce(p_skip_status_check, false) and v_status <> 'concluido' then
    raise exception 'PACKAGE_APPOINTMENT_NOT_CONCLUDED'
      using errcode = 'P0001';
  end if;

  select * into v_credit
    from public.package_credits c
   where c.tenant_id = v_tenant and c.id = p_credit_id
   for update;
  if not found then
    raise exception 'PACKAGE_CREDIT_NOT_FOUND'
      using errcode = 'P0001';
  end if;
  if v_credit.customer_id <> v_customer or v_credit.service_id <> v_service then
    raise exception 'PACKAGE_CREDIT_MISMATCH'
      using errcode = 'P0001';
  end if;
  if v_credit.expires_at <= now() then
    raise exception 'PACKAGE_CREDIT_EXPIRED'
      using errcode = 'P0001';
  end if;
  if v_credit.used_sessions >= v_credit.total_sessions then
    raise exception 'PACKAGE_CREDIT_EXHAUSTED'
      using errcode = 'P0001';
  end if;

  update public.package_credits
     set used_sessions = used_sessions + 1,
         status = case
                    when used_sessions + 1 >= total_sessions then 'exhausted'
                    else status
                  end
   where tenant_id = v_tenant and id = p_credit_id;
end;
$$;

revoke all on function public.package_consume(uuid, uuid, boolean) from public, anon;
grant execute on function public.package_consume(uuid, uuid, boolean) to authenticated, service_role;

create or replace function public.register_appointment_payments(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_appointment_id uuid,
  p_payments jsonb,
  p_idempotency_key uuid,
  p_close_appointment boolean default true
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_actor_role        text;
  v_actor_active      boolean;
  v_appt              public.appointments%rowtype;
  v_item              jsonb;
  v_method            text;
  v_amount            int;
  v_tip               int;
  v_count             int := 0;
  v_pix_count         int := 0;
  v_pix_intent        int := 0;
  v_manual_sum        int := 0;
  v_signature         text;
  v_pending           public.charges%rowtype;
  v_has_pending       boolean := false;
  v_price             int;
  v_paid              int;
  v_reserved          int;
  v_pix_for_balance   int := 0;
  v_existing_count    int;
  v_existing_sig      text;
  v_replay            boolean := false;
  v_appointment_status text;
  v_summary           jsonb;
  v_lines             jsonb;
  v_rec               record;
begin
  -- 1) Parâmetros e forma do array.
  if p_tenant_id is null or p_actor_id is null or p_appointment_id is null
     or p_idempotency_key is null or p_payments is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  if jsonb_typeof(p_payments) <> 'array' then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  if jsonb_array_length(p_payments) > 10 then
    raise exception 'INVALID_AMOUNT' using errcode = 'PT400';
  end if;

  -- 2) Ator ativo no tenant com papel operacional.
  select pr.role, pr.active
    into v_actor_role, v_actor_active
    from public.profiles pr
   where pr.id = p_actor_id
     and pr.tenant_id = p_tenant_id;

  if not found
     or v_actor_active is not true
     or v_actor_role not in ('admin', 'receptionist', 'professional') then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  -- 3) Validação dos itens do lote.
  for v_item in select value from jsonb_array_elements(p_payments) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'INVALID_BODY' using errcode = 'PT400';
    end if;

    if (v_item - 'method' - 'amount_cents' - 'tip_cents') <> '{}'::jsonb then
      raise exception 'INVALID_BODY' using errcode = 'PT400';
    end if;

    if not (v_item ? 'method') or not (v_item ? 'amount_cents') then
      raise exception 'INVALID_BODY' using errcode = 'PT400';
    end if;

    v_method := v_item ->> 'method';
    if v_method not in (
      'dinheiro', 'cartao_credito', 'cartao_debito', 'pix_sistema', 'pix_maquininha'
    ) then
      raise exception 'INVALID_METHOD' using errcode = 'PT400';
    end if;

    if jsonb_typeof(v_item -> 'amount_cents') <> 'number' then
      raise exception 'INVALID_AMOUNT' using errcode = 'PT400';
    end if;

    if (v_item ->> 'amount_cents')::numeric <> trunc((v_item ->> 'amount_cents')::numeric)
       or (v_item ->> 'amount_cents')::numeric <= 0
       or (v_item ->> 'amount_cents')::numeric > 2147483647 then
      raise exception 'INVALID_AMOUNT' using errcode = 'PT400';
    end if;
    v_amount := (v_item ->> 'amount_cents')::int;

    if v_item ? 'tip_cents' then
      if jsonb_typeof(v_item -> 'tip_cents') <> 'number' then
        raise exception 'INVALID_AMOUNT' using errcode = 'PT400';
      end if;

      if (v_item ->> 'tip_cents')::numeric <> trunc((v_item ->> 'tip_cents')::numeric)
         or (v_item ->> 'tip_cents')::numeric < 0
         or (v_item ->> 'tip_cents')::numeric > 2147483647 then
        raise exception 'INVALID_AMOUNT' using errcode = 'PT400';
      end if;
      v_tip := (v_item ->> 'tip_cents')::int;
    else
      v_tip := 0;
    end if;

    if v_method = 'pix_sistema' then
      v_pix_count := v_pix_count + 1;
      if v_pix_count > 1 then
        raise exception 'INVALID_AMOUNT' using errcode = 'PT400';
      end if;
      v_pix_intent := v_amount;
    else
      v_count := v_count + 1;
      v_manual_sum := v_manual_sum + v_amount;
    end if;
  end loop;

  -- 4) Array vazio só é válido concluindo o atendimento.
  if jsonb_array_length(p_payments) = 0 and p_close_appointment is not true then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  -- Assinatura canônica do lote (hash; nunca o payload).
  select md5(jsonb_build_object(
           'v', 1,
           'close', (p_close_appointment is true),
           'pix', coalesce(v_pix_intent, 0),
           'items', (
             select jsonb_agg(
                      jsonb_build_array(
                        e.value ->> 'method',
                        (e.value ->> 'amount_cents')::int,
                        coalesce((e.value ->> 'tip_cents')::int, 0)
                      )
                      order by e.value ->> 'method',
                               (e.value ->> 'amount_cents')::int,
                               coalesce((e.value ->> 'tip_cents')::int, 0)
                    )
               from jsonb_array_elements(p_payments) e
              where e.value ->> 'method' <> 'pix_sistema'
           )
         )::text)
    into v_signature;

  -- 5) Lock do atendimento.
  select *
    into v_appt
    from public.appointments
   where tenant_id = p_tenant_id
     and id = p_appointment_id
     for update;

  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = 'PT404';
  end if;

  -- 6) Profissional só o próprio atendimento.
  if v_actor_role = 'professional'
     and not exists (
       select 1 from public.professionals p
        where p.tenant_id = p_tenant_id
          and p.id = v_appt.professional_id
          and p.profile_id = p_actor_id
     ) then
    raise exception 'PROFESSIONAL_NOT_OWNER' using errcode = 'PT403';
  end if;

  -- 7) Estados aceitos.
  if v_appt.status not in ('em_atendimento', 'concluido') then
    raise exception 'APPOINTMENT_INVALID_STATE' using errcode = 'PT409';
  end if;

  if v_appt.status = 'em_atendimento' and p_close_appointment is not true then
    raise exception 'APPOINTMENT_INVALID_STATE' using errcode = 'PT409';
  end if;

  -- 7b) Colisão de idempotency_key em charges de OUTRO atendimento:
  --     falha antes de qualquer INSERT (nada é escrito).
  if exists (
    select 1 from public.charges c
     where c.tenant_id = p_tenant_id
       and c.idempotency_key = p_idempotency_key
       and c.appointment_id is distinct from p_appointment_id
  ) then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'PT409';
  end if;

  -- Cobrança pendente do atendimento (para PIX e saldo).
  select *
    into v_pending
    from public.charges c
   where c.tenant_id = p_tenant_id
     and c.appointment_id = p_appointment_id
     and c.status = 'pendente'
     and (c.expires_at is null or c.expires_at > now())
   order by c.created_at desc
   limit 1;
  v_has_pending := found;

  -- 8) Idempotência por lote.
  if exists (
    select 1 from public.appointment_payments p
     where p.tenant_id = p_tenant_id
       and p.idempotency_key = p_idempotency_key
       and p.appointment_id <> p_appointment_id
  ) then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'PT409';
  end if;

  select count(*), min(p.lote_signature)
    into v_existing_count, v_existing_sig
    from public.appointment_payments p
   where p.tenant_id = p_tenant_id
     and p.appointment_id = p_appointment_id
     and p.idempotency_key = p_idempotency_key;

  if v_existing_count > 0 then
    if v_existing_count <> v_count or v_existing_sig is distinct from v_signature then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'PT409';
    end if;
    v_replay := true;
  end if;

  if v_replay then
    select coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'id', p.id,
                 'method', p.method,
                 'amount_cents', p.amount_cents,
                 'tip_cents', p.tip_cents,
                 'source', p.source
               )
               order by p.line_index
             ),
             '[]'::jsonb
           )
      into v_lines
      from public.appointment_payments p
     where p.tenant_id = p_tenant_id
       and p.appointment_id = p_appointment_id
       and p.idempotency_key = p_idempotency_key;

    v_summary := public.appointment_payment_summary(p_tenant_id, p_appointment_id);
    return jsonb_build_object(
      'appointment_id', p_appointment_id,
      'appointment_status', v_appt.status,
      'payments', v_lines,
      'total_paid_cents', coalesce((v_summary ->> 'total_paid_cents')::int, 0),
      'tip_cents', coalesce((v_summary ->> 'tip_cents')::int, 0),
      'reserved_cents', coalesce((v_summary ->> 'reserved_cents')::int, 0),
      'remaining_cents', coalesce((v_summary ->> 'remaining_cents')::int, 0),
      'payment_status', v_summary ->> 'payment_status',
      'pix_amount_cents', coalesce(v_pix_intent, 0),
      'pix_already_pending', v_has_pending,
      'replayed', true
    );
  end if;

  -- Concluído + close=true sem replay => já concluído (D-08).
  if v_appt.status = 'concluido' and p_close_appointment is true then
    raise exception 'APPOINTMENT_ALREADY_CONCLUDED' using errcode = 'PT409';
  end if;

  -- 8a) Pacote válido recusa lote com pagamento (anti-dupla-cobrança).
  --     O auto-vínculo do trigger (RF-12) invalida os guards do frontend que leem
  --     `package_credit_id` pré-concluir (sempre null na sessão do pacote): só o
  --     servidor fecha a race, sob o lock do atendimento. Lote vazio + close=true
  --     é o caminho do pacote (o trigger consome no concluir) e segue permitido;
  --     replay já retornou acima sem escrever. Sem crédito válido (só vencido,
  --     esgotado ou de outro serviço), o lote segue avulso.
  if jsonb_array_length(p_payments) > 0
     and v_appt.customer_id is not null
     and v_appt.service_id is not null
     and exists (
       select 1 from public.package_credits c
        where c.tenant_id = p_tenant_id
          and c.customer_id = v_appt.customer_id
          and c.service_id = v_appt.service_id
          and c.status = 'active'
          and c.expires_at > now()
          and c.used_sessions < c.total_sessions
     ) then
    raise exception 'PACKAGE_CREDIT_AVAILABLE' using errcode = 'PT409';
  end if;

  -- 9) PIX: valor divergente de cobrança pendente é conflito.
  if v_pix_count = 1 and v_has_pending and v_pending.amount_cents <> v_pix_intent then
    raise exception 'PENDING_CHARGE_EXISTS' using errcode = 'PT409';
  end if;
  if v_pix_count = 1 and not v_has_pending then
    v_pix_for_balance := v_pix_intent;
  end if;

  -- 10) Saldo calculado sob o lock, com o summary como fonte única.
  v_summary := public.appointment_payment_summary(p_tenant_id, p_appointment_id);
  v_price := coalesce((v_summary ->> 'price_cents')::int, 0);
  v_paid := coalesce((v_summary ->> 'total_paid_cents')::int, 0);
  v_reserved := coalesce((v_summary ->> 'reserved_cents')::int, 0);

  if v_paid + v_reserved + v_manual_sum + v_pix_for_balance > v_price then
    raise exception 'AMOUNT_EXCEEDS_REMAINING' using errcode = 'PT409';
  end if;

  -- 11) Linhas não-PIX no mesmo commit da conclusão.
  if v_count > 0 then
    insert into public.appointment_payments (
      tenant_id, appointment_id, method, amount_cents, tip_cents, source,
      idempotency_key, line_index, received_at, received_by, lote_signature
    )
    select
      p_tenant_id,
      p_appointment_id,
      e.value ->> 'method',
      (e.value ->> 'amount_cents')::int,
      coalesce((e.value ->> 'tip_cents')::int, 0),
      'manual',
      p_idempotency_key,
      (e.ordinality - 1)::smallint,
      now(),
      p_actor_id,
      v_signature
    from jsonb_array_elements(p_payments) with ordinality as e(value, ordinality)
    where e.value ->> 'method' <> 'pix_sistema'
    on conflict (tenant_id, idempotency_key, line_index)
      where idempotency_key is not null do nothing;

    select count(*), min(p.lote_signature)
      into v_existing_count, v_existing_sig
      from public.appointment_payments p
     where p.tenant_id = p_tenant_id
       and p.appointment_id = p_appointment_id
       and p.idempotency_key = p_idempotency_key;

    if v_existing_count <> v_count or v_existing_sig is distinct from v_signature then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'PT409';
    end if;
  end if;

  if p_close_appointment is true and v_appt.status = 'em_atendimento' then
    update public.appointments
       set status = 'concluido'
     where tenant_id = p_tenant_id
       and id = p_appointment_id;
    v_appointment_status := 'concluido';
  else
    v_appointment_status := v_appt.status;
  end if;

  -- 12) Auditoria (uma linha por recebimento; sem PII).
  if v_count > 0 then
    for v_rec in
      select * from public.appointment_payments p
       where p.tenant_id = p_tenant_id
         and p.appointment_id = p_appointment_id
         and p.idempotency_key = p_idempotency_key
       order by p.line_index
    loop
      insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
      values (
        p_tenant_id, p_actor_id, 'payment_registered', 'appointment_payment', v_rec.id,
        jsonb_build_object(
          'appointment_id', p_appointment_id,
          'method', v_rec.method,
          'amount_cents', v_rec.amount_cents,
          'tip_cents', v_rec.tip_cents,
          'source', v_rec.source,
          'idempotency_key', p_idempotency_key
        )
      );
    end loop;
  end if;

  if jsonb_array_length(p_payments) = 0 and p_close_appointment is true then
    insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
    values (
      p_tenant_id, p_actor_id, 'appointment_concluded_without_payment',
      'appointment', p_appointment_id,
      jsonb_build_object(
        'appointment_id', p_appointment_id,
        'idempotency_key', p_idempotency_key
      )
    );
  end if;

  -- 13) Retorno congelado, com o summary recalculado após as escritas.
  v_summary := public.appointment_payment_summary(p_tenant_id, p_appointment_id);
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', p.id,
               'method', p.method,
               'amount_cents', p.amount_cents,
               'tip_cents', p.tip_cents,
               'source', p.source
             )
             order by p.line_index
           ),
           '[]'::jsonb
         )
    into v_lines
    from public.appointment_payments p
   where p.tenant_id = p_tenant_id
     and p.appointment_id = p_appointment_id
     and p.idempotency_key = p_idempotency_key;

  return jsonb_build_object(
    'appointment_id', p_appointment_id,
    'appointment_status', v_appointment_status,
    'payments', v_lines,
    'total_paid_cents', coalesce((v_summary ->> 'total_paid_cents')::int, 0),
    'tip_cents', coalesce((v_summary ->> 'tip_cents')::int, 0),
    'reserved_cents', coalesce((v_summary ->> 'reserved_cents')::int, 0),
    'remaining_cents', coalesce((v_summary ->> 'remaining_cents')::int, 0),
    'payment_status', v_summary ->> 'payment_status',
    'pix_amount_cents', coalesce(v_pix_intent, 0),
    'pix_already_pending', v_has_pending,
    'replayed', false
  );
end;
$$;

-- Grants e comentário (idempotentes; sem security definer novo).
revoke execute on function public.register_appointment_payments(uuid, uuid, uuid, jsonb, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.register_appointment_payments(uuid, uuid, uuid, jsonb, uuid, boolean)
  to service_role;

comment on function public.register_appointment_payments(uuid, uuid, uuid, jsonb, uuid, boolean) is
  'ADR-002: registra lote manual e conclui o atendimento no mesmo commit (idempotente por lote). Guarda 8a: lote com pagamento recusa PT409 PACKAGE_CREDIT_AVAILABLE quando há crédito de pacote válido (anti-dupla-cobrança com o auto-vínculo RF-12).';
