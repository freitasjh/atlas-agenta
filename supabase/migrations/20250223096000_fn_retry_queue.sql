-- Migration: whatsapp_process_retry_queue() — worker de retentativa da fila (ADR-05, Fatia 2, RNF04)
-- A Fatia 2 passa a criar mensagens que NASCEM em `status='fila'` sem envio imediato: o
-- `lembrete_d1` (ADR-04) e o `reagendar_retorno` (ADR-03). A Fatia 1 só deixava em `fila` no
-- instante do `handleSend` e resolvia `enviado`/`falha` no ato — não havia reprocessamento. Alguém
-- precisa DRENAR a fila com backoff/limite e respeito à janela útil (R15/R16/R17). A ADR-02
-- (20250223094000_pg_cron_setup) já REGISTRA o job `atlas_retry_queue` (*/5 * * * *) apontando
-- para `public.whatsapp_process_retry_queue()`; esta migration DEFINE essa função.
--
-- SEPARAÇÃO DE RESPONSABILIDADES (decisão da ADR-05, mantém a ADR-02 honesta): o worker tem duas
-- partes — ESTADO/DADOS (limite, janela, elegibilidade de backoff), que é SQL puro e 100% testável
-- sem scheduler e sem rede, e ENVIO FÍSICO via Evolution, que exige HTTP + segredo e NÃO pode
-- viver no SQL do cron (a ADR-02 escolheu cron por função SQL `security definer`, SEM pg_net nem
-- service role embutida). Por isso:
--   - ESTA FUNÇÃO SQL cuida SÓ de estado: aplica o teto de tentativas (R16), expira a janela útil
--     do lembrete (R17) e deixa em `fila` (elegível) apenas o que tem `next_attempt_at <= now()` e
--     `attempts < max_attempts`. NÃO fala com a Evolution.
--   - O ENVIO FÍSICO das mensagens elegíveis é feito pela Edge Function drenadora
--     `whatsapp-dispatch` (Deno, service role), que reusa `render.ts`/`evolution-adapter.ts` da
--     Fatia 1, aplica o BACKOFF no erro (incrementa `attempts`, carimba `last_attempt_at`, calcula
--     `next_attempt_at`) e marca `enviado`+`provider_message_id` no sucesso. Em ambiente hosted o
--     cron pode invocá-la via `pg_net`; sem pg_net/local ela é invocável manualmente (QA). O
--     segredo da Evolution NUNCA entra neste SQL.
--
-- PARÂMETROS DE BACKOFF (PRD §7, resolvido na ADR-05): base 5 min, fator 3, `max_attempts=3`
-- (default da coluna, 20250223092000). Tentativas em ~5min, ~15min, ~45min após a falha —
-- `next_attempt_at = now() + base * pow(fator, attempts)`. O CÁLCULO do próximo instante vive na
-- drenadora (onde a tentativa realmente ocorre); estas constantes são documentadas aqui como o
-- contrato acordado e repetidas na função Deno. Esta função SQL não agenda tentativa nova; ela só
-- decide elegibilidade do que já está na fila.
--
-- JANELA ÚTIL (R17): um `lembrete_d1` cujo agendamento já passou de `starts_at` perde o sentido —
-- não adianta lembrar de um horário que já aconteceu. Essas linhas em `fila` viram
-- `status='falha'`, `failure_reason='janela_vencida'` e não são mais drenadas. DECISÃO (ponto
-- aberto da ADR): `reagendar_retorno` NÃO expira por janela — é uma resposta a um pedido do
-- cliente de remarcar, independente do horário original do agendamento (que o cliente justamente
-- quer trocar); expirá-lo silenciaria o retorno. Fica sujeito só ao teto de tentativas (R16).
--
-- IDEMPOTÊNCIA / PII (R19): a função nunca toca o que já está `enviado`/`entregue` (o índice único
-- parcial `messages_dedupe_uidx` garante unicidade viva; esta função só mexe em `fila`). Não loga
-- telefone nem texto; `failure_reason` é técnico curto (`max_attempts`/`janela_vencida`).
--
-- ISOLAMENTO MULTI-TENANT (RNF03, inegociável): a função opera sobre TODAS as linhas de `messages`
-- (é o worker do sistema, não uma sessão de usuário), mas cada `update`/join carrega o
-- `tenant_id` da PRÓPRIA linha — nunca cruza tenants, nunca recebe `tenant_id` de parâmetro. A
-- expiração de janela casa o `lembrete_d1` ao seu agendamento pelo PAR `(tenant_id, appointment_id)`.
--
-- SEGURANÇA: `security definer` + `search_path` fixo (`public, pg_catalog`) — escreve `messages`,
-- cuja gravação é vedada ao cliente. REVOKE de `public`/`authenticated`/`anon`: nenhum papel do
-- cliente invoca; o cron roda como dono (`postgres`). Nenhum segredo no SQL.
--
-- TESTÁVEL SEM SCHEDULER (PRD §3 / critérios de aceite da ADR): `select
-- public.whatsapp_process_retry_queue();` aplica teto e janela e devolve as contagens de
-- transição — determinístico, dispensa pg_cron e rede.
--
-- Idempotente no re-apply (`create or replace function`).

