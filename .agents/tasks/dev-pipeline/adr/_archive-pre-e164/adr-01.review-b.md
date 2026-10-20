# Revisor B — Parecer sobre ADR-01 (`appointments` expõe `unique (tenant_id, id)`)

Migration nova `20250220089000_appointments_tenant_unique.sql` adiciona a constraint `unique (tenant_id, id)` em `appointments` para servir de alvo à FK composta de `messages` (ADR-03). A criação vai num bloco `do $$` que checa `pg_constraint` antes de criar, replicando o padrão idempotente de `20250219092000_appointments_no_overlap`. Não toca RLS, colunas, índices de domínio nem o trigger da máquina de estados, e não edita a migration aplicada.

Watch for: nada bloqueante. Verifiquei empiricamente os três critérios de aceite (A1/A2/A3) contra o Supabase local — todos passam.

**Verdict**: APPROVED

## Visão de alto nível

A ADR resolve um gap de schema real e confirmado: `appointments` só tinha `id uuid primary key` e nunca foi referenciada, então a FK composta `messages (tenant_id, appointment_id) → appointments (tenant_id, id)` quebraria o `db reset` por falta de alvo único. A correção escolhida (Opção A da análise de dados §4.2) é a coerente com o padrão já travado em `customers`, `services` e `professionals`, que expõem o mesmo par único. A Opção B (FK simples sem o par de tenant) foi corretamente descartada por reabrir o furo cross-tenant.

A execução é fiel à decisão: migration nova (não edita a aplicada), timestamp `20250220089000` posterior à última existente (`20250219093000`) e anterior ao `messages` planejado (`20250220091000`), garantindo a ordem de dependência. O escopo é cirúrgico — um único arquivo, sem efeito colateral em RLS/RBAC/colunas/trigger.

A postura de fronteira está preservada: a mudança reforça (não enfraquece) o isolamento multi-tenant ao habilitar a defesa de coerência de tenant no banco; não há segredo no SQL; não há dado de PII nem impacto em LGPD; RLS de `appointments` permanece com as 3 policies intactas.

<details>
<summary>Issues (0)</summary>

Nenhuma issue acionável. Aprovado.

</details>

<details>
<summary>Details</summary>

### Aderência à ADR e à análise de dados

A decisão da ADR cita "análise de dados §4.2: Opção A". Li a §4.2: ela documenta exatamente o gap (appointments sem `unique (tenant_id, id)`, FK composta de `messages` falharia no `db reset`), escolhe Opção A sugerindo o nome `20250220089000_appointments_tenant_unique.sql` aplicada antes de `messages`, e descarta Opção B pelo furo cross-tenant. A migration entregue corresponde ao nome, ao conteúdo e à ordenação prometidos — rastreabilidade íntegra (confirmed).

### Fronteira multi-tenant / RLS / RBAC / segredos / LGPD

A constraint `unique (tenant_id, id)` é o alvo que permite à FK composta de `messages` garantir, no schema, que uma mensagem só referencie agendamento do mesmo tenant — ou seja, a mudança *fortalece* o isolamento, não o afrouxa (confirmed). Nenhuma policy RLS foi criada, alterada ou removida: as 3 policies de `appointments` (`appointments_select_tenant`, `appointments_write_own_professional`, `appointments_write_staff`) seguem presentes após o `db reset` (verificado via `pg_policy`). Sem mudança de RBAC. Sem segredo no SQL. Sem coluna de PII nem qualquer impacto LGPD (confirmed).

### Idempotência

`add constraint ... unique` não aceita `if not exists`, então o `do $$` que consulta `pg_constraint` por `conname` + `conrelid` antes de criar é o padrão correto e já estabelecido em `appointments_no_overlap`. Re-apliquei a migration manualmente contra o DB já migrado: retornou `DO` sem erro e o número de constraints `appointments_tenant_id_unique` permaneceu 1 (confirmed). O `conrelid = 'public.appointments'::regclass` evita colisão de nome com constraint homônima em outro schema/tabela — bom detalhe.

### Contraprova executada

- `npm run build` (`tsc -b && vite build`): sucesso. A ADR é escopo puro de dados (SQL), não exercita TS, mas o build continua verde — sem regressão no frontend (confirmed). O aviso de chunk > 500 kB é pré-existente e fora de escopo.
- `supabase db reset`: aplicou todas as migrations em ordem, incluindo `20250220089000_...`, sem erro. `RESET_EXIT=0` (A1 ✓, confirmed).
- `pg_get_constraintdef`: `appointments_tenant_id_unique` → `UNIQUE (tenant_id, id)` (A2 ✓, confirmed).
- `git diff HEAD -- supabase/migrations/20250219091000_appointments.sql`: vazio — a migration aplicada permanece byte-a-byte inalterada (A3 ✓, confirmed).
- `git show --name-only`: o commit `efcf007` altera somente o arquivo novo da migration; nenhum arquivo fora de escopo (confirmed).

### Design doc React

Não se aplica: esta ADR é escopo `dados`, sem código de frontend. As ADRs de frontend (05–08) ficam para revisões próprias.

</details>

<details>
<summary>Arquivos no escopo da ADR</summary>

- `supabase/migrations/20250220089000_appointments_tenant_unique.sql` (novo) — bloco `do $$` idempotente que adiciona `unique (tenant_id, id)` em `appointments`.

Diff completo: `git show efcf007`.

</details>
