# SPEC — bootstrap-operator-backfill (débito P1)

## 1 Visão
`createSuperAdmin` (Edge `bootstrap-super-admin`) passa a inserir `internal_operators(user_id)` na mesma operação lógica da criação, com rollback compensatório e `ensureOperator` idempotente também no caminho `ja_existe` (cura retry pós-crash). Sem migration; BOLA/hook inalterados.

## 2 Semântica congelada
- Ordem: `createUser` → `insert profiles(super_admin)` → `insert internal_operators(user_id)`. Profile antes de operador (FK `user_id → auth.users`, freeze libera com tabela vazia).
- `ensureOperator(userId)`: `insert ... where not exists` (ou `on conflict do nothing`); chamado em `criado` (pós-profile) e em `ja_existe` (cura órfão de crash anterior).
- Rollback: falha em qualquer passo após `createUser` → deletar operador (se criado) → deletar profile → `deleteUser`, nesta ordem (FK sem cascade). Log `console.error` sem PII (só code/status).
- `23505` em operator-insert → sucesso idempotente (segue para `okResponse`), não 500.
- `42501` do freeze em profile-insert → `bootstrap_bloqueado` (403), não 500 genérico.
- Freeze check pré-criação: distinguir `undefined_table` (ambiente sem migration — permite legado) vs erro real (500). `bootstrap_bloqueado` mantido quando ≥1 operador.
- Resposta inalterada: `{status: criado|ja_existe, user_id}`; sem campo novo; sem toque em `_shared/super-admin-bootstrap.ts`, hook, `verify-operator`, RLS.
- Fake de teste table-aware (`profiles` vs `internal_operators`) + tracking de `delete` (profile/operador/user).

## 3 Aceite (Given/When/Then)
1. DB vazio → bootstrap válido → user+profile+operador criados; login `/internal-admin` + enroll MFA sem backfill.
2. ≥1 operador → bootstrap → `bootstrap_bloqueado` 403, nada muda.
3. Retry mesmo `user_id` → sucesso, `count(operator)=1` (sem duplicata).
4. Falha injetada no insert operador → user+profile removidos, erro explícito, zero órfão.
5. Crash simulado entre profile e operador → re-bootstrap retorna `ja_existe` E cria operador (ensureOperator).
6. Duplo bootstrap concorrente → um `criado`, outro `ja_existe` ou `bloqueado`; zero duplicata, zero 500.
7. BOLA 3 sentidos segue negado (regressão `verify-operator` verde).

## 4 Testes
- Deno novos (5): criado-inclui-operador; retry idempotente; falha-operador rollback duplo; bloqueado preservado; ja_existe-completa-operador. Regressão: suite `bootstrap-super-admin` + `verify-operator` verdes.
- pgTAP: nenhum novo (sem schema change). Harness E2E: `db reset → bootstrap → /internal-admin + enroll MFA`.

## 5 Segurança (Fase 1)
STRIDE: Spoofing (outro user virar operador) → só Edge service_role cria; Tampering (payload) → body só carrega nada sensível, ator é o próprio fluxo; Repudiation → log sem PII + audit existente; Info Disclosure → erro genérico, sem email/id; Elevation → freeze + bloqueado + RLS deny-all intactos. Veredito: pass (0 🔴).

## 6 Riscos
- R1 órfão profile-sem-operador → ensureOperator + compensação.
- R2 órfão operador-sem-user → ordem de delete + verificação.
- R3 duplicata retry → conflict/where-not-exists.
- R4 regressão bloqueado → distinguir erro leitura.
- R5 42501 mapeado errado → teste dedicado.

## 7 Delta
- ADDED: ensureOperator + testes + ADR decision-only (amenda ADR-05).
- MODIFIED: `bootstrap-super-admin/handler.ts` (+ teste).
- REMOVED: nenhum. RPC transacional descartada (exigiria migration).
