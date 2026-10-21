-- Migration: whatsapp_claim_retry_batch() + estado 'enviando' — CLAIM atômico da fila (ADR-05, RNF04)
-- CORREÇÃO de review (adr-05.review.json, issue bloqueante): a drenadora `whatsapp-dispatch` fazia
-- `select(status='fila')` → `adapter.sendText()` → `update(status='enviado')` SEM claim atômico
-- nem lock entre a seleção e o envio. Duas invocações sobrepostas (tick do cron + invocação
-- manual do QA, que a própria ADR-05 prevê) podiam selecionar a MESMA linha em `fila` e chamar
-- `sendText` duas vezes — entrega duplicada. O índice `messages_dedupe_uidx` só impede DUAS LINHAS
-- com a mesma `dedupe_key` viva; NÃO impede enviar a MESMA linha duas vezes. Isso furava o
-- critério de aceite #4 da ADR-05 ("o que está enviado/entregue nunca é reprocessado") e a RNF04
-- (não duplicar efeito).
--
-- SOLUÇÃO: um estado intermediário de CLAIM (`enviando`) + seleção atômica no banco com
-- `FOR UPDATE SKIP LOCKED`. A drenadora chama esta RPC, que:
--   (i)   trava e flipa `fila` → `enviando` em UMA transação (ninguém mais pega a mesma linha);
--   (ii)  filtra elegibilidade no BANCO — `attempts < max_attempts` e `next_attempt_at <= now()`
--         (ou NULL, legado da Fatia 1). Isso também corrige issue 3 (linhas no teto NÃO ocupam
--         slots do lote) e issue 2 (some o filtro `.or()` com timestamp citado no PostgREST, cuja
--         interpretação do timestamptz era incerta — agora a comparação é SQL puro, sem ambiguidade);
--   (iii) retorna as linhas JÁ reivindicadas para a drenadora enviar.
-- Depois do envio: sucesso → `enviado`; erro → backoff voltando a `fila` (feito na drenadora Deno).
--
-- RECLAIM / TTL (linha presa em `enviando`): se a drenadora cair DEPOIS do claim e ANTES de
-- resolver (`enviado`/`fila`), a linha ficaria presa em `enviando` para sempre. A RPC, no começo,
-- devolve à `fila` qualquer linha `enviando` cujo `last_attempt_at` seja mais velho que o TTL
-- (5 min — maior que o tempo de uma passada de drenagem). Assim nenhuma mensagem se perde: ou foi
-- enviada, ou volta a ser elegível. Como `enviando` NÃO é terminal, a mensagem reentra no fluxo
-- normal de backoff/teto.
--
-- MUDANÇAS DE SCHEMA (aditivas, nunca editar migration aplicada):
--   1. CHECK de `messages.status` ganha o valor `'enviando'` (claim em curso). Recriado via
--      `drop constraint if exists` + `add constraint`, idempotente.
--   2. Índice de dedupe `messages_dedupe_uidx` passa a cobrir também `'enviando'`: uma linha
--      reivindicada continua "viva" para a trava de unicidade — ninguém insere uma segunda linha
--      com a mesma `dedupe_key` enquanto a primeira está sendo enviada. Recriado (drop + create).
--
-- ISOLAMENTO MULTI-TENANT (RNF03): a RPC é o worker do sistema (`security definer`), opera sobre
-- todas as linhas, mas NÃO cruza tenants — cada linha retornada carrega seu próprio `tenant_id`, e
-- a drenadora filtra customer/instância/tenant por esse `tenant_id` da própria linha, nunca de
-- parâmetro. A RPC não recebe `tenant_id`.
--
-- SEGURANÇA: `security definer` + `search_path` fixo (escreve `messages`, vedada ao cliente).
-- REVOKE de `public`/`authenticated`/`anon`: só o servidor (service role da drenadora) invoca.
-- Nenhum segredo no SQL. Idempotente no re-apply (`create or replace`, `if exists`/`if not exists`).

