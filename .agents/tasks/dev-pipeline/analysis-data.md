# Análise de Dados & Segurança: senha e RBAC simplificados (Auth nativo, hook de token, Edge Functions)

Papel: analisador de dados e segurança do dev-pipeline. Define requisitos, critérios de aceite,
modelo de dados, migrations, RLS e a superfície de Edge Functions. Não contém código de aplicação.

Skills: `supabase-multitenant` (modelo, RLS, RBAC). `agenda-scheduling`, `asaas-pix` e
`whatsapp-evolution` não se aplicam: a demanda não toca agenda, cobrança PIX nem disparo.

Fontes lidas: steering (`produto`, `dominio`, `stack`, `seguranca-multitenant`,
`convencoes-codigo`); migrations `20250216090000` a `20250228095100`; ADRs 01 a 15 e `index.json`;
`_shared/super-admin-bootstrap.ts`; `change-password/schemas.ts`; `admin-subscription/index.ts`;
`usePostLoginRedirect.ts`; `supabase/config.toml`. Brain (`project: atlas-agenda`): nota
`senha-e-papel-fora-do-banco-auth-nativo-e-hook`, que já registra esta direção como pendente.

---

## 0. Resposta à pergunta de arquitetura

A pergunta do usuário era se o backend atrapalha mais do que ajuda, e se RBAC deveria sair do
Postgres. A resposta deste documento: sim para as duas partes, com um limite.

- Saem do banco: a regra de senha, a regra de papel de login e a reserva de troca. Essas viraram
  Edge Functions (com service role) e um custom access token hook.
- Ficam no banco: só o isolamento de dados por `tenant_id` (RLS), mais as invariantes de dado
  (`tenant_id` obrigatório para não super admin, `*_cents`, `timestamptz`).
- O backend continua. O que sai é a lógica de estado que estava espalhada em trigger, tabela de
  reserva e policy condicional. Esse estado foi a causa dos 4 dias de loop (ADRs 04 a 10).

## 1. Enquadramento no roadmap

- Fase: MVP (Fase 1). Dentro da fatia "Super Admin" (painel `/admin`, gestão de empresas) e do
  onboarding (cadastro de empresa). Nada da Fase 3 entra (link público, taxa antecipada, métricas).
- Não toca RF de agenda, cobrança ou WhatsApp. Toca RNF03 (isolamento entre empresas), que é
  inegociável, e RF de cadastro (onboarding).
- Dependência: o cadastro de empresa (signup) passa pelo mesmo trigger que o bootstrap usaria. Por
  isso a seção 5 (decisão D1) mexe no cadastro, e não só no fluxo de senha.

## 2. Verificação contra as fronteiras invioláveis

| Regra do projeto | Como o desenho atende |
|---|---|
| RLS em toda tabela de domínio | Nenhuma tabela nova. `profiles` e `tenants` mantêm RLS. |
| `tenant_id` nunca do cliente | `tenant_id` sai de `profiles` (service role no hook e nas Edge Functions). |
| Super admin cross-tenant só por caminho auditado | Policies `super_admin` sem condição de flag, e Edge Functions com service role. |
| RBAC: recepção não lê charges | Não muda. Não há tabela financeira nova. |
| Segredos fora do bundle | Service role, secret do hook, `BOOTSTRAP_SECRET` só em env das Edge Functions. |
| Nunca regra de senha/papel em trigger de `auth.users` | Violada hoje pelo `on_auth_user_created` (cadastro). Resolvida pela decisão D1. |
| Nunca regra de senha/papel em tabela de reserva | Tabela de reserva e colunas de reserva são removidas (migração de limpeza). |
| Nunca apagar tenant nem converter profile de tenant em super admin | Bootstrap cria usuário novo. Nenhum delete de tenant. Compensação só apaga o usuário Auth recém-criado. |
| Edição de migração já aplicada | Nenhuma. Tudo entra em migrações novas (seção 6). |

## 3. Decisões de desenho

Cada decisão tem alternativa descartada e motivo. Todas valem para o desenho novo.

### D-A. Senha: Auth nativo, troca por Edge Function

