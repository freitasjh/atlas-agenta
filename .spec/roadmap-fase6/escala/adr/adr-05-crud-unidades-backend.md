# ADR-05 — CRUD de unidades no backend + API do wizard

- **Status**: Aceito (design congelado)
- **PRD**: §6.1 RF-01..RF-07, §6.4 RF-46 (idempotência), W4
- **UX-SPEC**: §4 fluxo 2 (wizard 4 passos), §5 `unidades`/`unidades/:id`/`unidades/nova`
- **Depende de**: ADR-02 (schema), ADR-03 (RBAC), ADR-01 (`units_limit`)
- **Bloqueia**: ADR-09 (UI de cadastro), ADR-12/14 (consomem listagem)
- **Escopo de escrita**: `supabase/migrations/`, `src/hooks/useUnits.ts`, `src/hooks/useUnitMutations.ts`

## Contexto

O PRD exige criação transacional (unidade + horários + equipe + recursos opcionais), quota
por plano, idempotência de criação/associação/fechamento, auditoria antes/depois, inativação
sem delete e remoção de membro bloqueada por agendamento futuro. Fazer isso por inserts
soltos do cliente deixaria estados parciais (unidade criada sem matriz de horários, quota
estourada em corrida, retry duplicando unidade). O projeto já usa o padrão de limite por
trigger com `pg_advisory_xact_lock` (`plans`/`prof_limit`/`appt_limit`) e idempotência por
índice único tenant-scoped.

## Decisão

### D1 — Quota no banco (não só na UI)

Trigger `BEFORE INSERT` em `units` (`enforce_units_plan_limit`) espelha o padrão de
`enforce_professional_plan_limit`: lê `units_limit` do catálogo, adquire
`pg_advisory_xact_lock(tenant_id, 'units')` e conta unidades **ativas** (`active=true`,
incluindo suspensas — suspensão não libera quota). `null` = ilimitado. Estouro → exceção com
SQLSTATE próprio e mensagem pt-BR distinta de "sem entitlement". A UI antecipa, mas a corrida
é fechada no banco.

### D2 — RPCs transacionais (SECURITY DEFINER com checagem explícita)

Nenhuma criação multi-tabela sai do cliente. Funções com `search_path` fixo, `revoke` de
`public`/`anon`, `grant execute` a `authenticated`, e checagem de papel (`admin` do tenant)
no topo — `security definer` é necessário para escrever `unit_memberships`/`working_hours`
sem depender de policy de escrita do chamador; o isolamento é revalidado por
`current_tenant_id()`.

| RPC | Efeito | Idempotência |
|---|---|---|
| `create_unit(p_payload jsonb, p_idempotency_key uuid)` | cria unidade + horários iniciais + memberships + recursos opcionais; **não** toca catálogo | chave única `(tenant_id, idempotency_key)`; replay devolve o mesmo `unit_id` |
| `update_unit(p_unit_id uuid, p_payload jsonb)` | dados/endereço/telefone; fuso nunca é aceito | update direto (naturalmente idempotente) |
| `deactivate_unit(p_unit_id uuid)` | `active=false`; mantém linha e histórico | idempotente (`active` já falso = no-op) |
| `reactivate_unit(p_unit_id uuid)` | reativa se quota permitir | idempotente |
| `add_unit_member(p_unit_id uuid, p_profile_id uuid)` | associação | `on conflict do nothing` |
| `remove_unit_member(p_unit_id uuid, p_profile_id uuid)` | bloqueia se houver agendamento futuro do profissional na unidade | idempotente |
| `copy_unit_schedule(p_unit_id uuid, p_from_unit_id uuid)` | copia faixas de horário ("copiar da matriz"/"copiar de") | substituição atômica; reexecutar com a mesma origem = mesmo resultado |

### D3 — Payload do wizard (contrato de entrada)

Objeto validado por zod no hook e revalidado no banco (nunca confiar no cliente):

| Campo | Regra |
|---|---|
| `name` | 1..120, obrigatório |
| `short_name` | 1..12 (D6), obrigatório |
| `address` | `cep` (8 dígitos), `street`, `number`, `district`, `city`, `state` (UF) — obrigatórios; `complement` opcional |
| `phone` | opcional, formato BR |
| `hours` | lista de faixas por weekday (0..6) com `start < end`; passos 2–4 podem ser pulados |
| `member_profile_ids` | existentes no tenant; associação idempotente |
| `resources` | opcionais; nomes/tipos válidos |
| `copy_from_unit_id` | opcional; só horários/recursos, nunca catálogo |

`timezone` **não** existe no payload (herdado do tenant). `tenant_id` nunca é aceito.

### D4 — Inativação, histórico e leitura

Unidade inativa: sai de novas criações (`active=false` filtra forms/agenda de escrita),
permanece listada e selecionável para leitura histórica (D8) e entra no consolidado quando o
período inclui dados (decisão aprovada). **Não existe delete** — nem RPC, nem grant. Edição
de unidade inativa é permitida apenas para dados cadastrais (não reabre agendamento).

