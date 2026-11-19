-- Migration: ADR-06 fix — índice de série com escopo de tenant + fallback com tenant + allowlist de anexo.
-- Aditiva e idempotente. Não edita migration já aplicada (20261208090000_payables.sql).
--
-- Correções do review (must-fix):
--   1) Índice `payables_serie_vencimento_uidx` era global (serie_id, vencimento_at):
--      vazamento cross-tenant (colisão de serie entre tenants + ON CONFLICT sem tenant).
--      Recriado como (tenant_id, serie_id, vencimento_at) where serie_id is not null.
--   2) `payable_create`: ON CONFLICT passa a (tenant_id, serie_id, vencimento_at);
--      select de fallback filtra por tenant (antes lia serie de outro tenant).
--   3) `payable_settle`: allowlist de extensão do anexo no banco (defesa em
--      profundidade; o cliente já valida tipo + extensão + tamanho).

-- 1) Índice com escopo de tenant.
drop index if exists public.payables_serie_vencimento_uidx;
create unique index if not exists payables_serie_tenant_vencimento_uidx
  on public.payables (tenant_id, serie_id, vencimento_at)
  where serie_id is not null;

-- 2) payable_create — mesma assinatura; só ON CONFLICT + fallback com tenant.
create or replace function public.payable_create(
  p_descricao text,
  p_vencimento_at timestamptz,
  p_valor_cents int,
  p_supplier_id uuid default null,
  p_categoria text default null,
  p_recorrencia text default 'none',
  p_parcelas int default 1,
  p_serie_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_role   text;
  v_serie  uuid;
  v_n      int;
  v_ids    uuid[] := '{}';
  v_venc   timestamptz;
  v_id     uuid;
  i        int;
begin
  if p_descricao is null or char_length(btrim(p_descricao)) not between 1 and 200
     or p_vencimento_at is null
     or p_valor_cents is null or p_valor_cents <= 0
     or coalesce(p_recorrencia, 'none') not in ('none','mensal') then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  v_tenant := current_tenant_id();
  v_role := current_role_name();
  if v_tenant is null or coalesce(v_role, '__none') <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  if p_supplier_id is not null and not exists (
    select 1 from public.suppliers s
     where s.tenant_id = v_tenant and s.id = p_supplier_id
  ) then
    raise exception 'PAYABLE_SUPPLIER_NOT_FOUND' using errcode = 'PT404';
  end if;

  -- Replay idempotente: serie já lançada volta os ids existentes.
  if p_serie_id is not null and exists (
    select 1 from public.payables p
     where p.tenant_id = v_tenant and p.serie_id = p_serie_id
  ) then
    select coalesce(array_agg(p.id order by p.vencimento_at), '{}') into v_ids
      from public.payables p
     where p.tenant_id = v_tenant and p.serie_id = p_serie_id;
    return jsonb_build_object('payable_ids', v_ids, 'replayed', true);
  end if;

  if coalesce(p_recorrencia, 'none') = 'mensal' then
    if p_parcelas is null or p_parcelas < 2 or p_parcelas > 24 then
      raise exception 'INVALID_BODY' using errcode = 'PT400';
    end if;
    v_n := p_parcelas;
    v_serie := coalesce(p_serie_id, gen_random_uuid());
  else
    v_n := 1;
    v_serie := null;
  end if;

  for i in 1..v_n loop
    v_venc := p_vencimento_at + ((i - 1) || ' months')::interval;
    insert into public.payables
      (tenant_id, supplier_id, descricao, categoria, vencimento_at, valor_cents, recorrencia, serie_id)
    values
      (v_tenant, p_supplier_id, btrim(p_descricao), nullif(btrim(coalesce(p_categoria, '')), ''), v_venc, p_valor_cents, coalesce(p_recorrencia, 'none'), v_serie)
    on conflict (tenant_id, serie_id, vencimento_at) where serie_id is not null do nothing
    returning id into v_id;
    if v_id is null then
      select p.id into v_id from public.payables p
       where p.tenant_id = v_tenant and p.serie_id = v_serie and p.vencimento_at = v_venc;
    end if;
    v_ids := v_ids || v_id;
  end loop;

  return jsonb_build_object('payable_ids', v_ids, 'replayed', false);
end;
$$;

revoke all on function public.payable_create(text, timestamptz, int, uuid, text, text, int, uuid) from public, anon;
grant execute on function public.payable_create(text, timestamptz, int, uuid, text, text, int, uuid) to authenticated, service_role;

-- 3) payable_settle — mesma assinatura + allowlist de extensão do anexo (defesa em profundidade).
create or replace function public.payable_settle(
  p_payable_id uuid,
  p_valor_cents int,
  p_pago_at timestamptz default now(),
  p_conta text default null,
  p_anexo_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid;
  v_role   text;
  v_pay    public.payables%rowtype;
  v_somado int;
  v_novo   int;
begin
  if p_payable_id is null or p_valor_cents is null or p_valor_cents <= 0 then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  -- Anexo: allowlist de extensão (cliente valida MIME + tamanho; aqui o banco nega o resto).
  if p_anexo_path is not null
     and lower(p_anexo_path) !~ '\.(pdf|jpg|jpeg|png)$' then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  v_tenant := current_tenant_id();
  v_role := current_role_name();
  if v_tenant is null or coalesce(v_role, '__none') <> 'admin' then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  select * into v_pay from public.payables p
   where p.tenant_id = v_tenant and p.id = p_payable_id
   for update;
  if not found then
    raise exception 'PAYABLE_NOT_FOUND' using errcode = 'PT404';
  end if;
  if v_pay.status = 'cancelado' then
    raise exception 'PAYABLE_CANCELLED' using errcode = 'PT409';
  end if;
  if v_pay.status = 'pago' then
    raise exception 'PAYABLE_ALREADY_PAID' using errcode = 'PT409';
  end if;

  select coalesce(sum(s.valor_cents), 0) into v_somado
    from public.payable_settlements s
   where s.tenant_id = v_tenant and s.payable_id = p_payable_id;

  v_novo := v_somado + p_valor_cents;
  if v_novo > v_pay.valor_cents then
    raise exception 'PAYABLE_OVERPAY' using errcode = 'PT409';
  end if;

  insert into public.payable_settlements
    (tenant_id, payable_id, valor_cents, pago_at, conta, anexo_path, created_by)
  values
    (v_tenant, p_payable_id, p_valor_cents, coalesce(p_pago_at, now()),
     nullif(btrim(coalesce(p_conta, '')), ''), nullif(btrim(coalesce(p_anexo_path, '')), ''), auth.uid());

  if v_novo = v_pay.valor_cents then
    update public.payables set status = 'pago'
     where tenant_id = v_tenant and id = p_payable_id;
  else
    update public.payables set status = 'parcial'
     where tenant_id = v_tenant and id = p_payable_id;
  end if;

  return jsonb_build_object(
    'payable_id', p_payable_id,
    'status', case when v_novo = v_pay.valor_cents then 'pago' else 'parcial' end,
    'resto_cents', v_pay.valor_cents - v_novo
  );
end;
$$;

revoke all on function public.payable_settle(uuid, int, timestamptz, text, text) from public, anon;
grant execute on function public.payable_settle(uuid, int, timestamptz, text, text) to authenticated, service_role;
