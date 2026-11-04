# Convenções de Código — Atlas Agenda

Fonte: `.kiro/steering/convencoes-codigo.md`. Regra descritiva.

## Geral
TypeScript estrito (strict: true). Sem any implícito; tipar DTOs e respostas de API. Validação com zod (formulários, webhooks, respostas de integrações). Nunca confiar em payload externo sem validar. Erros de usuário em pt-BR; logs técnicos podem ser inglês.

## Frontend (React + Vite)
Componentes funcionais + hooks. Um componente por arquivo, PascalCase. Dados de servidor via TanStack Query (nada de fetch solto em useEffect para dados). Formulários react-hook-form + resolver zod. UI shadcn/ui + Tailwind; reutilizar src/components. Acessibilidade (labels, foco, contraste, teclado). Mobile-first.

## Acesso a dados
Cliente Supabase do navegador usa anon key + sessão do usuário (RLS aplica isolamento). Operações privilegiadas (service role) somente em Edge Functions, nunca no cliente. Nunca enviar tenant_id como filtro do cliente para contornar RLS.

## Banco (Supabase/Postgres)
Toda mudança de schema é migration em supabase/migrations (SQL versionado). Toda tabela de domínio: coluna tenant_id + índice + política RLS. Sem exceção. Dinheiro em *_cents (inteiro). Tempo em timestamptz (UTC).

## Nomenclatura
Tabelas/colunas: inglês, snake_case, tabelas no plural. TS: camelCase variáveis/funções, PascalCase tipos/componentes. Rotas em pt-BR quando voltadas ao usuário (/precos, /cadastro).

## Testes e verificação
Não adicionar testes automaticamente, só quando pedido. Quando houver suíte, rodar antes de concluir. Após mudança de código, rodar build/typecheck e corrigir erros antes de entregar.

## Git
Commits só quando o usuário pedir. Preferir branch nova, nunca push direto em main sem pedido. Não commitar .env, chaves ou segredos.