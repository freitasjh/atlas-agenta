-- Migration: tenants cadastro rico (ADR-001)
-- Adiciona colunas de endereco a `tenants` + checks de formato canonico
-- (document, phone, address_cep, address_state). Aditiva e idempotente:
-- ADD COLUMN IF NOT EXISTS + guard duplicate_object nos constraints.
-- Tipos TEXT (nunca CHAR(n)): limite de tamanho e prova de rejeicao, nao
-- truncamento silencioso nem erro 22001 de tipo. ALTER COLUMN TYPE garante
-- a convergencia mesmo se uma versao anterior criou CHAR(8)/CHAR(2).
-- Sem NOT NULL retroativo: legado com nulos permanece valido (checks com
-- IS NULL OR). Sem backfill. RLS e indice parcial tenants_document_key intactos.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address_cep TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address_street TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address_number TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address_complement TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address_city TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS address_state TEXT;
ALTER TABLE tenants ALTER COLUMN address_cep TYPE TEXT;
ALTER TABLE tenants ALTER COLUMN address_state TYPE TEXT;
DO $$ BEGIN ALTER TABLE tenants ADD CONSTRAINT tenants_cep_digits CHECK (address_cep IS NULL OR address_cep ~ '^[0-9]{8}$'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE tenants ADD CONSTRAINT tenants_uf CHECK (address_state IS NULL OR address_state ~ '^[A-Z]{2}$'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE tenants ADD CONSTRAINT tenants_document_digits CHECK (document IS NULL OR document ~ '^[0-9]{11}$' OR document ~ '^[0-9]{14}$'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE tenants ADD CONSTRAINT tenants_phone_digits CHECK (phone IS NULL OR phone ~ '^[0-9]{10,11}$'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
