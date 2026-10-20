# Revisor B — ADR-03: tabela `messages` (log de disparos WhatsApp)

**Escopo revisado:** commit `d52949e` — `supabase/migrations/20250220091000_messages.sql` (108 linhas, arquivo novo, nenhuma outra mudança no diff).

Migration de dados que materializa a entidade `messages` de `dominio.md`: log auditável de disparos de WhatsApp com `tenant_id` default do JWT, RLS habilitado, FKs compostas por tenant contra `customers` e `appointments`, índice único parcial de idempotência e **nenhuma policy de write pelo cliente** (gravação exclusiva da Edge Function com service role, ADR-04). Fecha a superfície de dados do módulo antes da função e das telas.

Watch for: colisão de nome com a tabela built-in `realtime.messages` do Supabase — não é bug, mas exige disciplina de schema-qualify em código/queries futuras (**confirmed**, baixo). A `dedupe_key` é `nullable` e o índice único parcial não cobre o caso de duas linhas com `dedupe_key IS NULL` — correto por design, mas o enforcement real de idempotência depende 100% da Edge Function sempre preencher a chave (**confirmed**, informativo, dono é ADR-04).

**Verdict**: APPROVED

## Visão de alto nível

A migration segue fielmente o §4.2 da `analysis-data.md` e o padrão travado nas tabelas anteriores (`customers`, `appointments`, `whatsapp_instances`): `tenant_id uuid not null default current_tenant_id() references tenants(id) on delete cascade`, índice por tenant, RLS on, helpers `current_tenant_id()`/`current_role_name()` reutilizados sem recriar. Não há desvio de aderência à ADR.

As FKs compostas `(tenant_id, customer_id)` e `(tenant_id, appointment_id)` casam com os `unique (tenant_id, id)` que `customers` (20250219090000) e `appointments` (20250220089000, ADR-01) expõem — confirmei que ambos os alvos existem. A coerência de tenant está no schema, não só na UI, e o `db reset` aplica as três migrations da fase em ordem, limpo.

A decisão de segurança central — **sem policy de INSERT/UPDATE/DELETE pelo cliente** — foi verificada na prática: sob role `authenticated` com JWT, INSERT é negado por violação de RLS e UPDATE/DELETE afetam 0 linhas. Combinado com a gravação exclusiva por service role, é a trava que impede o front forjar envio ou pular opt-in/idempotência. O RBAC de leitura inclui `receptionist` de propósito (log de comunicação não é dado financeiro, ao contrário de `charges`) — coerente com o PRD §5.

A idempotência está num índice único parcial sobre `(tenant_id, dedupe_key) where status in ('fila','enviado','entregue')`. A exclusão de `falha` é intencional: provei que um disparo falho não trava retentativa legítima com a mesma chave. A invariante de PII mínima em log é semântica (vive na função, ADR-04); o schema só provê o lugar (`payload`/`failure_reason`) e o vínculo por `customer_id`, sem coluna de telefone.

<details>
<summary>Issues (3)</summary>

1. **Colisão com `realtime.messages`** — existe `public.messages` e `realtime.messages` no mesmo banco; não é defeito, mas código/queries devem schema-qualify `public.messages` para evitar ambiguidade silenciosa. Sem ação de bloqueio.
2. **Idempotência depende da função** — `dedupe_key` é nullable e o índice parcial não deduplica linhas com chave nula; a trava real só funciona se a Edge Function (ADR-04) sempre compuser e gravar a chave. Garantir isso no escopo da ADR-04, não aqui.
3. **`on delete restrict` em `customer_id` vs. soft-delete** — como `customers` usa soft-delete (`active=false`, nunca DELETE físico), o `restrict` nunca dispara na prática; é defesa correta e barata, apenas registrada como redundância consciente. Sem ação.

</details>

<details>
<summary>Details</summary>

### Contraprova executada

- `npm run build` (`tsc -b && vite build`): **limpo**, build em ~5.9s, sem erro de typecheck. (A ADR é SQL; o build não exercita o schema, mas roda limpo — sem regressão de TS.)
- Não há script de lint no `package.json` (só `dev`/`build`/`typecheck`/`preview`); `typecheck` está coberto pelo `build`.
- `supabase db reset`: aplicou as 12 migrations em ordem, incluindo `20250220089000_appointments_tenant_unique` → `20250220090000_whatsapp_instances` → `20250220091000_messages`, sem erro e idempotente (CA-01, CA-01b).
- **Não** subi dev server (decisão do QA, step seguinte, via Chrome DevTools).

