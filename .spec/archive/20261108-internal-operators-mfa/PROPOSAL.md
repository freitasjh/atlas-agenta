# PROPOSAL — internal-operators-mfa (P0 mínimo seguro)

- Tipo: Feature (segurança)
- Origem: ordem sugerida P0 + desempate (Começar P0 / Mínimo seguro / Acesso+BOLA)

## Problema
Backoffice usa `profiles.role=super_admin` (tabela do cliente) + sem MFA. Risco BOLA/takeover total.

## Solução (architect + PM)
Tabela exclusiva `internal_operators` (deny-all, só service_role) + backfill super_admin atual + freeze legado; rota `/internal-admin` isolada com guard próprio (sem RequireRole/tenant); MFA TOTP nativo Supabase AAL2 obrigatório (enroll forçado, sem bypass); Edge `verify-operator` como único caminho; `custom-access-token`/gates negam super_admin sem operador+AAL2.

## Escopo
- Entra: tabela + RLS + backfill + rota isolada + login/MFA/enroll + verify-operator + BOLA negado ambos sentidos + auditoria.
- Fora: IP allowlist, kill switches, MFA tenant, WebAuthn, recovery codes single-use detalhado (F1), sessão curta/re-prompt (P1).

## Riscos
- BOLA residual enquanto policies legadas existirem → teste BOLA + F1 drop.
- Lockout enroll/recovery → enroll confirmado por código + break-glass 2º operador.
- Bypass claim antiga → Edge exige AAL2 server-side por request.

## Delta
- ADDED: `internal_operators`, `is_internal_operator()`, Edge `verify-operator`, `src/internal-admin/*`, tests.
- MODIFIED: `custom-access-token`, `identity.ts`, `admin-*/gate.ts` (negar sem operador+AAL2), `bootstrap_super_admin` (freeze).
- REMOVED: nenhum (drop policies legadas = F1).
