# Análise de frontend: brechas de privilégio em profiles e tenants

Status: documento mínimo do designer de frontend. Nenhum código de aplicação foi escrito.
Demanda: migration nova de RLS e grants que fecha três brechas no banco (escalada de `profiles.role`, bypass de `tenants.subscription_status` / `tenants.plan`, e `TRUNCATE` concedido a `anon` e `authenticated` em 17 tabelas de domínio).
Escopo de frontend: nenhum. Esta demanda não toca tela.

## 1. Veredito

A demanda não cria nem altera rota, página, componente, hook de dados ou estado visual. Não há direção visual, design system, nem critério de acessibilidade novo a definir. Não aplico as skills de estilo, porque nada no escopo tem superfície visual.

O único efeito no frontend é o de regressão: a RLS nova não pode quebrar as leituras e os fluxos que a UI já usa. A seção 3 descreve o contrato que a UI precisa respeitar no futuro.

## 2. Verificação no código

A verificação foi feita em `origin/master` (base da branch nova), com `git grep`, e confirmada na árvore local.

| Arquivo | Operação | Tabela | Colunas |
|---------|----------|--------|---------|
| `src/hooks/useProfile.ts` | leitura | `profiles` | `id, role, tenant_id` (filtro `id = userId`) |
| `src/auth/usePostLoginRedirect.ts` | leitura | `profiles` | `role` (filtro `id = userId`) |
| `src/hooks/useTenant.ts` | leitura | `tenants` | `id, trade_name, legal_name, subscription_status, timezone, segment` |
| `src/hooks/useAuthMutations.ts` | `signUp` com metadados | `auth.users` → trigger `handle_new_user` | `trade_name`, `segment` em `options.data` |

Em `origin/master` não há nenhum `.update`, `.upsert` ou `.insert` sobre `profiles` ou `tenants`. Os únicos acessos são as três leituras acima. O cadastro não escreve nas duas tabelas pelo cliente: o trigger `security definer` cria `profiles` e `tenants`, e a migration nova não altera esse caminho.

Consequência: nenhuma tela atual perde função com a revogação de UPDATE de colunas protegidas. A restrição "edição de nome e dados cadastrais do tenant pela UI continua funcionando" não tem tela de origem hoje. Não existe formulário de configuração da empresa que escreva em `tenants`. Portanto não há regressão de UI a preservar nesse ponto. Quando essa tela existir, ela entra pela seção 3.3.

## 3. Contrato de UI que a migração estabelece

Estes itens são restrições para as próximas telas. Não são trabalho desta PR.

### 3.1 Guards continuam iguais

- `useProfile` (role e tenant_id) e `useTenant` (subscription_status) seguem como leitura. A RLS nova mantém `profiles_select_same_tenant` e `tenants_select_own`.
- `RequireActiveSubscription` redireciona `bloqueado` para `/app/quitacao`, lendo `subscription_status` de `useTenant`. Esse guard não muda e continua sendo a única barreira de UI para o status.
- `router.tsx` não muda.

### 3.2 Troca de plano e de status não existe pelo cliente

Mudança de `subscription_status` ou `plan` (ex.: quitação, ativação após pagamento, troca de plano) não pode ser botão de UI que chama `.update` em `tenants`. A tela de status do super admin (`src/admin/pages.tsx`, hoje um `PlaceholderPanel` com `StatusBadge`) e o fluxo de cobrança (Fase 3) devem chamar uma Edge Function com service role ou uma RPC `security definer` auditada. Dependência: essa função não existe. Ela não bloqueia esta PR, porque nenhuma tela a usa hoje.

### 3.3 Edição de dados cadastrais futura

Quando houver tela de cadastro da empresa (`trade_name`, `legal_name`, `phone`, `timezone`) ou de perfil (`full_name`), ela deve seguir o padrão do projeto:

- Mutação com `useMutation` do TanStack Query. Nada de `fetch` solto em `useEffect`.
- Formulário com react-hook-form e resolver zod. Mensagens de validação em pt-BR.
- Enviar só as colunas permitidas. O cliente não envia `role`, `tenant_id`, `subscription_status`, `plan`, `trial_ends_at` nem `id`.
- Usar `.update(...).eq("id", ...).select()`. A RLS filtra linhas sem erro, então um update sem linhas afetadas chega como sucesso vazio. A mutação trata array vazio como falha.
- Mensagem de falha em pt-BR, sem detalhe técnico: "Não foi possível salvar as alterações. Tente novamente." O detalhe técnico vai para o log em inglês.
- Após sucesso, invalidar `["tenant", tenantId]` ou `["profile", userId]`. Nunca enviar `tenant_id` como filtro vindo do cliente.