-- ============================================================================
-- whatsapp_process_retry_queue() — aplica teto de tentativas (R16) e expira a janela útil do
-- lembrete (R17) sobre `messages` em `fila`. NÃO envia nada (o envio é da drenadora Deno
-- `whatsapp-dispatch`). Retorna uma linha com quantas mensagens cada transição afetou e quantas
-- restaram ELEGÍVEIS para envio (fila, next_attempt_at<=now(), attempts<max_attempts).
-- Seguro para rodar manualmente e repetidamente.
-- ============================================================================
create or replace function public.whatsapp_process_retry_queue()
returns table (
  failed_max_attempts integer,
  failed_janela_vencida integer,
  eligible_to_send integer
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_failed_max   integer := 0;
  v_failed_janela integer := 0;
  v_eligible     integer := 0;
begin
  -- 1. TETO DE TENTATIVAS (R16): o que já esgotou o limite N vira `falha` e sai da fila.
  --    Cada linha carrega seu próprio tenant_id — nenhum cruzamento de tenant.
  with bumped as (
    update public.messages
    set status = 'falha',
        failure_reason = 'max_attempts',
        last_attempt_at = coalesce(last_attempt_at, now())
    where status = 'fila'
      and attempts >= max_attempts
    returning 1
  )
  select count(*)::integer into v_failed_max from bumped;

  -- 2. JANELA ÚTIL do lembrete D-1 (R17): `lembrete_d1` em `fila` cujo agendamento já passou de
  --    `starts_at` não deve mais ser enviado. Casa pelo PAR (tenant_id, appointment_id).
  --    `reagendar_retorno` NÃO expira por janela (decisão documentada no cabeçalho).
  with expired as (
    update public.messages m
    set status = 'falha',
        failure_reason = 'janela_vencida',
        last_attempt_at = coalesce(m.last_attempt_at, now())
    from public.appointments a
    where m.status = 'fila'
      and m.template = 'lembrete_d1'
      and m.appointment_id is not null
      and a.tenant_id = m.tenant_id
      and a.id = m.appointment_id
      and a.starts_at <= now()
    returning 1
  )
  select count(*)::integer into v_failed_janela from expired;

  -- 3. ELEGÍVEIS PARA ENVIO: o que sobrou em `fila`, pronto agora (next_attempt_at<=now() ou NULL)
  --    e ainda dentro do teto. É o conjunto que a drenadora `whatsapp-dispatch` processaria.
  --    Apenas contagem (a função não envia); serve de observabilidade e critério de teste.
  select count(*)::integer into v_eligible
  from public.messages
  where status = 'fila'
    and attempts < max_attempts
    and (next_attempt_at is null or next_attempt_at <= now());

  return query select v_failed_max, v_failed_janela, v_eligible;
end;
$$;

comment on function public.whatsapp_process_retry_queue() is
  'Worker de retentativa (ADR-05 Fatia 2, RNF04): aplica teto de tentativas (status=falha / '
  'failure_reason=max_attempts) e expira a janela util do lembrete_d1 (failure_reason=janela_vencida) '
  'sobre messages em fila. NAO envia (o envio fisico via Evolution e da Edge Function '
  'whatsapp-dispatch). Retorna contagens de transicao e quantas mensagens restaram elegiveis para '
  'envio. Agendada pelo cron atlas_retry_queue (*/5 min, ADR-02). Testavel por chamada manual.';

-- Função privilegiada do sistema: nenhum papel do cliente a invoca. O cron roda como dono (postgres).
revoke all on function public.whatsapp_process_retry_queue() from public;
revoke all on function public.whatsapp_process_retry_queue() from authenticated;
revoke all on function public.whatsapp_process_retry_queue() from anon;
