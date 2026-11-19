-- Migration: ADR-07 hardening (revisão 1) — claim de cobrança por conta, guardas de
-- PIX vivo, liquidação pelo valor REAL do gateway e agregação de recebimentos na leitura.
-- Aditiva e idempotente. Nenhuma migration já aplicada é editada.
--
-- Correções endereçadas (review CHANGES_REQUIRED, iteração 1):
--   C1. claim atômico (`claim_receivable_gateway` + fence no `attach`) ⇒ no máximo UM
--       `POST /payments` por conta. O perdedor da corrida nunca derruba o PIX do vencedor:
--       `attach` falha com GATEWAY_CLAIM_LOST e a Edge só cancela órfão confirmado.
--   C2. `receivable_settle` recusa conta com PIX vivo (PT409 RECEIVABLE_HAS_ACTIVE_CHARGE):
--       evita caixa não registrado por recebimento parcial de uma conta já cobrada no
--       gateway. `receivable_cancel` recusa o mesmo estado — o PIX precisa ser cancelado
--       na Edge `cancel-receivable-charge` antes da baixa manual.
--   C2b. `receivable_settle_webhook` passa a receber o valor efetivamente pago; aplica no
--       máximo o saldo e registra o excedente em auditoria — diferença NUNCA é engolida.
--   I3. `receivable_list` agrega `recebido_cents` no banco (SUM por conta), sem depender
--       de janela limitada de settlements na UI.
--
-- Convenções: inglês/snake_case/plural; *_cents; timestamptz UTC; security definer/invoker
-- + search_path fixo; erros de domínio PT4xx com message = código estável.

-- ============================================================================
-- 1) Claim de criação no gateway (1 POST /payments por receivable).
-- ============================================================================
alter table public.receivables
  add column if not exists gateway_claimed_at timestamptz;
alter table public.receivables
  add column if not exists gateway_claim_expires_at timestamptz;

create index if not exists receivables_gateway_claim_expires_idx
  on public.receivables (gateway_claim_expires_at)
  where status = 'pendente';

