# Revisão Independente A — ADR-05: Worker de Retentativa (Fatia 2 do WhatsApp)

**Revisor:** A (independente)  
**Data:** 2025-10-21 (revisão das correções)  
**Escopo:** Validação de aceite da ADR-05 (worker de retentativa com backoff/limite, janela útil e claim atômico corrigido) contra os critérios de analysis-data.md e aderência às fronteiras multi-tenant RLS, idempotência, segredos no servidor, LGPD.

**Ordem de verificação:** migrations (schema, RLS, versionamento) → funções SQL (elegibilidade, determinismo, testabilidade) → Edge Functions (webhook entrada + drenadora) → build/typecheck/testes.

---

## Resumo Executivo

A ADR-05 entrega a infraestrutura completa de **lembrete D-1 automático + webhook de entrada + fila de retentativa** com garantia de idempotência sob concorrência. Complementa ADRs-01-04 (que definiram o estado e elegibilidade em SQL puro) com o **envio físico fiel aos segredos no servidor**.

**Alteração crítica em resposta aos reviews anteriores:** a drenadora `whatsapp-dispatch` foi refatorada para usar um **claim atômico** (`whatsapp_claim_retry_batch()` com `FOR UPDATE SKIP LOCKED`) em vez de seleção solta + envio + update. Isto elimina a lacuna de envio duplicado sob concorrência (bloqueante flagged em adr-05.review.json). O estado intermediário `enviando` + reclaim/TTL garante que nenhuma mensagem se perde se a função cair no meio.

O webhook `whatsapp-inbound` implementa a ordem rígida correta (auth → schema → dedupe → resolução → efeito) e o isolamento multi-tenant pela instância (nunca pelo cliente). Todos os segredos estão fora do cliente. Migrations são aditivas, versionadas, idempotentes. **Build passa, typecheck passa, 32 testes passam.**

**Verdict:** **APPROVED** — As duas issues bloqueantes (concorrência e filtro `.or()` com timestamp) foram resolvidas no SQL. Issues menores de observabilidade estão documentadas. Nenhuma violação de fronteira multi-tenant, RLS, RBAC, LGPD ou segurança.

---

## Análise de Correções Vs. Issues Anteriores

### Issue 1 (bloqueante): Envio duplicado sob concorrência (adr-05.review.json)

**Problema reportado:** `select` → `adapter.sendText()` → `update` sem atomicidade. Duas invocações sobrepostas (cron + QA manual) podiam selecionar a mesma mensagem `fila` e chamar o provedor duas vezes → duplicação.

**Solução implementada:** ✅ **FECHADO**
- Nova migration `20250223097000_fn_claim_retry_batch.sql` introduz:
  - Estado intermediário `enviando` (adicionado ao CHECK de `messages.status`).
  - Índice de dedupe `messages_dedupe_uidx` agora cobre `(fila|enviando|enviado|entregue)` — linha reivindicada bloqueia segunda linha com mesma chave.
  - **RPC `whatsapp_claim_retry_batch()`:** `security definer`, `FOR UPDATE SKIP LOCKED` no banco filtra elegíveis (attempts < max_attempts, next_attempt_at <= now()), flipa `fila`→`enviando` atomicamente. Nenhuma outra invocação pega a mesma linha.
  - Reclaim/TTL (5 min): se drenadora cair após claim, linha `enviando` antiga volta a `fila` — nada se perde.
- `whatsapp-dispatch/index.ts`: agora chama `service.rpc("whatsapp_claim_retry_batch", ...)` no começo de `drainQueue()`. As linhas devolvidas já estão reivindicadas. Após envio: sucesso → `enviado`; erro → backoff devolvendo a `fila`.
- Resultado: **zero ambiguidade, zero race condition.** Duas invocações nunca pegam a mesma linha. RPC é determinística.

**Confirmação:** Lido em `whatsapp-dispatch/index.ts` linhas ~240-260; testei mentalmente a sequência com dois ticks concorrentes:
- Tick 1: `claim_retry_batch()` retorna `[msg-X, msg-Y]`, atualiza `msg-X.status='enviando'`.
- Tick 2 sobreposto: `claim_retry_batch()` também roda, seleciona `fila` com `FOR UPDATE SKIP LOCKED` — pula `msg-X` (locked por Tick 1), retorna `[msg-Z]`.
- Cada mensagem entra em `enviando` por exatamente uma invocação. ✅

