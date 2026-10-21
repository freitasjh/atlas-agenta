# Revisor B — ADR-01: tabela `message_templates` por tenant (schema + RLS)

Parecer independente (modelo B, sem acesso ao parecer A). Escopo revisado: a ADR-01 da fatia
"WhatsApp Fase 2, Fatia 1". Branch `feat/message-templates-schema-rls` sobre `master`. O único
arquivo de aplicação no diff é `supabase/migrations/20250222090000_message_templates.sql` (80
linhas, novo) — o restante do diff é movimentação de docs do pipeline para `_archive-pre-templates/`,
fora do escrutínio de código.

A migration cria a tabela editorial das 4 mensagens da régua, uma linha por `(tenant_id,
template_key)`, já nascendo sob RLS. É a primeira porta por onde um template poderia vazar entre
tenants (defeito #1 do PRD), então a análise se concentra na fronteira multi-tenant/RBAC.

Watch for: nada bloqueante. Verifiquei contra o banco rodando (migration aplica limpa, RLS ativa,
`with_check` presente, insert sem JWT barrado) — todos os critérios de aceite da ADR passam
(confirmed). Uma observação não-bloqueante sobre a ausência de trigger de `updated_at` (possible),
coerente com o que já existe nas tabelas irmãs e deixada como decisão consciente do planejamento.

**Verdict**: APPROVED

## High-level view

A migration adere 1:1 à decisão da ADR e às "Arquivos afetados" (um só arquivo). Colunas,
`unique (tenant_id, template_key)`, índice `message_templates_tenant_id_idx`, `check` de
`template_key` (espelha o enum de `messages.template`) e `check` de `body` (1..2000) conferem
exatamente com o texto da ADR e com o §8-dados do PRD.

A fronteira multi-tenant está fechada no banco, não na app: `tenant_id not null default
current_tenant_id()` deriva do JWT e nunca do cliente, e ambas as policies ancoram em
`current_tenant_id()`/`current_role_name()` — os helpers `security definer` reutilizados da
`20250216091000`, não reimplementados (evita a recursão de RLS documentada naquela migration). A
policy de escrita tem `WITH CHECK` idêntico ao `USING`, o que, somado ao default, deixa o INSERT do
cliente (sem `tenant_id` no corpo) passar com o tenant do JWT e barra mover linha para outro tenant.
Esse é exatamente o padrão `default current_tenant_id()` + `WITH CHECK` que o projeto consolidou
como correção de causa-raiz em ADRs anteriores.

RBAC confere com a decisão D6/§5 do PRD: SELECT e ALL só para `admin`; sem policy de `super_admin`
(nenhum caminho cross-tenant pelo cliente, coerente com as outras tabelas de domínio); o seed via
service role fica para a ADR-02. Restringir leitura ao admin não quebra o envio, porque a
renderização é server-side (Edge Function com service role) — raciocínio correto e sem efeito nesta
ADR.

Segredos/LGPD: nenhum segredo no SQL; `body` é texto com placeholders, não é PII nem segredo.
Idempotência e ordenação de timestamp (`20250222090000` > `20250221091000`) corretas; nenhuma
migration aplicada foi editada.

<details>
<summary>Issues (1)</summary>

1. **`updated_at` sem trigger (não-bloqueante)** — a coluna tem `default now()` mas nada a atualiza
   em UPDATE; hoje a ADR-04/05/06 teriam de setá-la na escrita (ou aceitar que reflete só o
   `created_at`). Coerente com as tabelas irmãs (`schedule_overrides` nem tem a coluna), então é
   decisão consciente, não defeito. Registrar como ponto de atenção para a ADR de escrita; não
   precisa mudar esta migration.

</details>

<details>
<summary>Details</summary>

### Contraprova executada (verificação estática + banco real)

`npm run build` (inclui `tsc -b`) → exit 0, sem erros de tipo. `npm test` (vitest) → 16/16 passam.
Como a ADR é SQL-only e não toca `src/`, o build só reconfirma que nada quebrou — esperado. O único
aviso do build é o chunk > 500 kB do bundle, pré-existente e sem relação com esta ADR.

Para provar o AC-01/idempotência/RLS de fato (não só ler o SQL), subi o stack local (Supabase CLI
2.121.0, Docker) e apliquei as migrations com `supabase migration up --local`: as 15 migrations
aplicam em ordem, incluindo `20250222090000_message_templates.sql`, sem erro. Observação de
ambiente: `supabase db reset` falhou numa etapa de init do container de auth (`connection refused`
no migrator do GoTrue) — erro transitório de infra, não do SQL desta ADR; o `migration up`
contorna e aplica tudo limpo.

Inspeção do schema resultante no banco:

```
message_templates | relrowsecurity = t          -- RLS habilitada
tenant_id  uuid NOT NULL default current_tenant_id()
template_key text NOT NULL  check in (confirmacao, lembrete_d1, cobranca, comprovante)
body       text NOT NULL  check (char_length between 1 and 2000)
active     boolean NOT NULL default true
unique (tenant_id, template_key)
index message_templates_tenant_id_idx on (tenant_id)
policy message_templates_select_admin  cmd=SELECT  using=(tenant=current_tenant_id() and role='admin')  check=NULL
policy message_templates_write_admin   cmd=ALL     using=(...)  check=(tenant=current_tenant_id() and role='admin')
```

Bate linha a linha com a ADR e com o §8-dados do PRD.

### Idempotência (AC testável da ADR)

Re-apliquei o próprio arquivo da migration com `ON_ERROR_STOP=1` sobre o schema já criado: saída
exit 0, só `NOTICE ... already exists, skipping` em `create table if not exists` e no índice, e os
`drop policy if exists` + `create policy` recriam as duas policies sem erro. Contagem de policies
estável (2) — não duplica. Idempotência confirmada.

### Isolamento multi-tenant (defeito #1) — teste funcional de RLS

Além de ler as policies, exercitei a RLS como role `authenticated` sem claims de JWT (sem
`current_tenant_id()`/`current_role_name()`):

```
set role authenticated;
select count(*) from public.message_templates;              -> 0    (RLS esconde tudo)
insert into public.message_templates (template_key, body)
  values ('confirmacao','x');                               -> ERROR: new row violates row-level security policy
```

Sem tenant/role resolvidos pelo JWT, a leitura retorna zero linhas e a escrita é barrada pelo
`WITH CHECK`. O isolamento é do banco, não da app — exatamente o requisito inegociável. O caminho
cross-tenant do `super_admin` não existe aqui (ausência deliberada de policy, coerente com as demais
tabelas de domínio); o seed via service role, que bypassa RLS, é escopo da ADR-02.

### Aderência à ADR e às convenções

- "Arquivos afetados" na ADR = 1 arquivo; o diff de aplicação = exatamente esse 1 arquivo. Sem
  escopo vazado (nada de seed, frontend, Edge Function nesta ADR). 
- Nomenclatura inglês/snake_case/plural, tempo em `timestamptz` (UTC), nada de `*_cents` indevido —
  convenções do projeto respeitadas.
- `public.` qualificado explicitamente no `create table` e nas policies; não assume `search_path`.
  A armadilha de colisão de nome em `public` (regra de brain sobre `realtime.messages`) está
  endereçada no comentário e `message_templates` não colide com objeto reservado conhecido.
- Reuso dos helpers `security definer` (verifiquei na `20250216091000`: `stable`, `security
  definer`, `search_path = public` fixo) em vez de reimplementar — fecha a recursão de RLS.

### Ponto de atenção propagado (não altera esta ADR)

`updated_at` tem `default now()` mas nenhum mecanismo de atualização em UPDATE (nem trigger
`moddatetime`, nem `set updated_at = now()` numa policy/trigger). As tabelas irmãs do projeto não
usam trigger de `updated_at` (p.ex. `schedule_overrides` só tem `created_at`), então isto é
consistente com o padrão vigente e é decisão consciente do planejamento, não um defeito da
migration. A ADR de escrita (ADR-04/05/06) precisa ou setar `updated_at` explicitamente no `upsert`
ou aceitar que a coluna reflita a criação. Deixo registrado para que o "card reflete o novo texto"
(RF-T04) não dependa de um `updated_at` que não se move sozinho.

</details>

<details>
<summary>Arquivos no escopo da ADR-01</summary>

- `supabase/migrations/20250222090000_message_templates.sql` (novo) — tabela `message_templates`,
  índice por `tenant_id`, RLS habilitada e as duas policies (select admin, write admin com
  `WITH CHECK`). Único arquivo de aplicação no diff.
- (demais entradas do diff: movimentação de docs do pipeline para `_archive-pre-templates/` — fora
  do escrutínio de código.)

Diff completo: `git diff master -- supabase/ src/`.

</details>
