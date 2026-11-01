# Análise de Dados & Segurança — Bootstrap do Super Admin com troca obrigatória de senha

Papel: ANALISADOR DE DADOS E SEGURANÇA do dev-pipeline. Este documento define requisitos,
critérios de aceite, modelo de dados, migrations, políticas RLS e a superfície de Edge Functions
para o acesso inicial ao `/admin`. Não contém código de aplicação. O documento anterior (Fatia 1,
Empresas) foi preservado em `analysis-data.anterior-super-admin-empresas.md`.

Skills ativadas: `supabase-multitenant` (modelo, RLS, RBAC). `agenda-scheduling`, `asaas-pix` e
`whatsapp-evolution` não se aplicam: a demanda não toca agenda, cobrança nem disparo.

Base verificada: `origin/master` = `61a8543` (merge do PR #17). O commit `69cc037` (branch
`feat/super-admin-empresas`) já está contido em `origin/master`. A branch da implementação deve
nascer de `origin/master`.

---

## 1. Resumo

Hoje nenhum usuário consegue entrar no `/admin` porque não existe `super_admin` semeado, e o
`usePostLoginRedirect` manda o `super_admin` para `/admin` (placeholder), não para
`/admin/empresas`. A demanda cria o acesso inicial com uma credencial padrão fixa e provisória,
obriga a troca de senha antes de liberar o painel, e manda o `super_admin` para `/admin/empresas`.

**Valor de negócio:** sem esse acesso, as fatias do painel super admin (Empresas, status, e as
seguintes) ficam inacessíveis em todo ambiente. É pré-requisito da operação da plataforma, não
uma funcionalidade de cliente final.

**Enquadramento no roadmap:** o painel `/admin` já tem a Fatia 1 (listar empresas e operar
`subscription_status`) mergeada no PR #17. Esta demanda é a porta de entrada dessa fatia. Não
faz parte do PIX (Asaas) nem do WhatsApp. Depois dela, o roadmap do super admin segue com o
dashboard `/admin` e a criação de tenants, ambos fora desta entrega.

**Divergência a registrar:** o achado de segurança do §3 (escalonamento de privilégio por
`UPDATE` em `profiles`) já existe em `origin/master`. Não é causado por esta demanda, mas a
critério do usuário ("qualquer escrita de papel ou flag pelo cliente é defeito") ele precisa ser
corrigido junto. Sem essa correção, o flag de troca de senha não protege nada: um usuário comum
consegue zerá-lo ou se promover a `super_admin` pelo próprio cliente.

---

## 2. Requisitos

### 2.1 Requisitos funcionais

- **RF-01 Bootstrap idempotente.** Existe um procedimento que cria o usuário `super_admin`
  inicial com a credencial padrão. Ele roda com service role, pode ser repetido sem erro e sem
  duplicação, e nunca sobrescreve um `super_admin` já existente (nem a senha, nem o e-mail, nem o
  papel de outro usuário).
- **RF-02 Credencial padrão fixa e provisória.** A senha inicial é uma constante única no
  servidor (e no seed local), igual em todos os ambientes, documentada no código como provisória
  até o beta. Não existe geração aleatória nesta entrega.
- **RF-03 Flag de troca obrigatória no servidor.** Um booleano `must_change_password` em
  `profiles` indica que o usuário precisa trocar a senha antes de usar o painel. Vale `true` para
  o bootstrap e `false` para os demais usuários.
- **RF-04 Bloqueio do painel no servidor.** Enquanto `must_change_password = true`, o
  `super_admin` não lê nem escreve dados cross-tenant (RLS) e não aciona a Edge Function
  `admin-subscription`. A checagem no frontend é só usabilidade.
- **RF-05 Troca de senha server-controlled.** Uma Edge Function `change-password` (JWT do usuário
  + service role) valida a nova senha, grava a senha no Auth e só então zera o flag, na mesma
  requisição. Nenhum caminho zera o flag sem uma troca de senha efetiva.
- **RF-06 Tela de troca em pt-BR.** Página `/trocar-senha` com formulário react-hook-form + zod
  (nova senha, confirmação). Mensagens de erro em pt-BR. Ao concluir, redireciona para
  `/admin/empresas`.
