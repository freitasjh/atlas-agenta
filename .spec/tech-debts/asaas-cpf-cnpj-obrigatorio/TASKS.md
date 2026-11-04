# Débito P1 — `cpfCnpj` obrigatório para criar cliente no Asaas

**Origem:** code review do commit `aafeba1` (dev-up/dev-seed/dev-smoke). O smoke
pré-registra o cliente com CPF fixo para conseguir rodar; a prova real do PIX
(aceite #3 do ADR-20) **não** foi feita. Status: decisão de produto pendente
(usuário ainda não aprovou o escopo).

## Contexto

O Asaas exige `cpfCnpj` no `POST /customers` (sandbox e produção). Hoje:

- `supabase/functions/create-charge/handler.ts` busca o cliente por
  `externalReference` e, se não existir, cria com apenas `name`, `email`,
  `phone` e `externalReference`. Sem documento ⇒ Asaas responde **400** ⇒ a
  Edge Function devolve **500** (`Falha ao criar cliente no Asaas.`).
- `scripts/dev-smoke.mjs` contorna isso pré-registrando o cliente no Asaas com
  CPF fixo de teste (`39053344705`) antes de chamar `create-charge`. É bypass
  de teste, não correção de produto.
- O schema de `customers` (`supabase/migrations/20250219090000_customers.sql`)
  não tem coluna de documento, e nem o form de cliente nem o `public-book`
  coletam CPF/CNPJ.

## Impacto

Todo cliente novo (criado pela UI ou pelo autoagendamento público) falha na
primeira cobrança: `create-charge` → 500. O fluxo PIX do ADR-20 não funciona
ponta a ponta em produção, e o smoke atual esconde essa falha.

## Escopo mínimo proposto

1. **Banco**: coluna `customers.cpf_cnpj text` (nullable no legado; `check` de
   tamanho/dígitos quando preenchida) + índice se necessário; migration em
   `supabase/migrations/` com RLS herdada da tabela (sem política nova).
2. **Captura**:
   - form de cliente (`src/app/clientes/CustomerFormDialog.tsx` + model/hook em
     `src/hooks/useCustomers.ts`) com máscara e campo obrigatório para clientes
     novos;
   - `public-book` (`supabase/functions/public-book/index.ts`) coletando o
     documento no autoagendamento e gravando em `customers.cpf_cnpj`.
3. **Validação no servidor**: função compartilhada em
   `supabase/functions/_shared/` validando 11 (CPF) ou 14 (CNPJ) dígitos +
   dígitos verificadores; rejeitar com 400 acionável antes de chamar o Asaas.
4. **`create-charge`**: selecionar `cpf_cnpj` do cliente e enviar como
   `cpfCnpj` no `POST /customers`; se ausente/ inválido, devolver **400**
   acionável ("cliente sem CPF/CNPJ — complete o cadastro") em vez de 500.
5. **Erro do Asaas**: mapear 400 de `/customers` para mensagem acionável na
   resposta e no log, sem vazar documento completo.
6. **Smoke**: remover o bypass de CPF fixo e criar o cliente de teste com
   documento; o passo PIX volta a provar o caminho real.
7. **Docs**: atualizar `docs/DEV.md` (nota de CPF de teste) e o runbook.

## Critérios de teste

- Unitário de validação de documento: CPF/CNPJ válidos passam; dígitos
  verificadores errados, vazio e tamanho inválido falham.
- Unitário de `create-charge`: cliente com `cpf_cnpj` → payload do Asaas inclui
  `cpfCnpj`; cliente sem documento → 400 acionável (não 500).
- Integração: `public-book` grava `cpf_cnpj`; form de cliente persiste e
  rejeita documento inválido com erro em pt-BR.
- Smoke E2E: cliente criado sem pré-registro no Asaas; `create-charge` → 200
  com QR + copia-e-cola; `charges.status='pendente'` e
  `amount_cents = appointment.price_cents`.
- Regressão: `npm run test:functions`, `npm test`, typecheck e build limpos.

## Tarefas

- [ ] Decidir produto: documento obrigatório para todo cliente novo? (bloqueia)
- [ ] Migration `customers.cpf_cnpj` + constraint/validação
- [ ] Model/hook/form de cliente com máscara e obrigatoriedade
- [ ] `public-book` coleta e valida documento
- [ ] Validador compartilhado CPF/CNPJ + testes
- [ ] `create-charge` envia `cpfCnpj` e trata 400 acionável
- [ ] Remover bypass de CPF do `dev-smoke.mjs`
- [ ] Atualizar `docs/DEV.md` e rodar suite completa
