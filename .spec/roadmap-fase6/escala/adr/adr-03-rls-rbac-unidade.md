# ADR-03 — RLS/RBAC por unidade + conflito cross-unit

- **Status**: Aceito (design congelado)
- **PRD**: §7 (fronteiras), §6.3 RF-15..RF-17, §6.7 RF-39..RF-43, R8/R9
- **UX-SPEC**: §6 (RBAC por unidade), §11 (24 asserções), D12
- **Depende de**: ADR-02 (`units`, `unit_memberships`, `unit_id`)
- **Bloqueia**: ADR-04, ADR-05, ADR-06, ADR-07, ADR-10, ADR-14
- **Escopo de escrita**: `supabase/migrations/`, testes de integração RLS

## Contexto

O isolamento atual é por `tenant_id` com `current_tenant_id()` e `current_role_name()`
(padrão provado). Autorização por unidade é uma **segunda dimensão**: o papel no tenant não
substitui o vínculo à unidade. O PRD exige que a lista de unidades chegue **já filtrada pelo
servidor** (o cliente nunca filtra por `tenant_id`/`unit_id` para se isolar) e que uma
`?unidade` sem permissão resulte em Estado vazio, nunca em 403 cru.

O conflito de agenda é o ativo mais escasso: a constraint hoje é
`(tenant_id, professional_id, tstzrange)` com `where status not in ('cancelado','nao_compareceu')`.
Incluir `unit_id` na chave **reabriria** double-booking cross-unit (R8) — o profissional
poderia estar em duas unidades no mesmo horário.

## Decisão

### D1 — Helpers de unidade (SECURITY DEFINER, `search_path` fixo)

| Helper | Retorno | Semântica |
|---|---|---|
| `current_unit_ids()` | `uuid[]` | unidades com membership do `profile` do JWT; vazio se não houver profile |
| `current_has_unit(p_unit uuid)` | `boolean` | `true` se papel `admin` **ou** `p_unit` ∈ `current_unit_ids()` |
| `current_can_read_unit(p_unit uuid)` | `boolean` | admin, recepção (leitura agregada) ou membership |
| `current_can_write_unit(p_unit uuid)` | `boolean` | admin ou membership (recepção/profissional exigem vínculo) |

Nenhum helper aceita `tenant_id` como parâmetro — ele vem sempre de `current_tenant_id()`.
`security definer` só aqui (evita recursão de policy em `unit_memberships`), com `revoke` de
`public`/`anon` e `grant execute` a `authenticated`.

### D2 — Matriz de policies

| Tabela | SELECT | Escrita (INSERT/UPDATE/DELETE) |
|---|---|---|
| `units` | `tenant_id = current_tenant_id()` **e** (`admin` or `receptionist` or `current_has_unit(id)`) | `admin` do tenant; `suspended_at`/`active` só via RPC administrativa (ADR-14) |
| `unit_memberships` | `admin` ou `profile_id = auth.uid()` | `admin` |
| `product_unit_stock` | `current_can_read_unit(unit_id)` | `current_can_write_unit(unit_id)` |
| `service_units` | leitura do catálogo para quem lê `services` | `admin` |
| `appointments`, `working_hours`, `resources`, `stock_movements` | `tenant_id = current_tenant_id()` **e** `current_can_read_unit(unit_id)` **e** RBAC de papel já existente | `tenant_id = current_tenant_id()` **e** `current_can_write_unit(unit_id)` **e** RBAC de papel existente (profissional continua restrito à própria linha/grade) |
| `appointment_payments`, `charges` | policies atuais (admin-only / Edge escopada) **e** `current_can_read_unit(unit_id)` quando `unit_id` não é nulo | inalterado (service role/Edge); `unit_id` derivado por trigger |

Regras:

- Política de escrita tem `USING` e `WITH CHECK` espelhados (padrão do projeto).
- O cliente **nunca** envia `tenant_id`; `unit_id` só trafega como escopo operacional e é
  validado por `current_can_write_unit`.
- `professional` sem vínculo em `?unidade` vê **0 linhas**; o frontend detecta ausência de
  dados e mostra StatePanel — o banco não devolve 403.
- `receptionist` lê agregado do tenant (dashboard, relatórios), mas toda escrita exige
  membership na unidade alvo. Financeiro agregado continua negado por papel (policies
  existentes).
- `super_admin` não entra em `/app` (sem `tenant_id`); cross-tenant vive no internal-admin
  por Edge Function com service role (ADR-14).

### D3 — Conflito cross-unit (sem `unit_id` na chave)

A constraint `appointments_no_overlap` **permanece** como está. Nenhuma migration a recria
com `unit_id`. Complementos:

1. Teste de integração: mesmo profissional, duas unidades, faixas sobrepostas → `23P01`
   (exclusion_violation), independentemente da ordem de insert.
