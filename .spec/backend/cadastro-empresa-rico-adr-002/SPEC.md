# SPEC — ADR-002 RPC + Edge signup-tenant (scoped)

**Feature slug:** `cadastro-empresa-rico-adr-002`
**ADR de origem:** `.spec/prd/cadastro-empresa-rico/ADRs/ADR-002-rpc-edge-signup/ADR.md`
**Depende de:** ADR-001 (colunas + checks + formato canônico).
**Escopo:** Backend — nova versão da RPC + schema/validadores da Edge `signup-tenant`. Sem DDL de colunas, sem UI.

## 1. Decisão
Versar `create_tenant_with_admin` para a assinatura de 14 params (NOTA: o ADR escreveu "11 params" no título, mas a interface enumerada tem 14 — vale a enumeração) e estender `signupBodySchema` (`.strict()` preservado) com os mesmos validadores + DV CPF/CNPJ server-side. Unicidade via índice; violação mapeada para 409 sem ecoar PII.

## 2. RPC (migration nova, aditiva)
- `DROP FUNCTION IF EXISTS public.create_tenant_with_admin(uuid,text,text,text,text);` (remove overload de 5 params — `CREATE OR REPLACE` com outra assinatura criaria overload, não substituição).
- `CREATE FUNCTION public.create_tenant_with_admin(p_user_id uuid, p_owner_email text, p_trade_name text, p_full_name text, p_segment text, p_legal_name text, p_document text, p_phone text, p_cep text, p_street text, p_number text, p_complement text, p_city text, p_state text) RETURNS uuid` — `SECURITY DEFINER`, `search_path = public`, `REVOKE ALL ... FROM public,anon,authenticated` + `GRANT EXECUTE ... TO service_role` na assinatura nova.
- Validações na RPC (fail-closed, `RAISE EXCEPTION ... USING ERRCODE`): `p_full_name` vazio → `nome_admin_obrigatorio`; `p_document` (só dígitos 11/14 + DV) → `document_invalido`; `p_phone` (`^[0-9]{10,11}$`) → `telefone_invalido`; endereço (cep 8 + street + number + city + UF, complement opcional) → `endereco_incompleto`; segment fora do enum → `segment_invalid` (existente).
- DV CPF/CNPJ em PL/pgSQL (mesmo algoritmo do cliente/Edge; casos conhecidos 00000000000/11111111111 etc. rejeitados).
- Insert: `legal_name = NULLIF(trim(p_legal_name),'')` caído para `p_trade_name`; colunas novas persistidas só-dígitos/maiúscula; resto idêntico (trial 14d, profile admin, seed templates, transacional).
- Unicidade: deixa o índice `tenants_document_key` levantar `unique_violation` (23505) — a Edge mapeia; sem pre-check (race-safe).

## 3. Edge `signup-tenant`
- `schemas.ts`: `.strict()` estendido — `{ email, password, trade_name(2-120), legal_name?(2-120), document!, phone_empresa!, address_cep!, address_street!, address_number!, address_complement?, address_city!, address_state!, full_name!, segment? }`; strip de máscara → só dígitos; DV server-side (zod refine); `whatsapp`/`role`/`tenant_id` continuam recusados.
- `index.ts`: passa os 14 params; mapeia erro RPC 23505 em `tenants_document_key` → `409 { code: document_ja_cadastrado, message: "Este CNPJ/CPF já tem cadastro." }`; demais códigos RPC → 400 com mensagens do ADR (sem ecoar valores); sucesso `201 { tenant_id }` (ATENÇÃO: hoje retorna `{ ok: true }` — ADR-003 consome o novo formato); rollback deleteUser em falha (existente, mantido).
- Logs: só códigos/contadores; nunca documento/telefone/endereço/email.

## 4. Invariantes
| # | Invariante |
|---|---|
| I1 | Overload antiga removida; só a assinatura de 14 params existe |
| I2 | EXECUTE só service_role (revoke public/anon/authenticated) |
| I3 | Cliente nunca autoridade: Edge revalida tudo; RPC revalida tudo |
| I4 | 409 sem ecoar PII; logs sem PII |
| I5 | Transacional: falha ⇒ sem tenant parcial (rollback Auth user mantido) |

## 5. Requisitos funcionais
- RF01: cadastro completo válido → 201 `{ tenant_id }`, tenant + profile + templates criados.
- RF02: documento inválido (tamanho/DV) → 400 `document_invalido` (Edge barra antes da RPC; chamada direta à RPC também barra).
- RF03: documento duplicado → 409 `document_ja_cadastrado`, sem vazar o valor.
- RF04: `full_name` vazio → 400 `nome_admin_obrigatorio`.
- RF05: endereço incompleto → 400 `endereco_incompleto`.
- RF06: campo extra (`whatsapp`, `role`) → 400 `invalid_body`.
- RF07: falha na RPC após criar Auth user → user removido (sem login órfão).

## 6. Fora de escopo
DDL colunas (ADR-001); UI/máscaras/ViaCEP (ADR-003); whatsapp; funcionário.

## 7. Critérios de aceite
Suite deno da Edge verde (DV, máscaras, 409, invalid_body, rollback); teste de integração da RPC (14 params, DV, unique→23505, grants); typecheck + build verdes.
