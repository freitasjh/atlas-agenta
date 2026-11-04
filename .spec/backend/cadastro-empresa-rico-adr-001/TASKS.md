# TASKS — ADR-001 Schema tenants endereço (scoped)

## 1. Origem
- SPEC: `.spec/backend/cadastro-empresa-rico-adr-001/SPEC.md`
- PLAN: `.spec/backend/cadastro-empresa-rico-adr-001/PLAN.md`

## 2. Backlog
| Task | Tipo | Prioridade | Risco | Status |
|------|------|------------|-------|--------|
| DB-01 | Migration | P0 | Low | Todo |
| IT-01 | Test | P0 | Low | Todo |
| IT-02 | Test | P1 | Medium | Todo |

### DB-01: Criar migration tenants endereço
- **Depende:** ADR-001 (interface congelada SPEC §2)
- **Artefato:** `supabase/migrations/{YYYYMMDDHHMMSS}_tenants_cadastro_rico_endereco.sql`
- **Aceite (BDD):** Dado reset local, Quando aplica migrations, Então zero erro; Dado 2ª aplicação, Então zero erro; Dado documento `12.345.678/0001-90`, Então check rejeita.
- **Passos:** gerar timestamp; escrever DDL SPEC §2; `supabase db reset` local.
- **Done:** reset verde + arquivo versionado.

### IT-01: Testes de aplicação e checks
- **Depende:** DB-01
- **Aceite:** reset limpo; mascarado rejeitado; legado válido.
- **Done:** vitest verde.

### IT-02: Teste RLS endereço
- **Depende:** DB-01
- **Aceite:** cross-tenant negado; próprio tenant lê endereço.
- **Done:** vitest verde.

## 3. Validação
- [ ] DB-01 mapeada p/ SPEC §2; sem DROP; idempotente.
- [ ] Sem dependência circular; sem tarefa órfã.