2. RPC de pré-checagem `check_professional_conflict(p_professional_id, p_starts_at, p_ends_at)`
   `SECURITY INVOKER` retorna a(s) unidade(s) ocupada(s) (nome/`short_name`) para a mensagem
   de UI. Ela é **UX antecipada**, não a trava.
3. Transferência de atendimento entre unidades: permitida com revalidação de conflito
   (mesmo intervalo excluído da checagem). Se colidir, bloqueia citando a unidade ocupada.
4. Mensagem pt-BR distingue "mesma unidade" de "outra unidade" (D12/W6), sem expor dado de
   unidade à qual o usuário não tem acesso (usa apenas unidade que ele já pode ler).

### D4 — `?unidade` e agregação

RPCs de agregação (`SECURITY INVOKER`) ganham `p_unit_id uuid default null`; `null` = todas
as unidades que o RLS permite (agregado). O parâmetro é **conveniência de recorte**, nunca
fronteira: com `p_unit_id` de unidade sem permissão, a RPC retorna vazio porque o RLS já
filtrou as linhas.

## Interface congelada

| Símbolo | Contrato |
|---|---|
| `current_unit_ids()` / `current_has_unit(uuid)` | helpers de policy; sem parâmetro de tenant |
| `check_professional_conflict(uuid, timestamptz, timestamptz)` | retorna `{ unit_id, unit_name, unit_short_name, starts_at, ends_at }[]`; vazio = livre |
| Policy de escrita | `WITH CHECK` espelhado obrigatório |
| Erro de conflito | SQLSTATE `23P01`, mensagem pt-BR com unidade |
| `p_unit_id` em RPC agregada | `uuid default null`; `null` = agregado permitido |

## Consequências

**Positivas**
- Isolamento por unidade sem reimplementar regra no cliente; seletor nunca vaza nome alheio.
- Zero double-booking cross-unit por construção (constraint intacta).
- Recepção mantém leitura agregada sem ganhar escrita fora do vínculo.

**Negativas / custos**
- Policies mais complexas: custo de manutenção e de teste (matriz papel × unidade).
- Helpers `security definer` exigem auditoria de `search_path`/grants.

**Riscos e mitigação**
- *Risco*: policy nova esquecer `WITH CHECK` e permitir escrita em unidade alheia.
  *Mitigação*: teste negativo por tabela com `unit_id` forjado; revisão de security-engineer.
- *Risco*: recepção sem membership não conseguir operar (backfill incompleto).
  *Mitigação*: backfill da ADR-02 cria membership para todos os profiles.
- *Risco*: mensagem de conflito revelar unidade inacessível. *Mitigação*: RPC de pré-checagem
  só retorna unidades legíveis; teste com profissional restrito.

## Escopo

**Entra**
- Helpers, policies de `units`/`unit_memberships`/tabelas com `unit_id`, pré-checagem de
  conflito, testes de integração por papel e por unidade, grants.

**Não entra**
- Mudança da constraint de conflito, RLS de tabelas sem dimensão de unidade, policy nova de
  financeiro agregado para recepção, bypass de super admin em `/app`.

## Arquivos afetados

| Arquivo | Ação |
|---|---|
| `supabase/migrations/20261218090000_units_helpers_rls.sql` | helpers + policies de `units`/memberships |
| `supabase/migrations/20261218091000_unit_scoped_rls.sql` | policies das tabelas com `unit_id` |
| `supabase/migrations/20261218092000_conflict_precheck_rpc.sql` | RPC de conflito |
| `tests/integration/units-rls.it.test.ts` | matriz papel × unidade |
| `tests/integration/appointments-cross-unit.it.test.ts` | `23P01` cross-unit |

## Critérios de aceite (testáveis)

- [ ] `professional` sem membership: `select units` não retorna a unidade; insert/update com
      `unit_id` dela falha.
- [ ] `receptionist`: lê unidades e agregados do tenant; insert em unidade sem membership falha.
- [ ] `admin`: CRUD e leitura em todas as unidades do tenant; nada de outro tenant.
- [ ] `unit_id` forjado de outro tenant → 0 linhas na leitura e rejeição na escrita (FK + policy).
- [ ] `appointment_payments`/`charges` continuam ilegíveis para recepção/profissional.
- [ ] Dois atendimentos sobrepostos do mesmo profissional em unidades distintas → `23P01`.
- [ ] Pré-checagem retorna apenas unidades legíveis ao usuário; vazia quando livre.
- [ ] RPC agregada com `p_unit_id` sem permissão retorna vazio, não erro.

## Dependência / ordem

Após ADR-02. Antes de qualquer hook de dados (ADR-04) e do CRUD (ADR-05); ADR-06/07/10/14
reusam estes helpers.
