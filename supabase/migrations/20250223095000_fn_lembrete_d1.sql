-- Migration: whatsapp_enqueue_lembrete_d1() — função do lembrete D-1 automático (ADR-04, Fatia 2)
-- O valor central da Fatia 2 é o lembrete 24h antes (D-1) disparado SOZINHO (PRD §3, R1–R4). A
-- ADR-02 (20250223094000_pg_cron_setup) já REGISTRA o job `atlas_lembrete_d1` (*/15 * * * *)
-- apontando para `public.whatsapp_enqueue_lembrete_d1()`; esta migration DEFINE essa função. O
-- `cron.schedule` guarda o comando como string e não valida a função no ato do agendamento, então
-- registrar antes de definir (ordem 094000 -> 095000) é seguro.
--
-- DECISÃO — a função SÓ ENFILEIRA (PRD §7 / ADR-02/04): insere `messages` em `status='fila'` com
-- `attempts=0` e `next_attempt_at=now()`. O envio físico via Evolution é do worker de retentativa
-- (ADR-05), que drena a fila. Assim o lembrete nasce já sujeito a backoff/limite e janela útil,
-- uniformizando o caminho de saída. Esta ADR NÃO envia nada ao provedor.
--
-- JANELA D-1 (PRD §7 resolvido): elegível quando `starts_at` está entre `now()+23h` e `now()+25h`
-- (faixa de 2h, folgada para um cron de 15 min; no passado nunca entra — R4). Faixa fixada por
-- constantes no corpo da função (ajustável aqui, versionado).
--
-- SEGURANÇA / ISOLAMENTO (RNF03, inegociável): `security definer` + `search_path` fixo
-- (`public, pg_catalog`) para a função rodar com privilégio elevado (escreve `messages`, cuja
-- gravação é vedada ao cliente) sem depender do search_path do chamador. O `insert ... select`
-- carrega o `tenant_id` de CADA agendamento candidato (nunca de parâmetro/cliente): cron não cruza
-- tenants. REVOKE de `public`/`authenticated` e GRANT só ao `postgres` (dono do cron) — nenhum
-- papel do cliente invoca a função (R18 em espírito: só o sistema enfileira).
--
-- ELEGIBILIDADE (R1/R3/R5 + suspensão por assinatura):
--   - `status in ('pendente','confirmado')`;
--   - `starts_at` dentro da janela 23h–25h à frente (R4: passado fora);
--   - cliente `whatsapp_opt_in = true` (R3, LGPD — disparo só com consentimento);
--   - tenant `subscription_status not in ('bloqueado','cancelado')` (suspende disparo);
--   - instância do tenant `connection_status = 'conectado'` (recorte: 1 instância por tenant);
--   - SEM `lembrete_d1` prévio "que conta" para o agendamento (R2) — `not exists` espelhando a
--     semântica do índice único parcial `messages_dedupe_uidx` (status in fila/enviado/entregue).
--
-- IDEMPOTÊNCIA REAL (R2): dedupe_key = 'lembrete_d1:a:<appointment_id>' — MESMA convenção do
-- `handleSend` da Fatia 1, então um `lembrete_d1` enviado sob demanda e o automático NÃO duplicam.
-- O `not exists` cobre o caso comum; o `on conflict (tenant_id, dedupe_key) where status in
-- (...) do nothing` fecha a corrida/dupla execução contra o índice parcial, sem levantar erro
-- (duas rodadas seguidas => nada novo).
--
-- PII MÍNIMA (R19/LGPD): `payload` carrega só `{template, appointment_id}` — sem telefone,
-- documento ou texto cru. O destino é o `customer_id` (FK); o número é lido no servidor quando o
-- worker enviar, nunca duplicado no log.
--
-- TESTÁVEL SEM SCHEDULER (PRD §3): `select public.whatsapp_enqueue_lembrete_d1();` enfileira o que
-- for elegível naquele instante e devolve a contagem inserida — determinístico, dispensa pg_cron.
--
-- Idempotente no re-apply (`create or replace function`). Nenhum segredo no SQL.

