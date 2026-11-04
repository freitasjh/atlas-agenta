# SPEC — ADR-001 Schema tenants: endereço + NOT NULL documento/phone (scoped)

**Feature slug:** `cadastro-empresa-rico-adr-001`
**ADR de origem:** `.spec/prd/cadastro-empresa-rico/ADRs/ADR-001-schema-tenants-endereco/ADR.md`
**Depende de:** —
**Escopo:** Backend/DB — migration Supabase aditiva em `tenants`. Sem RPC/Edge/UI.

## 1. Decisão
Adicionar a `tenants`: `address_cep TEXT`, `address_street TEXT`, `address_number TEXT`, `address_complement TEXT NULL`, `address_city TEXT`, `address_state TEXT`; checks de formato canônico para `document`, `phone`, `address_cep`, `address_state`. Sem `NOT NULL` retroativo (L1): colunas novas nullable; obrigatoriedade de novos cadastros via RPC/Edge (ADR-002).

## 2. DDL congelado (idempotente)
```sql
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address_cep TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address_street TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address_number TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address_complement TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address_city TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address_state TEXT;
DO $$ BEGIN ALTER TABLE tenants ADD CONSTRAINT tenants_cep_digits CHECK (address_cep IS NULL OR address_cep ~ '^\d{8}$'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE tenants ADD CONSTRAINT tenants_uf CHECK (address_state IS NULL OR address_state ~ '^[A-Z]{2}$'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE tenants ADD CONSTRAINT tenants_document_digits CHECK (document IS NULL OR document ~ '^\d{11}$' OR document ~ '^\d{14}$'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE tenants ADD CONSTRAINT tenants_phone_digits CHECK (phone IS NULL OR phone ~ '^\d{10,11}$'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```
Índice único parcial `tenants_document_key` existente MANTIDO (sem alteração). RLS existente MANTIDA (sem policy nova; endereço herda policies de `tenants`).

## 3. Formato canônico (vale ADR-002/003)
`document` só dígitos 11/14; `phone` só dígitos `^\d{10,11}$`; `address_cep` só dígitos `^\d{8}$`; `address_state` UF maiúscula `^[A-Z]{2}$` (27 siglas IBGE, validada na app; check garante formato).

## 4. Invariantes
| # | Invariante |
|---|---|
| I1 | Migration re-executável (IF NOT EXISTS + guard duplicate_object); nunca DROP nem ALTER de coluna aplicada em produção — exceto convergência segura CHAR→TEXT pré-produção (review ADR-001) |
| I2 | Legado com nulos permanece válido (checks com `IS NULL OR`); nenhum backfill inventado |
| I3 | Nenhum tenant_id do cliente; RLS inalterada |
| I4 | Naming `{YYYYMMDDHHMMSS}_tenants_cadastro_rico_endereco.sql` em `supabase/migrations/` |

## 5. Requisitos funcionais
- RF01: `supabase db reset` local aplica migration sem erro.
- RF02: re-aplicar migration (2ª vez) sem erro.
- RF03: insert com documento mascarado (com hífen/ponto) é rejeitado pelo check.
- RF04: insert legado (só trade_name/owner_email) continua válido.

## 6. Fora de escopo
RPC/Edge (ADR-002); UI/máscaras/ViaCEP (ADR-003); whatsapp; funcionário; filiais.

## 7. Critérios de aceite
Migration aplica limpo + idempotente; checks rejeitam formato ruim; legado intacto; teste de integração RLS/guard verde.