- **RF-07 Redirect do super admin.** Após login, `super_admin` com flag `false` vai para
  `/admin/empresas`. Com flag `true` vai para `/trocar-senha`. O redirect para `/admin` deixa de
  existir como destino pós-login.
- **RF-08 Guard de rota.** Qualquer rota `/admin/*` redireciona para `/trocar-senha` enquanto o
  flag estiver `true`. Esta regra complementa, não substitui, o RF-04.

### 2.2 Requisitos não funcionais

- **RNF-01 Segredo fora de log, bundle e resposta.** A senha padrão e a senha escolhida na troca
  não aparecem em `console`, logs de Edge Function, `dist/` do build, nem em corpo de resposta
  HTTP. Logs técnicos em inglês, sem e-mail nem senha.
- **RNF-02 Flag fora do alcance do cliente.** O cliente (sessão `authenticated`) não grava
  `must_change_password`, `role`, `tenant_id` nem `id` em `profiles`. A regra vale no banco
  (trigger), não só na aplicação.
- **RNF-03 Isolamento multi-tenant preservado.** Nenhuma tabela de domínio fica sem RLS. O
  bootstrap não cria tenant de cliente.
- **RNF-04 Responsividade e acessibilidade.** Tela de troca funciona em 390px e 1280px, claro e
  escuro, com labels associados, foco visível e navegação por teclado (convencoes-codigo.md).
- **RNF-05 Testabilidade.** Os caminhos de segurança (RLS negativo, trigger, Edge Function) têm
  teste de integração contra o Postgres/Auth local.

### 2.3 Escolha de design: onde fica a regra de bloqueio

O painel precisa estar bloqueado no servidor. Três pontos de aplicação foram avaliados:

| Alternativa | Vantagem | Desvantagem | Decisão |
|---|---|---|---|
| Só guard de frontend | Simples | Qualquer cliente chama a API direto. Viola RNF-02/RF-04 | Descartada |
| Só Edge Function checa o flag | Um ponto | RLS de leitura cross-tenant continua aberta à sessão | Descartada como única barreira |
| RLS (policies de `super_admin`) + Edge Function | Cobre leitura direta e escrita via função | Duas superfícies para manter | **Escolhida** |

Motivo da escolha: a leitura cross-tenant (`tenants`, `subscription_status_changes`, `profiles`)
é feita pelo cliente com a sessão. Se o flag ficar só na Edge Function, a lista de empresas
continua acessível pela API do PostgREST. Por isso as policies de `super_admin` ganham a condição
`not current_must_change_password()`, e a Edge Function `admin-subscription` também recusa com
403 quando o flag está `true`.

### 2.4 Escolha de design: como o bootstrap cria o usuário

Alternativas avaliadas para a criação do usuário inicial:

1. **Migration com `insert` em `auth.users`.** Descartada. Migration já aplicada não pode mudar
   e a migration executaria em produção sem ação do operador, criando conta com senha conhecida
   sem decisão humana. Também depende do schema interno do GoTrue.
2. **Endpoint público de bootstrap.** Descartada. Mesmo idempotente, qualquer chamador anônimo
   criaria o privilégio de plataforma.
3. **Edge Function `bootstrap-super-admin` chamada pelo operador com a service role key como
   bearer.** **Escolhida para remoto.** A chave já é o segredo de maior privilégio do projeto;
   quem não a tem não consegue chamar. Nenhum segredo novo é criado.
4. **`supabase/seed.sql` para o ambiente local.** **Escolhida para `supabase db reset`.** O seed
   roda só no reset local, nunca no remoto. Usa o mesmo procedimento de conversão do item 3.

O fluxo comum aos itens 3 e 4 é: criar o usuário no Auth (o trigger `handle_new_user` cria um
tenant `trial` e um profile `admin` para ele), e então converter esse profile em `super_admin`
e remover o tenant órfão, tudo numa única função transacional (ver §4, `bootstrap_super_admin`).
Converter em vez de contornar o trigger evita alterar o trigger já aplicado.

---

## 3. Achado de segurança existente (bloqueante para o requisito de "sem escrita de papel pelo cliente")

**Migration afetada:** `20250216091000_profiles_and_helpers.sql`, policy
`profiles_update_self_or_admin`.

