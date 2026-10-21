# ADR-01 — Migrations aditivas da Fatia 2: webhook_events, appointments.confirmed_via, retentativa em messages, template reagendar_retorno

**Status:** proposto
**Escopo:** dados (Supabase/Postgres — somente SQL versionado)
**Depende de:** nada (é a fundação de schema; ADR-03/04/05/06 dependem desta)

## Contexto

A Fatia 2 introduz o primeiro webhook de ENTRADA e o primeiro cron do projeto. Antes de qualquer
Edge Function ou job, o schema precisa existir. Três superfícies de domínio novas e uma extensão
de enum, todas **aditivas** (nunca editar migration já aplicada — `convencoes-codigo.md`). A base é
`origin/master` (deb863c), cuja última migration é
`supabase/migrations/20250222091000_message_templates_baseline.sql`. Os novos timestamps devem ser
estritamente posteriores (ex.: `20250223xxxxxx`).

Fatos do código existente que esta ADR consome (não recria):
- `messages` (`20250220091000_messages.sql`): tem `tenant_id default current_tenant_id()`, RLS
  habilitado, **SELECT** para `admin|receptionist|professional`, **nenhuma policy de write**
  (escrita só por service role), índice único parcial `messages_dedupe_uidx (tenant_id, dedupe_key)
  where status in ('fila','enviado','entregue')`, CHECK de `template` com as 4 chaves atuais e CHECK
  de `status in ('fila','enviado','entregue','falha')`.
- `message_templates` (`20250222090000`) + seed (`20250222091000`): CHECK `template_key in
  ('confirmacao','lembrete_d1','cobranca','comprovante')`, função `seed_message_templates(uuid)`
  (security definer) e backfill por cross join. O `lembrete_d1` já traz "Responda 1 para confirmar
  ou 2 para reagendar".
- `appointments`: tem `confirmed_at` carimbado pelo trigger `appointments_validate_transition()`
  (`20250219093000`), de forma idempotente (só quando `confirmed_at is null`). Expõe
  `unique (tenant_id, id)` (`20250220089000`) para FKs compostas por tenant.
- Helpers `current_tenant_id()` / `current_role_name()` (security definer) — reutilizar, não recriar.

## Decisão

Criar **uma migration por responsabilidade coesa**, todas no mesmo passo de trabalho desta ADR
(ordenadas por timestamp). Decisões de design:

1. **Tabela `webhook_events`** (idempotência + auditoria de entrada). Colunas:
   - `id uuid pk default gen_random_uuid()`
   - `tenant_id uuid not null references tenants(id) on delete cascade` — **sem** `default
     current_tenant_id()` (a linha é escrita só por service role no webhook, que resolve o tenant
     pela instância; não há JWT de usuário).
   - `source text not null default 'evolution' check (source in ('evolution'))`
   - `external_event_id text not null` — id do evento vindo do provedor (chave de dedupe).
   - `instance_name text not null` — instância que recebeu (correlaciona ao tenant).
   - `status text not null default 'recebido' check (status in
     ('recebido','processado','ignorado','rejeitado'))`.
   - `parsed_intent text check (parsed_intent in ('confirmar','reagendar','nao_reconhecido'))`
     — nullable (só preenchido quando o evento foi interpretado).
   - `appointment_id uuid` — agendamento casado (nullable); FK composta `(tenant_id, appointment_id)`
     → `appointments(tenant_id, id)` `on delete set null` (auditoria sobrevive ao agendamento).
   - `payload jsonb not null default '{}'::jsonb` — metadados **sem PII** (sem telefone, sem texto
     cru; no máximo hash/rótulo).
   - `failure_reason text` — motivo técnico curto quando `rejeitado`.
   - `created_at timestamptz not null default now()`.
   - **Índice único `webhook_events_dedupe_uidx (source, external_event_id)`** — a trava real de
     idempotência de ENTRADA (R7). RLS **habilitado**.
   - **RLS:** SELECT só `admin` do mesmo tenant (`tenant_id = current_tenant_id() and
     current_role_name() = 'admin'`) — é auditoria sensível, recepção/profissional **não** leem
     (mais restrito que `messages`); **nenhuma** policy de INSERT/UPDATE/DELETE (write exclusivo do
     service role) — R18.

2. **`appointments.confirmed_via`** (Opção A do PRD §2.4, mantida pelo humano). `alter table
   appointments add column if not exists confirmed_via text check (confirmed_via in
   ('cliente_whatsapp','manual'))`, **nullable** (NULL = ainda não confirmado / legado). Decisão:
   coluna determinística versionada sob o RLS existente de `appointments`; o webhook grava
   `cliente_whatsapp`, a confirmação pela UI grava `manual`. Não mexer no trigger de transição aqui
   (ADR-03 decide como o webhook grava `confirmed_via` junto da transição). Sem backfill de origem
   para linhas antigas (NULL é aceitável; a UI trata ausência como "manual" por padrão — ver ADR-06).

3. **Campos de retentativa em `messages`** (RNF04). `alter table messages add column if not exists`:
   - `attempts int not null default 0`
   - `max_attempts int not null default 3`
   - `last_attempt_at timestamptz`
   - `next_attempt_at timestamptz`
   - **Índice parcial da fila elegível:** `create index if not exists messages_retry_queue_idx on
     messages (next_attempt_at) where status = 'fila'`. Não alterar o índice de dedupe existente.
   - Observação de contrato: o `handleSend` da Fatia 1 insere `messages` sem esses campos; os
     defaults cobrem (attempts=0, max_attempts=3). Não é necessário tocar o `index.ts` nesta ADR.

