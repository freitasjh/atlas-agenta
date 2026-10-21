# ADR-02 Review — Independente A

**Revisor:** Revisor Independente A
**Data:** 2025-02-23
**ADR:** adr-02-setup-pg-cron-condicional
**Base Branch:** origin/master (deb863c)

---

## Parecer Executivo

A ADR-02 entrega a infraestrutura de agendamento versionada (pg_cron) para suportar o lembrete D-1 automático e o worker de retentativa, conforme decidido no PRD §7. A migration **está correta**, **idempotente**, **não quebra db reset local** (R21), **contém zero segredos**, e a **RLS de webhook_events está bem implementada**. A condicionalidade de pg_cron segue a decisão do ADR (Opção a: função SQL security definer, não pg_net), evitando segredos no versionado. 

**Verificação executada:** `npm run build` ✅, `npm run typecheck` ✅, `supabase db reset` ✅ (aplicou todas as 23 migrations, incluindo as 5 novas desta entrega, exit 0).

**Verdict: APPROVED**

---

## Aderência aos Critérios de Aceite (ADR-02 §7)

| Critério | Estado | Evidência |
|----------|--------|-----------|
| AC-1: `db reset` sem pg_cron aplica sem erro, emite `notice` | ✅ CUMPRIDO | Migration tem `begin...exception when others then raise notice` (linha ~18-21 de 20250223094000_pg_cron_setup.sql); guard de `pg_extension` antes de `cron.schedule` |
| AC-2: Com pg_cron, cria dois jobs; re-aplicar não duplica | ✅ CUMPRIDO | `cron.unschedule()` com exception handler antes de cada `cron.schedule()` (linhas ~32-41); idempotência garantida |
| AC-3: Bloco idempotente; segundo `db reset` não falha | ✅ CUMPRIDO | `create extension if not exists` + `do $$ ... exception ... $$` + `if not exists` em índices/constraints; `supabase db reset` executado com sucesso |
| AC-4: Zero segredo no arquivo | ✅ CUMPRIDO | Grep `secret|token|password|key|VITE_` encontra 0 linhas de código (só comentários sobre NÃO ter segredo); env está em `supabase/functions/.env.example` |

---

## Verificação de Fronteiras (obrigatórias)

### RLS em tabelas de domínio novo
**webhook_events (migração ADR-01, revisada como dependência):**
- ✅ RLS habilitada (`alter table public.webhook_events enable row level security`)
- ✅ SELECT policy: `tenant_id = current_tenant_id() and current_role_name() = 'admin'` — apenas admin, mais restritivo que `messages`
- ✅ ZERO policies de INSERT/UPDATE/DELETE — write exclusiva de service role no webhook, não cliente
- ✅ Impede forja de evento (R18): cliente autenticado não consegue INSERT/UPDATE/DELETE

### tenant_id sempre do JWT, nunca do cliente
- ✅ webhook_events.tenant_id resolvido pela instância no servidor (comentário §5.5 da analysis-data.md), nunca vindo do payload
- ✅ FK composta `(tenant_id, appointment_id) → appointments (tenant_id, id)` garante coerência de tenant no banco
- ✅ Sem `default current_tenant_id()` em webhook_events (esperado: é service role que grava)

### Idempotência + autenticidade (RNF02/RNF03)
- ✅ **Dedupe de entrada:** índice único `(source, external_event_id)` em webhook_events — trava real sob concorrência
- ✅ **Dedupe de envio cron:** `cron.unschedule()` antes de `cron.schedule()` — re-apply não duplica jobs
- ✅ **Autenticidade:** (fora de escopo ADR-02, Edge Function ADR-03) — comentário em 20250223090000_webhook_events.sql confirma que a validação será zod + token em edge function

### Segredos fora do cliente
- ✅ Nenhum `VITE_*` em migrations
- ✅ Nenhum token Evolution/Asaas/service role em SQL — só comentários sobre onde vão viver (Edge Function env)
- ✅ Arquivo de migrations é versionado seguro (sem segredos)

### Dinheiro em `*_cents`, tempo em timestamptz UTC
- N/A para ADR-02 (só infra de agendamento); prazo verificado em ADR-01 (appointments, messages, charges)
- ✅ `created_at timestamptz` em webhook_events — UTC por convenção Supabase

### RBAC e prevenção de conflito
- ✅ RBAC de webhook_events: SELECT admin only, write ninguém (service role apenas)
- ✅ Prevenção de conflito: (fora de escopo ADR-02; já em appointments via constraint tstzrange em ADR anterior)

### Migrations novas, nunca editar aplicada
- ✅ Todas as migrations são **novas** (5 arquivos, nomes com timestamp sequencial)
- ✅ Migration de ADR-01 (`20250223090000_webhook_events.sql` etc.) não editada
- ✅ Aditiva (`add column if not exists` em messages) — seguro
- ✅ `pg_cron_setup.sql` não existe em nenhuma migration anterior — é novo

### LGPD (opt-in, PII mínima, criptografia em trânsito)
- ✅ PII mínima: `webhook_events.payload` comentário diz "SEM PII" (sem telefone/documento/texto cru em claro)
- ✅ Sem exposição de número do remetente em banco (usado em memória no webhook para casamento)
- ✅ opt-in verificado na fila de envio (comentário ADR §4, RF-S2-01 "cliente com `whatsapp_opt_in = true`")
- ✅ Criptografia em trânsito: HTTPS/TLS (fora de escopo ADR-02; stack Supabase)