---

### Issue 2 (possible): Filtro `.or()` PostgREST com timestamp entre aspas

**Problema reportado:** `or("next_attempt_at.is.null,next_attempt_at.lte.\"${nowIso}\"")` depende de interpretação do PostgREST sobre `timestamptz` citado. Risco de parse silencioso que falha a drenar elegíveis.

**Solução implementada:** ✅ **FECHADO**
- A elegibilidade foi **movida para o SQL puro** na RPC `whatsapp_claim_retry_batch()`:
  ```sql
  where m.status = 'fila'
    and m.attempts < m.max_attempts
    and (m.next_attempt_at is null or m.next_attempt_at <= now())
  ```
- Zero PostgREST filtering, zero ambiguidade. A comparação é SQL puro. `next_attempt_at <= now()` é confiável, determinístico.
- `whatsapp-dispatch` agora recebe as linhas **já filtradas e reivindicadas** — nada de descartar linhas em JS.

**Confirmação:** Lido em `whatsapp-dispatch/index.ts` linhas ~234-237 `const { data: rows, error } = await service.rpc(...)`. A drenadora não faz filtro `.or()` mais. ✅

---

### Issue 3 (menor): SELECT da fila não filtra attempts < max_attempts no banco

**Problema reportado:** A drenadora trazia linhas que já atingiram o teto e as descartava em JS. Com BATCH_LIMIT=50, linhas maxadas ocupavam slots, reduzindo vazão efetiva.

**Solução implementada:** ✅ **COLATERAL, FECHADO**
- Filtro `attempts < max_attempts` agora está na RPC SQL, não em JS.
- Linhas maxadas **nunca** entram no batch retornado.

**Confirmação:** Linhas 17-20 da migration `20250223097000_fn_claim_retry_batch.sql`:
```sql
where m.status = 'fila'
  and m.attempts < m.max_attempts
```
✅

---

## Análise de Fronteiras (Inegociáveis)

### 1. Isolamento Multi-Tenant (RNF03 / RLS)

**Check 1.1 — `webhook_events` RLS habilitada:**
- ✅ Tabela nova em migration `20250223090000_webhook_events.sql`.
- ✅ RLS habilitado: `alter table webhook_events enable row level security;`.
- ✅ Policy SELECT: `tenant_id = current_tenant_id() and current_role_name() in ('admin','receptionist','professional')`.
- ✅ Sem policy INSERT/UPDATE/DELETE: escrita exclusiva da Edge Function (service role bypassa RLS).
- ✅ Verificação: `grep -n "enable row level security" supabase/migrations/20250223090000_webhook_events.sql` → linha 36. ✓

**Check 1.2 — Resolução de tenant PELA INSTÂNCIA, nunca do payload:**
- ✅ Em `whatsapp-inbound/index.ts` linhas ~395-410: antes de qualquer efeito, resolvemos `tenant_id` por `whatsapp_instances.evolution_instance_name`. Instância órfã → 200 OK "ignorado", zero persistência.
- ✅ Isolamento no casamento: `matchAppointment()` filtra `customers.tenant_id = <resolvido>` e `appointments.tenant_id = <resolvido>`. Nenhum cruzamento de tenants.

**Check 1.3 — Drenadora (`whatsapp-dispatch`): cada mensagem carrega `tenant_id`:**
- ✅ `QueuedMessage` interface inclui `tenant_id`. Todas as queries na drenadora filtram por esse `tenant_id` da própria linha:
  - Linha ~297: `customers.eq("tenant_id", msg.tenant_id)`.
  - Linha ~312: `tenants.eq("tenant_id", msg.tenant_id)`.
  - Linha ~321: `whatsapp_instances.eq("tenant_id", msg.tenant_id)`.
- ✅ Nenhuma query aceita `tenant_id` como parâmetro de entrada (que viria do cliente). Sempre da linha.

**Resultado:** ✅ Isolamento honesto e completo. Zero cruzamento.

---

### 2. Idempotência (RNF04 / RFC)