- Senha fica no Auth (GoTrue). Nenhuma tabela guarda senha, reserva ou prazo.
- A Edge Function `change-password` valida o pedido e faz uma única chamada à API admin:
  `auth.admin.updateUserById(id, { password, app_metadata: { ...atual, must_change_password: false } })`.
  Uma chamada só, então a senha e o flag mudam juntos. Não há estado intermediário para
  reconciliar.
- Descartado: RPC com reserva e token (ADRs 05 a 10). Exigia travas e expiração de 60 s, e o
  loop de revisão veio daí.
- Descartado: troca direto do cliente com `supabase.auth.updateUser`. Ela não limpa o flag, que
  ficaria em `app_metadata` (só o service role escreve ali). O cliente não consegue fazer isso.

### D-B. Flag de troca: `app_metadata.must_change_password`

- Booleano em `auth.users.raw_app_meta_data`. Gravado só pela Admin API (service role).
- O cliente não escreve `app_metadata` (o `updateUser` do cliente só mexe em `user_metadata`). O
  teste de aceite CA-08 confirma isso.
- O flag não vai para o banco. Nenhuma coluna, nenhuma policy lê o flag.
- Leitura: o frontend lê `session.user.app_metadata.must_change_password`. Não há consulta extra.
- Após a troca, o cliente chama `refreshSession()`. Sem isso, o JWT antigo continua com o flag
  `true` até expirar (1 h).

### D-C. Papel e tenant no JWT: custom access token hook como Edge Function HTTP

- Função `custom-access-token` (Edge Function). Ela é configurada em `[auth.hook.custom_access_token]`
  (local) ou no painel do Supabase (hosted). A URI exata deve ser confirmada na versão da CLI
  instalada.
- Entrada: `{ user_id, claims, authentication_method }`, assinada (Standard Webhooks, cabeçalhos
  `webhook-id`, `webhook-timestamp`, `webhook-signature`). A função valida a assinatura com o
  secret do hook antes de qualquer leitura.
- Lê `profiles` com service role e devolve `{ claims: { ...claims, user_role, tenant_id } }`.
  `user_role` é o nome do claim, não `role`. O claim `role` é o papel Postgres (`authenticated`) que
  o PostgREST usa. Sobrescrevê-lo quebra o acesso.
- Sem profile: devolve `user_role: null` e `tenant_id: null`. As rotas do app negam acesso.
- Erro de leitura: responde HTTP 500 com `error`. O Auth recusa o login (falha fechada). Log sem
  e-mail, telefone nem id do usuário, só o código do erro.
- Descartado: hook em PL/pgSQL. Exigiria `grant select on profiles to supabase_auth_admin` e uma
  policy para esse papel. Isso cria exceção de RLS fora do isolamento por tenant, que a regra
  proíbe. A versão HTTP mantém a leitura privilegiada numa Edge Function.
- Custo aceito: uma chamada HTTP extra a cada emissão e renovação de token. O login depende da
  função estar no ar.
- Claims são para roteamento e UX. Autorização de dados continua no RLS (D-E). Operações
  privilegiadas leem o papel de novo em `profiles` com service role, sem confiar só no claim.
- Desatualização: após mudar o papel em `profiles`, o claim fica antigo até o JWT renovar (até 1 h).
  Aceito para o beta (decisão D5).

### D-D. Bootstrap do super admin: Edge Function `bootstrap-super-admin`, idempotente

- O operador chama a função com o cabeçalho `x-bootstrap-secret`. O valor vem de `BOOTSTRAP_SECRET`
  (env da função). O service role fica dentro da função, lido de `SUPABASE_SERVICE_ROLE_KEY`. O
  operador nunca envia service role como bearer.
- Essa escolha reverte a nota do Brain que mandava usar script de operador. O motivo era não expor
  o service role como bearer. Com o secret separado e o service role só no servidor, o motivo cai.
  Atualizar a nota após aprovação.
- `BOOTSTRAP_SECRET` não definido: a função responde 404 (desligada). Depois do uso, o operador
  remove a variável. Comparação do secret em tempo constante.
