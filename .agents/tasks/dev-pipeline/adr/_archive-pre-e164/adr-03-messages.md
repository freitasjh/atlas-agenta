# ADR-03 — Tabela `messages` (log de disparos, FKs compostas, idempotência, write só service role)

- **Status:** proposto
- **Escopo:** dados
- **Depende de:** ADR-01 (alvo `unique (tenant_id, id)` em `appointments` para a FK composta) e ADR-02 (ordem de migrations da fase). FK de `customer_id` usa o `unique (tenant_id, id)` que `customers` já expõe.

## Contexto

O módulo precisa de um **log auditável de disparos** (`messages`), conforme `dominio.md`. É a tabela que torna o fluxo "enviar" provável e rastreável, e onde vivem as invariantes de **idempotência de envio** e **PII mínima em log**. A escrita **não** pode ser aberta ao cliente: só a Edge Function (service role) grava, para impedir que o front forje um registro de envio ou pule opt-in/idempotência. A FK composta por tenant depende do alvo criado na ADR-01.

## Decisão

Criar `supabase/migrations/20250220091000_messages.sql` (timestamp posterior a ADR-01 e ADR-02), no mesmo padrão idempotente das demais migrations de domínio.

Colunas:

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `uuid` | PK `default gen_random_uuid()` |
| `tenant_id` | `uuid` | `not null default current_tenant_id()` → `tenants(id) on delete cascade` |
| `customer_id` | `uuid` | `not null` (destinatário sempre existe) |
| `appointment_id` | `uuid` | **nullable** |
| `channel` | `text` | `not null default 'whatsapp' check (channel in ('whatsapp'))` |
| `template` | `text` | `not null check (in ('confirmacao','lembrete_d1','cobranca','comprovante'))` |
| `status` | `text` | `not null default 'fila' check (in ('fila','enviado','entregue','falha'))` |
| `provider_message_id` | `text` | nulo até o provedor responder (no mock, id fake) |
| `failure_reason` | `text` | nulo; preenchido quando `status='falha'`, técnico curto, **sem PII** |
| `payload` | `jsonb` | `not null default '{}'::jsonb` — texto renderizado/metadados, **sem telefone/PII em claro** |
| `dedupe_key` | `text` | chave natural de idempotência, composta pela Edge Function |
| `created_at` | `timestamptz` | `not null default now()` |

FKs compostas (`on delete restrict`):
- `foreign key (tenant_id, customer_id) references customers (tenant_id, id) on delete restrict`.
- `foreign key (tenant_id, appointment_id) references appointments (tenant_id, id) on delete restrict` — como `appointment_id` é nullable, o Postgres (MATCH SIMPLE) não valida a FK quando nulo; mensagem sem agendamento é permitida, e quando preenchida só casa com agendamento do mesmo tenant.

Índices:
- `messages_tenant_id_idx on (tenant_id)`.
- `messages_tenant_customer_idx on (tenant_id, customer_id)`.
- `messages_tenant_appointment_idx on (tenant_id, appointment_id)`.
- **Índice único parcial de idempotência:** `create unique index if not exists messages_dedupe_uidx on messages (tenant_id, dedupe_key) where status in ('fila','enviado','entregue')`. É a trava real sob concorrência; exclui `falha` para que um disparo falho por opt-in não trave tentativa futura legítima. A composição da `dedupe_key` (`template || ':' || coalesce('a:'||appointment_id, 'c:'||customer_id)`) fica na Edge Function (ADR-04), não em coluna gerada — mantém a lógica no servidor e o schema simples.

RLS/RBAC:
- `enable row level security`.
- **SELECT:** `tenant_id = current_tenant_id() and current_role_name() in ('admin','receptionist','professional')` — `messages` é log de comunicação, **não** dado financeiro; por isso o `receptionist` pode ler (ao contrário de `charges`). Recorte por profissional é fase futura — não antecipar.
- **WRITE pelo cliente:** **nenhuma policy de INSERT/UPDATE/DELETE aberta ao cliente.** A gravação é exclusiva da Edge Function com service role (bypassa RLS). Mesmo espírito do insert de `profiles`/`tenants` (só via trigger security definer).
- **Sem policy `super_admin`** pelo cliente (fase futura).

## Consequências

- Fecha a superfície de dados do módulo; habilita a operação `send` da Edge Function (ADR-04) e o histórico de mensagens na UI (ADR-07).
- A ausência de policy de write cliente + service role é a trava de integridade: opt-in e idempotência não podem ser pulados pela UI.
- O índice único parcial garante idempotência sob corrida; a exclusão de `falha` preserva a retentativa legítima.
- PII mínima em log é invariante de schema/semântica: `payload`/`failure_reason` sem telefone/documento em claro; o vínculo ao destino é `customer_id`.
- Decisão durável (idempotência por índice único parcial + write só service role) — candidata a promoção futura para `docs/` (não copiar agora).

## Arquivos afetados

- `supabase/migrations/20250220091000_messages.sql` (novo)

## Critérios de aceite testáveis (desta ADR)

- **A1.** `supabase db reset` aplica as três migrations da fase (ADR-01 → ADR-02 → esta) em ordem, limpo e idempotente (CA-01, CA-01b).
- **A2.** `messages` tem `rowsecurity = true`, índice em `tenant_id` e `tenant_id default current_tenant_id()` (CA-02).
- **A3.** Inserir `messages` com `customer_id` (ou `appointment_id` não-nulo) de **outro** tenant é rejeitado pela FK composta; `appointment_id` nulo é aceito (CA-04).
- **A4.** Sob `authenticated`+JWT: usuário do tenant A lê 0 linhas de B (CA-05).
- **A5.** Nenhum papel consegue INSERT/UPDATE direto em `messages` pelo cliente — só service role grava (CA-07). Validar tentando INSERT sob `authenticated` e confirmando negação.
- **A6.** O índice único parcial `messages_dedupe_uidx` existe e cobre só `status in ('fila','enviado','entregue')` (inspeção de `pg_indexes`).
