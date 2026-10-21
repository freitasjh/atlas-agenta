# Parecer de Revisão — ADR-01: Migrations aditivas da Fatia 2 (Webhook Events, Confirmed Via, Retry Fields, Templates)

**Revisor:** Independente A (sem autoria de código)
**Data:** 2025-10-21
**Status:** APROVADO COM OBSERVAÇÕES

---

## Resumo

A ADR-01 entrega 4 migrations SQL aditivas que estabelecem o schema da Fatia 2 do WhatsApp (confirmação interativa D-1 via webhook, fila de retentativa). O escopo é **exclusivamente dados**: nenhum código frontend, nenhuma Edge Function, nenhuma lógica de aplicação — só as tabelas, colunas, índices, constraints e policies que o backend precisará. As migrations foram verificadas contra os critérios de aceite da ADR, executadas com sucesso (idempotentes em re-apply), e aderem rigorosamente ao padrão do projeto (RLS em toda tabela de domínio, isolamento por tenant_id no banco, PII mínima, nenhum segredo, timestamps UTC, dinheiro em *_cents quando aplicável). **Nenhum bloqueador encontrado.** O schema está pronto para suportar as ADRs 02–07.

---

## Verificação de Critérios de Aceite (ADR-01, §6)

| AC | Verificação | Resultado |
|:---|:---|:---|
| **AC-01** | Migrations aplicadas sem erro; reapplicação é idempotente | ✅ Executado 2× limpo; `supabase db reset` exit 0 |
| **AC-02** | `webhook_events` existe com tabela, índices e RLS corretos | ✅ Confirmado: 11 colunas, 4 índices, RLS habilitado |
| **AC-03** | Índice único `(source, external_event_id)` de dedupe criado | ✅ `webhook_events_dedupe_uidx` presente |
| **AC-04** | RLS com SELECT só admin; NENHUMA policy de write | ✅ 1 policy SELECT; 0 INSERT/UPDATE/DELETE |
| **AC-05** | `appointments.confirmed_via` coluna adicionada, nullable, CHECK correto | ✅ Coluna existe, nullable, CHECK `('cliente_whatsapp','manual')` |
| **AC-06** | `messages` campos de retentativa (attempts, max_attempts, etc.) | ✅ 4 colunas adicionadas com defaults seguros |
| **AC-07** | Índice parcial `messages_retry_queue_idx` criado | ✅ Índice presente, `where status = 'fila'` |
| **AC-08** | Template `reagendar_retorno` adicionado aos CHECKs de messages/message_templates | ✅ 5 chaves no CHECK (confirmacao, lembrete_d1, cobranca, comprovante, reagendar_retorno) |
| **AC-09** | Função `seed_message_templates` recriada com 5 valores; backfill idempotente | ✅ Seed + backfill sem duplicatas; re-apply continua 5 |

---

## Análise de Fronteiras (Segurança Multi-Tenant, RLS, RBAC, PII, Idempotência)

### 1. **Isolamento Multi-Tenant (RNF03, inegociável)**

- **webhook_events:** `tenant_id not null` (obrigatório), referência FK a `tenants`, **sem** `default current_tenant_id()` (correto, pois é escrito só por service role). RLS com SELECT filtrado por `tenant_id = current_tenant_id()`. Confirma-se: **nenhum caminho para um cliente de outro tenant ler eventos do tenant A enquanto autenticado no tenant B.**
- **FK composta:** `(tenant_id, appointment_id)` garante coerência: um evento ligado a um agendamento FORÇA estar no mesmo tenant da instância. **Idempotente.**
- **appointments.confirmed_via:** Coluna aditiva sob RLS existente; não quebra isolamento.
- **messages:** Campos de retry aditivos, sem tocar RLS.
- ✅ **Fronteira respeitada.**

### 2. **RBAC (Admin > Receptionist > Professional)**

- **webhook_events:** SELECT só para `admin` do tenant. Receptionist/Professional **não** leem (correto — auditoria de entrada sensível). Nenhuma policy de write para nenhum papel (só service role grava).
- **appointments.confirmed_via:** Herda RLS de `appointments` — já filtrado por papel. Admin vê tudo, professional só próprios agendamentos, receptionist todos (sem dados financeiros separadamente por RLS).
- **messages.retry_*:** Colunas aditivas; herdam RLS existente.
- ✅ **RBAC mantido.**

### 3. **PII e LGPD**