- Fluxo, reaproveitando `decideBootstrapAction` de `_shared/super-admin-bootstrap.ts`:
  1. Busca o usuário pelo e-mail `admin@neox.com.br` (API admin, paginada).
  2. Sem usuário: `createUser({ email, password: PROVISIONAL_PASSWORD, email_confirm: true,
     app_metadata: { must_change_password: true } })`. Depois insere o profile
     `(id, tenant_id = null, role = 'super_admin')`. Se o insert falhar, remove só o usuário Auth
     recém-criado e responde 500.
  3. Usuário existe como super_admin sem tenant: responde `ja_existe`. Não muda senha nem flag.
  4. Usuário existe com outro papel, ou sem profile: responde 409 `email_com_outro_papel`. Não muda nada.
     Este é o caminho que impede converter profile de empresa em super admin.
  5. Corrida entre duas chamadas: a segunda recebe 422 do `createUser`. A função refaz a decisão uma
     vez, e cai em `ja_existe`.
- Pré-condição: o trigger de cadastro precisa sair antes (D1). Senão o `createUser` do super admin
  também cria uma empresa.
- Senha provisória: `PROVISIONAL_PASSWORD` continua em `_shared/super-admin-bootstrap.ts`, como o
  usuário pediu (fixa até o beta, documentada como provisória). O risco dela fica em D2.

### D-E. RLS: só isolamento por tenant, sem condição de flag

- Helpers `current_tenant_id()` e `current_role_name()` (security definer, `search_path` fixo)
  continuam lendo `profiles`. Motivo: `profiles` é a fonte da verdade. Claim pode estar atrasado.
- Policies de super admin voltam à forma simples por papel, sem `not current_must_change_password()`:
  - `tenants_super_admin_select`, `tenants_super_admin_update_cadastro` (definições de
    `20250227091000`, sem a cláusula de flag).
  - `subscription_status_changes_super_admin` (definição de `20250227090000`, sem flag).
  - `profiles_super_admin` (SELECT, `current_role_name() = 'super_admin'`, de `20250228091500`).
- Escrita de `profiles` pelo cliente: revogada. Não há update, insert nem delete para `anon` nem
  `authenticated`. Não há caminho de edição de perfil hoje (o frontend só faz SELECT). Quando
  houver, entra por Edge Function ou grant de coluna em migração própria.
- Trigger `profiles_guard_privileged_columns` some, porque a revogação de privilégio resolve o
  mesmo problema sem código de banco extra.

### D-F. Concorrência: última escrita vence

- Decisão do usuário. Sem reserva, sem lock, sem tabela de estado.
- Efeito: duas trocas simultâneas podem as duas dar 200. A última senha gravada vale. Como o flag
  é limpo nas duas, nenhum estado fica inconsistente.
- Chamada que chega depois do flag já limpo recebe 409 `password_change_not_required`. O frontend
  trata esse 409 como "já trocada": faz `refreshSession()` e segue para o destino.
- No frontend, o botão de troca fica `disabled` enquanto a mutation estiver em andamento (`isPending`).
  Isso reduz o caso comum (duplo clique).
- Atualização de `app_metadata` lê o objeto inteiro e grava de volta. Entre a leitura e a escrita,
  outra gravação em `app_metadata` se perderia. Hoje só o flag e os campos do provedor existem ali,
  e o único escritor é esta função. Aceito. O teste CA-06 confirma que `provider` e `providers`
  permanecem depois da troca.

### D-G. Validação de entrada e erros

Schemas com zod, `.strict()`, para o corpo de toda Edge Function. Dados vindos de Auth ou de API
externa também passam por schema antes de uso.

| Entrada | Regra | Falha |
|---|---|---|
| `change-password` body | `{ password: string }` apenas (strict). Mínimo 8 caracteres, máximo 72 bytes UTF-8, diferente de `PROVISIONAL_PASSWORD`. | 400 `invalid_body`, `password_too_short`, `password_too_long`, `password_is_initial`. |
| `change-password` estado | JWT válido, `must_change_password === true`. | 401 sem JWT válido. 409 `password_change_not_required` se o flag já está limpo. |
| `change-password` erro do GoTrue | 4xx (ex.: senha fraca reconhecida pelo Auth). | Repassa código estável. 5xx: 503 `auth_indisponivel`. |
| `bootstrap-super-admin` | Header `x-bootstrap-secret`. | 404 se desligado. 401 se o secret não confere. |
| `custom-access-token` | Assinatura Standard Webhooks válida, corpo com `user_id` (uuid). | 401 sem assinatura válida. 500 em erro de leitura. |
| `signup-tenant` body | `email` (formato, máximo 254), `password` (8 a 72 bytes), `trade_name` (2 a 120), `full_name` opcional (2 a 120), `segment` opcional em `barbearia|clinica|salao`. Campos extras recusados. | 400 `invalid_body`. Segmento fora do enum: 400, não cai em nulo silencioso. |
| `signup-tenant` e-mail já existe | Auth recusa o usuário duplicado. | 409 `email_ja_cadastrado`. |
| `signup-tenant` falha da RPC | Erro na transação do banco. | Remove só o usuário Auth recém-criado. 500 `cadastro_falhou`. |
| `admin-subscription` (super admin) | Flag `must_change_password === true` em `app_metadata` lido de `getUser`. | 403 `password_change_required`. |