```
USING     id = auth.uid() OR (role atual = admin AND mesmo tenant)
WITH CHECK tenant_id = current_tenant_id() OR role atual = super_admin
```

A policy não restringe **quais colunas** podem mudar. Um usuário comum atualiza a própria linha
com `role = 'super_admin'` (o `CHECK` da tabela só valida o domínio do valor, não a permissão).
A partir daí, ele passa a satisfazer `tenants_super_admin_select` e `profiles_super_admin`
(`FOR ALL`), e lê e escreve dados de todas as empresas. O mesmo vale para
`must_change_password` depois que a coluna existir. A checagem do frontend (`usePostLoginRedirect`
lê o papel e não o escreve) não impede isso, porque a escrita vem direto da API.

Achado relacionado: a policy `profiles_super_admin` é `FOR ALL` em `origin/master`. O brain
registra que o ADR-02 a reduziu para `SELECT`, mas a migration no `master` mantém `FOR ALL`. A
redução precisa ser aplicada nesta demanda, porque `INSERT` e `DELETE` de `profiles` pelo
super_admin contradizem o modelo de identidade (o profile nasce só pelo trigger).

**Correção adotada:** trigger `BEFORE UPDATE` em `profiles` que barra mudança de `id`, `role`,
`tenant_id` e `must_change_password` quando `auth.role() = 'authenticated'`, no mesmo modelo do
guard já existente em `tenants` (migration `20250227091000`). A policy `profiles_super_admin`
passa a `SELECT`. Nenhuma tela do `master` escreve `profiles.role` (busca feita em `src/`: sem
resultado), então a trava não quebra fluxo existente. Troca de papel por admin do tenant (convite
de membros) continua fora de escopo e, quando existir, passa por Edge Function.

---

## 4. Modelo de dados e migrations

Convenções: tabelas em inglês, snake_case, plural (já vigentes). Nenhuma coluna monetária nesta
demanda. O único campo de tempo novo é `timestamptz` em UTC.

### 4.1 Alteração de `profiles` (tabela de domínio, já tem `tenant_id` nullable e RLS)

| Coluna | Tipo | Nulo | Default | Motivo |
|---|---|---|---|---|
| `must_change_password` | `boolean` | não | `false` | Flag server-controlled de troca obrigatória (RF-03) |
| `password_changed_at` | `timestamptz` | sim | null | Trilha de quando a troca obrigatória foi concluída |

Índice: nenhum novo (baixa cardinalidade, lido só por `id = auth.uid()` e pela função
`current_must_change_password()`, que já usa a PK).

Invariante de domínio: `must_change_password = true` só pode existir com `role = 'super_admin'`
nesta fase. Não é `CHECK` obrigatório, mas a RPC do bootstrap e a Edge Function são os únicos
caminhos que escrevem a flag, e ambos a usam só para o `super_admin`.

### 4.2 Migrations novas (ordem obrigatória; nenhuma migration existente é editada)

**M1 — `20250228090000_profiles_password_gate.sql`**
1. `alter table profiles add column must_change_password boolean not null default false`.
2. `alter table profiles add column password_changed_at timestamptz`.
3. Função `current_must_change_password()` `security definer`, `stable`, `search_path = public`,
   retorna `coalesce(must_change_password, false)` do `auth.uid()`. Mesmo padrão de
   `current_role_name()`, o que evita recursão de RLS.
4. Função trigger `profiles_guard_privileged_columns()`: se `auth.role() = 'authenticated'` e
   algum de `id`, `role`, `tenant_id`, `must_change_password` mudou, lança
   `privileged_column_change_denied` (`insufficient_privilege`). Trigger `before update on
   profiles for each row`. Idempotente com `drop trigger if exists`.
5. Policy `profiles_super_admin`: `drop` e recriação como `FOR SELECT`, com
   `current_role_name() = 'super_admin' and not current_must_change_password()`.

**M2 — `20250228091800_super_admin_password_gate_rls.sql`**
Recria as policies de leitura e escrita cross-tenant do `super_admin` com a condição de bloqueio:
- `tenants_super_admin_select`: `current_role_name() = 'super_admin' and not current_must_change_password()`.
- `tenants_super_admin_update_cadastro`: mesma condição nos dois lados (`using` e `with check`).
- `subscription_status_changes_super_admin` (SELECT): mesma condição.

