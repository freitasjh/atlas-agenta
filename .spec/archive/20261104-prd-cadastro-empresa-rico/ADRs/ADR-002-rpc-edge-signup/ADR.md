# ADR-002 — RPC create_tenant_with_admin + Edge signup-tenant: params, validação server, 409 documento

> Unidade de decisão: 1 ADR = 1 branch = 1 PR (merge humano).

- **Decisão**: Versar a RPC `create_tenant_with_admin` para 11 params (documento, telefone, endereço, legal_name com fallback) e ampliar o schema `.strict()` da Edge `signup-tenant` com os mesmos validadores server-side do ADR-001, mapeando unicidade violada para 409 pt-BR sem ecoar PII; nenhum log de documento/telefone/endereço.
- **Motivo**: Cliente nunca é autoridade (RNF04, `seguranca-multitenant.md`); payload da Edge é não-confiável; unicidade real só o índice `tenants_document_key` garante (RESEARCH T2-A); pré-prod sem trava de compat permite versar a RPC sem legado.
- **Alternativas descartadas**: Validação só no cliente (zod/react-hook-form no browser) — fonte: https://www.gov.br/receitafederal/ (base DV); descartada por insegura — chamada direta à Edge/RPC burlava documento inválido/duplicado, viola RNF04 — fonte: `.agents/rules/seguranca-multitenant.md`
- **depende-de**: ADR-001
- **Interface congelada**: RPC (nova versão, `SECURITY DEFINER`, `EXECUTE` só `service_role`):
  ```sql
  create_tenant_with_admin(
    p_user_id uuid, p_owner_email text, p_trade_name text,
    p_full_name text,           -- passa a OBRIGATÓRIO (RF06)
    p_segment text,             -- NULL | barbearia | clinica | salao
    p_legal_name text,          -- NULL/vazio ⇒ legal_name = trade_name (RN02)
    p_document text,            -- OBRIGATÓRIO, só dígitos 11/14, DV válido
    p_phone text,               -- OBRIGATÓRIO, só dígitos ^\d{10,11}$
    p_cep text, p_street text, p_number text, p_complement text, p_city text, p_state text
  ) RETURNS uuid
  ```
  Erros RPC (códigos mapeáveis, mensagens pt-BR exatas): `document_invalido` ("CNPJ/CPF inválido."), `document_ja_cadastrado` ("Este CNPJ/CPF já tem cadastro.", HTTP 409, mapeia `unique_violation` em `tenants_document_key`), `telefone_invalido` ("Informe o telefone da empresa."), `endereco_incompleto` ("Endereço incompleto: verifique CEP, logradouro, número, cidade e UF."), `nome_admin_obrigatorio` ("Informe seu nome."). Schema Edge `signup-tenant/schemas.ts` (`.strict()` preservado, extras recusados com `invalid_body`): `{ email, password, trade_name (2–120), legal_name? (2–120), document!, phone_empresa!, address_cep!, address_street!, address_number!, address_complement?, address_city!, address_state!, full_name!, segment? }` — mesmas regex do ADR-001 + DV CPF/CNPJ server-side; strip de máscara antes de validar, persiste só dígitos. HTTP: `201 { tenant_id }` sucesso (transacional: empresa + profile admin + templates; falha ⇒ remove Auth user, sem parcial); `400 invalid_body` (zod, por campo); `409 { code: document_ja_cadastrado, message }` sem ecoar valor. Logs: só contadores/códigos (`invalid_body`, `document_ja_cadastrado`), nunca valores de documento/telefone/endereço/email.
- **Fora desta decisão**: DDL/migration (ADR-001); UI/máscaras/ViaCEP/debounce (ADR-003); whatsapp/`role`/`tenant_id` continuam recusados por `.strict()` (RF07); templates da régua inalterados; funcionário (fase 2).
- **Consequências se estiver errado**: Params a mais/menos quebram o contrato com a UI (ADR-003 consome este contrato); mensagem 409 com PII ecoado viola LGPD — reversão = nova versão da RPC + Edge, nunca editar versão aplicada.
- **Status**: todo
