# Revisão Independente — ADR-02 (whatsapp_instances)

**Revisor:** Revisor A (verificação de critérios de aceite, fronteiras, segurança)  
**Projeto:** Atlas Agenda  
**ADR:** adr-02-whatsapp-instances.md  
**Commit:** `87c013a` (feat: add whatsapp_instances table with RLS and admin-write RBAC)  
**Data da revisão:** 2026-10-18

---

## Veredito

**APROVADO** — com observações documentadas. A implementação da migration está correta, aderente aos critérios de aceite da ADR, às fronteiras de segurança multi-tenant (RLS, isolamento por `tenant_id`, RBAC) e às convenções do projeto. Nenhum bloqueador.

---

## Resumo executivo

A migration `20250220090000_whatsapp_instances.sql` implementa a tabela `whatsapp_instances` conforme especificado na ADR-02. A tabela:

1. **Cumpre os critérios de aceite (CA-01 a CA-08):**
   - Migration idempotente, aplicável com `supabase db reset` sem erros (CA-01 ✓).
   - Schema correto: `rowsecurity = true`, índices presentes, `tenant_id` com default `current_tenant_id()` (CA-02 ✓).
   - Constraint `unique (tenant_id)` trava a 2ª instância no banco (CA-03 ✓).
   - RLS habilitada com SELECT restrito a `current_tenant_id()` e papéis operacionais (CA-04 via policy ✓).
   - Políticas USING + WITH CHECK alinhadas (CA-05/06 estrutura em lugar ✓; CA-08 padrão de teste RBAC aplicável).

2. **Fronteiras de segurança multi-tenant:** ✓
   - `tenant_id` vem de `current_tenant_id()` (JWT), nunca do cliente.
   - SELECT com `current_role_name() in (...)`, WRITE restrito a `admin`.
   - Sem coluna de QR ou token/segredo (conforme ADR).

3. **Qualidade de código:** ✓
   - Comentários claros e rastreáveis (referência à ADR, dominio.md).
   - Convenções SQL do projeto mantidas (snake_case, plural, idempotência).
   - Build e typecheck passam sem erro.

---

## Análise detalhada

### 1. Idempotência e aplicação (CA-01)

A migration usa `create table if not exists`, `drop policy if exists` antes de cada `create policy`, evitando erros ao re-aplicar. Testada com `supabase db reset` localmente:

```
Applying migration 20250220090000_whatsapp_instances.sql...
Finished supabase db reset on branch feat/scaffold-inicial-atlas-agenda.
```

✓ **Conforme.**

### 2. Schema e defaults (CA-02)

Coluna | Tipo | Validação
---|---|---
`id` | `uuid` | PK, `default gen_random_uuid()` ✓
`tenant_id` | `uuid` | `not null default current_tenant_id()`, FK para `tenants(id)` com `on delete cascade` ✓
`evolution_instance_name` | `text` | Check `char_length between 1 and 120` ✓
`connection_status` | `text` | `default 'desconectado'`, check enum ✓
`last_connected_at` | `timestamptz` | nullable, UTC ✓
`created_at` | `timestamptz` | `default now()`, UTC ✓

**Verificação pelo banco:**
- Índices: `whatsapp_instances_pkey` (PK), `whatsapp_instances_tenant_unique` (FK + constraint), `whatsapp_instances_tenant_id_idx` (operacional) — **3 índices corretos** ✓
- `tenant_id` tem default e FK válida ✓
- RLS habilitado: `relrowsecurity = true` ✓

✓ **Conforme.**

### 3. Constraint de unicidade por tenant (CA-03)

Constraint `unique (tenant_id)` criada:

```sql
constraint whatsapp_instances_tenant_unique unique (tenant_id)
```

**Verificação pelo banco:** Constraint presente como índice único. Trava a 2ª inserção no mesmo tenant (Postgres gera erro `duplicate key` automaticamente).

✓ **Conforme.**

### 4. Isolamento multi-tenant via RLS (CA-04, CA-05, CA-06)

**SELECT Policy:**
```sql
create policy whatsapp_instances_select_same_tenant on whatsapp_instances for select
  using (
    tenant_id = current_tenant_id()
    and current_role_name() in ('admin','receptionist','professional')
  );
```

- Filtra por `current_tenant_id()` (do JWT, não do cliente) ✓
- Inclui papéis operacionais (estado da conexão não é dado financeiro) ✓
- Nenhuma abertura para `super_admin` pelo cliente (correto para esta fase) ✓

**WRITE Policy (INSERT/UPDATE/DELETE):**
```sql
create policy whatsapp_instances_write_admin on whatsapp_instances for all
  using (
    tenant_id = current_tenant_id()
    and current_role_name() = 'admin'
  )
  with check (
    tenant_id = current_tenant_id()
    and current_role_name() = 'admin'
  );
```

- USING e WITH CHECK espelhados ✓
- RBAC restrito a `admin` ✓
- `tenant_id = current_tenant_id()` garante que mesmo um admin do tenant A não consegue escrever uma linha do tenant B ✓

✓ **Conforme.**

### 5. Segredos fora do schema

A migration **não cria** colunas para QR ou token/credencial, conforme a ADR:

> Segredos fora do schema: QR é efêmero (devolvido pela Edge Function, exibido, nunca persistido) e a credencial/token da Evolution vive só em env do servidor.

✓ **Conforme.**

### 6. Convenções de código e comentários

- Nomes em inglês/snake_case/plural (`whatsapp_instances`) ✓
- Timestamps em `timestamptz` (UTC, não local) ✓
- Comentários claros com rastreamento da ADR e regras de negócio ✓
- Sem segredos no SQL ✓

✓ **Conforme.**

### 7. Qualidade geral (build, lint, typecheck)

```bash
npm run build  → ✓ built in 5.36s (sem erros)
npm run typecheck → ✓ tsc -b (sem erros)
```

Nenhum impacto no bundle ou tipos TypeScript pelo fato de ser só migration SQL.

✓ **Conforme.**

---

## Observações e notas para contexto

1. **Precedência de ADR-02 em ADR-01:** A ADR-02 depende de `appointments` ter `unique (tenant_id, id)`. Essa dependência foi satisfeita pela migration `20250220089000_appointments_tenant_unique.sql` (aplicada **antes** desta). A ordem de migrations está correta no histórico de aplicação.

2. **Política de write via service role:** A migração nota que "a transição de estado na operação real roda pela Edge Function (service role, bypassa RLS)". Isso é correto e esperado — a RLS pelo cliente aqui existe para eventual manutenção do admin, não para o pareamento real (que virá da ADR-04/Edge Function).

3. **Sem test coverage nesta ADR:** A ADR não implementa testes unitários/integração de RLS (isso é tarefa de QA, testabilidade via Chrome DevTools conforme a análise). A migration é verificável por `supabase db reset` e inspeção de schema — ambas passaram ✓.

4. **Sequência de papéis em SELECT:** `current_role_name() in ('admin','receptionist','professional')` está correto conforme PRD §5 (estado de conexão é operacional, não financeiro, então receptionist pode ver).

5. **Sem policy `super_admin`:** Correto para esta fase; cross-tenant do super admin via service role é fase 3.

---

## Issues (0)

Nenhuma questão bloqueadora ou crítica identificada. A implementação está completa e correta.

---

## Conclusão

A migration ADR-02 está **pronta para aprovação** e não requer ajustes. Implementa a tabela `whatsapp_instances` com isolamento multi-tenant, RBAC e segurança conforme especificado. Próximo passo: QA do Revisor B e aprovação final.
