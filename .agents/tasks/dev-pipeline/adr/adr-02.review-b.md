# Revisão B — ADR-02: tabela `schedule_overrides` (exceções por data) com RLS/RBAC

Migration nova `supabase/migrations/20250221091000_schedule_overrides.sql` (commit `8fff6f8`) cria a tabela de domínio `schedule_overrides` com `tenant_id` default `current_tenant_id()`, FK composta por tenant, CHECK de coerência de janela, `unique (tenant_id, professional_id, override_date)`, dois índices, RLS habilitado e três policies (SELECT para o tenant, WRITE admin, WRITE own-professional) espelhando `working_hours`. Escopo da ADR é só dados (nenhum arquivo TS tocado). A implementação é um espelho fiel do padrão já auditado em `20250217090000_operational_catalog.sql`.

**Watch for:** divergência menor no CHECK de `reason` — a migration usa `char_length(reason) between 1 and 200`, enquanto a ADR/análise especificam `<= 200` (confirmed). Isso rejeita string vazia no banco; o schema zod da ADR-03 precisa espelhar essa borda para não deixar passar `reason=""` que o Postgres barra. Não é bloqueador.

**Verdict**: APPROVED

## High-level view

A tabela nasce isolada por tenant com o mesmo rigor do catálogo: `tenant_id not null default current_tenant_id()`, FK composta `(tenant_id, professional_id)` → `professionals (tenant_id, id)`, índice por tenant e RLS habilitado antes de qualquer policy. O `tenant_id` nunca vem do cliente — o WITH CHECK de cada policy de escrita o ancora em `current_tenant_id()`. Isolamento cross-tenant fechado no schema, não só na UI.

O RBAC é cópia byte-a-byte das policies de `working_hours`: SELECT para qualquer papel do tenant (recepção vê disponibilidade), WRITE para admin em qualquer profissional, WRITE para professional apenas nas linhas do profissional cujo `profile_id = auth.uid()`. Receptionist e super_admin sem policy de escrita — exatamente o que o PRD §5 e a análise §6.3 pedem. Como as policies replicam um padrão já verificado na mesma base, a superfície de erro é baixa.

A coerência de dados fica no banco: o CHECK `schedule_overrides_window` cobre os dois casos do usuário (fechado sem janela; aberto com `start < end` e break ambos-ou-nenhum dentro da janela), e o `unique` garante uma exceção por profissional/dia. Datas em `date` e horas em `time`, sem timestamptz nas janelas — a conversão para UTC fica para o gerador de slots (ADR-05), coerente com RNF-SEG-05. Nenhum segredo no SQL; idempotência via `if not exists` + `drop policy if exists`.

A única coisa a carregar para a frente é a borda do `reason` (mínimo 1 char no banco), que o zod da ADR-03 deve refletir. A verificação de RLS/CHECK/`unique` em runtime (AC-01..07) não é exercitada pelo build e fica para o QA ao vivo.

<details>
<summary>Issues (2)</summary>

1. **CHECK de `reason` diverge da ADR** — migration usa `between 1 and 200`, ADR/análise dizem `<= 200`; string vazia é rejeitada no banco. Garantir que o schema zod da ADR-03 espelhe o mínimo de 1 char (ou normalize `""` → `null`) para o CHECK não barrar o que o form deixou passar. Minor, não-bloqueador.
2. **Verificação de RLS/CHECK em runtime pendente** — a contraprova desta ADR é SQL-only; `npm run build` não exercita RLS/CHECK/`unique`. AC-01..07 (isolamento, tenant do servidor, RBAC por papel, coerência, unicidade) exigem `supabase db reset` + sessões autenticadas, que é verificação ao vivo do QA. Não executado aqui por desenho (sem subir ambiente neste step).

</details>

<details>
<summary>Details</summary>

### Isolamento multi-tenant — fechado no schema, não na UI

A linha-chave é `tenant_id uuid not null default current_tenant_id() references tenants (id) on delete cascade`. O cliente nunca envia `tenant_id`; o default o deriva do JWT via helper `security definer` (confirmed, `current_tenant_id()` existe em `20250216091000_profiles_and_helpers.sql`). A FK composta

```
constraint schedule_overrides_professional_fk
  foreign key (tenant_id, professional_id)
  references professionals (tenant_id, id) on delete cascade
```

