# TASKS — ADR-002 RPC + Edge signup (scoped)

## 1. Origem
- SPEC: `.spec/backend/cadastro-empresa-rico-adr-002/SPEC.md`
- PLAN: `.spec/backend/cadastro-empresa-rico-adr-002/PLAN.md`

## 2. Backlog
| Task | Tipo | Prioridade | Risco | Status |
|------|------|------------|-------|--------|
| BE-01 | Migration RPC | P0 | High | Todo |
| BE-02 | Edge schemas | P0 | Medium | Todo |
| BE-03 | Edge index | P0 | Medium | Todo |
| IT-01 | Test deno | P0 | Medium | Todo |
| IT-02 | Test integração | P0 | Medium | Todo |

### BE-01: Migration DROP 5-param + CREATE 14-param
- **Artefato:** `supabase/migrations/{ts}_signup_tenant_rpc_cadastro_rico.sql`
- **Aceite:** só 1 assinatura no catálogo; grants só service_role; DV válido/inválido; transacional.
- **Done:** reset aplica; catálogo com 1 overload.

### BE-02: schemas.ts estendido
- **Artefato:** `supabase/functions/signup-tenant/schemas.ts` (+ `schemas.test.ts` no IT-01)
- **Aceite:** `.strict()` recusa extras; strip + DV; mesmos regex ADR-001.
- **Done:** deno test verde.

### BE-03: index.ts 14 params + 409 + 201
- **Artefato:** `supabase/functions/signup-tenant/index.ts`
- **Aceite:** 201 `{ tenant_id }`; 409 sem PII; 400 por campo; rollback sem órfão.
- **Done:** deno check + testes verdes.

### IT-01: Testes deno
- **Aceite:** DV (CPF/CNPJ válidos/inválidos tabelados), strip máscara, invalid_body p/ extras, mensagens exatas, nenhum log com PII.

### IT-02: Testes integração RPC
- **Aceite:** 1 assinatura; EXECUTE negado p/ anon/authenticated; DV barra direto na RPC; duplicado → 23505; falha ⇒ sem parcial.

## 3. Validação
- [ ] Overload antiga removida (teste de catálogo).
- [ ] DV idêntico nos 2 lados (mesmos vetores).
- [ ] 409 sem PII; logs sem PII.
- [ ] Sem dependência circular; sem órfã.