Nota: `current_must_change_password()` é lido pelo `super_admin` da própria linha (policy
`profiles_select_same_tenant` já permite `id = auth.uid()`), então o cliente consegue mostrar a
tela de troca sem depender de RLS adicional.

**M3 — `20250228092000_bootstrap_super_admin.sql`**
Função `public.bootstrap_super_admin(p_user_id uuid)`, `security definer`,
`search_path = public, pg_catalog`, retorna `boolean` (true se converteu, false se já existia um
`super_admin`). Dentro de uma transação:
1. Se já existe qualquer `profiles` com `role = 'super_admin'` → retorna `false` (idempotência,
   RF-01). Não altera nada.
2. Trava o profile de `p_user_id` (`for update`). Se não existir, lança `bootstrap_user_not_found`.
3. Guarda o `tenant_id` atual do profile (criado pelo trigger de cadastro).
4. Atualiza o profile: `role = 'super_admin'`, `tenant_id = null`, `must_change_password = true`.
5. Remove o tenant órfão guardado no passo 3, se ele não tiver outros profiles (o `on delete
   cascade` de `profiles.tenant_id` não é acionado, porque o profile já saiu do tenant no passo 4).
6. Retorna `true`.

Permissões: `revoke all ... from public, anon, authenticated`. Só o service role e o `postgres`
(seed) invocam.

Por que a função cria o `super_admin` a partir do profile e não o insere: o trigger
`on_auth_user_created` já cria tenant e profile para qualquer usuário novo. Transformar o
profile existente evita reescrever o trigger, e a operação inteira fica numa transação só.

**M4 — `20250228093000_clear_must_change_password.sql`**
Função `public.complete_password_change(p_user_id uuid)`, `security definer`, retorna `void`.
Faz `update profiles set must_change_password = false, password_changed_at = now() where id =
p_user_id and must_change_password = true`. Revogada de `public`, `anon`, `authenticated`. Só a
Edge Function `change-password` (service role) invoca, e só depois de a senha ter sido gravada
no Auth.

### 4.3 Seed local (`supabase/seed.sql`, arquivo novo)

Executa só em `supabase db reset` local. Insere o usuário em `auth.users` com a senha padrão
(hash via `crypt`/`gen_salt('bf')` do pgcrypto) e `auth.identities` correspondente, depois chama
`bootstrap_super_admin`. A constante da senha fica só nesse arquivo e no código da Edge Function
bootstrap. O seed não roda em remoto.

Atenção: o seed depende do schema de `auth.users`/`auth.identities` do GoTrue local. Validar
com a CLI na versão do `config.toml` antes de aceitar a entrega.

### 4.4 Matriz de RLS após a demanda

| Tabela | Cliente `super_admin` com flag `true` | Cliente `super_admin` com flag `false` | Cliente `admin`/`professional`/`receptionist` |
|---|---|---|---|
| `profiles` (própria linha) | SELECT | SELECT | SELECT (própria linha e tenant) |
| `profiles` (outras) | nega | SELECT | SELECT (mesmo tenant) |
| `profiles` INSERT/DELETE | nega | nega | nega |
| `profiles` UPDATE (`role`, `tenant_id`, `id`, flag) | nega (trigger) | nega (trigger) | nega (trigger) |
| `profiles` UPDATE (`full_name`) | própria linha | própria linha | própria linha |
| `tenants` SELECT | nega | SELECT (todas) | própria empresa |
| `tenants` UPDATE de cadastro | nega | SELECT/UPDATE de cadastro | só admin, própria empresa |
| `tenants` `subscription_status`/`plan`/`trial_ends_at` | nega (trigger + RLS) | nega (trigger) | nega (trigger) |
| `subscription_status_changes` SELECT | nega | SELECT | nega |
| `subscription_status_changes` escrita | nega | nega | nega |

Os caminhos de escrita de status continuam sendo só o service role (RPC da ADR-01 via
`admin-subscription`), que também recusa o flag `true`.

---

## 5. Edge Functions e contratos

Todas seguem o molde de `admin-subscription`: JWT validado no servidor, papel e identidade lidos
de `profiles` com service role, zod para o corpo, respostas JSON pt-BR, logs curtos sem PII.

### 5.1 `bootstrap-super-admin` (nova)