fecha o buraco de vincular uma exceção a um `professional_id` de outro tenant — o alvo referenciável existe (`professionals_tenant_id_unique unique (tenant_id, id)` no catálogo). Mesmo padrão de `service_professionals`/`working_hours`. RLS é habilitada (`alter table ... enable row level security`) antes das policies.

### RBAC — espelho fiel de `working_hours`

Comparando a policy `schedule_overrides_write_own_professional` com `working_hours_write_own_professional`, a estrutura é idêntica (USING == WITH CHECK, `current_role_name() = 'professional'` + `exists` em `professionals` por `profile_id = auth.uid()` no mesmo tenant). O `exists` fecha tanto o tenant quanto o dono, então um professional do tenant A não escreve exceção de outro profissional nem de outro tenant. Admin via `schedule_overrides_write_admin` (ALL, `current_role_name() = 'admin'`). SELECT aberto a qualquer papel do tenant por `tenant_id = current_tenant_id()`. Receptionist e super_admin sem policy de escrita → só leitura — sem caminho cross-tenant pelo cliente. Casa com o PRD §5 e a matriz de perfis.

Vale notar que as policies de escrita são `for all` (não só INSERT): isso cobre UPDATE/DELETE pelos mesmos predicados, o que é o comportamento desejado — um professional também não pode editar/apagar exceção de outro.

### Coerência de janela e unicidade — a trava é o banco

O CHECK `schedule_overrides_window` reproduz `working_hours_window` + `working_hours_break_coherent`: fechado exige janela e break nulos; aberto exige `start_time < end_time` e break ambos-ou-nenhum com `start_time <= break_start < break_end <= end_time`. Cobre AC-06. O `unique (tenant_id, professional_id, override_date)` cobre AC-07 e evita a ambiguidade de duas janelas no mesmo dia, coerente com a decisão de uma faixa por dia (paridade com a grade). Datas `date` + horas `time` evitam embutir fuso na persistência (RNF-SEG-05); a conversão para UTC é responsabilidade do gerador de slots (ADR-05), fora deste escopo.

### Divergência no CHECK de `reason`

A ADR §Decisão e a análise §6.2 escrevem `reason text check (reason is null or char_length(reason) <= 200)`. A migration entregou `char_length(reason) between 1 and 200`. Efeito: `reason = ''` (string vazia não-nula) é aceito pela ADR mas rejeitado pela migration. É um endurecimento sensato (rótulo vazio não tem valor), mas cria uma assimetria a resolver na ADR-03: se o form enviar string vazia e o zod não normalizar para `null` nem exigir mínimo 1, o insert falha no CHECK com erro genérico em vez de validação pt-BR na borda. Ação: alinhar o zod de exceção (ADR-03) a `min(1)` ou `transform('' → null)`. Minor; não compromete isolamento nem integridade.

### Idempotência, segredos, ordem

`create table if not exists`, `create index if not exists` e `drop policy if exists` antes de cada `create policy` tornam o re-apply seguro (parte do "re-apply" nos ACs). Timestamp `20250221091000` é posterior a ADR-01 (`20250221090000`) e à última migration pré-agenda (`20250220091000_messages.sql`), respeitando a ordem. Nenhum segredo no SQL. Não há service role, Edge Function nem webhook nesta ADR — idempotência/autenticidade de webhook não se aplica, como o PRD §4 registra.

### Contraprova

`npm run build` (`tsc -b && vite build`) concluiu sem erro (saída limpa; warning de chunk > 500 kB é pré-existente e não relacionado a SQL). Não há script de lint/test no `package.json` (só `dev`, `build`, `typecheck`, `preview`), então não há outra verificação estática a rodar. A verificação de RLS/CHECK/`unique` em runtime (AC-01..07) depende de `supabase db reset` + sessões autenticadas de papéis/tenants distintos — verificação ao vivo que pertence ao QA (não executada aqui por instrução de não subir ambiente neste step).

</details>

<details>
<summary>Arquivos alterados</summary>

- `supabase/migrations/20250221091000_schedule_overrides.sql` (novo, 130 linhas) — tabela `schedule_overrides` + FK composta por tenant + CHECK de janela + `unique` + 2 índices + RLS + 3 policies (SELECT tenant, WRITE admin, WRITE own-professional).

Diff completo: `git show 8fff6f8`.

</details>