- **webhook_events.payload:** Documentado como "SEM PII" (sem telefone, documento, texto cru). O comentário SQL assinala: "no máximo hash/rótulo". **O número do remetente é usado em MEMÓRIA no webhook (ADR-03) para casamento, NUNCA persistido em claro.** ✅
- **webhook_events.failure_reason:** Motivo técnico curto, sem PII.
- **messages.retry_*:** Campos de controle (timestamps, contadores), sem novo risco de PII.
- **appointments.confirmed_via:** Enum fechado, sem dados pessoais novos.
- ✅ **PII minimizado; `whatsapp_opt_in` de `customers` (já existente) será respeitado pelo cron (ADR-04).**

### 4. **Idempotência**

- **Migration re-apply:** Testado 2×. Cada CREATE/ALTER usa `if not exists` / `if exists` (drop+create com guarda). CHECKs renomeados com nomes estáveis; bloco `do $$` confere `pg_constraint` antes de adicionar (evita duplicata). ✅
- **webhook_events.dedupe_uidx:** Índice único `(source, external_event_id)` é a trava REAL — a 2ª gravação do MESMO evento colide e para (aceita duplicação de entrada pelo operador de webhook, não duplica efeito). ✅
- **messages.retry_queue_idx:** Índice parcial; re-criação é segura.
- **Seed + backfill:** `on conflict (tenant_id, template_key) do nothing` — re-apply não duplica templates. ✅ Confirmado no teste.
- ✅ **Idempotência garantida.**

### 5. **Autenticidade de Webhook (RNF02, contrato)**

- Migration em si **não toca a verificação de autenticidade.** Isto é responsabilidade da Edge Function (ADR-03). Porém, a tabela `webhook_events` é projetada para receber o `status='rejeitado'` quando o webhook falha na autenticidade (§5.6 da análise-data.md). A coluna `failure_reason` suporta registrar o motivo (ex.: "auth_failed"). ✅ **Pronto para ADR-03.**

### 6. **Segredos (não devem estar em SQL)**

- Nenhum segredo no SQL (nenhuma chave API, token, senha, hash hardcoded). ✅

---

## Análise de Integridade de Dados

### 1. **Timestamps em UTC (timestamptz)**

- `webhook_events.created_at timestamptz not null default now()` — UTC pelo servidor. ✅
- `messages.last_attempt_at, next_attempt_at` — ambos `timestamptz`, NULLables. ✅
- **Convenção respeitada.**

### 2. **Dinheiro em *_cents (inteiros)**

- N/A nesta ADR (não há colunas monetárias novas).

### 3. **Nomenclatura (inglês, snake_case, plural)**

- Tabelas: `webhook_events` (plural), `messages` (plural), `appointments` (plural). ✅
- Colunas: `tenant_id`, `external_event_id`, `instance_name`, `parsed_intent`, `failure_reason`, `attempts`, `max_attempts`, `last_attempt_at`, `next_attempt_at`, `confirmed_via`. Todas snake_case, inglês. ✅
- **Convenção respeitada.**

### 4. **Enums Fechados (CHECK constraints)**

- `webhook_events.source in ('evolution')` — aberto para expansão futura (doc assinala). ✅
- `webhook_events.status in ('recebido','processado','ignorado','rejeitado')` — cobre RFC-S2-03 (entrada sem efeito, rejeitada, ou processada). ✅
- `webhook_events.parsed_intent in ('confirmar','reagendar','nao_reconhecido')` — cobre RF-S2-04/05/06/07. ✅
- `appointments.confirmed_via in ('cliente_whatsapp','manual')` — necessário para ADR-06 (selenium de origem). ✅
- `messages.template` estendido com `reagendar_retorno` — totalizando 5 chaves (confirmacao, lembrete_d1, cobranca, comprovante, reagendar_retorno). ✅

---

## Verificação de Contrato (Análise de Dados vs. Implementação)

A análise-data.md (§5) especifica:

| Item | Análise Exigia | Migration Entrega | Status |
|:---|:---|:---|:---|
| `webhook_events` tabela com dedupe unique | §5.1 | ✅ webhook_events_dedupe_uidx criado |
| RLS só SELECT admin | §5.1 | ✅ 1 policy SELECT, 0 write |
| Sem `default current_tenant_id()` | §5.1, R12 | ✅ tenant_id obrigatório sem default |
| FK composta `(tenant_id, appointment_id)` | §5.1 | ✅ Constraint existe |
| `appointments.confirmed_via` nullable | §5.2, Opção A | ✅ Coluna adicionada, nullable |
| `messages` campos retry | §5.2 | ✅ 4 colunas com defaults |
| Índice parcial fila | §5.2 | ✅ messages_retry_queue_idx |
| `reagendar_retorno` template adicionado | §5.3 | ✅ CHECK estendido, seed, backfill |
| pg_cron setup condicional | §5.4 | ⏳ **Fora da ADR-01 (ADR-02)** |
| Autenticidade webhook | §5.6 | ⏳ **Fora da ADR-01 (ADR-03)** |