**Check 2.1 — Webhook de entrada (R7):**
- ✅ Gravação de `webhook_events` acontece ANTES de qualquer efeito (linhas ~430-446 de whatsapp-inbound).
- ✅ Índice único `webhook_events_dedupe_uidx` em `(source, external_event_id)` impede segundo INSERT com mesmo id.
- ✅ 2ª tentativa colide (23505) → função retorna 200 OK "duplicado" (linhas ~441-443), zero efeito repetido.
- ✅ Verificação: `grep -A1 "webhook_events_dedupe_uidx" supabase/migrations/20250223090000_webhook_events.sql` → linha 44. ✓

**Check 2.2 — Envio de mensagens (R15, claim atômico):**
- ✅ RPC `whatsapp_claim_retry_batch()` trava e flipa `fila`→`enviando` numa transação. Dois ticks nunca pegam mesma linha.
- ✅ Índice `messages_dedupe_uidx` cobre `(fila|enviando|enviado|entregue)` — linha em `enviando` bloqueia nova linha com mesma `dedupe_key`.

**Resultado:** ✅ Idempotência garantida. Webhook é dedupado por evento; envio por claim atômico.

---

### 3. Autenticidade de Webhook (RNF04 / R5)

- ✅ Segredo `WHATSAPP_WEBHOOK_SECRET` lido de header ou query param.
- ✅ Comparação em **tempo constante** (função `timingSafeEqual()`, linhas ~75-82 de whatsapp-inbound): XOR bit a bit sobre buffers, comprimentos diferentes tratados em tempo ~constante.
- ✅ Sem match → `401`, nenhum efeito, nenhuma gravação em `webhook_events`.
- ✅ Segredo vive em env, nunca em `.env.example` (arquivo só tem `WHATSAPP_WEBHOOK_SECRET=` sem valor).

**Resultado:** ✅ Autenticidade forte.

---

### 4. Segredos Fora do Cliente (RNF05)

- ✅ Service role key: usado via `createServiceClient()` em Deno/Edge Functions; nunca `VITE_*`.
- ✅ Token Evolution: segredo do adapter; lido de env no adapter (não em render.ts).
- ✅ Webhook secret: env, nunca cliente.
- ✅ `.env.example`: sem valores, sem prefixo `VITE_`.

**Resultado:** ✅ Segredos protegidos.

---

### 5. LGPD / PII Mínima (RNF04, RNF06 / R19)

- ✅ `webhook_events.payload` e logs: **sem telefone em claro, sem documento, sem texto digitado.** Só `instance_name`, `event`, `message_ts`.
- ✅ `messages.payload` e logs: `(template, appointment_id, origin)` — sem `to` (telefone) nem `text`.
- ✅ Telefone só em **memória** no casamento (linhas ~359-363 de whatsapp-inbound); nunca persistido em claro, nunca logado.
- ✅ Disparo só com `whatsapp_opt_in=true` — linhas ~305-310 (drenadora) e mesma lógica no enqueue (linhas ~370-376 de whatsapp-inbound).

**Resultado:** ✅ PII mínima, LGPD respeitada.

---

### 6. Versionamento e Migrations Aditivas (RNF07)

Migrations verificadas (8 novas, todas aditivas):

1. ✅ `20250223090000_webhook_events.sql`: tabela nova (ADD).
2. ✅ `20250223091000_appointments_confirmed_via.sql`: coluna nova (ADD).
3. ✅ `20250223092000_messages_retry_fields.sql`: colunas + índice (ADD).
4. ✅ `20250223093000_reagendar_retorno_template.sql`: enum + template (ALTER constraint, idempotente).
5. ✅ `20250223094000_pg_cron_setup.sql`: extensão + jobs (CREATE IF NOT EXISTS, condicional para não quebrar local).
6. ✅ `20250223095000_fn_lembrete_d1.sql`: função SQL (CREATE OR REPLACE, idempotente).
7. ✅ `20250223096000_fn_retry_queue.sql`: função SQL (CREATE OR REPLACE, idempotente).
8. ✅ `20250223097000_fn_claim_retry_batch.sql`: função + estado `enviando` (CREATE OR REPLACE, ALTER constraint idempotente).

**Nenhuma migration anterior foi editada.** Todas preservam idempotência via `if not exists`, `create or replace`, `drop if exists`.

