# PLAN — internal-operators-mfa

## Estratégia
Identidade primeiro (tabela + RLS + backfill + freeze), depois prova (verify-operator + gates/hook), depois UI isolada (login/MFA/enroll). Sem tocar tenant; /admin legado só leitura transição.

## Fases
1. BE-01 Migration internal_operators deny-all + is_internal_operator() + audit append-only + backfill super_admin + trigger freeze profiles.
2. BE-02 Edge verify-operator (getUser + factors AAL2, 200/401/403 fail-closed) + internal-operator.ts compartilhado + Deno tests.
3. BE-03 Gates/hook: custom-access-token + identity.ts + admin-*/gate.ts negam sem operador+AAL2; bootstrap freeze.
4. FE-01 Rota /internal-admin isolada + guard RequireInternalOperator (mfa_pending shell bloqueado).
5. FE-02 Telas login/MFA/enroll (OTP single-input, QR 1x + chave copiável, backup gate checkbox, anti-enumeração).
6. VAL-01 Harness: pgTAP BOLA 3 sentidos + Deno + vitest + Chrome + grep sem PostgREST tenant.

## Restrições
- TOTP segredo nunca no nosso banco (Auth MFA nativo). Sem cache prova client. Sem grant view/tabela a anon/authenticated.
- TDD, RLS assert-first, pt-BR, UTC, sem PII log.

## Fail modes
- Claim antiga cacheada → AAL2 por request nega.
- Enroll lockout → ≥2 operadores + break-glass auditado.
- Janela residual legada → BOLA teste + F1 drop datado.
