-- Migration: ADR-10 — export contábil (formato + log + download).
-- Aditiva e idempotente. Nenhuma migration já aplicada é editada.
--
-- Escopo (ADR-10, RF-36..38 + PRD §6.8/§7): a Edge `export-ledger` gera
-- CSV/OFX/SPED-resumo sob service_role e registra a entrega. Esta migration
-- entrega o que o banco precisa para isso de forma atômica:
--   1) índices de apoio às leituras do export (período por eixo de data);
--   2) `export_log_write` — grava o log de SUCESSO (export_logs + audit_log)
--      com o tenant e o ator explícitos, porque service_role não tem claims;
--   3) `export_log_reject` — grava a TENTATIVA RECUSADA só em `audit_log`
--      (com motivo). Recusa não entra em `export_logs`: a tabela é a trilha de
--      entregas, e um arquivo que não existiu não vira linha de export.
--
-- Decisões (ADR-10 §Decisão + PRD §10.11 delegada):
--   - `export_logs` continua sendo a SSoT da trilha (dono: ADR-09). Nenhuma
--     coluna nova: `tipo` já é text (1..40) e `formato` já aceita
--     csv/ofx/sped. ADR-10 só grava tipos novos por RPC service-only —
--     `export_log_create` (ADR-09) segue restrita a dre|fluxo.
--   - `arquivo_path` guarda o NOME do arquivo entregue (o arquivo é gerado em
--     memória na Edge e baixado pelo navegador; não há upload para storage
--     neste MVP). O log só é gravado APÓS o arquivo ser montado — se a escrita
--     do log falhar, a Edge responde 500 e não devolve arquivo sem prova.
--   - Período vazio: nenhum `export_logs`, só `audit_log`
--     (`action = export_rejected`, motivo = código estável). PRD RF-37
--     ("nunca arquivo vazio") + ADR-10 ("sem log de sucesso").
--   - Gate de entitlement `export_contabil` é re-checado no banco (defesa em
--     profundidade): a Edge já barra antes de ler qualquer tabela, mas a RPC
--     também recusa tenant fora do plano. Nenhuma RPC aqui devolve dado
--     financeiro — só a Edge lê, com `tenant_id` resolvido do JWT.
--   - `export_log_write`/`export_log_reject` NÃO são executáveis por
--     `authenticated` nem `anon`: só service_role (a Edge). O admin já tem
--     leitura de `export_logs` pela policy do ADR-09.
--
-- Convenções: inglês/snake_case/plural; *_cents; timestamptz UTC; erros de
-- domínio PT4xx com message = código estável; security definer + search_path
-- fixo.

-- ============================================================================
-- 1) Índices de apoio ao export (eixo de data de cada fonte).
--    `receivable_settlements`/`payable_settlements`/`appointment_commissions`
--    já foram indexados pelo ADR-09; aqui entram os eixos que faltavam.
-- ============================================================================
create index if not exists appointment_payments_tenant_received_idx
  on public.appointment_payments (tenant_id, received_at)
  where voided_at is null;

create index if not exists fiscal_documents_tenant_authorized_idx
  on public.fiscal_documents (tenant_id, authorized_at)
  where authorized_at is not null;

-- OFX lê o extrato conciliado por data (status já indexado desde o ADR-08;
-- o índice composto abaixo cobre o recorte exato do export).
create index if not exists bank_lines_tenant_reconciled_data_idx
  on public.bank_lines (tenant_id, data)
  where status = 'conciliado';

-- ============================================================================
-- 2) export_log_write — log de entrega (service_role).
--    Valida formas, ator do tenant e entitlement `export_contabil`.
-- ============================================================================
-- Drop da assinatura anterior (6 args): `create or replace` com parâmetro novo
-- criaria um overload e a chamada de 6 args ficaria ambígua.
drop function if exists public.export_log_write(uuid, text, text, text, text, uuid);