-- 1a) Claim atômico. Elegível: conta pendente sem PIX vivo OU com PIX expirado
-- (reemissão). O TTL é o mesmo orçamento de I/O da Edge (180s).
create or replace function public.claim_receivable_gateway(
  p_tenant_id uuid,
  p_receivable_id uuid,
  p_ttl_seconds int default 180
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_rec public.receivables%rowtype;
  v_ttl int;
begin
  if p_tenant_id is null or p_receivable_id is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  v_ttl := greatest(1, least(coalesce(p_ttl_seconds, 180), 900));

  update public.receivables r
     set gateway_claimed_at = now(),
         gateway_claim_expires_at = now() + make_interval(secs => v_ttl)
   where r.tenant_id = p_tenant_id
     and r.id = p_receivable_id
     and r.status = 'pendente'
     and (
       r.asaas_payment_id is null
       or (r.charge_expires_at is not null and r.charge_expires_at < now())
     )
     and (
       r.gateway_claimed_at is null
       or r.gateway_claim_expires_at is null
       or r.gateway_claim_expires_at < now()
     )
  returning * into v_rec;

  if v_rec.id is null then
    select * into v_rec from public.receivables r
     where r.tenant_id = p_tenant_id and r.id = p_receivable_id;
    if not found then
      raise exception 'RECEIVABLE_NOT_FOUND' using errcode = 'PT404';
    end if;
    return jsonb_build_object(
      'claimed', false,
      'claim_token', null,
      'receivable', jsonb_build_object(
        'charge_id', v_rec.id,
        'amount_cents', v_rec.valor_cents,
        'status', v_rec.status,
        'asaas_payment_id', v_rec.asaas_payment_id,
        'pix_qr_code', v_rec.pix_qr_code,
        'pix_copy_paste', v_rec.pix_copy_paste,
        'expires_at', v_rec.charge_expires_at,
        'gateway_claimed_at', v_rec.gateway_claimed_at,
        'gateway_claim_expires_at', v_rec.gateway_claim_expires_at
      )
    );
  end if;

  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (
    p_tenant_id, null, 'receivable_gateway_claimed', 'receivable', v_rec.id,
    jsonb_build_object(
      'receivable_id', v_rec.id,
      'claim_expires_at', v_rec.gateway_claim_expires_at
    )
  );

  return jsonb_build_object(
    'claimed', true,
    'claim_token', v_rec.gateway_claimed_at,
    'receivable', jsonb_build_object(
      'charge_id', v_rec.id,
      'amount_cents', v_rec.valor_cents,
      'status', v_rec.status,
      'asaas_payment_id', v_rec.asaas_payment_id,
      'pix_qr_code', v_rec.pix_qr_code,
      'pix_copy_paste', v_rec.pix_copy_paste,
      'expires_at', v_rec.charge_expires_at,
      'gateway_claimed_at', v_rec.gateway_claimed_at,
      'gateway_claim_expires_at', v_rec.gateway_claim_expires_at
    )
  );
end;
$$;

revoke all on function public.claim_receivable_gateway(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.claim_receivable_gateway(uuid, uuid, int) to service_role;

-- 1b) Attach com fence: só o dono do claim grava os dados do gateway.
create or replace function public.attach_receivable_gateway_data(
  p_tenant_id uuid,
  p_receivable_id uuid,
  p_claim_token timestamptz,
  p_asaas_payment_id text,
  p_pix_qr_code text,
  p_pix_copy_paste text,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_rec public.receivables%rowtype;
begin
  if p_tenant_id is null or p_receivable_id is null or p_claim_token is null
     or p_asaas_payment_id is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  update public.receivables
     set asaas_payment_id = p_asaas_payment_id,
         pix_qr_code = p_pix_qr_code,
         pix_copy_paste = p_pix_copy_paste,
         charge_expires_at = coalesce(p_expires_at, charge_expires_at),
         gateway_claimed_at = null,
         gateway_claim_expires_at = null
   where tenant_id = p_tenant_id
     and id = p_receivable_id
     and status = 'pendente'
     and gateway_claimed_at = p_claim_token
     and gateway_claim_expires_at > now()
   returning * into v_rec;

  if v_rec.id is null then
    raise exception 'GATEWAY_CLAIM_LOST' using errcode = 'PT409';
  end if;

  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (
    p_tenant_id, null, 'receivable_charge_created', 'receivable', v_rec.id,
    jsonb_build_object(
      'receivable_id', v_rec.id,
      'amount_cents', v_rec.valor_cents,
      'expires_at', v_rec.charge_expires_at
    )
  );

  return jsonb_build_object(
    'id', v_rec.id,
    'customer_id', v_rec.customer_id,
    'descricao', v_rec.descricao,
    'valor_cents', v_rec.valor_cents,
    'status', v_rec.status,
    'asaas_payment_id', v_rec.asaas_payment_id,
    'pix_qr_code', v_rec.pix_qr_code,
    'pix_copy_paste', v_rec.pix_copy_paste,
    'charge_expires_at', v_rec.charge_expires_at
  );
end;
$$;

revoke all on function public.attach_receivable_gateway_data(uuid, uuid, timestamptz, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.attach_receivable_gateway_data(uuid, uuid, timestamptz, text, text, text, timestamptz)
  to service_role;

-- 1c) Libera o claim quando a criação falha (com fence do token).
create or replace function public.release_receivable_gateway_claim(
  p_tenant_id uuid,
  p_receivable_id uuid,
  p_claim_token timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_tenant_id is null or p_receivable_id is null or p_claim_token is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  update public.receivables
     set gateway_claimed_at = null,
         gateway_claim_expires_at = null
   where tenant_id = p_tenant_id
     and id = p_receivable_id
     and gateway_claimed_at = p_claim_token
   returning id into v_id;

  return jsonb_build_object('receivable_id', p_receivable_id, 'released', v_id is not null);
end;
$$;

revoke all on function public.release_receivable_gateway_claim(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.release_receivable_gateway_claim(uuid, uuid, timestamptz)
  to service_role;

-- 1d) Limpa os dados de gateway de um PIX expirado antes da reemissão (fence no id antigo).
create or replace function public.clear_receivable_gateway_data(
  p_tenant_id uuid,
  p_receivable_id uuid,
  p_expected_payment_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_tenant_id is null or p_receivable_id is null or p_expected_payment_id is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  update public.receivables
     set asaas_payment_id = null,
         pix_qr_code = null,
         pix_copy_paste = null,
         charge_expires_at = null
   where tenant_id = p_tenant_id
     and id = p_receivable_id
     and asaas_payment_id = p_expected_payment_id
   returning id into v_id;

  if v_id is not null then
    insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
    values (
      p_tenant_id, null, 'receivable_charge_detached', 'receivable', v_id,
      jsonb_build_object('receivable_id', v_id, 'previous_payment_id', p_expected_payment_id)
    );
  end if;

  return jsonb_build_object('receivable_id', p_receivable_id, 'cleared', v_id is not null);
end;
$$;

revoke all on function public.clear_receivable_gateway_data(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.clear_receivable_gateway_data(uuid, uuid, text) to service_role;

-- ============================================================================
-- 2) receivable_settle — recusa conta com PIX vivo (C2).
--    Recebimento parcial numa conta já cobrada no gateway gera caixa não
--    registrado (cliente paga o PIX cheio; o sistema registraria só o parcial).
-- ============================================================================
create or replace function public.receivable_settle(
  p_receivable_id uuid,
  p_valor_cents int,
  p_recebido_at timestamptz default now(),
  p_metodo text default 'pix'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_role   text;
  v_rec    public.receivables%rowtype;
  v_somado int;
  v_novo   int;
  v_status text;
begin
  if p_receivable_id is null
     or p_valor_cents is null or p_valor_cents <= 0
     or coalesce(p_metodo, 'pix') not in ('dinheiro','pix','cartao_credito','cartao_debito','transferencia') then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  v_tenant := current_tenant_id();
  v_role := current_role_name();
  if v_tenant is null or coalesce(v_role, '__none') <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  select * into v_rec from public.receivables r
   where r.tenant_id = v_tenant and r.id = p_receivable_id
   for update;
  if not found then
    raise exception 'RECEIVABLE_NOT_FOUND' using errcode = 'PT404';
  end if;
  if v_rec.status = 'cancelado' then
    raise exception 'RECEIVABLE_CANCELLED' using errcode = 'PT409';
  end if;
  if v_rec.status = 'pago' then
    raise exception 'RECEIVABLE_ALREADY_PAID' using errcode = 'PT409';
  end if;
  -- PIX vivo: o pagamento do gateway é a única forma de baixa desta conta.
  -- Baixa manual exigiria cancelar o PIX antes (Edge `cancel-receivable-charge`).
  if v_rec.asaas_payment_id is not null then
    raise exception 'RECEIVABLE_HAS_ACTIVE_CHARGE' using errcode = 'PT409';
  end if;

  select coalesce(sum(s.valor_cents), 0) into v_somado
    from public.receivable_settlements s
   where s.tenant_id = v_tenant and s.receivable_id = p_receivable_id;

  v_novo := v_somado + p_valor_cents;
  if v_novo > v_rec.valor_cents then
    raise exception 'RECEIVABLE_OVERPAY' using errcode = 'PT409';
  end if;

  v_status := case when v_novo = v_rec.valor_cents then 'pago' else 'parcial' end;

  insert into public.receivable_settlements
    (tenant_id, receivable_id, valor_cents, recebido_at, metodo, created_by)
  values
    (v_tenant, p_receivable_id, p_valor_cents, coalesce(p_recebido_at, now()),
     coalesce(p_metodo, 'pix'), auth.uid());

  update public.receivables set status = v_status
   where tenant_id = v_tenant and id = p_receivable_id;

  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (
    v_tenant, auth.uid(), 'receivable_settled', 'receivable', p_receivable_id,
    jsonb_build_object(
      'valor_cents', p_valor_cents,
      'metodo', coalesce(p_metodo, 'pix'),
      'status', v_status,
      'resto_cents', v_rec.valor_cents - v_novo
    )
  );

  return jsonb_build_object(
    'receivable_id', p_receivable_id,
    'status', v_status,
    'resto_cents', v_rec.valor_cents - v_novo
  );
end;
$$;

revoke all on function public.receivable_settle(uuid, int, timestamptz, text) from public, anon;
grant execute on function public.receivable_settle(uuid, int, timestamptz, text) to authenticated, service_role;

-- ============================================================================
-- 3) receivable_cancel — recusa conta com PIX vivo (C2): o PIX precisa ser
--    cancelado no gateway ANTES da baixa manual, senão o cliente continua com um
--    QR pagável de uma conta já cancelada.
-- ============================================================================
create or replace function public.receivable_cancel(
  p_receivable_id uuid,
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
  v_rec    public.receivables%rowtype;
  v_count  int;
begin
  if p_receivable_id is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  v_tenant := current_tenant_id();
  v_role := current_role_name();
  if v_tenant is null or coalesce(v_role, '__none') <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  select * into v_rec from public.receivables r
   where r.tenant_id = v_tenant and r.id = p_receivable_id
   for update;
  if not found then
    raise exception 'RECEIVABLE_NOT_FOUND' using errcode = 'PT404';
  end if;
  if v_rec.status = 'pago' then
    raise exception 'RECEIVABLE_ALREADY_PAID' using errcode = 'PT409';
  end if;
  if v_rec.asaas_payment_id is not null then
    raise exception 'RECEIVABLE_HAS_ACTIVE_CHARGE' using errcode = 'PT409';
  end if;

  select count(*) into v_count from public.receivable_settlements s
   where s.tenant_id = v_tenant and s.receivable_id = p_receivable_id;
  if v_count > 0 then
    raise exception 'RECEIVABLE_HAS_SETTLEMENTS' using errcode = 'PT409';
  end if;

  update public.receivables set status = 'cancelado'
   where tenant_id = v_tenant and id = p_receivable_id;

  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (
    v_tenant, auth.uid(), 'receivable_cancelled', 'receivable', p_receivable_id,
    jsonb_build_object('motivo', p_motivo)
  );

  return jsonb_build_object('receivable_id', p_receivable_id, 'status', 'cancelado');
end;
$$;

revoke all on function public.receivable_cancel(uuid, text) from public, anon;
grant execute on function public.receivable_cancel(uuid, text) to authenticated, service_role;

-- ============================================================================
-- 4) Webhook: liquida pelo valor REALMENTE pago (C2b).
--    Aplica no máximo o saldo; excedente vira auditoria explícita. Até então o
--    valor enviado pelo gateway era ignorado (só o saldo local era baixado).
-- ============================================================================
drop function if exists public.receivable_settle_webhook(uuid, uuid, timestamptz, text);

create or replace function public.receivable_settle_webhook(
  p_tenant_id uuid,
  p_receivable_id uuid,
  p_paid_at timestamptz default null,
  p_event_id text default null,
  p_paid_value_cents int default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_rec      public.receivables%rowtype;
  v_recebido int;
  v_resto    int;
  v_aplicar  int;
  v_status   text;
begin
  if p_tenant_id is null or p_receivable_id is null then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;
  if p_paid_value_cents is not null and p_paid_value_cents < 0 then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  select * into v_rec from public.receivables r
   where r.tenant_id = p_tenant_id and r.id = p_receivable_id
   for update;
  if not found then
    raise exception 'RECEIVABLE_NOT_FOUND' using errcode = 'PT404';
  end if;

  -- Replay do MESMO evento: sem efeito (a unique parcial é a trava sob corrida).
  if p_event_id is not null and exists (
    select 1 from public.receivable_settlements s
     where s.tenant_id = p_tenant_id and s.event_id = p_event_id
  ) then
    return jsonb_build_object(
      'receivable_id', p_receivable_id, 'status', v_rec.status,
      'settled', false, 'replayed', true
    );
  end if;

  -- Conta já quitada: webhook atrasado não reabre nem duplica recebimento.
  if v_rec.status = 'pago' then
    return jsonb_build_object(
      'receivable_id', p_receivable_id, 'status', v_rec.status,
      'settled', false, 'replayed', true
    );
  end if;

  if v_rec.status = 'cancelado' then
    raise exception 'RECEIVABLE_CANCELLED' using errcode = 'PT409';
  end if;

  select coalesce(sum(s.valor_cents), 0) into v_recebido
    from public.receivable_settlements s
   where s.tenant_id = p_tenant_id and s.receivable_id = p_receivable_id;

  v_resto := greatest(0, v_rec.valor_cents - v_recebido);
  if v_resto <= 0 then
    update public.receivables set status = 'pago'
     where tenant_id = p_tenant_id and id = p_receivable_id;
    return jsonb_build_object(
      'receivable_id', p_receivable_id, 'status', 'pago',
      'settled', false, 'replayed', true
    );
  end if;

  -- Valor pago manda: baixa o que o gateway confirma, limitado ao saldo.
  v_aplicar := least(coalesce(p_paid_value_cents, v_resto), v_resto);
  if v_aplicar <= 0 then
    return jsonb_build_object(
      'receivable_id', p_receivable_id, 'status', v_rec.status,
      'settled', false, 'replayed', true
    );
  end if;

  insert into public.receivable_settlements
    (tenant_id, receivable_id, valor_cents, recebido_at, metodo, event_id)
  values
    (p_tenant_id, p_receivable_id, v_aplicar, coalesce(p_paid_at, now()), 'pix',
     nullif(btrim(coalesce(p_event_id, '')), ''));

  v_status := case
    when v_recebido + v_aplicar >= v_rec.valor_cents then 'pago'
    else 'parcial'
  end;

  update public.receivables set status = v_status
   where tenant_id = p_tenant_id and id = p_receivable_id;

  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (
    p_tenant_id, null, 'receivable_settled_webhook', 'receivable', p_receivable_id,
    jsonb_build_object(
      'valor_cents', v_aplicar,
      'event_id', p_event_id,
      'paid_value_cents', p_paid_value_cents,
      'status', v_status
    )
  );

  -- Diferença nunca é engolida: pagamento acima do saldo fica registrado.
  if p_paid_value_cents is not null and p_paid_value_cents > v_resto then
    insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
    values (
      p_tenant_id, null, 'receivable_gateway_overpay', 'receivable', p_receivable_id,
      jsonb_build_object(
        'paid_value_cents', p_paid_value_cents,
        'applied_cents', v_aplicar,
        'excess_cents', p_paid_value_cents - v_aplicar,
        'event_id', p_event_id
      )
    );
  end if;

  return jsonb_build_object(
    'receivable_id', p_receivable_id,
    'status', v_status,
    'settled', true,
    'replayed', false,
    'valor_cents', v_aplicar,
    'excess_cents', greatest(0, coalesce(p_paid_value_cents, 0) - v_aplicar)
  );
end;
$$;

revoke all on function public.receivable_settle_webhook(uuid, uuid, timestamptz, text, int)
  from public, anon, authenticated;
grant execute on function public.receivable_settle_webhook(uuid, uuid, timestamptz, text, int)
  to service_role;

-- ============================================================================
-- 5) Leitura da aba Avulsas: recebimentos agregados no banco (I3).
--    security invoker: a RLS admin de `receivables`/`receivable_settlements`
--    vale integralmente. `pix_qr_code` fica de fora (base64 grande, a UI usa o
--    retorno da Edge na hora da cobrança).
-- ============================================================================
create or replace function public.receivable_list()
returns jsonb
language sql
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(row_to_json(t) order by t.vencimento_at asc), '[]'::jsonb)
    from (
      select r.id,
             r.tenant_id,
             r.customer_id,
             r.descricao,
             r.categoria,
             r.vencimento_at,
             r.valor_cents,
             r.status,
             r.asaas_payment_id,
             null::text as pix_qr_code,
             r.pix_copy_paste,
             r.charge_expires_at,
             r.created_at,
             coalesce(sum(s.valor_cents), 0)::int as recebido_cents
        from public.receivables r
        left join public.receivable_settlements s
          on s.tenant_id = r.tenant_id
         and s.receivable_id = r.id
       group by r.id
       order by r.vencimento_at asc
       limit 500
    ) t;
$$;

revoke all on function public.receivable_list() from public, anon;
grant execute on function public.receivable_list() to authenticated, service_role;
