# SPEC — ADR-003 UI CadastroPage + ViaCEP (scoped)

**Feature slug:** `cadastro-empresa-rico-adr-003`
**ADR de origem:** `.spec/prd/cadastro-empresa-rico/ADRs/ADR-003-ui-cadastro-viacep/ADR.md`
**Depende de:** ADR-002 (contrato Edge: 14 campos, 201 `{ tenant_id }`, 409 `document_ja_cadastrado`).
**Escopo:** Frontend — `CadastroPage` + `signupSchema` + `useSignUp` + hook ViaCEP + catálogo de mensagens. Sem RPC/DDL.

## 1. Parecer ux-designer (VINCULANTE)
- Página única, 4 `<fieldset>` empilhados, 1 submit (NÃO wizard, NÃO accordion).
- Ordem fixa: 1 Empresa → 2 Endereço → 3 Acesso → 4 Responsável (`segment` migra do bloco 1 p/ bloco 4).
- Header de seção: badge numérico + h2 + descrição + divisor; 24–32px entre blocos, 16px dentro.
- Grid: mobile 1 col; `sm:grid-cols-2` só pares (numero/complemento, cidade/UF, password/confirm); inputs h-11; Card p-6/p-8, max-w-2xl.
- Máscara = apresentação, canônico = dígitos; validar no blur, nunca no keystroke; colar formatado funciona; nunca `type="number"`; caret preservado.
- ViaCEP: loading com aria-live + trava só do bloco (aria-busy); sucesso pré-preenche editável + anúncio; falha → erro inline + "preencha manualmente" + Tentar de novo; NUNCA apaga digitado; Abort em redigitação.
- a11y: fieldset/legend reais, autocompletes (organization, postal-code, street-address, address-level2/1, email, new-password, given-name, tel), error-summary c/ âncoras se ≥2 erros + foco no 1º inválido, toggle senha aria-pressed, contraste 4.5:1, alvos 44px.
- PII: NÃO mascarar com ••• no cadastro; helper LGPD no bloco 1; nada em logs.
- Componentes shadcn existentes, zero token novo.

## 2. Desvio documentado do ADR (i18n)
ADR previa `react-i18next` (`cadastro.*`); repo NÃO tem infra i18n (sem dependência, tudo literal). Decisão (ux-designer §7): catálogo local `src/auth/cadastro-messages.ts` (labels/helpers/erros ViaCEP/labels 27 UFs) + mensagens no zod — migração futura vira troca mecânica. Sem literal solto fora do catálogo.

## 3. Componentes
- `signupSchema` (`src/lib/validations/auth.ts`): `tradeName!`, `legalName?`, `document!` (strip→11/14+DV), `phoneEmpresa!` (strip→10/11), `addressCep!` (strip→8), `addressStreet!`, `addressNumber!`, `addressComplement?`, `addressCity!`, `addressState!` (27 siglas), `email!`, `password`+`confirmPassword` (regras inalteradas), `fullName!`, `segment?` (sentinela `""`, bloco 4). Mensagens via catálogo.
- `mask.ts` (`src/lib/`): `maskDocument` (dinâmica 11↔14), `maskPhone`, `maskCep`, `stripDigits` — apresentação ⇄ canônico.
- `useCepLookup` (`src/hooks/`): debounce 400ms + AbortController timeout 5s; estados idle/loading/success/not-found/error; `GET https://viacep.com.br/ws/{cep8}/json/`; nunca escreve por cima de campo tocado pelo usuário após retorno.
- `CadastroPage`: 4 fieldsets + error-summary + ViaCEP status + submit (loading/disabled) + footer; corpo enviado = snake_case idêntico ao schema ADR-002 (sem whatsapp/role/tenant_id).
- `useSignUp` (`src/hooks/useAuthMutations.ts`): body completo; trata 201; `mapSignUpError` cobre `document_ja_cadastrado` → "Este CNPJ/CPF já tem cadastro."; login automático mantido.
- `cadastro-messages.ts`: todas as strings (labels, helpers, erros por campo, ViaCEP, UFs).

## 4. Invariantes
| # | Invariante |
|---|---|
| I1 | Corpo enviado byte-idêntico ao schema ADR-002 (chaves + só-dígitos + UF maiúscula) |
| I2 | Regras cliente == servidor (mesmos vetores DV/regex); servidor sempre revalida |
| I3 | ViaCEP sugestão, nunca autoridade; offline conclui |
| I4 | Zero literal fora do catálogo; zero PII em logs/testes reais |

## 5. Requisitos funcionais
- RF01: blocos na ordem 1→4 com fieldset/legend; submit único.
- RF02: máscaras dinâmicas sem travar apagar/colar; canônico só dígitos no submit.
- RF03: CEP 8 dígitos → lookup; sucesso preenche editável; falha → manual + retry; redigitar aborta anterior.
- RF04: DV inválido/duplicado/endereço incompleto → erro por campo pt-BR + summary + foco; 409 exibe "Este CNPJ/CPF já tem cadastro."
- RF05: cadastro válido → 201 → login automático → destino pós-login (inalterado).
- RF06: sem JS de ViaCEP (offline/bloqueio) → cadastro manual completo funciona.

## 6. Fora de escopo
RPC/DDL (ADR-001/002); whatsapp; funcionário; i18n full; dark-mode novo.

## 7. Critérios de aceite
Testes de schema (vetores espelhados servidor), página (ordem, máscaras, ViaCEP mockado, corpo exato, 409, summary/foco), build + typecheck + harness DevTools (console zero erros, network 201 local) verdes.
