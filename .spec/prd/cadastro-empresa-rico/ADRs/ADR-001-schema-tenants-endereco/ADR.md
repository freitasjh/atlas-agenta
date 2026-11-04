# ADR-001 — Schema tenants: colunas de endereço + NOT NULL documento/phone

> Unidade de decisão: 1 ADR = 1 branch = 1 PR (merge humano).

- **Decisão**: Adicionar a `tenants` as colunas `address_cep CHAR(8)`, `address_street TEXT`, `address_number TEXT`, `address_complement TEXT NULL`, `address_city TEXT`, `address_state CHAR(2)`; tornar `document` e `phone` `NOT NULL` para novos cadastros; estender o guard de colunas privilegiadas a `document` quando preciso; manter RLS/índices existentes (`tenants_document_key` parcial único).
- **Motivo**: `tenants` hoje não tem endereço (verificado em `20250216090000_tenants.sql`); endereço único da empresa é afirmado no PRD §4/RN05; colunas embutidas cobrem 1:1 sem join e mantêm RLS existente (RESEARCH T3-A).
- **Alternativas descartadas**: Tabela `tenant_addresses` com FK composta `(tenant_id, ref_id)` — fonte: `.agents/rules/db-migration-supabase.md` §8 + `dominio.md`; descartada por over-engineering para 1 endereço/empresa nesta fase (join + RLS extra sem benefício; migração futura se filiais vierem) — fonte: https://supabase.com/docs/guides/database/tables
- **depende-de**: —
- **Interface congelada**: Migration `{YYYYMMDDHHMMSS}_tenants_cadastro_rico_endereco.sql` (aditiva, idempotente: `ADD COLUMN IF NOT EXISTS`, backfill `WHERE ... IS NULL`, sem `DROP`); DDL final:
  ```sql
  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address_cep CHAR(8);
  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address_street TEXT;
  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address_number TEXT;
  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address_complement TEXT;
  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address_city TEXT;
  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address_state CHAR(2);
  ```
  Formato canônico congelado aqui (vale p/ ADR-002/003, cliente+servidor+banco idênticos): `document` só dígitos (11 CPF / 14 CNPJ, DV válido); `phone` só dígitos BR (`^\d{10,11}$`, DDD + número, sem `+55`, sem máscara); `address_cep` só dígitos (`^\d{8}$`, sem hífen); `address_state` sigla UF maiúscula (`^[A-Z]{2}$`, validada contra lista IBGE de 27 UFs). Checks: `tenants_document_digits CHECK (document ~ '^\d{11}$' OR document ~ '^\d{14}$')`, `tenants_phone_digits CHECK (phone ~ '^\d{10,11}$')`, `tenants_cep_digits CHECK (address_cep ~ '^\d{8}$')`, `tenants_uf CHECK (address_state ~ '^[A-Z]{2}$')`. Motivo do só-dígitos: comparação/unicidade sem ambiguidade de máscara; formatação só na exibição. Decisão L1 (base legada, gate humano): cadastros antigos com `document/phone/endereço` nulos **não** recebem backfill inventado; migration **não** impõe `NOT NULL` retroativo — colunas novas nullable no DDL e `NOT NULL` aplicado só a novas linhas via check parcial/RPC; bloqueio de login até completar é fase futura, fora deste ADR.
- **Fora desta decisão**: Assinatura da RPC/Edge (ADR-002); UI/máscaras/ViaCEP (ADR-003); whatsapp/Evolution; funcionário (fase 2); múltiplos endereços/filiais.
- **Consequências se estiver errado**: Formato divergente entre camadas quebra unicidade (duplicado com máscara passa); reversão = nova migration aditiva (nunca editar migration aplicada); filiais futuras exigem migração para tabela própria.
- **Status**: todo