- **Autenticação:** cabeçalho `Authorization: Bearer <service role key>`, comparado com
  `SUPABASE_SERVICE_ROLE_KEY` em tempo constante. Outro token → 401.
- **Entrada:** nenhuma. O e-mail do bootstrap é constante no servidor. O corpo é ignorado.
- **Fluxo:**
  1. Se já existe `profiles.role = 'super_admin'` → 200 `{ status: 'ja_existe' }`. Não cria nada.
  2. Se existe `auth.users` com o e-mail constante mas o profile não é `super_admin` → 409 pt-BR
     (não sobrescreve nem altera senha).
  3. Senão, cria o usuário com `auth.admin.createUser` (senha constante, `email_confirm: true`),
     chama `bootstrap_super_admin(id)`. Se a RPC falhar, remove o usuário criado (compensação) e
     retorna 500.
- **Resposta:** 200 `{ status: 'criado' }`. Nunca retorna senha, hash, nem id interno além do
  necessário.
- **Log:** `bootstrap: created` ou `bootstrap: skipped` em inglês, sem e-mail nem senha.

### 5.2 `change-password` (nova)

- **Autenticação:** `Authorization: Bearer <JWT do usuário>`. `getUser(token)` no servidor. Sem
  JWT válido → 401.
- **Entrada (zod):**
  - `newPassword`: string, obrigatória, mínimo 8 e máximo 72 caracteres (limite do bcrypt).
  - Recusa, com 400 e mensagem pt-BR, se for igual à senha padrão constante (RF-02).
  - `confirmPassword` é validado no frontend. Não é necessário no servidor.
- **Fluxo:**
  1. Resolve `userId` do JWT. Ignora qualquer `userId` do corpo.
  2. `auth.admin.updateUserById(userId, { password })`.
  3. Se o passo 2 falhar → 500 pt-BR, flag inalterada.
  4. Chama `complete_password_change(userId)`.
  5. Se o passo 4 falhar → 500 pt-BR. O usuário repete a troca com a mesma senha, que é
     idempotente no passo 2.
- **Resposta:** 200 `{ ok: true }`. Sem senha no corpo.
- **Opcional recomendado:** encerrar as outras sessões do usuário após a troca
  (`signOut` com escopo `others`). Não é requisito de aceite, fica registrado como residual.
- **Alternativa descartada:** o cliente chamar `supabase.auth.updateUser` e depois a Edge
  Function só zerar o flag. Rejeitada porque o flag ficaria zerado sem troca efetiva se a
  chamada for forjada. Aqui a função faz as duas coisas no servidor.

### 5.3 `admin-subscription` (existente, alteração)

Depois de resolver a identidade e antes de qualquer operação, recusa com 403 quando o profile
do `super_admin` tem `must_change_password = true`. Mensagem pt-BR com código de erro
`password_change_required`. Nenhuma outra mudança de contrato.

---

## 6. Frontend (superfície, sem código)

| Arquivo | Mudança |
|---|---|
| `src/auth/usePostLoginRedirect.ts` | Lê `role` e `must_change_password` da própria linha. `super_admin` com flag `false` → `/admin/empresas`. Com flag `true` → `/trocar-senha`. Remove o destino `/admin`. |
| `src/auth/TrocarSenhaPage.tsx` (novo) | Formulário react-hook-form + zod (nova senha, confirmação). Chama `change-password` com o JWT da sessão. Sucesso → `/admin/empresas`. Erros em pt-BR. |
| `src/router.tsx` | Rota `/trocar-senha` sob `RequireAuth`, fora dos guards de assinatura. Guard `RequireRole` de `/admin` passa a redirecionar para `/trocar-senha` quando o flag for `true`. |
| `src/types/domain.ts` / `src/types/` | Tipo do profile com `must_change_password`. |
| `src/admin/` | Nenhuma tela nova. As telas existentes passam a depender do bloqueio de RLS e do redirect. |

Os guards de frontend não são barreira de segurança. A barreira é RLS e Edge (§2.3).

---

## 7. Erros e falhas