-- ============================================================================
-- whatsapp_enqueue_lembrete_d1() — varre agendamentos elegíveis e enfileira lembrete_d1.
-- Retorna o número de mensagens efetivamente inseridas (0 quando nada elegível ou tudo já
-- enfileirado). Seguro para rodar manualmente e repetidamente.
-- ============================================================================
create or replace function public.whatsapp_enqueue_lembrete_d1()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  -- Janela D-1 fixada (ajustável aqui). Faixa de 2h para folgar um cron de 15 min.
  v_window_start constant interval := interval '23 hours';
  v_window_end   constant interval := interval '25 hours';
  v_inserted     integer;
begin
  with eligible as (
    select
      a.tenant_id,
      a.customer_id,
      a.id as appointment_id
    from public.appointments a
    join public.customers c
      on c.tenant_id = a.tenant_id and c.id = a.customer_id
    join public.tenants t
      on t.id = a.tenant_id
    where a.status in ('pendente','confirmado')
      -- Janela D-1: entre now()+23h e now()+25h; no passado nunca entra (R4).
      and a.starts_at >= now() + v_window_start
      and a.starts_at <  now() + v_window_end
      -- Consentimento LGPD explícito (R3).
      and c.whatsapp_opt_in = true
      -- Suspensão de disparo por status de assinatura do tenant.
      and t.subscription_status not in ('bloqueado','cancelado')
      -- Instância do tenant conectada (recorte: uma por tenant).
      and exists (
        select 1
        from public.whatsapp_instances wi
        where wi.tenant_id = a.tenant_id
          and wi.connection_status = 'conectado'
      )
      -- Sem lembrete_d1 "que conta" prévio para o agendamento (R2): espelha o índice parcial.
      and not exists (
        select 1
        from public.messages m
        where m.tenant_id = a.tenant_id
          and m.dedupe_key = 'lembrete_d1:a:' || a.id::text
          and m.status in ('fila','enviado','entregue')
      )
  ),
  inserted as (
    insert into public.messages (
      tenant_id,
      customer_id,
      appointment_id,
      channel,
      template,
      status,
      payload,
      dedupe_key,
      attempts,
      next_attempt_at
    )
    select
      e.tenant_id,
      e.customer_id,
      e.appointment_id,
      'whatsapp',
      'lembrete_d1',
      'fila',
      -- PII mínima: só template + appointment_id, sem telefone/documento/texto cru.
      jsonb_build_object('template', 'lembrete_d1', 'appointment_id', e.appointment_id),
      'lembrete_d1:a:' || e.appointment_id::text,
      0,
      now()
    from eligible e
    -- Fecha a corrida/dupla execução contra o índice único parcial messages_dedupe_uidx.
    on conflict (tenant_id, dedupe_key) where status in ('fila','enviado','entregue')
      do nothing
    returning 1
  )
  select count(*)::integer into v_inserted from inserted;

  return coalesce(v_inserted, 0);
end;
$$;

comment on function public.whatsapp_enqueue_lembrete_d1() is
  'Cron D-1 (ADR-04 Fatia 2): enfileira messages lembrete_d1 (status=fila) para agendamentos '
  'pendente/confirmado na janela 23h-25h, com opt-in, tenant ativo e instancia conectada. '
  'Idempotente por dedupe_key lembrete_d1:a:<appointment_id>. So enfileira; o envio e do worker '
  'de retentativa (ADR-05). Retorna o numero de mensagens inseridas.';

-- Função privilegiada do sistema: nenhum papel do cliente a invoca. O cron roda como dono (postgres).
revoke all on function public.whatsapp_enqueue_lembrete_d1() from public;
revoke all on function public.whatsapp_enqueue_lembrete_d1() from authenticated;
revoke all on function public.whatsapp_enqueue_lembrete_d1() from anon;
