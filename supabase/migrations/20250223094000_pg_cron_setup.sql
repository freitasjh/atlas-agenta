-- Migration: pg_cron setup — infra de agendamento dos jobs da Fatia 2 (ADR-02)
-- O lembrete D-1 (ADR-04) e o worker de retentativa (ADR-05) precisam rodar PERIODICAMENTE sem
-- ninguém clicar. A decisão do PRD (§7, ponto 6) é usar pg_cron, VERSIONADO em migration. Esta
-- migration cria SÓ a infra de agendamento: a extensão (condicional) e o registro dos dois jobs.
-- As FUNÇÕES agendadas (`whatsapp_enqueue_lembrete_d1()` e `whatsapp_process_retry_queue()`) são
-- definidas nas migrations de ADR-04/05 — aqui só são referenciadas pelo nome acordado. O
-- `cron.schedule` armazena o comando SQL como string e NÃO valida a existência da função no
-- momento do agendamento, então registrar o job antes da função existir é seguro.
--
-- DECISÃO — invocação por função SQL `security definer` (Opção a do PRD §7), NÃO pg_net:
--   (i) toda a lógica de elegibilidade/enfileiramento é SQL/dados — não precisa sair do banco;
--   (ii) evita embutir service role no SQL do cron (menos superfície de segredo);
--   (iii) o envio físico via Evolution continua com quem drena a fila (worker de retentativa
--         processa `messages.status='fila'`), mantendo o adapter atrás da porta.
-- Consequência aceita: o cron puro-SQL NÃO chama a Edge Function; o worker (ADR-05) concretiza o
-- envio. Nenhum segredo (service role/token) aparece neste arquivo (R20/decisão §7, ponto 4).
--
-- CONDICIONALIDADE — não quebrar `db reset` local (R21): `pg_cron` existe no Supabase hosted mas
-- pode NÃO existir no Postgres do `supabase db reset` local (Docker). Por isso:
--   - `create extension` vai dentro de `begin ... exception when others then raise notice` — se a
--     extensão não estiver disponível, NÃO falha o reset, só emite notice e segue;
--   - os jobs só são registrados SE `pg_cron` estiver de fato instalada (checar `pg_extension`
--     antes de chamar `cron.schedule`). Sem a extensão, nada é agendado e as funções (ADR-04/05)
--     continuam testáveis por chamada manual (PRD §3). NÃO usar `to_regproc('cron.schedule')`
--     como guard: `cron.schedule` é SOBRECARREGADA (duas assinaturas) e `to_regproc` devolve NULL
--     para nome ambíguo, o que faria o guard pular o agendamento mesmo com pg_cron presente.
--
-- IDEMPOTÊNCIA (R21, critério 2/3): antes de `cron.schedule`, remover job homônimo prévio
-- (`cron.unschedule` por nome, tolerando ausência) para o re-apply não duplicar. Um segundo
-- `db reset` não falha por job/extensão já existente.
--
-- GRANULARIDADE (resolve PRD §7):
--   - Lembrete D-1:     `atlas_lembrete_d1`  a cada 15 min (`*/15 * * * *`) — varredura barata
--                       (índice) e folga para a janela 23h–25h sem spam.
--   - Worker retry:     `atlas_retry_queue`  a cada  5 min (`*/5 * * * *`)  — respeita
--                       `next_attempt_at`.

-- ============================================================================
-- 1. Extensão pg_cron — condicional (não quebra `db reset` onde não existe).
-- ============================================================================
do $$
begin
  create extension if not exists pg_cron;
exception
  when others then
    -- Ambiente sem pg_cron disponível (ex.: Postgres local do `db reset`). Não falhar o reset:
    -- os jobs simplesmente não serão agendados abaixo (guard de to_regproc).
    raise notice 'pg_cron indisponivel neste ambiente (%); jobs de agendamento nao serao criados. As funcoes agendadas continuam testaveis por chamada manual.', sqlerrm;
end
$$;

-- ============================================================================
-- 2. Registro dos jobs — SÓ se pg_cron (cron.schedule) estiver instalado.
--    Idempotente: unschedule homônimo antes de schedule.
-- ============================================================================
do $$
begin
  -- Guard: só agenda se a extensão pg_cron estiver instalada neste ambiente. Checar pg_extension
  -- (e não to_regproc) porque cron.schedule é sobrecarregada e to_regproc resolve nome ambíguo
  -- para NULL, o que pularia o agendamento mesmo com pg_cron presente.
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron ausente; pulando agendamento dos jobs atlas_lembrete_d1 / atlas_retry_queue.';
    return;
  end if;

  -- Lembrete D-1 — a cada 15 minutos. Idempotente: remove job homônimo antes de recriar.
  begin
    perform cron.unschedule('atlas_lembrete_d1');
  exception
    when others then
      -- Job ainda não existe (primeiro apply): cron.unschedule lança se o nome não existe.
      null;
  end;
  perform cron.schedule('atlas_lembrete_d1', '*/15 * * * *', 'select public.whatsapp_enqueue_lembrete_d1();');

  -- Worker de retentativa — a cada 5 minutos. Idempotente igual ao anterior.
  begin
    perform cron.unschedule('atlas_retry_queue');
  exception
    when others then
      null;
  end;
  perform cron.schedule('atlas_retry_queue', '*/5 * * * *', 'select public.whatsapp_process_retry_queue();');
end
$$;