| Operação | Falha | Recuperável? | Resposta ao chamador | Log |
|---|---|---|---|---|
| `bootstrap_super_admin` | profile do usuário não existe | fatal para o bootstrap | RPC levanta `bootstrap_user_not_found` → Edge 500 | `error` sem PII |
| `bootstrap_super_admin` | já existe super_admin | não é erro | 200 `ja_existe` (Edge) / `false` (RPC) | `info` |
| `bootstrap-super-admin` (Edge) | falha após `createUser` | sim, por compensação | 500, usuário removido | `error` sem PII |
| `bootstrap-super-admin` (Edge) | token não é service role | fatal | 401 | `warn` sem token |
| `change-password` | JWT inválido | fatal | 401 pt-BR | `warn` |
| `change-password` | senha < 8 ou > 72, ou igual à padrão | sim (usuário corrige) | 400 pt-BR com campo | sem log do valor |
| `change-password` | `updateUserById` falha | sim (repetir) | 500 pt-BR | `error` sem PII |
| `change-password` | `complete_password_change` falha após senha gravada | sim (repetir a troca) | 500 pt-BR | `error` sem PII |
| `admin-subscription` | flag `true` | sim (trocar senha) | 403 `password_change_required` | `warn` |
| RLS `super_admin` com flag `true` | leitura cross-tenant | sim (trocar senha) | 0 linhas (sem erro, comportamento de RLS) | nenhum |
| Trigger de `profiles` | cliente tenta mudar coluna protegida | fatal para a operação | erro `privileged_column_change_denied` / 403 do PostgREST | nenhum (evento de segurança recusado, sem dados) |

---

## 8. Critérios de aceite (testáveis)

Ambiente local limpo, `supabase db reset`, Supabase CLI na versão do `config.toml`.

1. **CA-01** Após `db reset`, existe exatamente um `profiles` com `role = 'super_admin'` e
   `must_change_password = true`, com `tenant_id` nulo. Não resta tenant órfão de bootstrap.
2. **CA-02** Rodar `bootstrap-super-admin` duas vezes: a primeira retorna `criado` (ou o seed já
   criou) e a segunda retorna `ja_existe`. Contagem de `auth.users` com o e-mail constante
   permanece 1.
3. **CA-03** Chamar `bootstrap-super-admin` sem service role → 401, e nenhuma linha é criada.
4. **CA-04** Login com a credencial padrão: após o login, o destino é `/trocar-senha`. A rota
   `/admin/empresas` redireciona para `/trocar-senha` (RF-08).
5. **CA-05** Com a sessão do `super_admin` com flag `true`, `select` em `tenants` e em
   `subscription_status_changes` via PostgREST retorna 0 linhas. `select` em `profiles` de outras
   empresas também retorna 0 linhas.
6. **CA-06** `admin-subscription` com a sessão do `super_admin` com flag `true` → 403
   `password_change_required`.
7. **CA-07** `change-password` com senha de 7 caracteres → 400 pt-BR. Com a senha padrão → 400
   pt-BR. Sem JWT → 401.
8. **CA-08** `change-password` com senha válida → 200. Depois: `must_change_password = false`,
   `password_changed_at` preenchido, e login com a nova senha leva a `/admin/empresas`.
9. **CA-09** Login com a senha padrão após a troca → falha (`invalid_credentials`).
10. **CA-10 (negativo, cliente comum)** Um usuário `admin` autenticado executa
    `update profiles set role = 'super_admin' where id = auth.uid()` via PostgREST → erro, e o
    papel permanece `admin`.
11. **CA-11 (negativo, flag)** Um `super_admin` com flag `true` executa
    `update profiles set must_change_password = false` na própria linha → erro, e o flag permanece
    `true`.
12. **CA-12 (negativo, tenant)** Um `admin` executa `update profiles set tenant_id = <outro>` →
    erro.
13. **CA-13 (negativo, insert/delete)** `insert into profiles` e `delete from profiles` pelo
    `super_admin` via cliente → erro (policy `SELECT` apenas).
14. **CA-14** `usePostLoginRedirect` com `super_admin` e flag `false` → `/admin/empresas`; nunca
    `/admin`. Teste unitário do redirect com o mock de sessão.
15. **CA-15 (segredo)** Após `npm run build`, nenhuma ocorrência da senha padrão em `dist/`. Os
    logs das Edge Functions (bootstrap e change-password) em execução local não contêm a senha
    padrão nem a nova senha.