### D5 — Auditoria

Toda RPC grava em `audit_log` (tabela existente, `20250303100000_invitations_audit.sql`):
ação (`unit.created`, `unit.updated`, `unit.deactivated`, `unit.reactivated`,
`unit.member_added`, `unit.member_removed`, `unit.schedule_copied`), `unit_id`, ator,
antes/depois em JSONB, UTC. `auditLabels.ts` ganha os rótulos pt-BR. Nenhum PII de cliente.

### D6 — Idempotência de criação

Tabela `unit_operation_requests` (`tenant_id, idempotency_key uuid, operation text,
unit_id uuid, created_at`) com unique `(tenant_id, idempotency_key)`. O cliente gera a chave
uma vez por tentativa do wizard e a reusa em retry. Replay com mesmo payload devolve sucesso;
replay com payload divergente devolve erro de conflito (nunca cria segunda unidade).

## Interface congelada

| Símbolo | Contrato |
|---|---|
| `create_unit(p_payload, p_idempotency_key)` | → `{ unit_id, created: boolean }` |
| `update_unit(p_unit_id, p_payload)` | → `{ unit_id }` |
| `deactivate_unit(p_unit_id)` / `reactivate_unit` | → `{ unit_id, active }` |
| `add_unit_member` / `remove_unit_member` | → `{ unit_id, profile_id }`; removal pode falhar com código `future_appointments` |
| `copy_unit_schedule(p_unit_id, p_from_unit_id)` | → `{ unit_id, copied_ranges }` |
| `UnitPayload` (TS) | espelho zod do D3; `timezone`/`tenant_id` ausentes por tipo |
| Códigos de erro | `units_limit_reached`, `not_admin`, `future_appointments`, `idempotency_conflict`, `unit_not_found` |

## Consequências

**Positivas**
- Wizard nunca deixa unidade pela metade; retry não duplica.
- Quota fechada no banco, coerente com prof/appt.
- Histórico preservado (sem delete) e auditável.

**Negativas / custos**
- `security definer` amplia superfície: cada RPC precisa de checagem explícita de papel e
  teste negativo.
- Duas validações (zod + banco) geram manutenção de contrato.

**Riscos e mitigação**
- *Risco*: `security definer` sem checagem virar bypass de RLS. *Mitigação*: template único
  (`current_tenant_id()` + `current_role_name()='admin'`), teste com recepção/profissional.
- *Risco*: remoção de membro com agenda futura deixar atendimento órfão. *Mitigação*: checagem
  de futuro na mesma transação, com `advisory lock` por (tenant, professional).
- *Risco*: reativação estourar quota. *Mitigação*: mesmo trigger cobre UPDATE para
  `active=true`.

## Escopo

**Entra**
- Trigger de quota, RPCs, tabela de idempotência, auditoria, hooks de dados/mutações, códigos
  de erro mapeados para pt-BR, cópia de horários/recursos.

**Não entra**
- UI do wizard/lista/detalhe (ADR-09), re-seed de catálogo, preço por unidade, delete físico,
  transferência de estoque, criação de unidade por super admin (ADR-14 é read-only).

## Arquivos afetados

| Arquivo | Ação |
|---|---|
| `supabase/migrations/20261219090000_units_quota_trigger.sql` | trigger + erro de limite |
| `supabase/migrations/20261219091000_units_rpcs.sql` | CRUD/associação/cópia |
| `supabase/migrations/20261219092000_unit_idempotency.sql` | tabela + unique |
| `src/hooks/useUnits.ts` | lista/detalhe |
| `src/hooks/useUnitMutations.ts` (novo) | mutações + mapeamento de erro |
| `src/lib/unit-errors.ts` (novo) + test | códigos → pt-BR |
| `src/app/config/auditoria/auditLabels.ts` | rótulos `unit.*` |

## Critérios de aceite (testáveis)

- [ ] Criar unidade no limite do plano falha com `units_limit_reached` mesmo em duas chamadas
      concorrentes (uma vence).
- [ ] Replay da mesma `idempotency_key` devolve o mesmo `unit_id`; chave com payload diferente
      falha sem criar segunda unidade.
- [ ] Criação com passos 3–4 vazios é válida e **não** cria serviço/produto.
- [ ] `remove_unit_member` com agendamento futuro retorna `future_appointments` e não altera nada.
- [ ] Inativação mantém a linha, sai de novas criações e ainda aparece na lista (badge).
- [ ] `update_unit` ignora/rejeita tentativa de enviar `tenant_id`/`timezone`.
- [ ] Toda RPC grava `audit_log` com antes/depois e UTC.
- [ ] Recepção/profissional chamando RPC de escrita → `not_admin`, sem escrita.

## Dependência / ordem

Depois de ADR-02/03/01. Antes de ADR-09 (UI). ADR-06/07 podem avançar em paralelo a partir
de ADR-03, mas a consolidação usa `units` já criável.
