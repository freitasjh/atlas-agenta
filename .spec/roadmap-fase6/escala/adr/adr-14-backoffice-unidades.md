# ADR-14 — Back-office: unidades no internal-admin (leitura + suspensão)

- **Status**: Aceito (design congelado)
- **PRD**: §4 (super admin), §6.7 RF-42, §10 derivada 13, §15
- **UX-SPEC**: §1 (super_admin não entra em `/app`), §11 asserção internal-admin
- **Depende de**: ADR-02 (`units`), ADR-03 (`current_can_write_unit`), ADR-05 (auditoria)
- **Bloqueia**: nada
- **Escopo de escrita**: `src/internal-admin/`, `src/hooks/useAdminTenants.ts`, `supabase/functions/`, `supabase/migrations/`

## Contexto

`super_admin` não tem `tenant_id` e não entra em `/app` (guard `RequireActiveSubscription` +
tenant nulo). O cross-tenant vive em `/internal-admin`, onde já existem empresas, assinaturas,
backoffice e auditoria (`internal_operator_audit`). O PRD exige, para unidades: listagem e
**suspensão** auditada; nada de criação/edição de operação pelo super admin. Suspensão
decidida: **read-only** (não apaga, não cancela automaticamente futuros).

## Decisão

### D1 — Listagem por empresa

Rota `/internal-admin/empresas/:id/unidades` com:

- colunas: Unidade (`name`/`short_name`), Status (`Ativa`/`Inativa`/`Suspensa`), Plano e
  `units_limit` da empresa, Equipe (nº), Atendimentos futuros (nº), Última atividade, Ações;
- coluna "Unidades" na `EmpresasTable` (contagem ativas/limite) com link para a rota;
- estados loading/vazio/erro; sem qualquer ação de criação/edição de horário/equipe.

Leitura cross-tenant é feita por Edge Function com service role, autenticada como operador
interno (mesmo padrão de `internal_operators`), retornando apenas o necessário (sem PII de
cliente, sem financeiro detalhado — no máximo contadores).

### D2 — Suspensão = read-only

`units.suspended_at timestamptz null` (escrita **somente** por Edge Function/administrativo;
tenant não consegue escrever — guard de coluna privilegiada).

Efeitos:

- `current_can_write_unit` (ADR-03) passa a retornar `false` quando `suspended_at is not null`
  — mudança **aditiva** na função, sem alterar as policies existentes.
- Backstop no banco: trigger de escrita nas tabelas com `unit_id` rejeita
  (`unit_suspended`) mesmo se alguma policy futura esquecer o helper.
- Leitura continua: histórico e agenda do dia permanecem visíveis para o tenant (com banner).
- Agendamentos futuros **não** são cancelados automaticamente; ficam sinalizados no
  back-office e no app do tenant para decisão humana (evita perda silenciosa).
- Suspensão não libera quota (`units_limit` conta ativas; suspensa continua ativa).
- Reativação restaura escrita imediatamente; idempotente.

### D3 — Auditoria

Cada suspensão/reativação grava: `internal_operator_audit` (operador, empresa, unidade,
ação, motivo obrigatório) e `audit_log` do tenant (`unit.suspended_by_platform` /
`unit.reactivated_by_platform`) para o admin ver no próprio histórico. UTC, sem segredo.

### D4 — Limites de acesso

- Super admin: lê e suspende; **não** cria/edita unidade, não altera horários/equipe, não
  entra em `/app`.
- Nenhum endpoint do back-office aceita `tenant_id`/`unit_id` de isolamento do cliente; a
  Edge resolve o tenant pelo `:id` da empresa e valida operador.
- UI do tenant mostra banner `role=status` "Unidade suspensa pela plataforma — somente
  leitura" quando aplicável, sem CTA de reativação.

### D5 — Contrato de dados do back-office

Payload enxuto por unidade: `id`, `name`, `short_name`, `active`, `suspended_at`, endereço
resumido (cidade/UF), `members_count`, `future_appointments_count`, `last_activity_at`. Nada
de receita por unidade no back-office (fora de escopo; evitar exposição desnecessária).

## Interface congelada

| Símbolo | Contrato |
|---|---|
| Rota | `/internal-admin/empresas/:id/unidades` |
| `useAdminUnits(tenantId)` | lista enxuta do D5; erro/vazio/loading |
| Edge `admin-unit-suspend` | `{ tenantId, unitId, action: "suspend"\|"reactivate", reason }`; operador interno; audita |
| `units.suspended_at` | nullable; guard de coluna; só Edge escreve |
| Helper | `current_can_write_unit` = false se suspensa; erro `unit_suspended` |
| Banner tenant | `role=status`, sem CTA de reativação |

## Consequências

**Positivas**
- Operação cross-tenant sem abrir `/app` nem dar poder de edição ao super admin.
- Suspensão reversível e auditada, sem apagar histórico nem cancelar futuros em silêncio.
- Backstop no banco fecha o furo de policy esquecida.

**Negativas / custos**
- Mais uma Edge Function privilegiada e mais um estado de unidade (ativa/inativa/suspensa).
- Trigger de backstop adiciona custo mínimo em toda escrita escopada.

**Riscos e mitigação**
- *Risco*: suspensão bloquear leitura e esconder agenda. *Mitigação*: só escrita é bloqueada;
  teste de leitura sob suspensão.
- *Risco*: Edge Function virar bypass de tenant. *Mitigação*: validação de operador + motivo
  obrigatório + auditoria; teste com token de tenant comum (deve negar).
- *Risco*: UI do tenant oferecer reativação. *Mitigação*: ausência de CTA + teste.

## Escopo

**Entra**
- Lista cross-tenant, coluna na tabela de empresas, suspensão/reativação, auditoria dupla,
  banner read-only, helper/trigger, testes de acesso.

**Não entra**
- Criar/editar unidade pelo back-office, ver financeiro por unidade, cancelar futuros
  automaticamente, impersonation, mudança de plano por unidade.

## Arquivos afetados

| Arquivo | Ação |
|---|---|
| `src/internal-admin/empresas/UnidadesTab.tsx` (novo) + test | lista |
| `src/internal-admin/empresas/EmpresasTable.tsx` | coluna Unidades |
| `src/internal-admin/empresas/SuspenderUnidadeDialog.tsx` (novo) | motivo obrigatório |
| `src/hooks/useAdminUnits.ts` (novo) + test | leitura |
| `src/router.tsx` | rota interna |
| `supabase/functions/admin-unit-suspend/` (novo) | suspend/reactivate + auditoria |
| `supabase/migrations/20261222090000_units_suspended.sql` | coluna + guard + helper/trigger |

## Critérios de aceite (testáveis)

- [ ] Back-office lista unidades da empresa com status e contadores; sem ações de edição.
- [ ] Suspender exige motivo; grava `internal_operator_audit` e `audit_log`.
- [ ] Unidade suspensa: escrita rejeitada (`unit_suspended`) em todas as tabelas escopadas;
      leitura e histórico continuam.
- [ ] Agendamentos futuros permanecem e aparecem sinalizados; nada é cancelado sozinho.
- [ ] Reativar restaura escrita na primeira request seguinte.
- [ ] Quota continua contando unidade suspensa.
- [ ] Tenant não consegue alterar `suspended_at` (guard).
- [ ] Token de tenant comum chamando a Edge recebe negação.
- [ ] Super admin não acessa `/app`; app do tenant mostra banner sem CTA de reativação.

## Dependência / ordem

Depois de ADR-02/03/05. Pode ser a última da esteira; não bloqueia as demais.