Log: nunca registrar senha, e-mail, telefone ou id do usuário em texto claro. Registrar código de
erro e nome da operação.

### D-H. Invariantes e quem as aplica

| Invariante | Camada | Motivo |
|---|---|---|
| Só super admin pode ter `tenant_id` nulo | Banco (constraint `profiles_tenant_required_for_non_super` e `profiles_super_admin_sem_tenant`) | Vale para qualquer escrita, inclusive service role, então precisa ser constraint. |
| Papel e tenant de quem cria profile | Edge Function, sob service role | Cliente nunca escolhe. |
| Papel válido | Constraint `check (role in ...)` | Já existe. |
| Escrita de `profiles` pelo cliente | Privilégio (REVOKE) | Sem caminho de escrita, nada a validar. |
| Flag de troca | `app_metadata` gravado só por service role | Dado fora do alcance do cliente. |
| Isolamento entre empresas | RLS com `current_tenant_id()` | Regra de dado, no banco. |

## 4. Modelo de dados

Nenhuma tabela de domínio nova. Mudanças no schema são só remoções e revogações.

### Tabelas afetadas

**`profiles`** (permanece)

| Coluna | Tipo | Nulo | Observação |
|---|---|---|---|
| `id` | uuid | não | PK, FK para `auth.users(id)` on delete cascade. |
| `tenant_id` | uuid | sim | FK para `tenants(id)`. Nulo só para `super_admin`. Índice `profiles_tenant_id_idx`. |
| `role` | text | não | `check (role in ('super_admin','admin','professional','receptionist'))`. |
| `full_name` | text | sim | |
| `created_at` | timestamptz | não | UTC. |

Colunas que a limpeza remove: `must_change_password`, `password_changed_at`,
`password_change_claimed_until` (ADRs 01, 02, 05 a 10).

**`tenants`** (permanece, sem mudança de colunas). Dinheiro em `*_cents` quando houver. Não há
campo monetário nesta mudança.

**`auth.users.raw_app_meta_data`** (não é tabela do projeto, mas é a fonte do flag):
`must_change_password` boolean. Gravado só via Admin API.

**Não existe** tabela de reserva, coluna de token nem tabela de estado de troca.

## 5. Decisões pendentes do usuário (bloqueiam a implementação)

**D1. Cadastro sai do trigger `on_auth_user_created` (recomendado).** Hoje `handle_new_user()`
(última versão em `20250228094100`) roda para todo `insert` em `auth.users`. Ele cria empresa e
profile `admin`, e lê `raw_app_meta_data`. Isso é regra de papel em trigger de `auth.users`, que o
projeto proíbe. Também conflita com o bootstrap: `admin.createUser` do super admin dispararia o
trigger e criaria uma empresa.

- Recomendado: remover o trigger e a função. O cadastro vira a Edge Function `signup-tenant`, que
  cria o usuário Auth e chama a RPC `create_tenant_with_admin` (transação única: tenant + profile
  `admin` + templates de régua via `seed_message_templates`). Se a RPC falhar, só o usuário Auth
  recém-criado é removido. Nenhuma empresa é apagada.
- Impacto no frontend: `useSignUp` troca `supabase.auth.signUp` por chamada a `signup-tenant`, e
  depois faz `signInWithPassword`. `enable_confirmations = false` (já configurado), então não há
  etapa de e-mail.
- Alternativa descartada: manter o trigger e pular o super admin por marcador em `app_metadata`.
  Mantém a regra de papel em trigger, que é justamente o defeito a remover.
