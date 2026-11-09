# F1 — Policies legadas `*_super_admin` (janela residual declarada)

Data do risco aceito: 2026-11-08. Remoção total (drop) é follow-up F1; nesta fase
o teste BOLA cobre os dois sentidos e os gates negam sem operador+AAL2.

## Policies que confiam em `current_role_name() = 'super_admin'` (sem prova de operador)

| Migration | Policy | Tabela | Sentido |
|---|---|---|---|
| 20250216091000_profiles_and_helpers.sql | `profiles_super_admin` (all) | profiles | cross-tenant legado |
| 20250216091000_profiles_and_helpers.sql | `tenants_super_admin` (all) | tenants | cross-tenant legado |
| 20250227090000_appointments_customer_unique.sql e demais de domínio | `*_super_admin` (all) | appointments, customers, professionals, services, messages, charges, appointment_payments | leitura/escrita legado |
| 20250228091800_super_admin_password_gate_rls.sql | policies super_admin password gate | profiles | gate legado |

## Por que não remover agora

- Backfill garante ≥2 operadores; freeze 42501 barra novos `super_admin` em profiles.
- Hook `custom-access-token`, `identity.ts` e `admin-*/gate.ts` negam `super_admin`
  sem registro ativo em `internal_operators` + AAL2 server-side por request.
- Rota `/internal-admin` nunca usa PostgREST de tenant direto; só Edge service_role + audit.

## Critério de drop (F1)

Remover todas as policies `*_super_admin` após confirmar em produção: contagem
`internal_operators >= 2`, `verify-operator` 200 para os operadores, e BOLA verde
nos 3 sentidos (tenant→/internal-admin 403; operador→tenant via PostgREST 403;
super_admin sem AAL2 negado).