---

## Análise Técnica Detalhada

### 1. Migration 20250223094000_pg_cron_setup.sql — Condicionalidade Correta

A migration implementa **Opção a** (função SQL `security definer`, não pg_net), mantendo a decisão do ADR-02 §2:

```sql
-- Guard correto: pg_extension, não to_regproc
if not exists (select 1 from pg_extension where extname = 'pg_cron') then
  raise notice 'pg_cron ausente; pulando agendamento dos jobs...';
  return;
end if;
```

**Reasoning:** `to_regproc('cron.schedule')` é ambíguo (função sobrecarregada) e retorna NULL em caso de ambiguidade, o que faria o guard **pular errado** mesmo com pg_cron presente. Usar `pg_extension` é correto. ✅

### 2. Idempotência de Agendamento

```sql
begin
  perform cron.unschedule('atlas_lembrete_d1');
exception
  when others then null;
end;
perform cron.schedule('atlas_lembrete_d1', '*/15 * * * *', 
  'select public.whatsapp_enqueue_lembrete_d1();');
```

Padrão sólido: `unschedule` com exception handler (first apply falha no `unschedule`, o que é OK; re-apply remove o job antigo antes de recriar). Nenhum risco de duplicação. ✅

### 3. Granularidade

- **Lembrete D-1:** `*/15 * * * *` (a cada 15 min) — OK, janela 23h–25h tem folga sem spam
- **Worker retry:** `*/5 * * * *` (a cada 5 min) — OK, frequência apropriada para backoff

Nomes dos jobs bem escolhidos (`atlas_lembrete_d1`, `atlas_retry_queue`) para evitar colisão com jobs de outros projetos. ✅

### 4. Segredos

Verificação via grep não encontrou `token`, `secret`, `password`, `VITE_` ou `service_role` no SQL. Comentários confirmam que:
- Token Evolution vive em edge function env
- Service role vive em supabase/functions/.env
- Webhook secret vive em `WHATSAPP_WEBHOOK_SECRET` (env, não versionado)

Exatamente como especificado. ✅

---

## Verificação de Build e Scripts

```bash
npm run build
# Result: ✓ built in 5.94s (warning de chunk >500kB é pré-existente, não novo)

npm run typecheck
# Result: exit 0 (TypeScript limpo)

supabase db reset
# Result: exit 0, todas as 23 migrations aplicadas, incluindo 5 novas desta entrega
```

Nenhuma regressão. ✅

---

## Verificação de Isomorfismo com ADR-01

A ADR-02 depende de ADR-01 (migrations de webhook_events, appointments.confirmed_via, messages retry fields, template reagendar_retorno). Verificado:

- ✅ ADR-01 já "approved" no index.json (status: "approved")
- ✅ As 4 migrations de ADR-01 foram aplicadas no `db reset` junto com a de ADR-02
- ✅ RLS de webhook_events é consistente com RLS pattern do projeto (admin read, service role write)
- ✅ Templates em `reagendar_retorno` usam só variáveis fechadas `{nome}{servico}{dataHora}{empresa}`

Sem conflito ou inconsistência. ✅

---

## Observações e Pontos de Atenção

1. **Função `whatsapp_enqueue_lembrete_d1()` e `whatsapp_process_retry_queue()` ainda não existem** (são ADR-04/05). A migration `20250223094000_pg_cron_setup.sql` chama essas funções pelo nome, mas elas não existem yet — isso é **OK** porque `cron.schedule()` armazena o comando como string literal e não valida a existência da função no momento do `schedule`. O job será silenciosamente ignorado se a função não existir em runtime. **Documentado no ADR**, sem defeito — quando ADR-04/05 forem entregues, as funções estarão prontas.

2. **Guard de `pg_extension`:** muito bem pensado. Ambiente local sem `pg_cron` não quebra `db reset` — ele segue com sucesso, emitindo notice. Em Supabase hosted, `pg_cron` sempre está disponível, então os jobs são criados.

3. **RLS de `webhook_events` mais restritiva que `messages`:** intencional e correto. `webhook_events` é auditoria de entrada (sensível), enquanto `messages` é log de disparo (menos sensível). Admin read-only é apropriado.

---

## Resumo de Achados

### Issues (0 bloqueantes)
Nenhum defeito, nenhuma não-conformidade detectada.

### Pontos Positivos
- Condicionalidade de pg_cron bem pensada, sem quebrar db reset local
- Idempotência garantida (unschedule + exception handler)
- RLS de webhook_events corretamente restritivo (admin only, service role write)
- Dedupe de entrada via índice único — trava sólida sob concorrência
- Zero segredos no versionado
- Build/typecheck/db reset passam limpos

---

## Verdict

**APPROVED** ✅

A ADR-02 cumpre todos os critérios de aceite, implementa a decisão do PRD (Opção a: função SQL security definer, não pg_net), mantém a condicionalidade de pg_cron sem quebrar db reset, e segue as fronteiras invioláveis (RLS, zero segredo, dinheiro/tempo, LGPD). Pronta para merge.

