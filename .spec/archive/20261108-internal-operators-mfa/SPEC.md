# SPEC — internal-operators-mfa (P0 mínimo seguro)

## 1 Visão
Isolar identidade interna (`internal_operators`, deny-all, só service_role) + rota `/internal-admin` com guard próprio + MFA TOTP nativo Supabase AAL2 obrigatório + Edge `verify-operator` como único caminho. Backfill super_admin atual + freeze legado; drop policies legadas = F1.

## 2 Semântica congelada (gaps architect)
- **G1 AAL2 server-side:** por request via `auth.getUser(jwt)` + `factors` verificados (amr/aal2), nunca claim cliente. `custom-access-token` hook lê Auth API, não confia em claim.
- **G3 verify-operator:** `POST verify-operator` input JWT Authorization; output `200 {is_operator, aal, user_id}` / `403 {is_operator:false}` fail-closed (erro/timeout = nega). Chamadores obrigatórios: guard `/internal-admin` + toda Edge interna + gates. Cache client proibido como prova.
- **G4 janela residual:** policies `*_super_admin` listadas em anexo F1-drop; PROPOSAL declara risco aceito datado; teste BOLA ambos sentidos nesta fase.
- **G5 freeze legado:** trigger BEFORE INSERT/UPDATE em `profiles` barra `role=super_admin` para authenticated (42501); `bootstrap_super_admin` recusa novos; backfill `profiles.id→internal_operators.user_id where not exists` + contagem; órfão sem auth.users = report manual, não auto-cria.
- **G6 isolamento rota:** `/internal-admin` nunca query tenant via PostgREST direto; tudo via Edge service_role + audit. Regra testada por grep (sem `.from('tenants|profiles|appointments')` em `src/internal-admin/*`).
- **Bootstrap/break-glass:** seed inicial via service_role auditado (migration, não código); enroll forçado com confirmação por código antes de `active`; exigir ≥2 operadores desde backfill; recovery = F1 (lockout documentado como risco aceito P0).

## 3 Interfaces
- DB: `internal_operators(user_id PK→auth.users, created_at, created_by, disabled_at)` RLS deny-all, `is_internal_operator()` definer, audit append-only service_role-only.
- Edge `verify-operator` (verify_jwt=true) + `internal-operator.ts` compartilhado.
- UI: `/internal-admin/login` (email+senha, erro genérico anti-enumeração), `/internal-admin/mfa` (OTP single-input numeric+one-time-code, 5 tentativas + lockout timer), `/internal-admin/enroll` (3 passos + QR 1x + chave copiável + backup gate checkbox). Decisões ux-designer vinculantes (Auth Card max-w-md, 1 primário/tela, mfa_pending shell bloqueado, role=alert, aria-live, tabular-nums, 375px sem scroll-x).
- Gates: `custom-access-token` + `identity.ts` + `admin-*/gate.ts` negam `super_admin` sem operador+AAL2.

## 4 Aceite
1. Sem MFA → cai em enroll passo 1; GET rota interna sem MFA = redirect sem dado (mfa_pending ≤10min).
2. Enroll só com 1 TOTP válido + checkbox backup; backup 1x.
3. OTP colar funciona ≤2s; inválido mostra restantes + foco; 5x = bloqueio timer.
4. Login inexistente vs senha errada = texto/tempo idênticos.
5. 375px sem scroll-x; CTA ≥44pt; teclado+leitor total.
6. BOLA: tenant→/internal-admin 403; operador→tenant via PostgREST 403; super_admin sem AAL2 negado. IT matriz obrigatória.
7. ≥2 operadores após backfill (contagem).

## 5 Testes
- IT BOLA (3 sentidos) + enroll→login→verify E2E; pgTAP RLS deny-all + helper + backfill contagem; Deno verify-operator 401/403/200; vitest telas (pending, OTP, backup 1x, anti-enumeração).
- Proibição grep PostgREST tenant em internal-admin; EXPLAIN n/a (auth, não agregação).

## 6 Delta
- ADDED: tabela+helper+audit, Edge verify-operator, src/internal-admin/*, tests. (ADRs ADR-01..06, fundir ADR-04+05 para teto 5.)
- MODIFIED: custom-access-token, identity.ts, admin gates, bootstrap freeze.
- REMOVED: nenhum (drop legado = F1).

## 7 Security Fase 1: pass (gaps viram asserts)
STRIDE: Spoofing (operador sem MFA) → AAL2 por request; Tampering (claim) → server-side getUser; Repudiation → audit service_role; Info (enumeração) → erro genérico; DoS (OTP brute) → 5x lockout + rate-limit; Elevation (BOLA) → deny-all + só Edge. Veredito: pass com G1..G6 travados.