- Alternativa descartada: manter `signUp` no cliente e criar a empresa depois. Deixa usuário sem
  profile se a segunda chamada falhar. O ADR-04 original rejeitou isso pelo mesmo motivo.

**D2. Risco residual da senha provisória (aceitar ou exigir mudança).** A senha fica no repositório
e no histórico de conversa. Entre o bootstrap e a troca, quem conhece a senha entra como super admin.
As Edge Functions de admin recusam (403), e o guard do frontend bloqueia as rotas. Mas o cliente
ainda consegue ler via PostgREST as policies `super_admin` (D-E).
Eu não consigo remover esse risco sem a condição de flag na RLS, que o usuário proibiu.
Mitigações: rodar o bootstrap só em ambiente de dev ou beta, trocar a senha no primeiro acesso,
remover `BOOTSTRAP_SECRET` depois de usar. Se for inaceitável, a alternativa é a senha provisória
vir de env (`PROVISIONAL_PASSWORD_ENV`), fora do código. Isso contraria o pedido de senha fixa
documentada no código.

**D3. Limite de criação no `signup-tenant`.** O GoTrue aplica limite de taxa ao cadastro. A
Edge Function não herda esse limite. Sem proteção, dá para criar empresas em volume. MVP sem
limite próprio, com risco registrado. Recomendado para o beta: limite por IP ou captcha.

**D4. Troca voluntária de senha.** `change-password` só aceita quando o flag está ligado. Assim a
função não serve de troca genérica (que pediria a senha atual). Troca voluntária fica fora do MVP.
Confirmar.

**D5. Papel desatualizado no JWT.** Mudança de papel ou de tenant só aparece no claim após a
renovação do JWT (até 1 h). Aceito para o beta. As Edge Functions privilegiadas leem o papel em
`profiles`, então a autorização de operações não depende do claim.

## 6. Migrações

### Migrações aplicadas: não editar

`20250228090000` a `20250228095100` estão aplicadas no banco local. Nenhuma é alterada. A limpeza é
uma migração nova.

### Nova migração de limpeza: `20250301090000_password_rbac_cleanup.sql`

Ordem interna importa. Policies e trigger saem antes das funções que eles usam.

1. Recriar as policies `super_admin` sem a cláusula de flag: `tenants_super_admin_select`,
   `tenants_super_admin_update_cadastro`, `subscription_status_changes_super_admin`,
   `profiles_super_admin` (SELECT). Usar `drop policy if exists` antes.
2. Remover a policy `profiles_update_self_or_admin` (permitia o cliente atualizar a própria linha,
   incluindo `role`).
3. Remover o trigger `profiles_guard_privileged_columns_trg` e a função
   `profiles_guard_privileged_columns()`.
4. Remover as funções de reserva e de flag:
   `claim_password_change(uuid)`, `release_password_change_claim(uuid)`,
   `release_password_change_claim(uuid, timestamptz)`, `finish_password_change(uuid, timestamptz)`,
   `complete_password_change(uuid)`, `current_must_change_password()`. Todas com `drop ... if exists`.
   `bootstrap_super_admin(uuid)` já saiu em `20250228094000`; repetir o `if exists` é inofensivo.
5. Remover as colunas: `profiles.must_change_password`, `profiles.password_changed_at`,
   `profiles.password_change_claimed_until`. Usar `drop column if exists`.
6. Revogar escrita do cliente:
   `revoke insert, update, delete on public.profiles from anon, authenticated;`
7. Se D1 for aprovada: `drop trigger if exists on_auth_user_created on auth.users;` e depois
   `drop function if exists public.handle_new_user();`. Nesta ordem.
8. Não remover `seed_message_templates` nem `seed_template_texts`. Eles são usados pela RPC de
   cadastro e pela régua de templates.

### Migração de cadastro: `20250301090100_signup_tenant_rpc.sql` (se D1 aprovada)

- `create or replace function public.create_tenant_with_admin(p_user_id uuid, p_owner_email text,
  p_trade_name text, p_full_name text, p_segment text) returns uuid`, `security definer`,
  `set search_path = public`.
