-- Migration: clinical_records — ficha do cliente, schema, constraints e índices (ADR-05)
-- Cria a tabela `clinical_records`: registro clínico ligado a um atendimento e, por
-- consequência, a um cliente. Dado de saúde (LGPD art. 5º, II).
--
-- Modelo append-only (PRD RF-04, D-01): correção é um registro NOVO que aponta para o original
-- por `supersedes_id`. `supersedes_id is null` = registro original. Não há UPDATE nem DELETE
-- nesta migration; o trigger de imutabilidade entra na ADR-07. Os grants de `anon` e
-- `authenticated` são revogados aqui (TRUNCATE não passa por RLS); a ADR-06 devolve select e
-- insert com policy.
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
-- Ciclo na cadeia de correção: `clinical_records_supersedes_not_self` barra auto-referência, e o
-- trigger `before insert` exige que o registro apontado já exista. Isso cobre o ciclo de dois
-- registros num mesmo insert, que a FK sozinha aceitaria (ela só checa no fim do statement).
--
-- Idempotência: `create table if not exists` e `create index if not exists`; as constraints ficam
-- dentro do `create table`, então um re-apply não as recria. A função usa `create or replace`;
-- o trigger é recriado com `drop trigger if exists` antes de `create trigger`. `revoke` é
-- idempotente. Nenhum segredo no SQL.

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
  -- conteúdo clínico (PRD D-05). O valor gravado já vem sem espaço, tab, CR ou LF nas pontas
  -- (`x = btrim(x, E' \t\r\n')`), então o limite de caracteres vale para o que de fato fica armazenado.
  -- A app (ADR-12) faz o trim com o mesmo conjunto antes de gravar.
  allergies       text null check (allergies is null or (allergies = btrim(allergies, E' \t\r\n') and char_length(allergies) between 1 and 500)),
  medications     text null check (medications is null or (medications = btrim(medications, E' \t\r\n') and char_length(medications) between 1 and 500)),
  clinical_notes  text null check (clinical_notes is null or (clinical_notes = btrim(clinical_notes, E' \t\r\n') and char_length(clinical_notes) between 1 and 2000)),
  created_by      uuid not null default auth.uid(),
  created_at      timestamptz not null default now(),
  -- conteúdo mínimo (RF-03): ao menos um campo com texto depois de btrim. O conjunto de espaços é
  -- espaço, tab, CR e LF: o que não passa disso é vazio.
  constraint clinical_records_has_content check (
    nullif(btrim(allergies, E' \t\r\n'), '') is not null
    or nullif(btrim(medications, E' \t\r\n'), '') is not null
    or nullif(btrim(clinical_notes, E' \t\r\n'), '') is not null
  ),
  -- um registro não pode ser correção de si mesmo.
  constraint clinical_records_supersedes_not_self check (supersedes_id is null or supersedes_id <> id),
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

-- cobre a FK de atendimento: apagar ou trocar atendimento não varre a tabela inteira. Os índices
-- acima são parciais em supersedes_id ou começam por customer_id, e não servem a essa checagem.
create index if not exists clinical_records_tenant_appointment_customer_idx
  on clinical_records (tenant_id, appointment_id, customer_id);

-- RLS ligado, sem policy: deny-all para anon e authenticated até a ADR-06.
alter table clinical_records enable row level security;

-- Grants: o padrão do Supabase dá a anon e authenticated todos os privilégios de tabela. RLS não
-- cobre TRUNCATE, então os grants saem já nesta migration. service_role mantém acesso (bypass de
-- RLS), tratado na ADR-07.
revoke all on table clinical_records from anon, authenticated;

-- Ciclo na cadeia: o registro apontado por `supersedes_id` precisa existir ANTES da linha nova.
-- Trigger before insert, porque a FK só checa no fim do statement e aceitaria dois registros
-- que se apontam no mesmo insert.
--
-- Security INVOKER de propósito: a leitura do trigger passa pela RLS de quem insere. Registro de
-- outro tenant fica invisível para o chamador e cai no mesmo erro de id inexistente. Com
-- security definer, o trigger veria o registro de outro tenant, e a falha viraria 42501 (RLS),
-- o que revela que o id existe. Por isso o caminho é invoker, não definer.
-- Erro fixo, sem eco de valor. Usa o SQLSTATE e o nome da FK, para o mapeamento da ADR-12.
-- Consequência: sem select concedido (estado desta ADR), o trigger falha com 42501 para qualquer
-- id; a ADR-06 concede select com policy de tenant, e a resposta fica uniforme.
create or replace function clinical_records_check_supersedes_exists()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.supersedes_id is not null and not exists (
    select 1 from clinical_records r
    where r.tenant_id = new.tenant_id and r.id = new.supersedes_id
  ) then
    raise exception 'supersedes_id does not reference an existing record'
      using errcode = '23503', constraint = 'clinical_records_supersedes_fk';
  end if;
  return new;
end;
$$;

drop trigger if exists clinical_records_supersedes_exists on clinical_records;
create trigger clinical_records_supersedes_exists
  before insert on clinical_records
  for each row execute function clinical_records_check_supersedes_exists();
