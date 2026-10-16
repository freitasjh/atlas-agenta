---
inclusion: always
---

# Convenções de Código

## Geral

- **TypeScript estrito** (`strict: true`). Sem `any` implícito; tipar DTOs e respostas de API.
- Validação de entrada e de dados externos com **zod** (formulários, webhooks, respostas de
  integrações). Nunca confiar em payload externo sem validar.
- Erros de usuário com mensagens em **pt-BR**. Logs técnicos podem ser em inglês.

## Frontend (React + Vite)

- Componentes funcionais + hooks. Um componente por arquivo, PascalCase.
- Dados de servidor via **TanStack Query** (nada de `fetch` solto em `useEffect` para dados).
- Formulários com **react-hook-form** + resolver zod.
- UI com **shadcn/ui** + Tailwind. Reutilizar componentes de `src/components`; não recriar.
- Acessibilidade: labels associados, foco visível, contraste adequado, navegação por teclado.
- Mobile-first: estilizar o layout pequeno primeiro, depois breakpoints maiores.

## Acesso a dados

- Cliente Supabase do navegador usa **anon key** + sessão do usuário (RLS aplica isolamento).
- Operações privilegiadas (service role) **somente** em Edge Functions, nunca no cliente.
- Nunca enviar `tenant_id` como filtro vindo do cliente para contornar RLS; o isolamento é do
  banco.

## Banco (Supabase/Postgres)

- Toda mudança de schema é uma **migration** em `supabase/migrations` (SQL versionado).
- Toda tabela de domínio: coluna `tenant_id` + índice + política RLS. Sem exceção.
- Dinheiro em `*_cents` (inteiro). Tempo em `timestamptz` (UTC).

## Nomenclatura

- Tabelas/colunas: inglês, `snake_case`, tabelas no plural.
- Código TS: `camelCase` para variáveis/funções, `PascalCase` para tipos/componentes.
- Rotas em pt-BR quando voltadas ao usuário final (`/precos`, `/cadastro`), consistentes com a
  spec.

## Testes e verificação

- Não adicionar testes automaticamente, só quando pedido. Quando houver suíte, rodar antes de
  concluir.
- Após mudança de código, rodar build/typecheck e corrigir erros antes de entregar.

## Git

- Commits só quando o usuário pedir. Preferir branch nova, nunca push direto em main sem pedido.
- Não commitar `.env`, chaves ou segredos.