- Valida `p_segment` contra o enum (`barbearia|clinica|salao` ou nulo) e levanta erro se for inválido.
- Insere `tenants` (plan `individual`, `subscription_status` `trial`, `trial_ends_at = now() + 14 days`,
  `legal_name = p_trade_name`, `segment`). Insere `profiles` (`id = p_user_id`, `role = 'admin'`,
  `tenant_id` do tenant novo). Chama `seed_message_templates(v_tenant_id, p_segment)`.
- Uma transação só. Erro em qualquer passo desfaz tudo.
- `revoke all ... from public, anon, authenticated`. `grant execute ... to service_role`.

### Migrações não criadas

- Nenhuma tabela de reserva. Nenhuma coluna de flag em `profiles`.
- Nenhum `seed.sql` com super admin. O bootstrap é a Edge Function.

### Arquivos fora do banco a remover ou ajustar

- `supabase/tests/change-password-claim.sh`: testa a reserva. Remover.
- `scripts/bootstrap-super-admin.ts`, se existir (ADR-07): remover.
- `supabase/functions/change-password/index.ts`: reescrever para o fluxo de D-A. Manter
  `schemas.ts` (validação de senha), remover `claimRowSchema` e `isDefinitiveAuthRejection`.
- `supabase/functions/admin-subscription/index.ts`: trocar a leitura de
  `profiles.must_change_password` por `user.app_metadata.must_change_password` (já vem em `getUser`).
  O papel continua vindo de `profiles`.

## 7. Edge Functions e configuração

| Função | Auth | Quem chama | Service role | Uso |
|---|---|---|---|---|
| `custom-access-token` | `verify_jwt = false`, assinatura do hook | Auth (hook) | sim, leitura de `profiles` | Claims `user_role`, `tenant_id`. |
| `change-password` | JWT do usuário (default) | Frontend, usuário com flag | sim, `updateUserById` | Troca a senha e limpa o flag. |
| `bootstrap-super-admin` | `verify_jwt = false`, `BOOTSTRAP_SECRET` | Operador (uma vez) | sim | Cria o super admin. |
| `signup-tenant` (se D1) | `verify_jwt = false` | Frontend, visitante | sim, `createUser` e RPC | Cria usuário e empresa. |
| `admin-subscription` | JWT do usuário | Super admin | sim | Bloqueia se o flag está ligado (403). |

`supabase/config.toml`:
- `[auth.hook.custom_access_token]` com `enabled = true` e a URI da função. Valor exato a confirmar
  com a CLI instalada.
- `[functions.custom-access-token]`, `[functions.bootstrap-super-admin]`, `[functions.signup-tenant]`
  com `verify_jwt = false`. Os outros seguem o default.

Variáveis (só em env ou secrets do Supabase, nunca no código nem no bundle):
`SUPABASE_SERVICE_ROLE_KEY` (já injetada nas Edge Functions), `CUSTOM_ACCESS_TOKEN_HOOK_SECRET`,
`BOOTSTRAP_SECRET` (removida após o uso). Nada disso vai para `.env` versionado. Ao ler `.env`, não
ecoar valores.

## 8. Frontend (ADRs 11 a 15): ajustes ao contrato novo

- **ADR-11 (contrato do perfil e função de destino).** Papel e flag vêm da sessão. Schema zod no
  limite: `app_metadata.must_change_password` (boolean, ausente = false) e `user_role` (enum ou
  nulo). Função pura `resolvePostLoginDestination(session)`:
  flag ligada → `/trocar-senha`; `super_admin` → `/admin/empresas`; demais → `from` ou `/app`;
  sem claim → `/app` (os guards negam).
- **ADR-12 (`usePostLoginRedirect`).** Não consulta `profiles`. Lê a sessão. Some a consulta extra
  que o ADR-12 original previa.
- **ADR-13 (mutation de troca).** `useChangePassword` chama `change-password`. Sucesso:
  `refreshSession()`, depois navega para o destino. 409 `password_change_not_required`: mesmo
  caminho. Erros mapeados para pt-BR. Botão `disabled` enquanto `isPending`.
- **ADR-14 (tela `/trocar-senha`).** react-hook-form + zod (senha e confirmação). Acessível (label
  associado, foco visível). Mobile first.
- **ADR-15 (guards).** `RequirePasswordChange` manda qualquer rota para `/trocar-senha` enquanto o
  flag estiver ligado, e tira de `/trocar-senha` quem já trocou. `RequireRole` para `/admin`
  exige `user_role === 'super_admin'`.