16. **CA-16 (idempotência de migration)** `supabase db reset` roda limpo do zero. Reaplicar as
    migrations novas sobre o banco já migrado não falha (`if not exists`, `drop ... if exists`,
    `create or replace`).
17. **CA-17** Build, typecheck e testes passam (`convencoes-codigo.md`: rodar antes de concluir).
18. **CA-18 (QA visual, Chrome DevTools)** Login do super admin, tela de troca de senha e
    `/admin/empresas` em 390px e 1280px, claro e escuro. Console sem erro.
19. **CA-19** Testes de RLS negativos (CA-05, CA-10 a CA-13) rodam como teste de integração
    automatizado contra o banco local, não só manual.

---

## 9. Testabilidade

- **Unitário:** `usePostLoginRedirect` (destino por papel e flag), validação zod de
  `change-password` (limites e senha padrão), tela `TrocarSenhaPage` (erros de formulário).
- **Integração (Postgres + Auth local):** triggers de `profiles` (CA-10 a CA-13), policies com
  flag `true`/`false` (CA-05), `bootstrap_super_admin` idempotente (CA-01, CA-02),
  `complete_password_change` (CA-08).
- **Integração de Edge Function:** `bootstrap-super-admin` (CA-02, CA-03), `change-password`
  (CA-07, CA-08), `admin-subscription` com flag (CA-06).
- **E2E/visual:** Chrome DevTools (CA-18).

Os caminhos de segurança são testáveis sem UI: os negativos de RLS e de trigger rodam direto no
banco. Por isso a regra vive no banco e não só na tela.

---

## 10. Riscos e residuais (aceitos ou a tratar)

| # | Risco | Tratamento |
|---|---|---|
| R1 | Senha padrão fixa é pública (fica no repositório e no seed). Quem logar antes do dono do ambiente assume a conta de `super_admin` (depois de trocar a senha). | **Aceito** pelo usuário, provisório. Mitigação: rodar `bootstrap-super-admin` no remoto e trocar a senha no mesmo dia da criação. Documentado no código e no PR. Troca para senha aleatória por ambiente antes do beta. |
| R2 | Escalonamento de privilégio por `UPDATE` em `profiles` já existente em `master`. | **Corrigido nesta demanda** (§3, M1). |
| R3 | `profiles_super_admin` `FOR ALL` (escrita cross-tenant de profile). | **Corrigido nesta demanda** (M1, passa a `SELECT`). |
| R4 | Após a troca, sessões antigas (outros dispositivos) continuam válidas. | **Residual**. Recomendado encerrar outras sessões (§5.2). Fica no backlog de hardening. |
| R5 | Admin de tenant não pode mais mudar papel de membros pelo cliente (a trava de `role` vale para todos). | **Intencional**. Nenhuma tela do `master` faz isso. Convite e troca de papel vão para Edge Function quando a feature existir. |
| R6 | Brute force na senha padrão via `/login`. | GoTrue já tem rate limit de login. Confirmar os limites no `config.toml` antes do beta. |
| R7 | Trigger `handle_new_user` cria tenant órfão no bootstrap. | Tratado pela `bootstrap_super_admin` (remove o tenant). Coberto por CA-01. |

---

## 11. Enquadramento no roadmap

- **Feito:** Painel super admin, Fatia 1 (listar empresas, operar `subscription_status`), PR #17
  mergeado em `origin/master`.
- **Esta demanda:** acesso inicial do super admin (bootstrap, troca obrigatória de senha,
  redirect para `/admin/empresas`). Pré-requisito de qualquer uso do `/admin`.
- **Fora desta demanda:** dashboard `/admin`, criação de tenants, senha aleatória por ambiente
  (antes do beta), convite e troca de papel de membros, PIX (Asaas), WhatsApp.

---

## 12. Decisões que o usuário já tomou (preservadas)

- Senha padrão fixa em todos os ambientes, provisória, até o beta.
- Troca obrigatória no primeiro login.
- Destino pós-login do `super_admin`: `/admin/empresas`.
- Um único super_admin inicial, criado por bootstrap idempotente.

## 13. Pontos abertos

Nenhum. A demanda não tem pergunta em aberto. As decisões de design desta análise (§2.3, §2.4,
§5.2, §3) estão justificadas e são reversíveis antes da implementação.