4. **Novo template `reagendar_retorno`** (R10/R14). Esta é a parte que toca MAIS pontos e exige
   **paridade**:
   - `messages`: estender o CHECK de `template`. Como não se pode editar a migration aplicada, usar
     `alter table messages drop constraint <nome_do_check_de_template>; alter table messages add
     constraint messages_template_check check (template in ('confirmacao','lembrete_d1','cobranca',
     'comprovante','reagendar_retorno'))`. **O coder deve descobrir o nome real do CHECK** (gerado
     pelo Postgres, provavelmente `messages_template_check`) via `\d messages` / catálogo, e usar
     `if exists` no drop para idempotência no re-apply.
   - `message_templates`: mesmo tratamento no CHECK de `template_key`.
   - Função `seed_message_templates(uuid)`: recriar com `create or replace` adicionando a 5ª linha
     `('reagendar_retorno', '<texto pt-BR>')` ao `values`, mantendo as 4 existentes **idênticas**
     (on conflict do nothing preserva idempotência). Texto proposto, sem PII e sem variável de
     dado sensível: `"Oi {nome}, recebemos seu pedido de reagendamento do {servico} na {empresa}.
     Em breve entramos em contato para encontrar um novo horário."` (usa só a lista fechada
     `{nome}{servico}{dataHora}{empresa}` da ADR-03/render.ts).
   - **Backfill** idempotente para tenants existentes: `insert ... select` da nova chave × tenants
     `on conflict (tenant_id, template_key) do nothing` — todo tenant legado ganha a 5ª linha.

## Consequências

- Habilita ADR-03 (webhook escreve `webhook_events`, grava `confirmed_via`, enfileira
  `reagendar_retorno`), ADR-04/05 (cron/worker usam os campos de retentativa) e ADR-06 (frontend lê
  `confirmed_via` e distingue o template no histórico).
- **Paridade obrigatória:** o novo `reagendar_retorno` tem de aparecer em 3 lugares de banco (CHECK
  de `messages.template`, CHECK de `message_templates.template_key`, seed+backfill) e, no frontend
  (ADR-06), no enum `MESSAGE_TEMPLATES` de `src/types/domain.ts`, no `TEMPLATE_LABELS` de
  `src/lib/whatsapp.ts`, e no `DEFAULT_TEMPLATE_BODIES`/espelho de `render.ts` consumido pela Edge
  Function (ADR-03). Divergência vira bug.
- `webhook_events` com RLS só-admin é mais restrito que `messages` de propósito (auditoria de
  entrada pode conter sinais de intenção do cliente).
- `confirmed_via` nullable não quebra o insert atual de `appointments` (useCreateAppointment não
  envia a coluna).

## Arquivos afetados

- `supabase/migrations/20250223090000_webhook_events.sql` (novo)
- `supabase/migrations/20250223091000_appointments_confirmed_via.sql` (novo)
- `supabase/migrations/20250223092000_messages_retry_fields.sql` (novo)
- `supabase/migrations/20250223093000_reagendar_retorno_template.sql` (novo — CHECKs + seed + backfill)

(Os timestamps exatos ficam a critério do coder, desde que posteriores a `20250222091000` e nesta
ordem relativa.)

## Critérios de aceite testáveis (desta ADR)

1. `supabase db reset` (CLI + Docker local) aplica TODAS as migrations limpo, exit 0. Se não houver
   CLI/Docker, registrar a limitação para o QA (ADR-07) — mas o SQL deve estar escrito.
2. Re-aplicar (segundo `db reset`) é idempotente: nenhum erro de objeto já existente; o CHECK de
   `template` fica estável com exatamente as 5 chaves (não duplica constraint).
3. `webhook_events` existe com RLS habilitado, índice único `(source, external_event_id)`, e as
   policies corretas: um usuário `receptionist`/`professional` **não** lê a tabela; `admin` lê só do
   próprio tenant; nenhum papel do cliente consegue INSERT (R18). Verificar com o padrão de teste de
   RLS com signup trigger ativo (ver nota de brain `testar-rls-com-signup-trigger-ativo`).
4. Cadastrar um tenant novo (signup) cria exatamente **5** `message_templates`
   (`confirmacao|lembrete_d1|cobranca|comprovante|reagendar_retorno`), todos ativos, body não-vazio.
5. `appointments.confirmed_via` aceita `cliente_whatsapp`/`manual`/NULL e rejeita outro valor (CHECK).
6. `messages` aceita `template='reagendar_retorno'`; `attempts/max_attempts/next_attempt_at/
   last_attempt_at` existem com os defaults corretos; `messages_retry_queue_idx` existe.
7. `npm run build` e `npm run typecheck` permanecem limpos (ADR SQL-only não toca frontend ainda).

## Verificação

- `cd <worktree> && supabase db reset` → exit 0 (duas vezes seguidas, para idempotência).
- `cd <worktree> && npm run build` → exit 0.
- Consultas de inspeção no banco local (psql/supabase) confirmando CHECKs, índices e contagem de
  templates por tenant, conforme os critérios acima.
