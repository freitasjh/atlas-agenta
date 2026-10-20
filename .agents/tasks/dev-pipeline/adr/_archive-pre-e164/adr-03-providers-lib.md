# ADR-03 — Núcleo de dados: cliente Supabase (anon key + zod), QueryClient e padrões de `src/lib`/`src/hooks`

**Status:** proposto
**Escopo:** frontend (infra de dados / lib)
**Depende de:** ADR-01 (build/env). Independente da ADR-02; a ADR-04 monta estes providers na
raiz, então esta ADR vem antes da ADR-04.

## Contexto

O scaffold precisa estabelecer, já no primeiro commit, o padrão de acesso a dados: cliente
Supabase centralizado em `src/lib` usando **somente a anon key pública** via env, o
`QueryClient` do TanStack Query, e o padrão de hooks (`useQuery`, nada de `fetch` solto em
`useEffect`) — tudo como forma/contrato, sem chamada real de dados neste recorte
(analysis-frontend §4, analysis-data §7). A única "entrada externa" do scaffold são as envs
`VITE_*`, que devem ser validadas na borda com zod e falhar com mensagem clara em pt-BR —
**sem** quebrar a navegação das rotas-casca (analysis-data §7).

## Decisão

1. **Dependências (versões fixadas):** `@supabase/supabase-js` v2, `@tanstack/react-query` v5,
   `zod`, `react-hook-form`, `@hookform/resolvers`. (react-hook-form/resolvers entram aqui
   como dependência; o uso real em formulário fica para a fase de auth — aqui só um schema de
   exemplo em `src/lib/validations`.)
2. **Validação de env com zod** em `src/lib/env.ts`: schema exigindo `VITE_SUPABASE_URL`
   (string não-vazia com formato de URL) e `VITE_SUPABASE_ANON_KEY` (string não-vazia).
   Comportamento na falha (analysis-data §7): **não lançar exceção que derrube a SPA** — logar
   erro/aviso claro em pt-BR no console (ex.: "Configuração ausente: defina VITE_SUPABASE_URL
   e VITE_SUPABASE_ANON_KEY no arquivo .env — veja .env.example.") e seguir, para que as
   rotas-casca naveguem mesmo sem `.env`. Nenhum dado sensível é logado (anon key é pública).
3. **Cliente Supabase** em `src/lib/supabase.ts`: cria o client `@supabase/supabase-js` a
   partir de `import.meta.env.VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (validados por
   `env.ts`). **Exclusivamente a anon key** — nenhuma referência a service role. Nenhuma
   chamada de rede dispara no load do scaffold (critério visual §8). Comentário no arquivo
   reforçando: nunca enviar `tenant_id` do cliente para contornar RLS; service role jamais no
   bundle (RNF-SCAFF-01, PRD §4 itens 2 e 8).
4. **QueryClient** em `src/lib/queryClient.ts`: instância única com `staleTime` sensato e
   `retry` moderado. O `QueryClientProvider` é montado na raiz na ADR-04.
5. **Hook de exemplo** em `src/hooks` (ex.: `src/hooks/useExampleQuery.ts`): padrão `useQuery`
   **documentado/comentado**, sem chamada real — fixa a convenção "dados sempre via TanStack
   Query, nunca `fetch` em `useEffect`" (RNF-SCAFF-04).
6. **Schema zod de exemplo** em `src/lib/validations/` (ex.: `auth.ts` com um schema de login)
   **sem** submit funcional — prepara react-hook-form + resolver para a fase de auth, sem
   introduzir schema de domínio agora.

## Consequências

- O padrão de acesso a dados fica travado antes de qualquer tela que consuma dados, evitando
  `fetch` solto nas fases seguintes.
- A app sobe e navega mesmo sem `.env` (requisito do scaffold navegável), e falha de env é
  explícita e em pt-BR em vez de erro obscuro tardio (CA-09).
- "Só anon key no cliente" fica refletido na forma do código; a enforcement real continua
  sendo processo + `.gitignore` (ADR-01).

## Arquivos afetados

- `package.json`, `package-lock.json` (deps fixadas)
- `src/lib/env.ts`, `src/lib/supabase.ts`, `src/lib/queryClient.ts`
- `src/hooks/useExampleQuery.ts`
- `src/lib/validations/auth.ts`

## Critérios de aceite testáveis (desta ADR)

1. `npm run build` conclui sem erro de tipo (TS estrito). (CA-01)
2. O cliente Supabase é criado em `src/lib` a partir de `VITE_SUPABASE_URL` e
   `VITE_SUPABASE_ANON_KEY`; leitura do código confirma **só anon key**, nenhuma service role.
   (RF-SCAFF-05, CA-09)
3. Com `.env` ausente, a app **ainda navega** (verificável após ADR-04/05) e emite mensagem
   clara em pt-BR no console — não quebra de forma confusa. (CA-09)
4. `src/lib/queryClient.ts` exporta um `QueryClient` configurado, pronto para a raiz. (RF-SCAFF-07)
5. Busca por `service_role` / segredos privilegiados no código não retorna nada. (CA-13)
6. `src/hooks` tem um exemplo de `useQuery`; nenhum `fetch` em `useEffect` no código. (RNF-SCAFF-04)

## Verificação

- `cd <workdir> && npm run build` → limpo.
- Inspeção estática de `src/lib/supabase.ts` (só anon key), `env.ts` (mensagem pt-BR),
  `queryClient.ts`, hook de exemplo.
- QA de runtime da falha de env fica para a ADR-05 (quando as rotas existem) ou QA consolidado.
