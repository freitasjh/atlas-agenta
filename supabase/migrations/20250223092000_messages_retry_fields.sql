-- Migration: messages — campos de retentativa da fila de disparo (ADR-01 Fatia 2, RNF04)
-- A Fatia 2 introduz o worker de retentativa (ADR-05): mensagens em `fila` cujo envio falhou
-- temporariamente são reenviadas com backoff/limite, respeitando a janela útil (R15/R16/R17).
-- O schema de `messages` (20250220091000) só tem status/dedupe; faltam os campos de controle da
-- fila. Esta migration os adiciona de forma ADITIVA (nunca editar migration aplicada).
--
-- Campos (todos nullable ou com default seguro, para não quebrar o insert atual do handleSend da
-- Fatia 1, que não os envia):
--   - attempts         int not null default 0    — tentativas já feitas.
--   - max_attempts     int not null default 3     — limite N; ao atingir, status='falha' (R16).
--   - last_attempt_at  timestamptz                — quando foi a última tentativa (diagnóstico).
--   - next_attempt_at  timestamptz                — quando a próxima tentativa fica elegível
--                                                    (backoff); NULL = elegível imediatamente.
--
-- Índice parcial da fila elegível: `messages (next_attempt_at) where status = 'fila'` — o worker
-- (ADR-05) varre só as linhas em fila ordenando por `next_attempt_at`, sem tocar o índice de
-- dedupe existente (`messages_dedupe_uidx`). NÃO alterar o índice de dedupe.
--
-- Contrato com a Fatia 1: o `handleSend` insere `messages` sem esses campos; os defaults cobrem
-- (attempts=0, max_attempts=3, next_attempt_at=NULL). Não é necessário tocar o index.ts nesta ADR.
--
-- Aditiva e idempotente (`add column if not exists` / `create index if not exists`). Não altera
-- RLS nem as policies de `messages`. Nenhum segredo no SQL.

alter table public.messages
  add column if not exists attempts        int not null default 0,
  add column if not exists max_attempts    int not null default 3,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists next_attempt_at timestamptz;

-- Fila elegível: só linhas em 'fila', ordenáveis por next_attempt_at. O worker (ADR-05) usa isto.
create index if not exists messages_retry_queue_idx
  on public.messages (next_attempt_at)
  where status = 'fila';