create or replace function public.export_log_write(
  p_tenant_id uuid,
  p_tipo text,
  p_periodo text,
  p_formato text,
  p_arquivo_path text,
  p_actor_id uuid,
  p_escopo text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tipo   text;
  v_form   text;
  v_per    text;
  v_path   text;
  v_escopo text;
  v_id     uuid;
  v_created timestamptz;
begin
  v_tipo := lower(btrim(coalesce(p_tipo, '')));
  v_form := lower(btrim(coalesce(p_formato, '')));
  v_per  := btrim(coalesce(p_periodo, ''));
  v_path := btrim(coalesce(p_arquivo_path, ''));
  v_escopo := lower(btrim(coalesce(p_escopo, '')));

  -- Tipos de ADR-10: ledger (receber), payables (pagar), fiscal, ofx, sped.
  if p_tenant_id is null
     or p_actor_id is null
     or v_tipo not in ('ledger', 'payables', 'fiscal', 'ofx', 'sped')
     or v_form not in ('csv', 'ofx', 'sped')
     or v_escopo not in ('receber', 'pagar', 'fiscal')
     or char_length(v_per) not between 1 and 80
     or char_length(v_path) not between 1 and 300 then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  -- Trilogia da entrega: perfil ATIVO e ADMIN do tenant. service_role não tem
  -- claims, então a checagem é explícita (a Edge já barra antes de chamar).
  if not exists (
    select 1
      from public.profiles p
     where p.tenant_id = p_tenant_id
       and p.id = p_actor_id
       and p.active
       and p.role = 'admin'
  ) then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  if not public.tenant_has_feature(p_tenant_id, 'export_contabil') then
    raise exception 'FEATURE_DISABLED' using errcode = 'PT403';
  end if;

  insert into public.export_logs (tenant_id, tipo, periodo, formato, arquivo_path, created_by)
  values (p_tenant_id, v_tipo, v_per, v_form, v_path, p_actor_id)
  returning id, created_at into v_id, v_created;

  insert into public.audit_log (tenant_id, actor_id, action, target_type, target_id, metadata)
  values (
    p_tenant_id,
    p_actor_id,
    'export_log_created',
    'export_log',
    v_id,
    jsonb_build_object(
      'tipo', v_tipo,
      'periodo', v_per,
      'formato', v_form,
      'escopo', v_escopo
    )
  );

  return jsonb_build_object('id', v_id, 'created_at', v_created);
end;
$$;

revoke all on function public.export_log_write(uuid, text, text, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.export_log_write(uuid, text, text, text, text, uuid, text)
  to service_role;

comment on function public.export_log_write(uuid, text, text, text, text, uuid, text) is
  'ADR-10: registra export entregue (export_logs + audit_log). Somente service_role (Edge export-ledger).';

-- ============================================================================
-- 3) export_log_reject — tentativa recusada (período vazio / formato inválido).
--    Só audit_log: recusa não é entrega e não polui a lista de exports.
-- ============================================================================
create or replace function public.export_log_reject(
  p_tenant_id uuid,
  p_periodo text,
  p_formato text,
  p_escopo text,
  p_motivo text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_form   text;
  v_escopo text;
  v_per    text;
  v_motivo text;
begin
  v_form   := lower(btrim(coalesce(p_formato, '')));
  v_escopo := lower(btrim(coalesce(p_escopo, '')));
  v_per    := btrim(coalesce(p_periodo, ''));
  v_motivo := upper(btrim(coalesce(p_motivo, '')));

  if p_tenant_id is null
     or p_actor_id is null
     or v_form not in ('csv', 'ofx', 'sped')
     or v_escopo not in ('receber', 'pagar', 'fiscal')
     or char_length(v_per) not between 1 and 80
     or v_motivo !~ '^[A-Z][A-Z0-9_]{2,63}$' then
    raise exception 'INVALID_BODY' using errcode = 'PT400';
  end if;

  if not exists (
    select 1
      from public.profiles p
     where p.tenant_id = p_tenant_id
       and p.id = p_actor_id
       and p.active
       and p.role = 'admin'
  ) then
    raise exception 'FORBIDDEN' using errcode = 'PT403';
  end if;

  insert into public.audit_log (tenant_id, actor_id, action, target_type, metadata)
  values (
    p_tenant_id,
    p_actor_id,
    'export_rejected',
    'export_log',
    jsonb_build_object(
      'periodo', v_per,
      'formato', v_form,
      'escopo', v_escopo,
      'motivo', v_motivo
    )
  );

  return jsonb_build_object('rejected', true, 'motivo', v_motivo);
end;
$$;

revoke all on function public.export_log_reject(uuid, text, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.export_log_reject(uuid, text, text, text, text, uuid)
  to service_role;

comment on function public.export_log_reject(uuid, text, text, text, text, uuid) is
  'ADR-10: registra tentativa de export recusada (audit_log apenas). Somente service_role.';