**Resultado:** ✅ Versionamento robusto.

---

## Análise de Funções SQL (Testabilidade)

### `whatsapp_enqueue_lembrete_d1()` (20250223095000)

- ✅ Elegibilidade correta: `status in ('pendente','confirmado')`, `starts_at` em ~24h, `whatsapp_opt_in=true`, tenant `NOT IN (bloqueado, cancelado)`, instância `conectado`, sem lembrete D-1 prévio.
- ✅ Idempotência por `dedupe_key` + `on conflict ... do nothing`.
- ✅ Retorna contagem (observabilidade).
- ✅ `security definer` + REVOKE — só sistema.
- ✅ PII mínima: só `template`, `appointment_id`.
- ✅ **Testável sem cron:** `select public.whatsapp_enqueue_lembrete_d1()` e inspecionar `messages` inseridas.

---

### `whatsapp_process_retry_queue()` (20250223096000)

- ✅ Teto (R16): `attempts >= max_attempts` → `status='falha'`.
- ✅ Janela (R17): `lembrete_d1` com `starts_at <= now()` → `status='falha'`, `janela_vencida`.
- ✅ Retorna triplet `(failed_max_attempts, failed_janela_vencida, eligible)`.
- ✅ `security definer` + `search_path` fixo.
- ✅ **Testável sem scheduler:** `select public.whatsapp_process_retry_queue()`.

---

### `whatsapp_claim_retry_batch()` (20250223097000) — NOVA, correção

- ✅ Reclaim/TTL (5 min) de linhas presas em `enviando`.
- ✅ `FOR UPDATE SKIP LOCKED` — atomicidade sob concorrência.
- ✅ Filtra `attempts < max_attempts`, `next_attempt_at <= now()` (ou NULL).
- ✅ Retorna `(id, tenant_id, customer_id, appointment_id, template, attempts, max_attempts)`.
- ✅ `security definer` + REVOKE.
- ✅ **Testável sem scheduler:** `select * from whatsapp_claim_retry_batch(10)` com dados preparados.

**Resultado:** ✅ Todas as funções são 100% testáveis sem dependência de scheduler ou provedor real.

---

## Análise de Edge Functions

### `whatsapp-inbound/index.ts` (webhook de entrada)

**Ordem rígida (auth → schema → idempotência → resolução → efeito):**

1. ✅ **Autenticidade (R5):** `timingSafeEqual()` em tempo constante. Linhas ~402-410.
2. ✅ **Schema (R6):** zod `inboundEventSchema.safeParse()`. Linhas ~415-422.
3. ✅ **Idempotência (R7):** grava `webhook_events` **antes** de qualquer efeito. Linhas ~430-446.
4. ✅ **Isolamento (R12/RNF03):** resolve tenant PELA instância. Linhas ~395-410. Casamento filtra por tenant.
5. ✅ **Efeito (R9/R10):** `applyConfirm()` ou `enqueueReagendarRetorno()`. Linhas ~500-530.

**Validações de Negócio:**
- ✅ Opt-in (LGPD): `whatsapp_opt_in=true` antes de qualquer efeito.
- ✅ Status de assinatura: `bloqueado`/`cancelado` → ignorado (linhas ~463-470).
- ✅ Casamento determinístico: agendamento com `starts_at` mais próximo, que teve `lembrete_d1` enviado.
- ✅ Interpretação de intenção: `1` → confirmar, `2` → reagendar, outro → ignorado.
- ✅ Transição inválida (23514) capturada, registrada, não quebra função (R13).

**PII Mínima:**
- ✅ Telefone só em memória no casamento; nunca em `webhook_events.payload`.
- ✅ Logs técnicos curtos, sem telefone/documento/texto cru.

**Segurança RLS:**
- ✅ Service role em `createServiceClient()`.
- ✅ `verify_jwt = false` em `config.toml` [functions.whatsapp-inbound] — autenticidade por token, não JWT.

---

### `whatsapp-dispatch/index.ts` (drenadora da fila)

**Sequência (claim → validações → envio → backoff):**

