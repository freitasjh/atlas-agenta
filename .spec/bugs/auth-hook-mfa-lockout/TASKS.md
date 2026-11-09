# BUG — auth-hook-mfa-lockout (Bugfix fast-track)

## Bug
Login super_admin retorna `{"code":"unexpected_failure","message":"Unexpected status code returned from hook: 500"}`. Nenhum reset resolve.

## Causa raiz
`supabase/functions/custom-access-token/handler.ts:211-225` (§4 gate operador): super_admin sem operador ativo + fator verificado → `500 identity_unavailable`. GoTrue repassa como `unexpected_failure`. Deadlock galinha-ovo: operador existe (backfill) mas sem MFA enrolado (bootstrap fresco) → hook nega na emissão do token → sem sessão aal1 → impossível enrolar MFA. Evidência: edge log `super_admin without operator+aal2 denied` ×2.

## Solução
Trocar negação-por-500 por rebaixamento-por-200: sem operador/fator, hook retorna 200 com claims neutras (sem privilégio super_admin) + flag `mfa_required`. Autenticação (aal1) abre; autorização segue fechada em verify-operator/guards/RLS. Manter 500 só para erro real de leitura (fail-closed leitura). Verificar `current_role_name()` não concede via claims neutras.

## Arquivos + impacto
- `supabase/functions/custom-access-token/handler.ts` (§4) + `handler.test.ts` (Deno: login aal1 neutro OK; AAL2+operador claims cheias; erro leitura 500; BOLA inalterado).
- Sem mudança em verify-operator/guards/RLS (já corretos). Sem migration.

## Testes
- Deno: super_admin sem factor → 200 neutro (novo); com operador+AAL2 → 200 cheio (regressão); erro leitura → 500; tenant comum inalterado.
- Manual: login → enroll TOTP → sessão aal2 → /internal-admin libera; BOLA tenant→interna 403.

## Riscos
- Claims neutras com shape errado quebram RLS allowlist → validar `current_role_name()` com claims neutras nega cross-tenant (teste).
- Flag nova em claims deve ser ignorada por políticas legadas (só `role` decide).