### 3.4 Coluna protegida enviada pelo cliente

Se a UI enviar uma coluna sem permissão, o PostgREST responde com erro Postgres `42501` (HTTP 403). A mensagem do banco é "permission denied for table profiles" para `role`, `tenant_id`, INSERT e DELETE, e a tela não deve depender do texto, só do código `42501`. Isso é defeito de código da tela, não cenário de uso. A mutação mostra a mesma mensagem genérica de 3.3 e registra o código técnico no console, sem dados pessoais.

### 3.5 `tenants.segment` é só gating de UI

`useSegmentFeatures` decide telas por `segment`. A RLS das tabelas clínicas não lê `segment` (comentário na migration `20250227092000_clinical_records_rls.sql`). Se o admin puder alterar o próprio segmento, a mudança muda quais telas aparecem, mas não muda o que o banco libera. Isto é uma decisão de produto, não de UI, e fica em aberto (seção 7).

### 3.6 Cadastro e bloqueio sem mudança

- `CadastroPage` continua chamando `signUp` com `trade_name` e `segment` em metadados. O `?plano` segue apenas apresentacional e não entra no payload.
- `BillingGateLayout` (tela de quitação) não muda.

## 4. Estados e componentes

Nenhum estado visual novo. Nenhum componente novo. Nenhum componente de `src/components` é alterado. Não há badge, skeleton, estado vazio ou tela de erro nova nesta demanda.

## 5. Acessibilidade

Não há tela alterada, então não há item novo de contraste, foco ou teclado a conferir. Os itens de acessibilidade das telas existentes continuam valendo e não são afetados.

## 6. Critério de aceite

1. `git diff --name-only origin/master` não lista nenhum arquivo em `src/`. A PR toca só `supabase/migrations/` e testes pgTAP.
2. `npm run typecheck`, `npm run build` e `npm run test` ficam verdes sem alteração de código de aplicação.
3. Smoke de regressão após `supabase db reset` com contas semeadas, em `127.0.0.1`:
   - conta de admin de tenant entra e chega em `/app`, com o nome do tenant carregado (leitura de `tenants` e `profiles`);
   - conta de super admin entra e chega em `/admin`;
   - tenant com `subscription_status = 'bloqueado'` é redirecionado para `/app/quitacao`;
   - formulário de cadastro em `/cadastro` envia `signUp` sem erro e o trigger cria o tenant em `trial`.
   Esse smoke pode ser feito com o Chrome DevTools MCP. Não há captura de tela para comparar, porque nenhuma tela muda.

## 7. Pontos em aberto para o planner

1. Lista de colunas editáveis pelo admin. A sugestão da demanda inclui `segment`. Pela seção 3.5, manter `segment` fora da lista é mais seguro, a não ser que o produto peça troca de ramo pelo próprio admin.
2. Nome da coluna `profiles.full_name`: existe (migration `20250216091000`). A sugestão de revogar UPDATE e liberar só `full_name` é viável.
3. Timestamp da migration. `origin/master` tem a última migration em `20250226096000_appointments_combo.sql`. A branch de ficha clínica (`feat/clinica-ficha-cliente`) já tem `20250227091000` a `20250227093000`. Escolher timestamp posterior a `20250227093000` evita conflito de ordem se as duas PRs forem mescladas.
4. Arquivo de destino. `analysis-frontend.md` tem alterações não commitadas do design da ficha do cliente. Este documento foi gravado em arquivo próprio para não sobrescrever esse trabalho.
5. `security-findings.json` marca a correção de escalada como `requires_user_confirmation: false`. A decisão do usuário já está em `prd-approval.json`, com `verdict: approved`. O planner não precisa de nova confirmação, e deve citar `prd-approval.json` na PR.

## 8. Respostas a achados de revisão

Não há revisão anterior de design para esta demanda. Nada a responder.