**Observação:** A ADR-01 se limita ao SCHEMA. As jobs de cron (ADR-02), a Edge Function de webhook (ADR-03), e a lógica de render (ADR-03) ficam para as ADRs seguintes — conforme planejado. ✅

---

## Testes Executados

### 1. **Build / Typecheck**
```bash
npm run build   # ✅ exit 0 (warning pré-existente de chunk > 500 kB)
npm run typecheck  # ✅ exit 0 (tsc clean)
```

### 2. **Database Reset (Idempotência)**
```bash
supabase db reset   # Run 1: ✅ exit 0, migrations aplicadas
supabase db reset   # Run 2: ✅ exit 0, idempotente
```

### 3. **Inspeção SQL**
- RLS habilitado em todas as 3 tabelas (webhook_events, messages, appointments). ✅
- Índices criados e únicos funcionando. ✅
- CHECKs com 5 chaves de template (não duplicadas após re-apply). ✅
- Seed + backfill idempotentes (criado 1 tenant, 5 templates gerados; re-seed não duplicou). ✅

---

## Observações de Qualidade de Código

### 1. **Documentação em SQL**

Cada migration traz um bloco de comentário extenso explicando:
- O contexto (qual ADR, qual RF/RNF aborda)
- Decisões de design (por que coluna nullable, por que CHECKs renomeados, etc.)
- Referências às convenções do projeto
- PII / segurança / isolamento multi-tenant

✅ **Documentação acima do padrão típico de migrations. Facilita audit e manutenção.**

### 2. **Padrão de Idempotência**

- `create table if not exists` / `add column if not exists`
- `drop policy if exists` antes de `create policy`
- Bloco `do $$` com `pg_constraint` para conferir CHECKs antes de adicionar

✅ **Padrão consistente, seguro, reutilizável em futuras migrations.**

### 3. **Convenção de Ordenação**

As 4 migrations são ordenadas por timestamp e responsabilidade:
1. `20250223090000_webhook_events.sql` — tabela nova
2. `20250223091000_appointments_confirmed_via.sql` — coluna aditiva
3. `20250223092000_messages_retry_fields.sql` — colunas aditivas
4. `20250223093000_reagendar_retorno_template.sql` — CHECKs + seed + backfill

A ordem respeita dependências (nenhuma foreign key circular, nenhuma coluna usada antes de criada).

✅ **Ordem lógica, fácil de seguir.**

---

## Não-Bloqueadores (Itens Menores)

### 1. **Nomes de Constraint Auto-Gerados**

Em `20250223093000_reagendar_retorno_template.sql`, o bloco `do $$` tenta remover a constraint auto-nomeada `messages_template_check` e `message_templates_template_key_check`. 

- **Risco:** Se o Postgres havia gerado outro nome (ex.: `messages_template_blah_check`), o drop não acharia e deixaria a constraint velha no banco.
- **Mitigação:** O código usa `if exists` no drop, então **não quebra** se a constraint velha estiver com outro nome. Apenas a constraint velha permaneceria e a nova seria criada com nome estável `messages_template_allowed_check`. Isto causaria múltiplas constraints no banco, ocupando espaço e deixando ruído.
- **Realidade:** Consultei o PostgreSQL (`information_schema.check_constraints` após re-apply) e **confirmei** que o nome auto-gerado foi exatamente `messages_template_check` / `message_templates_template_key_check`. O drop funcionou, e após re-apply há **uma única constraint** com nome estável. ✅ **Sem problema prático.**

**Recomendação futura:** Se houver dúvida sobre nomes auto-gerados em futuras migrations, consultar `pg_constraint` dinamicamente em vez de hardcodar — algo como:

```sql
do $$
  declare v_constraint_name text;
begin
  select conname into v_constraint_name from pg_constraint
  where conrelid = 'public.messages'::regclass and conname ~ 'template.*check';
  if found then
    execute 'alter table public.messages drop constraint ' || v_constraint_name;
  end if;
end
$$;
```

Para **esta ADR**, o código atual funciona. Não bloqueia.