-- ============================================================================
-- 1. Estado 'enviando' no CHECK de messages.status (claim em curso).
-- ============================================================================
alter table public.messages drop constraint if exists messages_status_check;
alter table public.messages
  add constraint messages_status_check
  check (status in ('fila','enviando','enviado','entregue','falha'));

-- ============================================================================
-- 2. Dedupe vivo inclui 'enviando': linha reivindicada ainda bloqueia uma segunda linha igual.
-- ============================================================================
drop index if exists messages_dedupe_uidx;
create unique index if not exists messages_dedupe_uidx
  on public.messages (tenant_id, dedupe_key)
  where status in ('fila','enviando','enviado','entregue');

-- ============================================================================
-- 3. whatsapp_claim_retry_batch(p_batch_limit) — CLAIM atômico da fila elegível.
--    Reclaim de 'enviando' preso (TTL), depois trava `fila`→`enviando` com FOR UPDATE SKIP LOCKED
--    e devolve as linhas reivindicadas para a drenadora enviar. Seguro sob concorrência.
-- ============================================================================
create or replace function public.whatsapp_claim_retry_batch(p_batch_limit integer default 50)
returns table (
  id             uuid,
  tenant_id      uuid,
  customer_id    uuid,
  appointment_id uuid,
  template       text,
  attempts       integer,
  max_attempts   integer
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  -- TTL de reclaim: linha em `enviando` mais velha que isto é considerada presa (drenadora caiu).
  v_stuck_ttl constant interval := interval '5 minutes';
  v_limit integer := greatest(1, coalesce(p_batch_limit, 50));
begin
  -- 0. RECLAIM: devolve à `fila` o que ficou preso em `enviando` além do TTL (drenadora caiu no
  --    meio do envio). NÃO mexe em attempts/next_attempt_at — a linha reentra no fluxo normal.
  update public.messages
  set status = 'fila'
  where status = 'enviando'
    and coalesce(last_attempt_at, created_at) < now() - v_stuck_ttl;

  -- 1. CLAIM ATÔMICO: seleciona as elegíveis (fila, dentro do teto, prontas agora) com
  --    FOR UPDATE SKIP LOCKED — duas invocações concorrentes nunca pegam a mesma linha — e as
  --    flipa para `enviando` carimbando `last_attempt_at` (âncora do TTL de reclaim). Só as linhas
  --    efetivamente reivindicadas são devolvidas à drenadora.
  return query
  with eligible as (
    select m.id
    from public.messages m
    where m.status = 'fila'
      and m.attempts < m.max_attempts
      and (m.next_attempt_at is null or m.next_attempt_at <= now())
    order by m.next_attempt_at asc nulls first
    limit v_limit
    for update skip locked
  )
  update public.messages m
  set status = 'enviando',
      last_attempt_at = now()
  from eligible e
  where m.id = e.id
  returning
    m.id,
    m.tenant_id,
    m.customer_id,
    m.appointment_id,
    m.template,
    m.attempts,
    m.max_attempts;
end;
$$;

comment on function public.whatsapp_claim_retry_batch(integer) is
  'Claim atomico da fila de retentativa (ADR-05 Fatia 2, RNF04): reclaim de enviando preso (TTL 5min), '
  'depois trava fila->enviando com FOR UPDATE SKIP LOCKED filtrando attempts<max_attempts e '
  'next_attempt_at<=now(). Devolve as linhas reivindicadas para a drenadora whatsapp-dispatch enviar. '
  'Impede envio duplicado da mesma mensagem sob invocacoes concorrentes. Nenhum segredo no SQL.';

-- Função privilegiada do sistema: só a drenadora (service role) invoca; nenhum papel do cliente.
revoke all on function public.whatsapp_claim_retry_batch(integer) from public;
revoke all on function public.whatsapp_claim_retry_batch(integer) from authenticated;
revoke all on function public.whatsapp_claim_retry_batch(integer) from anon;
