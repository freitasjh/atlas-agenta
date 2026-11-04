# PLAN — ADR-002 RPC + Edge signup (scoped)

## 1. Contexto
- **SPEC:** `.spec/backend/cadastro-empresa-rico-adr-002/SPEC.md`
- **ADR:** `.spec/prd/cadastro-empresa-rico/ADRs/ADR-002-rpc-edge-signup/ADR.md`
- **Depende de:** ADR-001 (migration aplicada na branch base).
- **Goal:** RPC 14 params + Edge validando tudo server-side + 409 sem PII.

## 2. Estratégia
- Migration SQL (`db-migration-supabase.md`): DROP overload 5 params + CREATE 14 params + grants; DV em PL/pgSQL.
- Edge Deno (`signup-tenant/`): zod `.strict()` estendido + refine DV + strip máscara + mapa 23505→409 + 201 `{ tenant_id }`.
- Testes: deno unit (schemas/DV/códigos) + integração RPC (grants, DV, unique, transacionalidade).

## 3. Tarefas
- **[BE-01]** Migration: DROP 5-param + CREATE 14-param + grants + DV PL/pgSQL.
- **[BE-02]** Edge schemas.ts: campos novos + strip + DV + `.strict()`.
- **[BE-03]** Edge index.ts: 14 params + mapa 409 + 201 `{ tenant_id }` + rollback mantido.
- **[IT-01]** Testes deno (schemas, DV, códigos, sem-PII-em-logs).
- **[IT-02]** Testes integração RPC (params, DV, 23505, grants service_role-only, transacional).

## 4. Riscos
- **HIGH: Overload fantasma** — esquecer o DROP mantém a versão 5-param viva (Edge antiga/ataque). Mitiga: DROP explícito + teste `count(*) ... proname` = 1 assinatura.
- **MEDIUM: DV divergente entre PL/pgSQL e TS** — mesma bateria de vetores nos dois lados (válidos/inválidos conhecidos).
- **MEDIUM: Resposta 201 `{ tenant_id }`** muda contrato — ADR-003 consome; teste do formato novo.
- **LOW: `phone` com +55/DDI** — strip mantém só dígitos; `^[0-9]{10,11}$` rejeita DDI (decisão: BR sem DDI nesta fase).

## 5. Caminho crítico
BE-01 → BE-02 → BE-03 → IT-01 → IT-02 → review → PR (base: branch ADR-001 até merge).
