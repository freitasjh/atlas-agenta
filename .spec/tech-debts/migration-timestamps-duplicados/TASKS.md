# Débito Técnico P1 — Timestamps duplicados de migration quebram `db reset`

## 1. Bug
`supabase db reset` falha com `duplicate key version=(20250227090000)` em `schema_migrations_pkey`. Três pares de arquivos commitados compartilham o mesmo prefixo de 14 dígitos:

| Prefixo | Mantém (A) | Renomeia (B → novo) |
|---------|------------|---------------------|
| 20250227090000 | `..._appointments_customer_unique.sql` (outros dependem dele: clinical_records referencia seu unique) | `..._subscription_status_audit.sql` → `20250227090500_subscription_status_audit.sql` |
| 20250227091000 | `..._clinical_records.sql` (depende do unique acima; RLS própria em 27092000) | `..._tenants_privileged_columns_guard.sql` → `20250227091500_tenants_privileged_columns_guard.sql` |
| 20250228090000 | `..._profiles_password_gate.sql` | `..._security_privilege_hardening.sql` → `20250228090050_security_privilege_hardening.sql` (independentes entre si — verificado: B não cita o helper de A) |

Slots novos verificados livres; ordem relativa preservada (B continua logo após A, antes do próximo vizinho).

## 2. Causa raiz
Dois commits distintos criaram migrations no mesmo minuto com o mesmo timestamp manual, sem checar colisão. O CLI usa o prefixo como `version` (PK) — duplicata = reset impossível desde então.

## 3. Solução (exige gate humano — viola D-11 de propósito)
`git mv` dos 3 arquivos B para os novos nomes + allowlist dos 3 renames no teste `migrations.test.ts` ("nenhuma migração ... renomeada", com motivo + PR) + `supabase db reset` limpo do zero como prova + suite verde.

## 4. Riscos
- **Ambientes com versions antigas aplicadas:** como o reset nunca completou com as duplicatas, nenhum ambiente pode ter as duas versões do par aplicadas (a 2ª sempre falhou). Pré-produção confirmado pelo dono — rebuild limpo resolve. Se algum volume local tiver uma das versões, `db reset` recria do zero.
- **Conteúdo intocado:** só o nome do arquivo muda; zero edição de SQL.

## 5. Testes
- `supabase db reset` sai 0 (aceite principal — hoje inalcançável).
- `migrations.test.ts` verde com allowlist documentada.
- Suite unit + integração verdes.

## 6. Status
- [x] Gate humano aprovado (2026-11-04, resposta A)
- [x] Rename executado (3x R100, 0 insertions/deletions)
- [x] Reset limpo validado (EXIT 0) + suites verdes + review APPROVED
- [ ] PR do ADR-001 segue com reset como prova
