# Parecer do Revisor Independente A — ADR-01

**ADR:** adr-01-appointments-tenant-unique.md  
**Escopo:** Dados  
**Tipo de mudança:** Schema (1 migration nova)  
**Status da revisão:** ✅ APROVADO

---

## Resumo executivo

A ADR-01 adiciona uma constraint `unique (tenant_id, id)` em `appointments` via migration nova, habilitando a FK composta que ADR-03 (`messages`) precisa para garantir isolamento de tenant no banco. A implementação é mínima, idempotente e segue o padrão já estabelecido no projeto.

**Verdict:** ✅ APROVADO sem ressalvas.

---

## Verificações realizadas

### 1. Critérios de aceite (CA-01 a CA-03)

| Critério | Status | Evidência |
|----------|--------|-----------|
| **CA-01.** `supabase db reset` aplica sem erro e é idempotente | ✅ Passou | Reset completou com sucesso; migration `20250220089000_appointments_tenant_unique.sql` aplicada sem erro. |
| **CA-02.** Constraint `unique (tenant_id, id)` criada em `appointments` | ✅ Passou | Query em `pg_constraint` confirmou a presença de `appointments_tenant_id_unique`. |
| **CA-03.** Migration aplicada `20250219091000_appointments.sql` permanece inalterada | ✅ Passou | `git diff` mostra apenas 1 arquivo novo; zero alterações nas migrations existentes. |

### 2. Design e segurança

**Idempotência:** A constraint é criada dentro de um bloco `do $$` com verificação contra `pg_constraint` antes de executar `ALTER TABLE`. Isso garante que o `db reset` pode ser reexecutado sem erro — padrão idêntico ao de `20250219092000_appointments_no_overlap.sql` que já existe no código.

**Timestamp e ordenação:** `20250220089000` vem após `20250219093000` (última migration do projeto) e **antes** de `20250220091000_messages.sql` (ADR-03, que depende do alvo único). A sequência garante que o constraint exista antes da FK composta ser criada.

**Sem alteração de RLS/triggers:** O SQL só adiciona a constraint. Nenhuma política RLS, trigger de máquina de estados, ou índice de domínio foi tocado. Risco zero de regressão em lógica existente.

**Coerência de tenant no schema:** O par `(tenant_id, id)` como alvo único foi a **Opção A** da análise de dados (§4.2, descartando a Opção B de FK simples que reabreria buraco cross-tenant). A implementação segue essa decisão sem reinterpretação.

**Sem segredo:** Nenhuma credencial, token ou info sensível no SQL.

### 3. Contraprova (build + typecheck)

```
npm run typecheck  → ✅ Sem erro
npm run build      → ✅ Sem erro (bundle 722.43 kB, warning pré-existente sobre chunk size)
```

Nenhuma regressão no frontend. A mudança é de dados, sem impacto no código-fonte da aplicação.

### 4. Aderência às regras de projeto

- ✅ **Convenções de código / SQL:** migração versionada, idempotente, documentação clara em pt-BR.
- ✅ **Segurança multi-tenant:** constraint `(tenant_id, id)` reforça o isolamento esperado no schema.
- ✅ **Regra de versionamento:** migration nova nunca edita aplicada — respeitado.
- ✅ **RLS / RBAC:** nenhuma mudança; padrão já existente preservado.

---

## Conclusão

A migration é **técnica, mínima e correcta**. Implementa exatamente o contrato estabelecido na ADR, sem desvios, sem regressões e sem questões abertas. O código está pronto para aprovação pelo revisor B e pelo planejador.

**Nenhuma ação requerida do desenvolvedor.**

---

**Revisto por:** Revisor Independente A (Semantic Code Review)  
**Data:** 2025-02-20  
**Confiança:** Confirmado (verificações executadas e logs capturados)
