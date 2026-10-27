-- Migration: clinical_records — ficha do cliente, schema, constraints e índices (ADR-05)
-- Cria a tabela `clinical_records`: registro clínico ligado a um atendimento e, por
-- consequência, a um cliente. Dado de saúde (LGPD art. 5º, II).
--
-- Modelo append-only (PRD RF-04, D-01): correção é um registro NOVO que aponta para o original
-- por `supersedes_id`. `supersedes_id is null` = registro original. Não há UPDATE nem DELETE
-- nesta migration; o revoke de grants de escrita e o trigger de imutabilidade entram na ADR-07.
--
-- Campos de conteúdo (PRD D-05): alergias (até 500), medicamentos (até 500) e observações do
-- atendimento (até 2000). Não há campo de histórico relevante.
--
-- Conteúdo mínimo (RF-03): pelo menos um dos três campos com texto depois de `btrim`.
--
-- Coerência no schema (não só na app): FKs COMPOSTAS por tenant e por cliente.
--   - (tenant_id, customer_id) -> customers: cliente do mesmo tenant.
--   - (tenant_id, appointment_id, customer_id) -> appointments (exige unique da ADR-03): o
--     cliente da ficha é o cliente do atendimento.
--   - (tenant_id, supersedes_id, appointment_id, customer_id) -> clinical_records: a correção
--     vale para o mesmo atendimento e o mesmo cliente do original. Com match simple, não é
--     checada quando `supersedes_id` é null.
-- Todas as FKs são `on delete restrict`: ficha não some em cascata silenciosa.
--
-- Unicidade (RF-03, RF-04):
--   - um único original por atendimento (índice único parcial em supersedes_id is null);
--   - uma única correção por registro (índice único parcial em supersedes_id is not null).
--     A cadeia é linear: corrigir uma correção é permitido enquanto ela não tiver sucessora.
--
-- Isolamento multi-tenant (RNF03, inegociável): `tenant_id` default `current_tenant_id()`,
-- que deriva do JWT/profiles; o tenant NUNCA vem do cliente. RLS habilitado SEM nenhuma policy
-- aqui: com RLS ligado e sem policy, `anon` e `authenticated` não leem nem escrevem. As policies
-- de leitura e inserção entram na ADR-06.
--
-- `created_by` default `auth.uid()`. Fora de sessão de usuário (seed, service role) o banco não
-- preenche sozinho: quem insere deve passar `tenant_id` e `created_by` explicitamente.
--
-- Idempotência: `create ... if not exists` em tabela e índices; constraints ficam dentro do
-- `create table`, então um re-apply não recria nada. Migration aplicada não é editada.
-- Nenhum segredo no SQL.

-- ============================================================================
-- clinical_records — ficha do cliente (registro append-only).
-- ============================================================================
create table if not exists clinical_records (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null default current_tenant_id() references tenants (id) on delete restrict,
  customer_id     uuid not null,
  appointment_id  uuid not null,
  -- null = registro original; preenchido = correção do registro apontado.
  supersedes_id   uuid null,
  -- conteúdo clínico (PRD D-05). Limites aplicados sobre o texto sem espaços das pontas.
  allergies       text null check (allergies is null or char_length(btrim(allergies)) between 1 and 500),
  medications     text null check (medications is null or char_length(btrim(medications)) between 1 and 500),
  clinical_notes  text null check (clinical_notes is null or char_length(btrim(clinical_notes)) between 1 and 2000),
  created_by      uuid not null default auth.uid(),
  created_at      timestamptz not null default now(),
  -- conteúdo mínimo (RF-03): ao menos um campo com texto depois de btrim.
  constraint clinical_records_has_content check (
    nullif(btrim(allergies), '') is not null
    or nullif(btrim(medications), '') is not null
    or nullif(btrim(clinical_notes), '') is not null
  ),
  -- alvo da FK composta de correção: inclui atendimento e cliente para amarrar a cadeia.
  constraint clinical_records_tenant_id_unique unique (tenant_id, id, appointment_id, customer_id),
  constraint clinical_records_customer_fk
    foreign key (tenant_id, customer_id)
    references customers (tenant_id, id) on delete restrict,
  constraint clinical_records_appointment_fk
    foreign key (tenant_id, appointment_id, customer_id)
    references appointments (tenant_id, id, customer_id) on delete restrict,
  constraint clinical_records_supersedes_fk
    foreign key (tenant_id, supersedes_id, appointment_id, customer_id)
    references clinical_records (tenant_id, id, appointment_id, customer_id) on delete restrict
);

-- um único registro original por atendimento (RF-03).
create unique index if not exists clinical_records_one_original_per_appointment
  on clinical_records (tenant_id, appointment_id) where supersedes_id is null;

-- uma única correção por registro: impede bifurcação da cadeia (RF-04).
create unique index if not exists clinical_records_one_correction_per_record
  on clinical_records (tenant_id, supersedes_id) where supersedes_id is not null;

-- histórico do cliente na ficha (RF-06): leitura por cliente em ordem cronológica.
create index if not exists clinical_records_tenant_customer_created_idx
  on clinical_records (tenant_id, customer_id, created_at);

-- RLS ligado, sem policy: deny-all para anon e authenticated até a ADR-06.
alter table clinical_records enable row level security;