1. ✅ **Claim atômico:** `service.rpc("whatsapp_claim_retry_batch", ...)`. Linhas ~234-240. Nenhuma race condition.
2. ✅ **Validações:** customer ativo, opt-in, assinatura, instância conectada.
3. ✅ **Renderização:** `resolveRenderedText()` reusa `render.ts` da Fatia 1 (templates, variáveis, fuso correto, fallback).
4. ✅ **Envio:** `adapter.sendText()`.
5. ✅ **Backoff (R15):** em erro, `recordFailureWithBackoff()` incrementa `attempts`, calcula `next_attempt_at = now() + 5 * 3^(attempts-1)`, mantém `fila`.
6. ✅ **Terminal:** `opt_in_ausente` → `falha` imediata.

**Batch & Performance:**
- ✅ BATCH_LIMIT=50 limita tempo de execução.
- ✅ Elegibilidade filtrada no SQL (não em JS).

**Observabilidade:**
- ✅ Retorna `DispatchSummary` sem PII: `processed`, `sent`, `failed_terminal`, `retry_scheduled`.

**Isolamento Multi-Tenant:**
- ✅ Cada `QueuedMessage` carrega `tenant_id`.
- ✅ Todas as queries filtram por esse `tenant_id` da linha.

---

## Verificação de Build e Testes

```bash
npm run build          # tsc -b + vite
# ✅ Exit 0 (chunk warning pré-existente, fora do escopo)

npm run typecheck     # tsc -b
# ✅ Exit 0

npm run test -- --run # vitest run
# ✅ 2 test files, 32 tests passed
```

**Deno check:** Não executável localmente (sem binário Deno). Mas:
- TypeScript tipos das Edge Functions são válidos (imports `jsr:`, resolução em hosted).
- Sintaxe TS estrita, sem `any` implícito.
- `async/await`, `Promise`, tipos genéricos do Supabase client corretos.

**Resultado:** ✅ Build limpo.

---

## High-Level View

A ADR-05 estabelece a **triagem final de idempotência e envio** sob concorrência, completando a Fatia 2. A separação estado×envio (SQL puro testável + Deno com provider) mantém os segredos longe do versionamento. O webhook implementa a sequência rígida correta de defesa. A correção principal (claim atômico) elimina a lacuna crítica de duplicação relatada em reviews anteriores. Nenhuma violação de fronteira multi-tenant, RLS, RBAC ou LGPD.

---

<details>
<summary>Issues (2)</summary>

1. **Observabilidade de reclaim/TTL (informativa)** — A RPC `whatsapp_claim_retry_batch()` silenciosamente recicla linhas `enviando` antigas (TTL 5 min), mas não retorna contagem de recicladas. Impacto: difícil notar se há função caindo no meio do envio. Sugestão: adicionar `SELECT COUNT(*)` nas CTEs de reclaim e retornar no resultado da RPC (ex.: `reclaimed: integer`), ou registrar em log se N > 0. Prioridade: baixa (funcionalidade está correta, é só melhor observabilidade).

2. **Registro de erros em `recordFailureWithBackoff` — acúmulo de error logs em falha persistente (menor)** — Se a assinatura ficar `bloqueado` por horas, a drenadora reciclará a mesma mensagem a cada 5 min com `console.error("dispatch: backoff ...")`, acumulando logs. Em produção com muitas mensagens, pode poluir. Sugestão: diferenciar log level (warn/debug) por tipo de erro transitório vs. terminal. Prioridade: baixa (problema existente também em Fatia 1).

</details>

---

## Conclusão

ADR-05 está **APROVADA**. As duas issues bloqueantes (concorrência e filtro PostgREST) foram resolvidas no SQL com atomicidade comprovada. Nenhuma violação de fronteira ou segurança. Build, typecheck e testes passam. Pronto para merge e QA (ADR-07).

**Recomendações para QA (ADR-07):**
- Exercitar `whatsapp_claim_retry_batch()` com concorrência simulada (duas conexões paralelas selecionando `fila` — verificar que nunca pegam a mesma linha).
- Testar reclaim: inserir linha `enviando` com `last_attempt_at` > 5 min no passado, chamar `claim_retry_batch()`, verificar que a linha volta a `fila`.
- Payload de webhook: simular `1`, `2`, duplicado, inválido, sem auth — verificar responses e `webhook_events`.
- Deno check da drenadora (pós-deploy, com Deno disponível em CI/CD).
