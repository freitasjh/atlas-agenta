# Revisor B — ADR-02: Baseline/seed dos 4 templates padrão por tenant

Escopo revisado: commit `c7fd6a1` — `supabase/migrations/20250222091000_message_templates_baseline.sql` (118 linhas, único arquivo). Base de comparação: `master`; dependência ADR-01 (`20250222090000_message_templates.sql`) já aprovada.

A migration cumpre as três responsabilidades da ADR com idempotência: função `seed_message_templates` (`security definer`, `search_path` fixo, `on conflict do nothing`), recriação de `handle_new_user` com `create or replace` acrescentando a chamada de seed no fluxo atômico do signup, e backfill por `cross join` para tenants legados. O corpo de `handle_new_user` é cópia fiel da migration aplicada `20250216092000` — conferi linha a linha: mesmos inserts de `tenants` e `profiles`, único acréscimo é `perform seed_message_templates(v_tenant_id)` após o insert em `profiles`. O trigger `on_auth_user_created` não é recriado, como manda a ADR.

Watch for: nada bloqueante. Dois pontos menores de robustez (confirmed, não-bloqueantes) — ordem de recriação da função vs. uma possível falha de migration anterior, e divergência textual (DRY) entre o seed e o backfill. Ambos abaixo.

**Verdict**: APPROVED

## High-level view

A fidelidade do corpo recriado de `handle_new_user` é o ponto de maior risco de regressão, e está correta: o insert de tenant/profile é idêntico ao original, então o signup não regride. O seed entra no mesmo bloco atômico, então tenant novo nunca existe sem os 4 templates.

A idempotência das três superfícies foi verificada contra um Postgres real (harness mínimo + apply duplo): tenant novo nasce com exatamente 4 linhas, backfill cobre o legado, re-apply insere 0 e a query de duplicatas retorna 0. `on conflict (tenant_id, template_key) do nothing` é a chave única da ADR-01 — casa com a constraint.

Fronteiras de segurança: o seed roda sob `security definer` (bypassa RLS por desenho, é a dona da redação padrão — coerente com a ADR-01, que explicitamente delega o seed à service role). Nenhum segredo/PII no SQL; os textos são placeholders pt-BR. AC-09 preservado: nenhum artefato de webhook/cron/parsing foi adicionado — o `lembrete_d1` carrega `1 confirmar / 2 reagendar` como texto livre, sem lógica acoplada.

Os dois achados menores são de qualidade, não de correção: os 4 textos padrão estão duplicados entre a função de seed e o bloco de backfill (risco de divergirem em edições futuras), e a migration recria a função `handle_new_user` sem um guard caso o signup original não tenha sido aplicado — improvável na cadeia de migrations, mas vale registrar.

<details>
<summary>Issues (2)</summary>

1. **Texto padrão duplicado (seed vs. backfill)** — os 4 corpos pt-BR aparecem idênticos em dois lugares (função `seed_message_templates` e bloco de backfill). Não é bug (ambos conferidos iguais), mas uma edição futura pode alterar um e esquecer o outro. Opcional: fazer o backfill chamar `seed_message_templates(t.id)` num `select ... from tenants t`, deixando a função como fonte única da redação. Não-bloqueante.
2. **Recriação de `handle_new_user` assume a migration de signup aplicada** — `create or replace` reproduz o corpo inteiro, então funciona mesmo que a função não exista; mas se a ordem de migrations quebrar (função original ausente), a cópia aqui vira a definição canônica sem aviso. Na cadeia versionada atual isso não ocorre. Apenas registrado. Não-bloqueante.

</details>

<details>
<summary>Details</summary>

### Fidelidade do corpo recriado de `handle_new_user` (defeito #2 — regressão do signup)

O maior risco de uma ADR que recria uma função de signup `security definer` é regredir o fluxo de criação de tenant/profile. Comparei o corpo recriado com `20250216092000_signup_trigger.sql`: o `insert into tenants (...)` com o `coalesce(trade_name, legal_name, email)`, o `plan='individual'`, `subscription_status='trial'`, `trial_ends_at = now() + interval '14 days'`, e o `insert into profiles (id, tenant_id, role='admin', full_name)` são byte-a-byte equivalentes. O único acréscimo é `perform seed_message_templates(v_tenant_id)` depois do insert de `profiles`, dentro do mesmo bloco — ou seja, se o seed falhar, o signup inteiro reverte (sem janela de tenant/profile órfão). Fidelidade confirmada (confirmed).

### Idempotência das três superfícies (AC-02)

Apliquei a migration contra um Postgres 16 descartável com um harness mínimo (tabelas `tenants`/`profiles`/`message_templates` na forma da ADR-01, `auth.users` stub, 1 tenant legado, trigger `on_auth_user_created` religado). Resultados (confirmed):

- **Tenant novo via trigger:** insert em `auth.users` → o tenant resultante tem exatamente 4 linhas em `message_templates`, uma por chave, todos os `body` não-vazios e `active = true`.
- **Backfill legado:** o tenant pré-existente recebeu 4 linhas no primeiro apply.
- **Re-apply da migration inteira:** `INSERT 0 0` no backfill; total de linhas inalterado (8); `group by tenant_id, template_key having count(*)>1` retornou 0 linhas.
- **Re-chamada de `seed_message_templates` num tenant que já tem as 4:** 0 novas linhas.

O `on conflict (tenant_id, template_key) do nothing` depende da constraint `message_templates_tenant_key_unique` da ADR-01 — presente e correta. Ambas as inserções passam `tenant_id` explicitamente (`p_tenant_id` na função, `t.id` no backfill), então o `default current_tenant_id()` da coluna (que seria nulo fora de uma sessão autenticada) não é exercido — correto para código que roda sob definer/service role.

### Fronteira de segurança (RLS/segredos/LGPD)

O seed roda `security definer` com `search_path = public` fixo — bypassa o RLS por desenho, exatamente como a ADR-01 delega ("a baseline/seed roda via service role"). Isso não é vazamento cross-tenant: cada linha é inserida com o `tenant_id` do próprio tenant alvo. Nenhum segredo no SQL; os `body` são placeholders de texto, não PII. AC-09: `grep` por `pg_cron|webhook|parse|http` no diff só bate num comentário que afirma a ausência — nenhum artefato de Fatia 2 foi antecipado.

### Contraprova de build

`npm run build` (tsc -b + vite build) — limpo. `npm run test` (vitest) — 16/16 passam. ADR-02 não toca TS; registrado como contraprova. Não subi dev server (decisão do QA).

</details>

<details>
<summary>Mapa de arquivos</summary>

- `supabase/migrations/20250222091000_message_templates_baseline.sql` (novo) — função `seed_message_templates`, `create or replace handle_new_user` (corpo fiel + seed), backfill idempotente. Único arquivo do escopo da ADR-02.

Diff completo: `git show c7fd6a1`.

</details>