### 2. **Backfill sem Filtro de Status**

Em `20250223093000_reagendar_retorno_template.sql`, o backfill faz:

```sql
insert into message_templates (tenant_id, template_key, body)
select t.id, 'reagendar_retorno', '...'
from tenants t
on conflict (tenant_id, template_key) do nothing;
```

Isto cria a 5ª linha para **todos** os tenants (legacy, ativo, bloqueado, cancelado). 

- **É deliberado?** Sim — a seed é criada quando um tenant é criado (signup), e o backfill garante que tenants já existentes também têm a 5ª chave (senão o frontend poderia quebrar ao tentar enviar `template='reagendar_retorno'` para tenant legado). ✅

- **Alternativa:** Filtrar `where subscription_status in ('trial','ativo')` para não pollute tenants inativos. Mas a documentação não o especifica como requisito, e o comportamento atual é mais simples (nenhum condicional, nenhuma lógica). A ADR-06 (frontend) não rejeita tenants `bloqueado`/`cancelado` de ler templates — só suspendem **disparos** (lógica do cron, ADR-04).

**Conclusão:** Comportamento aceitável. Sem bloqueador.

---

## Verificação de Divergência com Análise de Frontend

A análise-frontend.md (ADR-06) lista dependências de dados que devem vir da ADR-01:

| Dependência | Entregue | Status |
|:---|:---|:---|
| `appointments.confirmed_via` (enum cliente_whatsapp \| manual) | ✅ Coluna criada | Pronto para ADR-06 |
| Campos de retry em `messages` | ✅ Criados | Pronto para ADR-05 |
| Template `reagendar_retorno` | ✅ Adicionado | Pronto para ADR-03/06 |

✅ **Nenhuma divergência. ADR-01 entrega exatamente o que ADR-06 espera.**

---

## Checklist de Segurança (seguranca-multitenant.md)

- [x] RLS habilitado em TODAS as tabelas de domínio novo (`webhook_events`).
- [x] `tenant_id` obrigatório, nunca do cliente.
- [x] Policies RLS comparam a linha com `current_tenant_id()` do JWT.
- [x] Super admin sem caminho pelo cliente.
- [x] Nenhum segredo no SQL.
- [x] Idempotência de entrada (índice único `(source, external_event_id)`).
- [x] PII mínima (sem telefone/texto em claro no `payload` persistido).
- [x] Dinheiro N/A, timestamps UTC, nomes em inglês.

✅ **Todas as fronteiras respeitadas.**

---

## Decisões Confirmadas vs. PRD

1. **Opção A (`confirmed_via` coluna vs. Opção B join com messages):** ✅ Confirmado (mais determinístico, sem PII).
2. **Template `reagendar_retorno` (nova chave vs. reusar `confirmacao`):** ✅ Confirma (semântica clara, dedupe coerente).
3. **FK composta `(tenant_id, appointment_id)` para isolamento no banco:** ✅ Implementado (coerência, não só app-level).
4. **Nenhuma default de `current_tenant_id()` em `webhook_events`:** ✅ Correto (resolvido pela instância, não JWT).

✅ **Todas as decisões do PRD honradas.**

---

## Conclusão

A ADR-01 estabelece um schema sólido, seguro e idempotente para a Fatia 2. Todas as fronteiras de segurança (RLS, isolamento, PII, idempotência, autenticidade) estão em lugar. O código é bem documentado, segue o padrão do projeto, e foi verificado com sucesso em testes locais (re-apply idempotente, typecheck/build limpos). Nenhum bloqueador; as observações acima são de qualidade/futuro, não defeitosas.

**A ADR-01 está pronta para suportar as ADRs 02–07.**

---

## Recomendações para Próximas ADRs

1. **ADR-02 (pg_cron setup):** Garantir que o schedule condicional não quebra em ambientes sem a extensão; documentar a limitação no README local.
2. **ADR-03 (webhook inbound):** Validar o payload da Evolution v2.3.7 contra o zod schema; confirmar os campos exatos (`key.id`, `key.remoteJid`, etc.).
3. **ADR-04/05 (jobs cron):** Usar os índices (`webhook_events_tenant_idx`, `messages_retry_queue_idx`) para não fazer full scan.
4. **ADR-06 (frontend):** Não esquecer de espelhar os enums (`confirmed_via`, templates novos) em `src/types/domain.ts` + `src/lib/whatsapp.ts`.

---

**Parecer Final:** ✅ **APROVADO — PRONTO PARA MERGE**

