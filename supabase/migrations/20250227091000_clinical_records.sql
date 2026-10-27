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
-- Coerência no schema (não só na app): FKs COMPOSTAS por tenant e por cliente.
--   - (tenant_id, customer_id) -> customers: cliente do mesmo tenant.
--   - (tenant_id, appointment_id, customer_id) -> appointments: o cliente da ficha é o cliente do
--     atendimento. Exige a constraint `appointments_tenant_id_customer_unique`, criada pela migration
--     20250227090000 (ADR-03) nesta mesma entrega.
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
-- Validação de obrigatoriedade, conteúdo e cadeia em UM trigger (`clinical_records_validate`), não
-- em CHECK constraints. Motivo: o PostgreSQL grava a linha inteira no DETAIL de erro de CHECK e de
-- NOT NULL ("Failing row contains (...)"). Com texto clínico na linha, isso vazaria dado de saúde
-- para a resposta da API e para o log do banco. O trigger roda ANTES da verificação de CHECK e NOT
-- NULL, então cada regra falha primeiro com mensagem fixa, nome de constraint e SQLSTATE próprio,
-- sem eco de valor. Os NOT NULL continuam declarados no schema como documentação. O trigger checa
-- antes todas as colunas NOT NULL (id, tenant_id, customer_id, appointment_id, created_by e
-- created_at), então nenhum NOT NULL dispara com valor de cliente.
--
-- Campo de texto vazio ('') é normalizado para null no trigger, antes das regras. Espaço, tab, CR
-- e LF nas pontas continuam recusados (não são normalizados).
--
-- Ciclo na cadeia de correção: o mesmo trigger barra auto-referência e exige que o registro
-- apontado já exista. Isso cobre o ciclo de dois registros num mesmo insert, que a FK sozinha
-- aceitaria (ela só checa no fim do statement).
--
-- Idempotência: `create table if not exists` e `create index if not exists`. A função usa
-- `create or replace`; o trigger é recriado com `drop trigger if exists` antes de `create trigger`.
-- `revoke` é idempotente. Nenhum segredo no SQL.
--
-- Observação de re-apply: `create table if not exists` NÃO atualiza uma tabela que já existe. Num
-- banco que já aplicou a versão anterior desta migration, use `supabase db reset` (banco local).
-- Nenhum banco remoto recebeu esta migration ainda.

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
  -- conteúdo clínico (PRD D-05). Validado pelo trigger: o valor gravado precisa vir sem espaço,
  -- tab, CR ou LF nas pontas, e o limite vale para o que fica armazenado. A app (ADR-12) faz o
  -- trim com o mesmo conjunto antes de gravar.
  allergies       text null,
  medications     text null,
  clinical_notes  text null,
  created_by      uuid not null default auth.uid(),
  created_at      timestamptz not null default now(),
  -- alvo da FK composta de correção: inclui atendimento e cliente para amarrar a cadeia.
  constraint clinical_records_fk_target_unique unique (tenant_id, id, appointment_id, customer_id),
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

-- Função pura: true se o campo é nulo ou se, já sem espaço/tab/CR/LF nas pontas, tem entre 1 e
-- `max_len` caracteres. Não lê a linha, então não toca dado de saúde em erro.
create or replace function clinical_records_content_ok(v text, max_len int)
returns boolean
language sql
immutable
as $$
  select v is null or (v = btrim(v, E' \t\r\n') and char_length(v) between 1 and max_len)
$$;

-- Validação de obrigatoriedade, conteúdo e cadeia. Roda BEFORE INSERT OR UPDATE, então cobre
-- service_role e qualquer caminho que escreva na tabela. Ordem: normalização de '' para null,
-- obrigatoriedade, conteúdo mínimo, formato e limite de cada campo, auto-referência e, por último,
-- existência do registro apontado.
--
-- Erros SEMPRE com mensagem fixa e `constraint`/`column` com nome técnico. Nunca incluir valor da
-- linha na mensagem, no DETAIL ou no HINT.
--
-- Existência: security INVOKER de propósito. A leitura passa pela RLS de quem insere. Registro de
-- outro tenant fica invisível para o chamador e cai no mesmo erro de id inexistente. Com security
-- definer, a falha de um id de outro tenant viraria 42501 (RLS), o que revela que o id existe.
-- Sem select concedido (estado desta ADR), qualquer id falha com a mesma resposta; a ADR-06
-- concede select com policy de tenant.
create or replace function clinical_records_validate()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- campo opcional vazio é o mesmo que ausente: grava null, para não reprovar outro campo válido.
  new.allergies      := nullif(new.allergies, '');
  new.medications    := nullif(new.medications, '');
  new.clinical_notes := nullif(new.clinical_notes, '');

  -- obrigatoriedade (o mesmo que os NOT NULL declarados, mas com mensagem sem eco).
  if new.id is null then
    raise exception 'clinical record requires id'
      using errcode = '23502', column = 'id';
  end if;
  if new.created_at is null then
    raise exception 'clinical record requires created_at'
      using errcode = '23502', column = 'created_at';
  end if;
  if new.tenant_id is null then
    raise exception 'clinical record requires tenant_id'
      using errcode = '23502', column = 'tenant_id';
  end if;
  if new.customer_id is null then
    raise exception 'clinical record requires customer_id'
      using errcode = '23502', column = 'customer_id';
  end if;
  if new.appointment_id is null then
    raise exception 'clinical record requires appointment_id'
      using errcode = '23502', column = 'appointment_id';
  end if;
  if new.created_by is null then
    raise exception 'clinical record requires created_by'
      using errcode = '23502', column = 'created_by';
  end if;

  -- conteúdo mínimo (RF-03): ao menos um campo com texto depois de remover espaço, tab, CR e LF.
  if nullif(btrim(new.allergies, E' \t\r\n'), '') is null
     and nullif(btrim(new.medications, E' \t\r\n'), '') is null
     and nullif(btrim(new.clinical_notes, E' \t\r\n'), '') is null then
    raise exception 'clinical record requires at least one filled content field'
      using errcode = '23514', constraint = 'clinical_records_has_content';
  end if;

  -- formato e limite de cada campo (PRD D-05).
  if not clinical_records_content_ok(new.allergies, 500) then
    raise exception 'clinical content field is not trimmed or exceeds its limit'
      using errcode = '23514', constraint = 'clinical_records_allergies_check', column = 'allergies';
  end if;
  if not clinical_records_content_ok(new.medications, 500) then
    raise exception 'clinical content field is not trimmed or exceeds its limit'
      using errcode = '23514', constraint = 'clinical_records_medications_check', column = 'medications';
  end if;
  if not clinical_records_content_ok(new.clinical_notes, 2000) then
    raise exception 'clinical content field is not trimmed or exceeds its limit'
      using errcode = '23514', constraint = 'clinical_records_clinical_notes_check', column = 'clinical_notes';
  end if;

  -- um registro não pode ser correção de si mesmo.
  if new.supersedes_id is not null and new.supersedes_id = new.id then
    raise exception 'clinical record cannot supersede itself'
      using errcode = '23514', constraint = 'clinical_records_supersedes_not_self';
  end if;

  -- o registro apontado precisa existir ANTES da linha nova, no mesmo tenant (ver cabeçalho).
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

drop trigger if exists clinical_records_validate on clinical_records;
create trigger clinical_records_validate
  before insert or update on clinical_records
  for each row execute function clinical_records_validate();