### Critérios de aceite verificados contra o banco vivo

Inspeção de catálogo (`pg_class`, `information_schema`, `pg_indexes`, `pg_policies`, `pg_constraint`) e testes funcionais sob role `authenticated` + `request.jwt.claims`:

- **A2** — `public.messages.relrowsecurity = true`; `tenant_id default current_tenant_id()`, `not null`; `payload default '{}'::jsonb not null`; `status default 'fila'`; `channel default 'whatsapp'`; `created_at default now()`. Índice `messages_tenant_id_idx` presente. ✓
- **A6** — `messages_dedupe_uidx` é `CREATE UNIQUE INDEX ... (tenant_id, dedupe_key) WHERE status = ANY (ARRAY['fila','enviado','entregue'])`. Cobre exatamente os três estados vivos. ✓
- **FKs** — `messages_customer_fk FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id) ON DELETE RESTRICT`; `messages_appointment_fk ... REFERENCES appointments(tenant_id, id) ON DELETE RESTRICT`; `messages_tenant_id_fkey ... REFERENCES tenants(id) ON DELETE CASCADE`. ✓
- **Checks** — `channel in ('whatsapp')`, `template in ('confirmacao','lembrete_d1','cobranca','comprovante')`, `status in ('fila','enviado','entregue','falha')`. Espelham `dominio.md`. ✓
- **A3** — INSERT com `customer_id` de outro tenant → `violates foreign key constraint "messages_customer_fk"`. INSERT com `appointment_id` nulo → aceito (MATCH SIMPLE não valida FK em coluna nula). ✓
- **A4** — sob JWT do tenant A, `select` retorna só as linhas de A; sob JWT de B, só as de B. Isolamento de leitura cross-tenant provado. ✓
- **A5** — sob `authenticated`: INSERT → `new row violates row-level security policy`; UPDATE → 0 linhas; DELETE → 0 linhas. Nenhum papel escreve pelo cliente. ✓
- **Idempotência** — 2ª linha com mesma `(tenant_id, dedupe_key)` e `status='enviado'/'fila'` → `duplicate key violates "messages_dedupe_uidx"`. Mesma chave com `status='falha'` → aceita (retentativa legítima preservada). ✓

Fixtures de teste removidas ao fim (banco local limpo).

### Aderência à ADR e às fronteiras

Pontos onde a ADR faz uma escolha não óbvia, verificados:

- **RBAC (PRD §5):** `receptionist` lê `messages` de propósito — log de comunicação não é dado financeiro, divergência deliberada vs. `charges`. Nenhuma policy `*_super_admin` (cross-tenant do super admin é fase futura, não antecipado).
- **LGPD/PII mínima:** o enforcement de "sem telefone em claro" vive na função (ADR-04); o schema só delega o lugar (`payload`/`failure_reason`) e o vínculo por `customer_id`. A cobertura dessa invariante fica a cargo da revisão da ADR-04, não aqui.
- **Escopo negativo respeitado:** enum de `template` inteiro mas sem régua/cron/worker; nenhum `charges`/PIX/Asaas; nenhuma Evolution real — a migration é só o lugar do log para disparo sob demanda.

Isolamento multi-tenant/RLS, write só service role, idempotência e ausência de segredos no SQL foram verificados nos testes acima.

### Nota sobre `realtime.messages`

O Supabase provê uma tabela built-in `realtime.messages`. Após o reset, existem `public.messages` **e** `realtime.messages`. A FK e as policies aqui são todas em `public`, então não há conflito funcional. O risco é apenas de query/código futuro não schema-qualify e resolver para a tabela errada pelo `search_path`. Design doc React e hooks (ADR-06) devem usar o client Supabase que já opera no schema `public` por padrão — então o risco é baixo. Registrado como observação, não como defeito desta ADR.

</details>

<details>
<summary>Mapa de arquivos</summary>

- `supabase/migrations/20250220091000_messages.sql` — **novo**. Tabela `messages`: 12 colunas, 3 FKs (2 compostas por tenant + cascade de tenant), 3 índices de tenant + 1 índice único parcial de idempotência, RLS on com 1 policy de SELECT (sem write pelo cliente). Único arquivo do diff (`git show d52949e`).

</details>
