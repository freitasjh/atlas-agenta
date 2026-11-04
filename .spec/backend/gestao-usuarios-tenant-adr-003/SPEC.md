# Architecture & Software Specification — ADR-003 (JWT Claim Active)

**Feature slug:** `gestao-usuarios-tenant-adr-003`
**ADR de origem:** `.spec/prd/gestao-usuarios-tenant/ADRs/ADR-003-jwt-claim-active/ADR.md`
**Depende de:** ADR-001 (schema: profiles.active).
**Escopo:** Backend (hook custom-access-token) + Frontend (auth-claims parse + guard).

## 1. Decisao (RESEARCH D2)

Desativacao: revogacao global de sessao + claim active fail-closed no hook. Guard frontend e UX (defesa em profundidade).

## 2. Backend — Hook custom-access-token

- Arquivo: `supabase/functions/custom-access-token/handler.ts` (ou hook SQL).
- Modificar: incluir active na claim do JWT. Ler profiles.active do usuario; o hook emite `active=false` + 200 para conta desativada (o cliente força logout). A trava real de acesso é a revogação global de sessão (ADR-002) + RLS; a claim é defesa em profundidade.
- Schema de claims (profileRowSchema): adicionar active: boolean.
- buildHookClaims: incluir active.

## 2.1 Decisão — Hook tolerante para fluxo de convite (ADR-003)

O GoTrue chama o hook `custom_access_token` durante a verificação do token de
convite, antes de `accept-invitation` criar o `profile`. Por isso o hook NÃO pode
falhar (500) quando o profile ainda não existe: isso quebrava o link de convite
("Unexpected status code returned from hook: 500").

Comportamento:
- profile ausente (data === null, error === null) → 200 com claims mínimas:
  `user_role=null`, `tenant_id=null`, `must_change_password=false`, `active=false`.
- erro de leitura do banco (error !== null) → 500 `identity_unavailable` (fail-closed).
- shape inválido (data presente mas não valida em `profileRowSchema`) → 500
  `identity_unavailable` (fail-closed).
- flag `must_change_password` não booleana → 500 `identity_unavailable`.

Frontend: nova página pública `/accept-invitation` (sem guard) extrai o token do
query param `token`, valida com zod, chama a Edge Function `accept-invitation` e
redireciona para `/login` com aviso de sucesso; em erro exibe mensagem + link
para login.

## 3. Frontend — Parse de claims

- src/lib/auth-claims.ts: adicionar active ao tipo de claims e ao parser.
- useCurrentUser: expor active (default false se ausente; sessao antiga sem claim = fail-closed).
- RequireAuth guard: se active === false -> forcar logout + redirect /login com mensagem.

## 4. Invariantes

| Entidade | Invariante |
|----------|------------|
| JWT | Claim active presente em tokens emitidos apos ADR-003. |
| Sessao | Usuario com active=false recebe token com active=false; o cliente força logout (defesa em profundidade). A trava real é a revogação global de sessão (ADR-002) + RLS. |
| Frontend | active ausente -> tratado como false (fail-closed). |

## 5. Functional Requirements

- RNF-01 (isolamento): claim active fail-closed.
- RNF-02 (minimo privilegio): usuario desativado perde acesso.

## 6. Delta Specs

- .agents/rules/seguranca-multitenant.md: claim active no JWT.
- Frontend coding standards: parse de claims.

## 7. Criterios de Aceite

- Hook emite claim active para usuarios ativos.
- Hook emite claim active=false + 200 para usuarios inativos; o cliente força logout.
- Hook retorna 200 com claims mínimas quando o profile ainda não existe (fluxo de convite).
- Hook retorna 500 apenas para erro de leitura do banco ou shape inválido.
- Frontend parseia active; guard forca logout se false.
- Testes de integracao (hook) passando.
- Usuario desativado: sessão revogada globalmente (ADR-002) + claim active=false força logout no cliente.
