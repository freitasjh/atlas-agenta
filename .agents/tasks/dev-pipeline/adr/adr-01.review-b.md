# Vigência da grade e passo-base de slots em `professionals` (ADR-01) — Revisor B

Revisor independente B. Escopo: commit `6d09e23`, única mudança = migration nova `supabase/migrations/20250221090000_professionals_schedule_vigencia.sql` (55 linhas, só SQL). A migration faz `ALTER TABLE professionals` adicionando `schedule_start_date date`, `schedule_end_date date`, `slot_step_minutes int not null default 30 check (between 5 and 240)` e o CHECK de coerência de vigência `professionals_schedule_vigencia_coherent`. Nenhuma tabela, policy, índice ou segredo novo. Aderente ao PRD §9 (pontos 1/2/3, aprovados no gate) e à recomendação de `analysis-data.md` §6.1 — que é reproduzida quase literalmente, com guardas de idempotência adicionadas.

Watch for: nada bloqueante. Um ponto de design admin-only (`professional` não edita a própria vigência/passo) é intencional e registrado como backlog no próprio ADR (**confirmed**, não é defeito). A ausência de índice nas colunas de data é correta para esta ADR (**confirmed**, a filtragem acontece no gerador de slots da ADR-05, não no banco).

**Verdict**: APPROVED

## High-level view

A decisão de pôr vigência e passo-base como colunas em `professionals` (e não em `working_hours` nem em tabela de settings) é sólida: são um valor único por profissional, e duplicá-los por linha de dia abriria inconsistência entre dias. O schema aplicado confere com o que o PRD e a análise de dados fixaram.

A fronteira multi-tenant/RBAC está preservada sem esforço novo: a migration não cria policy. A policy `professionals_write_admin` pré-existente (`FOR ALL`, USING + WITH CHECK ancorados em `current_tenant_id()` e `current_role_name()='admin'`) cobre colunas novas automaticamente, e `tenant_id` já tem default `current_tenant_id()`. Isso realiza exatamente o "admin-only no MVP" do PRD §9 ponto 3 sem ampliar a superfície de escrita.

A integridade é travada no banco por dois CHECKs, com o zod da ADR-03 ficando só como UX — a ordem correta (banco é a trava, cliente é conveniência). A migration é idempotente no re-apply: `add column if not exists` nas colunas e guarda `do $$ ... if not exists (pg_constraint) $$` no CHECK de coerência, contornando o fato de `add constraint` não ser idempotente sozinho.

Contraprova executada contra o Supabase local rodando: migration já aplicada (`20250221090000` no `schema_migrations`), `npm run build` limpo, e todos os ACs testáveis desta ADR passam (coerência, range, default, nulos, boundaries e re-apply).

<details>
<summary>Issues (0)</summary>

Nenhum issue acionável. Aprovado.

</details>

<details>
<summary>Details</summary>

### Aderência à ADR e ao PRD

A migration entrega exatamente o escopo da ADR-01: nome de arquivo (`20250221090000_professionals_schedule_vigencia.sql`, timestamp posterior à última aplicada `20250220091000_messages.sql`), três colunas, dois CHECKs, zero policy nova. Os nomes de constraint batem com os ACs: `professionals_schedule_vigencia_coherent` (AC-08a) e o check de range `slot_step_minutes between 5 and 240` (AC-08b, materializado como `professionals_slot_step_minutes_check`). Confere com `analysis-data.md` §6.1 linha a linha; a única diferença é a adição das guardas de idempotência, que a ADR exige e o snippet cru da análise não tinha — melhoria, não desvio.

A escolha de `date` (não `timestamptz`) para vigência é coerente com RNF-SEG-05: vigência é dia de calendário no fuso do tenant, e a conversão para instante UTC fica na geração de slots (ADR-05). O comentário do SQL documenta isso explicitamente.

### Fronteira multi-tenant / RLS / RBAC

Verificado por leitura de `20250217090000_operational_catalog.sql`: a policy `professionals_write_admin` é `for all using (tenant_id = current_tenant_id() and current_role_name() = 'admin') with check (...)`. Como é `FOR ALL` e não lista colunas, ela governa qualquer `UPDATE` nas colunas novas sem alteração. A migration não adiciona policy de escrita para `professional` nem `receptionist`, então o AC-03 (parcial) — só admin escreve vigência/passo — é satisfeito estruturalmente. `tenant_id` tem default `current_tenant_id()` (`20250218090000_operational_tenant_id_default.sql`), então nenhuma brecha de `tenant_id` vindo do cliente é aberta aqui. RLS de `professionals` permanece habilitada e inalterada.

O trade-off de o `professional` não editar a própria vigência/passo no MVP é consciente (PRD §9 ponto 3, Consequências do ADR) e registrado como backlog para own-update granular. Não é um gap de segurança — é o inverso, restringe a superfície de escrita numa tabela que carrega `profile_id`/`active`.

Idempotência de webhook, segredos e LGPD/PII: não se aplicam a esta ADR (sem webhook, sem credencial, sem PII — `date`/`int` sem dado pessoal). Nada no SQL expõe segredo.

### Contraprova executada

Supabase local ativo (container `supabase_db_atlas-agenda`, Postgres 15). Resultados:

- `npm run build` (`tsc -b && vite build`): sucesso. Sem script de lint no `package.json`; `typecheck` está embutido no build. Mudança é SQL-only, então não exercita TS — rodado para não-regressão, limpo.
- Migration `20250221090000` presente em `supabase_migrations.schema_migrations`; `\d professionals` mostra as três colunas (`schedule_start_date date`, `schedule_end_date date`, `slot_step_minutes integer not null default 30`) e os dois CHECKs.
- ACs testáveis (transação com savepoints, rollback ao final — sem poluir estado):
  - **AC-08b default:** insert sem `slot_step_minutes` grava `30`. OK.
  - **AC-08a:** `schedule_start_date='2025-03-10' > schedule_end_date='2025-03-01'` → rejeitado por `professionals_schedule_vigencia_coherent`. OK. Datas iguais (`2025-05-01`/`2025-05-01`) aceitas. OK.
  - **AC-08b:** `slot_step_minutes=300` e `=4` → rejeitados por `professionals_slot_step_minutes_check`; boundaries `5` e `240` aceitos. OK.
  - **AC-08c:** `schedule_start_date=null` + `schedule_end_date` preenchido aceito; ambos null aceito. OK.
  - **Re-apply:** rodar o corpo completo da migration duas vezes na mesma transação → `ALTER TABLE` + `DO` em ambas as passagens sem erro. Idempotência confirmada.

Verificação visual (dev server / Chrome DevTools) não foi executada aqui por decisão de processo — é do QA no step seguinte. Para esta ADR de dados, o `supabase start` + `psql` é a prova pertinente e foi feito.

</details>

<details>
<summary>Mapa de arquivos</summary>

- `supabase/migrations/20250221090000_professionals_schedule_vigencia.sql` (novo) — ALTER em `professionals`: 3 colunas de vigência/passo + CHECK de coerência, idempotente. Única mudança do commit `6d09e23`.

Diff completo: `git show 6d09e23 -- supabase/migrations/`.

</details>