- **Cadastro (se D1).** Nova ADR (16) para `useSignUp` chamando `signup-tenant`. Antes de D1 ser
  aprovada, este item fica bloqueado.
- Nova ADR também para o hook (D-C) e para o bootstrap (D-D), porque mudam o contrato do claim e
  do acesso inicial. As ADRs 04 a 10 ficam como superadas, sem edição.

## 9. Testes

Não é teste unitário genérico. É verificação contra o stack local (`supabase start`, `supabase db reset`).

**Integração (banco e Edge Functions)**

- T1: `supabase db reset` aplica tudo do zero. Após reset, não existe função nem coluna da lista da
  seção 6. Nenhuma policy referencia `must_change_password`.
- T2: hook. Requisição sem assinatura válida recebe 401. Com assinatura válida e profile, o token
  final traz `user_role` e `tenant_id`. Claim `role` continua `authenticated`.
- T3: bootstrap. Primeira chamada cria usuário e profile `super_admin` com `tenant_id` nulo. Número
  de empresas não muda. Segunda chamada responde `ja_existe` e não altera senha nem flag. E-mail de
  um admin de empresa retorna 409 e nada muda. `BOOTSTRAP_SECRET` ausente retorna 404.
- T4: troca. Login do super admin com a senha provisória: `app_metadata.must_change_password` é
  `true`. `change-password` com senha válida retorna 200. Após `refreshSession`, o claim vem sem o
  flag. Segunda chamada retorna 409.
- T5: validação. Corpo com campo extra, senha curta, senha acima de 72 bytes e senha igual à
  provisória retornam 400 com o código certo. Sem JWT, 401.
- T6: escrita pelo cliente. Como `authenticated`, `update profiles set role` e
  `update profiles set tenant_id` retornam erro de permissão (zero linhas ou 403). `updateUser`
  com `data: { app_metadata: ... }` não altera o flag nem o papel.
- T7: isolamento. Admin da empresa A não lê linha da empresa B em `tenants`, `profiles` e nas
  tabelas de domínio já existentes. Regressão do RLS atual.
- T8: super admin com flag ligado. `admin-subscription` responde 403 `password_change_required`.
- T9 (se D1): `signup-tenant` cria usuário, empresa e profile `admin` com 5 templates. Forçar falha
  na RPC: nenhuma empresa criada, usuário Auth removido.
- T10: `provider` e `providers` continuam em `app_metadata` após a troca (CA-06).

**Unitários (frontend e funções puras)**

- `resolvePostLoginDestination` nos quatro cenários (flag, super admin, admin, sem claim).
- Mapeamento de erro para pt-BR.
- Botão `disabled` durante a mutation (teste de componente).
- Schemas zod de `change-password`, `signup-tenant` e `custom-access-token`.

**Build e typecheck**: `npm run typecheck` (`tsc -b`), `npm run build`, `npm test` (vitest), todos verdes.

**QA visual (Chrome DevTools MCP)**: login do super admin com a senha provisória, bloqueio em
`/admin`, tela de troca, troca, destino `/admin/empresas`. Em 390 px e 1280 px, tema claro e
escuro. Conferir foco visível, contraste e botão desabilitado durante a chamada.

## 10. Critérios de aceite

