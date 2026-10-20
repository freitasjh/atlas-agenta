# Revisor B — Parecer sobre ADR-02 (tabela `whatsapp_instances`, RLS + RBAC admin-write)

Migration nova `20250220090000_whatsapp_instances.sql` (commit `87c013a`, único arquivo) cria a tabela `whatsapp_instances` do módulo WhatsApp: uma conexão de número por tenant, estado de conexão observável, `tenant_id` com `default current_tenant_id()`, índice por tenant, RLS com SELECT para todo papel operacional e WRITE só para `admin`, unique por tenant travando o recorte "sem múltiplos números". Reutiliza os helpers security definer da Fase 2 (`current_tenant_id()`/`current_role_name()`) — não os recria. Nenhuma coluna de QR nem de token/segredo.

Watch for: nada bloqueante. Rodei os cinco critérios de aceite (A1–A5) contra o Supabase local com o harness de dois tenants + papéis distintos — todos passam. Build verde.

**Verdict**: APPROVED

## Visão de alto nível

A ADR materializa `whatsapp_instances` de `dominio.md` seguindo o mesmo molde de `customers`/`appointments`: `tenant_id uuid not null default current_tenant_id() references tenants(id) on delete cascade`, índice por tenant, RLS com USING + WITH CHECK ancoradas nos helpers. A execução é fiel linha a linha à decisão — colunas, tipos, checks, constraint e policies batem com a tabela da ADR sem desvio.

A postura de fronteira está correta e, em pontos, exemplar. O `default current_tenant_id()` fecha de antemão a armadilha que foi bug de causa-raiz na ADR-05 (coluna `not null` sem default barrando a escrita legítima do cliente por WITH CHECK) — confirmei empiricamente que o INSERT do admin sem `tenant_id` recebe o tenant do JWT e passa, enquanto o cross-tenant continua barrado. O RBAC separa leitura (todo papel operacional) de escrita (só admin), coerente com "parear é configuração do dono" e com o fato de o estado de conexão não ser dado financeiro. Não há policy `super_admin` pelo cliente — cross-tenant fica para fase futura via service role, como manda a regra de segurança.

A decisão de não persistir QR nem token/credencial é a postura certa de segredos: a tabela não tem onde vazar credencial, e `evolution_instance_name` é só nome lógico. Sem PII de cliente final aqui, então nada a tratar de LGPD nesta ADR. Escopo `dados` puro: design doc React não se aplica (ADRs 05–08 têm revisão própria).

<details>
<summary>Issues (0)</summary>

Nenhuma issue acionável. Aprovado.

</details>

<details>
<summary>Details</summary>

### Aderência à ADR

A tabela entregue corresponde exatamente à decisão: `id uuid pk default gen_random_uuid()`; `tenant_id` com `default current_tenant_id()` + FK `on delete cascade`; `evolution_instance_name text not null check (char_length between 1 and 120)`; `connection_status text not null default 'desconectado' check in ('desconectado','aguardando_qr','conectado')`; `last_connected_at timestamptz` nulo; `created_at timestamptz not null default now()`; `constraint whatsapp_instances_tenant_unique unique (tenant_id)`; índice explícito `whatsapp_instances_tenant_id_idx`. Verifiquei cada item contra o catálogo (`information_schema.columns`, `pg_constraint`, `pg_indexes`) — rastreabilidade íntegra (confirmed). As duas policies (`whatsapp_instances_select_same_tenant`, `whatsapp_instances_write_admin`) têm exatamente o `qual`/`with_check` descritos na ADR (confirmed).

### Fronteira multi-tenant / RLS / RBAC

Exercido na mesma transação sob `role authenticated` + `request.jwt.claims`, com harness de dois tenants semeados pelo signup trigger (padrão registrado no brain: reconfigurar profiles por UPDATE, nunca re-INSERT):

- **CA-05 (isolamento de leitura):** admin do tenant A vê 1 linha total e 0 linhas de B (confirmed).
- **CA-06 (WITH CHECK cross-tenant):** admin A tentando inserir linha com `tenant_id` de B é barrado — `new row violates row-level security policy` (confirmed).
- **A5 (RBAC de escrita):** `receptionist` e `professional` do tenant A → UPDATE afeta 0 linhas (write negado pela policy `for all` que exige admin), mas ambos LEEM normalmente (SELECT retorna a linha). `admin` A → UPDATE afeta 1 linha; e INSERT sem `tenant_id` passa (default preenche do JWT) (confirmed).

O `default current_tenant_id()` é o ponto que fecha o bug de causa-raiz da ADR-05 — sem ele, o WITH CHECK reprovaria a escrita legítima do cliente, que por regra de isolamento não envia `tenant_id`. Confirmado que a escrita do admin passa e o cross-tenant continua barrado (confirmed). A coexistência de uma policy `for select` permissiva + uma `for all` permissiva não vaza: ambas exigem `tenant_id = current_tenant_id()`, e o Postgres faz OR por comando (o SELECT do não-admin passa pela de select; a de write só concede a admin) — comportamento esperado, não bug (confirmed).

### Idempotência

`create table if not exists` + `drop policy if exists` antes de cada `create policy`, igual ao padrão de `customers`. `supabase db reset` aplicou a migration limpo na ordem correta (último da sequência, após `20250220089000`), `RESET_EXIT=0`, tabela presente no catálogo com `relrowsecurity = t` (A1/A2 ✓, confirmed). Timestamp `20250220090000` é posterior ao da ADR-01 e anterior ao `messages` planejado (`20250220091000`), preservando a cadeia de dependência (confirmed).

### Segredos / LGPD

Nenhum segredo no SQL. A ausência deliberada de coluna de QR e de token/credencial é a decisão certa: QR é efêmero (devolvido pela Edge Function da ADR-04, exibido, nunca gravado) e a credencial da Evolution vive só em env do servidor — a tabela não tem superfície para vazar credencial em coluna (confirmed). `evolution_instance_name` é nome lógico derivado do tenant, sem segredo. Sem PII de cliente final nesta tabela, então sem impacto LGPD direto nesta ADR (confirmed).

### Contraprova executada

- `npm run build` (`tsc -b && vite build`): sucesso, `BUILD_EXIT=0`. Escopo é SQL puro, não exercita TS; sem regressão no frontend. O aviso de chunk > 500 kB é pré-existente e fora de escopo (confirmed).
- `supabase db reset`: todas as migrations aplicadas em ordem, incluindo `20250220090000`, sem erro (A1 ✓, confirmed).
- Catálogo: `relrowsecurity = t`; índice `whatsapp_instances_tenant_id_idx` presente; `tenant_id` com `default current_tenant_id()`; unique `(tenant_id)`; checks de `connection_status` e `evolution_instance_name` presentes (A2/A3 ✓, confirmed).
- Harness RLS/RBAC de dois tenants: A3/A4(CA-05/CA-06)/A5 todos passam (confirmed). Dados de teste removidos ao final.
- `git show 87c013a --name-only`: único arquivo é a migration nova; nenhum arquivo fora de escopo, nenhuma migration aplicada editada (confirmed).

### Design doc React

Não se aplica: ADR de escopo `dados`, sem código de frontend.

</details>

<details>
<summary>Arquivos no escopo da ADR</summary>

- `supabase/migrations/20250220090000_whatsapp_instances.sql` (novo) — tabela `whatsapp_instances` com `default current_tenant_id()`, unique por tenant, índice por tenant, RLS (SELECT todo papel operacional, WRITE só admin).

Diff completo: `git show 87c013a`.

</details>