| # | Critério | Como verificar |
|---|---|---|
| CA-01 | `supabase db reset` aplica tudo do zero, sem erro. A limpeza remove o que restou de ADRs 01 a 10. | T1 |
| CA-02 | Login do super admin com a senha provisória gera JWT com `user_role = super_admin` e `app_metadata.must_change_password = true`. | T2, T4 |
| CA-03 | Com o flag ligado, todas as rotas do app redirecionam para `/trocar-senha`. | QA visual, teste do guard |
| CA-04 | Troca pela Edge Function limpa o flag. Após `refreshSession`, o login seguinte vai para `/admin/empresas`. | T4, QA visual |
| CA-05 | Usuário comum não altera papel nem tenant por nenhum caminho do cliente. Não altera o flag. | T6 |
| CA-06 | A troca preserva `provider` e `providers` em `app_metadata`. | T10 |
| CA-07 | Botão de troca fica `disabled` durante a chamada. | Teste de componente, QA visual |
| CA-08 | `updateUser` do cliente não grava `app_metadata`. | T6 |
| CA-09 | Bootstrap é idempotente. Não cria empresa. Não converte profile de empresa. Não altera senha de quem já existe. | T3 |
| CA-10 | Super admin com flag ligado recebe 403 em `admin-subscription`. | T8 |
| CA-11 | RLS isola empresas. Admin da empresa A não lê dados da empresa B. | T7 |
| CA-12 | `custom-access-token` recusa requisição sem assinatura válida. Falha de leitura bloqueia o login. | T2 |
| CA-13 | Typecheck, build e testes passam. | Comandos da seção 9 |
| CA-14 | QA visual de login ponta a ponta em 390 px e 1280 px, claro e escuro. | Chrome DevTools MCP |
| CA-15 (se D1) | Cadastro cria empresa, profile `admin` e 5 templates em uma transação. Falha não deixa empresa nem usuário Auth órfãos. | T9 |

## 11. Requisitos rastreados

Requisitos funcionais e não funcionais que este desenho toca (fonte: `prd.md`, `produto.md`):

- Isolamento entre empresas (RNF03, inegociável): RLS, seção 3 D-E.
- RBAC admin, professional, receptionist: sem mudança. A recepção continua sem `charges`.
- Status de assinatura `bloqueado`/`cancelado` (redirecionamento para quitação): não muda, o guard
  de assinatura continua o mesmo.
- LGPD, minimizar PII em log: seção 3 D-G.
- Dinheiro em centavos, tempo em UTC: sem campo novo nesta mudança.

## 12. Fora de escopo

- Troca voluntária de senha (D4).
- Recuperação de senha por e-mail. Já existe fluxo de Auth, sem alteração.
- Papel `professional` e `receptionist` no convite de membros (fora desta fase, conforme a
  migração do cadastro).
- Limite de taxa e captcha no cadastro (D3, registrado).
- Qualquer alteração de agenda, cobrança PIX ou WhatsApp.

## 13. Resposta às pendências já registradas

| ADR | Situação | Destino |
|---|---|---|
| ADR-01 (colunas `must_change_password`, `password_changed_at`) | Conflita: flag agora fica em `app_metadata`. | Removida pela limpeza. |
| ADR-02 (trigger que protege colunas de `profiles`) | Conflita: trigger de guarda substituído por REVOKE. | Removida pela limpeza. |
| ADR-03 (RLS bloqueada por flag) | Conflita: a condição de flag sai da RLS. | Removida. A parte útil (`profiles_super_admin` só SELECT) é mantida sem flag. |
| ADR-04 a ADR-10 (reserva, conversão, salvaguardas, RPC com travas) | Substituídas. | Arquivadas em `_anteriores/`. Sem edição. |
| ADR-11 a ADR-15 (frontend) | Mantidas, com ajuste ao contrato novo. | Seção 8. |
| ADR-10 (suíte de integração de segurança) | Reaproveitada como ponto de partida dos testes T1 a T10. | Seção 9. |
| Testes de fronteira já escritos | Os de isolamento entre empresas seguem válidos. Os de reserva saem. | Seção 6 e 9. |

## 14. Itens do usuário que este documento precisa cobrir

- Auth nativo para senha: D-A.
- Troca pela Edge Function com API admin: D-A.
- Papel e tenant no JWT via custom access token hook: D-C.
- Bootstrap do super admin por Edge Function com service role, idempotente: D-D.
- RLS só para isolamento: D-E.
- Flag de troca em `app_metadata`, gravado só pelo service role: D-B.
- Senha provisória fixa até o beta, documentada como provisória: D-D e D2.
- Troca obrigatória no primeiro login: D-B e CA-03.
- Última escrita vence, sem reserva nem lock: D-F.
- Botão de troca desabilitado durante a chamada: D-F e CA-07.
- `db reset` aplica tudo, e a limpeza remove o restante: seção 6 e CA-01.
- Login leva a `/admin/empresas` após a troca: CA-04.
- Usuário comum não altera papel nem flag: CA-05.
- QA visual em 390 px e 1280 px, claro e escuro: seção 9 e CA-14.
- Testes de integração, build e typecheck: seção 9 e CA-13.
