# Análise de Dados & Segurança: bootstrap do super admin sem conversão (opção A)

Papel: ANALISADOR DE DADOS E SEGURANÇA do dev-pipeline. Este documento define requisitos,
critérios de aceite, modelo de dados, migrations, políticas RLS e a superfície de Edge Functions
e scripts. Não contém código de aplicação.

Skills ativadas: `supabase-multitenant` (modelo, RLS, RBAC) e `prompt-optimizer` (gate da demanda).
`agenda-scheduling`, `asaas-pix` e `whatsapp-evolution` não se aplicam: a demanda não toca agenda,
cobrança nem disparo.

Fontes lidas: `.kiro/steering/produto.md`, `dominio.md`, `stack.md`, `seguranca-multitenant.md`,
`convencoes-codigo.md`; migrations `20250216090000` a `20250228092400`; ADRs 01 a 15 e `index.json`;
`prd.md`; `supabase/functions/admin-subscription`; brain (`project: atlas-agenda`) com as notas
`auth-flag-controle-acesso-fora-user-metadata`, `super-admin-nao-nasce-como-admin-de-tenant` e
`acesso-inicial-super-admin`.

Base: branch `feat/adr-01-password-gate`, HEAD `0225d19`. Não usa `origin/master`. O texto antigo
do PRD que cita `origin/master` 61a8543 não vale mais, por decisão do usuário.

---

## 1. Resumo

O super admin inicial `admin@neox.com.br` passa a nascer direto na plataforma: `auth.users` criado
pelo service role com `app_metadata.bootstrap_role = 'super_admin'`, e o trigger `handle_new_user`
cria só o profile `super_admin` com `tenant_id = null` e `must_change_password = true`. Nenhum
tenant é criado, nenhum profile de tenant é convertido, nenhuma linha é apagada.

O mecanismo da ADR-04 (`bootstrap_super_admin`, conversão de profile) sai. A função é removida por
migration nova. As migrations `20250228092000` a `20250228092300` não são editadas e, pelo motivo
do §8.1, continuam no repositório.

**Valor de negócio:** a plataforma precisa de um operador com acesso ao `/admin`. Sem isso, a
Fatia 1 do painel (PR #17, listar empresas e operar `subscription_status`) não é usável em nenhum
ambiente. Esta entrega é pré-requisito da operação, não funcionalidade de cliente final.

**Enquadramento no roadmap:** pertence ao painel super admin, que é uma área de operação da
plataforma. Não entra em Fase 1 de cliente final (agenda, cobrança, WhatsApp) nem na Fase 3
(autoagendamento, métricas). Depois desta entrega, o painel segue com a criação de tenants e o
dashboard `/admin`, ambos fora desta demanda.

**Ponto de atenção:** a senha fixa é uma credencial pública no repositório. Ver §8.2. O usuário
decidiu mantê-la até o beta; o risco fica registrado e tem uma trava operacional (§5.3).

---

## 2. Estado atual relevante (verificado no código)

| Item | Situação |
|---|---|
| `handle_new_user()` | Última versão em `20250225091000_segment_seed_templates.sql`. Cria tenant trial, profile admin e 5 `message_templates` via `seed_message_templates`. Trigger `on_auth_user_created` após insert em `auth.users`. |
| `profiles` | Colunas `must_change_password` e `password_changed_at` já existem (`20250228090000`). Constraint `profiles_tenant_required_for_non_super`: só exige tenant para não-super_admin. |
| Guard de colunas | `profiles_guard_privileged_columns()` (`091500`, revisada em `091700`) barra UPDATE de `id`, `role`, `tenant_id`, `must_change_password`, `password_changed_at` quando `auth.role() = 'authenticated'`. Revogado de `public/anon/authenticated`. |
| Policies de super_admin | `tenants_super_admin` (FOR ALL) foi removida pela `20250227091000`. As restantes são `tenants_super_admin_select` e `tenants_super_admin_update_cadastro` (ambas com `not current_must_change_password()`), `subscription_status_changes_super_admin` (SELECT, gated) e `profiles_super_admin` (SELECT, gated). Nenhuma tabela operacional tem policy `*_super_admin`. |
| Conversão da ADR-04 | `bootstrap_super_admin(uuid)` existe no banco local (`092000` a `092300`). Nenhum código de `src/` nem de `supabase/functions/` a chama. Só aparece em migrations e ADRs. |
| Seed functions | `seed_template_texts(text)` (criada em `092200`) e `seed_message_templates(uuid, text)` (reescrita em `092200`, revogada de `authenticated` em `092300`) são usadas pelo trigger. Não fazem parte da conversão. |
| `admin-subscription` | Edge Function com service role. Hoje não checa `must_change_password`. Ver ADR-09. |
| Pendentes | ADR-05 (RPC `complete_password_change`), ADR-08 (Edge `change-password`), ADR-09 (gate em `admin-subscription`), ADR-10 (suíte de integração), ADR-11 a 15 (frontend). Nenhuma foi implementada. |
| Testes | `vitest.config.ts` inclui só `src/**`. Não há `tests/integration/`. |
| Ferramentas locais | Supabase CLI 2.121.0 e Docker disponíveis. `auth-js` 2.46.1 aceita `app_metadata` em `admin.createUser`. |
| Árvore de trabalho | Há alterações não commitadas de pipelines anteriores (`analysis-data.md`, `prd.md`, etc.). Não foram tocadas além deste documento. |

---

## 3. Decisões e alternativas

### 3.1 Onde o marcador de bootstrap é lido: `raw_app_meta_data`

Escolhido: o trigger lê `new.raw_app_meta_data->>'bootstrap_role'`. Esse campo só é gravado pelo
servidor (service role via Admin API). O cliente não consegue escrevê-lo: `signUp` não aceita
`app_metadata`, `updateUser` grava só `user_metadata`, e `authenticated` não tem grant em
`auth.users`.

Alternativa descartada: `raw_user_meta_data`. O próprio usuário edita esse campo com `updateUser`,
então qualquer usuário criaria um super_admin.

Alternativa descartada: inserir o usuário direto por SQL em `auth.users`. Exige replicar o hash de
senha e as identidades do GoTrue, depende do schema interno do Auth e não passa pela Admin API.

### 3.2 Marcador lido só em INSERT

O trigger continua `after insert on auth.users`. Alterar `app_metadata` depois do cadastro não
dispara nada. Um usuário de tenant nunca vira super_admin por mudança de marcador, porque não há
trigger de UPDATE em `auth.users`.

### 3.3 Caminho server-side de criação: script Deno, não Edge Function

Escolhido: um script de operador `scripts/bootstrap-super-admin.ts`, executado em Deno com
`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` vindos do ambiente do operador.

Motivo: o script não cria endpoint HTTP público. O bootstrap é um comando único, e uma Edge
Function exporia uma rota que aceita service role como bearer, com a chave viajando em cada
chamada. O script usa o mesmo runtime Deno das Edge Functions, então a constante de senha pode
viver em um único arquivo compartilhado: `supabase/functions/_shared/super-admin-bootstrap.ts`.

Alternativa descartada: `seed.sql` com insert em `auth.users`. Não roda em `supabase db push` para
remoto, depende do schema interno do GoTrue e duplicaria o mecanismo. O `db reset` local fica sem
super_admin até o operador rodar o script, o que é aceitável (§8.3).

Trade-off: o operador precisa de Deno instalado. Se o usuário preferir Edge Function, o contrato
de §5 continua valendo. Só muda a superfície.

### 3.4 Flag de troca obrigatória: coluna em `profiles`

Escolhido: `profiles.must_change_password`, já existente e protegida pelo guard. Nunca
`user_metadata`, que o usuário edita.

### 3.5 Remoção da conversão: função dropada por migration nova

`drop function if exists public.bootstrap_super_admin(uuid)`. As migrations antigas ficam como
histórico. Motivo em §8.1.

### 3.6 Senha: constante fixa em código, com trava de ambiente

Mantido por decisão do usuário: senha fixa, provisória, igual em todos os ambientes até o beta. A
constante vive só em `supabase/functions/_shared/super-admin-bootstrap.ts`, com comentário que diz
que precisa ser trocada antes do beta. O script recusa executar contra URL que não seja
`localhost`/`127.0.0.1` sem a flag explícita `--allow-remote`. Essa flag exige ação consciente do
operador (§8.2).

---

## 4. Requisitos

### 4.1 Funcionais

- **RF-01** Um usuário criado no Auth com `app_metadata.bootstrap_role = 'super_admin'` gera um
  profile com `role = 'super_admin'`, `tenant_id = null`, `must_change_password = true`, e nenhum
  tenant novo.
- **RF-02** Um usuário criado por cadastro comum (sem marcador) continua gerando tenant trial,
  profile `admin` e 5 `message_templates`, como hoje.
- **RF-03** O script de bootstrap cria o usuário `admin@neox.com.br` com senha padrão e
  `email_confirm = true`. Se o e-mail já existir como super_admin, não altera nada. Se existir com
  outro papel, recusa e não altera nada.
- **RF-04** A senha padrão nunca é regravada para usuário existente. O script não chama
  `updateUserById` com senha.
- **RF-05** O super_admin com flag ligado não lê dados de outras empresas pelo cliente e não
  aciona `admin-subscription` (RLS já cobre leitura; ADR-09 cobre a Edge).
- **RF-06** `change-password` (ADR-08) grava a nova senha no Auth e depois zera o flag via
  `complete_password_change` (ADR-05), nessa ordem.
- **RF-07** Após a troca, o flag é `false`, `password_changed_at` é preenchido, e o login leva a
  `/admin/empresas` (frontend, ADR-12).

### 4.2 Não funcionais

- **RNF-01** Nenhum caminho do cliente altera `role`, `tenant_id`, `id`, `must_change_password`
  ou `password_changed_at`, nem cria/remove profile.
- **RNF-02** Marcador de bootstrap e senha padrão não aparecem em log, em resposta de API nem no
  bundle do frontend.
- **RNF-03** Script idempotente: N execuções produzem o mesmo estado que uma.
- **RNF-04** Timestamps em `timestamptz` UTC. Nenhum valor monetário nesta entrega.

### 4.3 Fora de escopo

- Criação de tenants pelo painel, dashboard `/admin`, convite de membros de tenant.
- Senha aleatória por ambiente (fica para antes do beta, com trava de §8.2).
- Encerrar sessões antigas após a troca (residual, PRD R4).
- Limpeza de tenants órfãos de testes anteriores (decisão: não apagar tenant).

---

## 5. Critérios de aceite testáveis

Cada critério indica como é verificado. "Int" é teste de integração contra o stack local
(`supabase start`, Docker). "Unit" é teste de função pura ou com cliente mockado.

**CA-01 Trigger sem tenant para o marcador.** Dado `auth.admin.createUser` com
`app_metadata: { bootstrap_role: 'super_admin' }`, então `profiles` tem uma linha com
`role = 'super_admin'`, `tenant_id is null`, `must_change_password = true`. Contagem de `tenants`
e de `message_templates` não muda. (Int)

**CA-02 Cadastro comum inalterado.** Dado `auth.signUp` sem marcador, então há um tenant `trial`,
um profile `admin` com o tenant, `must_change_password = false`, e 5 `message_templates` do
tenant. (Int)

**CA-03 Cadastro não cria super_admin.** Dado `auth.signUp` com `options.data.bootstrap_role =
'super_admin'`, o marcador vai para `user_metadata`, não para `app_metadata`. O resultado é o
do CA-02, com `role = 'admin'`. (Int)

**CA-04 Cliente não altera marcador.** Dado usuário autenticado, `auth.updateUser({ data: {
bootstrap_role: 'super_admin' } })`, então `raw_app_meta_data` do usuário (lido com service role)
não muda, e `role` continua `admin`. (Int)

**CA-05 Cliente não altera flag nem papel.** Dado sessão autenticada de super_admin, de admin e de
professional, `update profiles set must_change_password = false`, `set role = ...`, `set tenant_id
= ...`, `set password_changed_at = now()` falham com `privileged_column_change_denied`. Valores
inalterados. (Int)

**CA-06 Cliente não cria nem apaga profile.** `insert` e `delete` em `profiles` por sessão
autenticada de qualquer papel são negados por RLS (sem policy). (Int)

**CA-07 Script cria o super_admin.** Primeira execução com ambiente limpo retorna status `criado`.
Depois: 1 usuário com o e-mail, 1 profile `super_admin`, `tenant_id` nulo, flag `true`. (Int)

**CA-08 Script idempotente.** Segunda execução retorna `ja_existe`, exit 0. Contagem de usuários
com o e-mail continua 1. Login com a senha padrão continua funcionando e o `user.id` é o mesmo.
(Int)

**CA-09 Script recusa usuário existente com outro papel.** Com `admin@neox.com.br` existente como
`admin` de tenant, o script sai com código diferente de zero, mensagem pt-BR, e nada muda
(profile, tenant, senha). (Int)

**CA-10 Script recusa URL remota sem a flag.** Com `SUPABASE_DB_URL` não local e sem `--allow-remote`,
o script sai com erro antes de qualquer chamada de rede. (Unit)

**CA-11 Segredos fora da saída.** Saída do script (stdout, stderr) e respostas de `change-password`
não contêm a senha padrão, a service role key nem o marcador `bootstrap_role`. Verificado por
busca literal no output capturado. (Int)

**CA-12 Login e painel bloqueado.** Login com a senha padrão retorna sessão. Com flag `true`:
`select` em `tenants` de outra empresa retorna 0 linhas; `admin-subscription` retorna 403 com
`password_change_required`. (Int)

**CA-13 Troca de senha.** `change-password` sem JWT → 401. Senha com 7 caracteres → 400 pt-BR.
Senha igual à padrão → 400. Corpo com campo extra → 400. Usuário sem flag → 409. Senha válida →
200; depois flag `false`, `password_changed_at` preenchido, login com senha nova ok, login com a
padrão falha. (Int)

**CA-14 Após a troca, leitura liberada.** Com flag `false`, o super_admin lê linhas de `tenants` de
outras empresas. (Int)

**CA-15 Banco do zero.** `supabase db reset` aplica todas as migrations sem erro. Depois
`to_regprocedure('public.bootstrap_super_admin(uuid)')` retorna null. (Int, manual)

**CA-16 RLS ligado.** `relrowsecurity = true` para `profiles` e `tenants`, e para toda tabela de
domínio. (Int)

**CA-17 Constraint de super_admin sem tenant.** Insert de profile `super_admin` com `tenant_id`
preenchido é rejeitado pelo banco. (Int, depende da aprovação de §6.3)

**CA-18 Build e typecheck.** `npm run typecheck` e `npm run build` passam. `vitest` roda a suíte
de unidade. Suíte de integração roda via config própria (`vitest.integration.config.ts`, ADR-10).

---

## 6. Modelo de dados e migrations

### 6.1 Tabelas

Nenhuma tabela nova. Nenhuma coluna nova. Todas as colunas usadas já existem:

- `profiles`: `id`, `tenant_id` (nullable para super_admin), `role`, `full_name`, `created_at`,
  `must_change_password`, `password_changed_at`.
- `tenants`: sem alteração.

### 6.2 Migrations desta entrega, em ordem

| Ordem | Arquivo | Conteúdo | Status |
|---|---|---|---|
| 1 | `20250228093000_complete_password_change.sql` | RPC `complete_password_change(p_user_id uuid) returns boolean`. `security definer`, `search_path = public, pg_catalog`. Zera a flag e preenche `password_changed_at` onde `must_change_password = true`. Retorna `true` se alterou a linha, `false` se a flag já era `false` ou o perfil não existe (não altera `password_changed_at` nesse caso). Grant só para `service_role`. | ADR-05 (incluída porque CA-13 depende dela) |
| 2 | `20250228094000_drop_bootstrap_super_admin.sql` | `drop function if exists public.bootstrap_super_admin(uuid)`. Nenhuma outra alteração. | Nova |
| 3 | `20250228094100_handle_new_user_bootstrap_marker.sql` | `create or replace function handle_new_user()`. Copia fielmente o corpo de `20250225091000`. Antes de qualquer insert, se `coalesce(new.raw_app_meta_data, '{}'::jsonb)->>'bootstrap_role' = 'super_admin'`, insere só o profile (`role = 'super_admin'`, `tenant_id = null`, `full_name = null`, `must_change_password = true`) e retorna `new`. Sem tenant, sem `seed_message_templates`. O trigger `on_auth_user_created` não é recriado. | Nova |
| 4 | `20250228094200_profiles_super_admin_sem_tenant.sql` | `alter table profiles add constraint profiles_super_admin_sem_tenant check (role <> 'super_admin' or tenant_id is null)`. Se houver linha que viole, o `add constraint` falha alto. | Proposta, depende de §6.3 |

Ordem de execução do `db reset`: 093000 precisa existir antes de qualquer teste de troca. A 094100
depende das seed functions de `092200` e `092300`, já aplicadas. A 094000 é independente.

Regras de migration:
- Nenhuma migration aplicada é editada (`20250228092000` a `20250228092400`, `20250228091500`,
  `20250228091700`, `20250228091800`).
- Nomes com timestamp único. Nenhum dinheiro. Nenhum segredo no SQL. Nenhuma senha no SQL.
- Idempotência: `create or replace`, `drop ... if exists`.

### 6.3 Constraint de super_admin sem tenant (proposta)

Hoje `profiles_tenant_required_for_non_super` só obriga tenant nos outros papéis. Nada no banco
impede um `super_admin` com `tenant_id` preenchido, caso alguém use service role para isso. A
regra do produto diz que super_admin não tem tenant. A constraint da migration 4 torna isso um
invariante de banco. Como o banco não tem super_admin com tenant em nenhum ambiente conhecido,
o risco de aplicar é baixo. Precisa de aprovação (§8.4).

---

## 7. RLS, RBAC e fronteiras

### 7.1 Políticas que ficam como estão (verificadas)

| Tabela | Policy | Regra | Observação |
|---|---|---|---|
| `profiles` | `profiles_select_same_tenant` | `id = auth.uid()` ou mesmo tenant | Permite o frontend ler a própria flag. |
| `profiles` | `profiles_update_self_or_admin` | USING: próprio ou admin do tenant. WITH CHECK: mesmo tenant ou super_admin | Guard de colunas barra papel, tenant, flag. |
| `profiles` | `profiles_super_admin` (SELECT) | `current_role_name() = 'super_admin' and not current_must_change_password()` | Bloqueio por flag. |
| `tenants` | `tenants_select_own` | `id = current_tenant_id()` | Super_admin com flag `false` lê via policy gated abaixo. |
| `tenants` | `tenants_super_admin_select` | super_admin e flag `false` | Bloqueio por flag. |
| `tenants` | `tenants_super_admin_update_cadastro` | super_admin e flag `false` (USING e WITH CHECK) | Bloqueio por flag. |
| `subscription_status_changes` | `subscription_status_changes_super_admin` (SELECT) | super_admin e flag `false` | Bloqueio por flag. |

Não há INSERT nem DELETE para clientes em `profiles` nem em `tenants`. O cadastro usa o trigger
(security definer, dono `postgres`), e o bootstrap usa o service role via Admin API.

### 7.2 Quem enforça cada invariante

| Invariante | Camada | Por quê |
|---|---|---|
| Marcador só do servidor | Supabase Auth (Admin API) e ausência de grant de `authenticated` em `auth.users` | Nenhum caminho do cliente escreve `app_metadata`. |
| Trigger ignora `user_metadata` para papel | Banco (trigger lê só `raw_app_meta_data`) | O banco é a única camada que o cliente não contorna. |
| Super_admin sem tenant | Banco (trigger e constraint da §6.3) | Invariante de dados, não de tela. |
| Flag e papel não mudam pelo cliente | Banco (guard `profiles_guard_privileged_columns`) | Vale para qualquer cliente, inclusive API direta. |
| Painel bloqueado até a troca (leitura) | Banco (RLS com flag) | Vale para PostgREST, que usa a sessão do cliente. |
| Painel bloqueado até a troca (escrita pela Edge) | Edge `admin-subscription` (ADR-09) | Service role ignora RLS, então a checagem precisa estar na função. |
| Troca só com senha gravada | Edge `change-password` (ordem: Auth, depois RPC) | O flag só cai depois da senha nova. |
| Idempotência do bootstrap | Script (checagem prévia) e Auth (e-mail único) | Corrida entre duas execuções cai no `email_exists` e é reconsultada. |

Nenhum tenant é lido nem escrito a partir de parâmetro do cliente. O `tenant_id` do super_admin é
nulo por construção. As Edge Functions derivam o usuário do JWT, nunca do corpo.

### 7.3 RBAC

- `super_admin`: sem tenant. Acesso cross-tenant só com flag `false` e pelo caminho auditado.
- `admin`, `professional`, `receptionist`: sem mudança nesta entrega. O bootstrap não cria nenhum
  desses papéis.

---

## 8. Riscos, decisões do usuário e pontos em aberto

Os pontos levantados pelo usuário estão listados aqui. Nenhum foi descartado.

### 8.1 Remoção das migrations 092000 a 092300 (conflito com o pedido)

O pedido manda remover as migrations `20250228092000` a `20250228092300`. Não é seguro apagar os
arquivos:

- `20250228092200` define `seed_template_texts(text)`, e `seed_message_templates(uuid, text)` passou
  a depender dela. O trigger `handle_new_user` chama `seed_message_templates`. Apagar o arquivo
  quebra o `supabase db reset` do zero.
- `20250228092300` revoga o `EXECUTE` das seed functions de `authenticated` (achado B-3, vazamento
  de `p_tenant_id`). Apagar o arquivo reabre o vazamento.
- As migrations já estão aplicadas no banco local. Apagar o arquivo cria divergência entre o
  histórico do CLI e o repositório.

**Proposta:** manter os arquivos como histórico e remover só a função, por migration nova (`94000`).
O comentário de `092000` sobre o tenant órfão já está superado por `092100`. Nada é editado.
**Precisa de confirmação do usuário.**

### 8.2 Senha fixa: risco de takeover em ambiente público

Supabase Auth é público. A senha padrão está no repositório. Se o bootstrap rodar num ambiente
acessível pela internet antes da troca, quem conhece a senha entra como super_admin. Com a flag
ligada, o atacante ainda pode chamar `change-password`, que aceita o usuário com flag `true`, e
trocar a senha para a dele. Nesse caso o flag não protege nada.

Decisão do usuário: manter a senha fixa até o beta. Tratamento desta análise:
- O script recusa qualquer URL fora de `localhost`/`127.0.0.1` sem `--allow-remote` (CA-10).
- Nenhuma execução remota é feita nesta entrega. O bootstrap remoto é decisão separada, com o
  usuário no comando.
- Antes do beta: senha por ambiente vinda de env ou gerada, e troca obrigatória com prazo.
**Precisa de aceite explícito do usuário para qualquer execução remota.**

### 8.3 Limpeza do banco local

Se o `admin@neox.com.br` já existe localmente como `admin` de tenant (de tentativas da ADR-04), o
script recusa (CA-09). A limpeza natural é `supabase db reset`, que apaga os dados locais. Não há
delete de tenant por código. **Precisa de OK do usuário**, porque o reset apaga dados locais de
teste.

### 8.4 Constraint da migration 4

Torna super_admin sem tenant um invariante de banco. **Precisa de aprovação.**

### 8.5 Escopo do que depende desta entrega

O CA-12 e o CA-13 exigem ADR-05, ADR-08 e ADR-09. O CA-14 exige o caminho de troca. O redirect para
`/admin/empresas` exige ADR-11 a 15 (frontend, em `analysis-frontend.md`). Proposta: incluir
ADR-05, ADR-08 e ADR-09 neste branch, e tratar o frontend como parte da mesma entrega, para que o
critério de login completo seja verificável. **Precisa de confirmação.**

### 8.6 Demais riscos

- Sessões antigas do super_admin continuam válidas após a troca (PRD R4, residual).
- Usuário sem flag e sem papel é tratado como "não precisa trocar". Isso é o comportamento
  esperado para tenant, mas só é seguro enquanto só o bootstrap liga a flag.
- Recurso `listUsers` pagina. Com poucos usuários, uma página de 1000 basta. Documentado no script.
- O script exige Deno instalado no operador (§3.3).

---

## 9. Erros por operação

| Operação | Falha | Recuperável? | O que o chamador recebe | Log |
|---|---|---|---|---|
| Trigger (insert em `auth.users`) | Insert em `profiles` falha | Fatal para o cadastro: a transação do Auth faz rollback, sem usuário órfão | Erro do `createUser` / `signUp` | Postgres log (erro do banco, sem e-mail) |
| Script: `createUser` | `email_exists` (corrida) | Recuperável: reconsulta e segue | Status `ja_existe` se o usuário é super_admin; erro pt-BR se não | Nível info, sem e-mail |
| Script: `createUser` | Outro erro (rede, 5xx) | Recuperável: nova execução | Exit != 0, mensagem pt-BR | Nível erro, sem segredo |
| Script: verificação pós-criação | Profile não é `super_admin` com tenant nulo e flag true | Fatal para a execução | `deleteUser` como compensação (usuário novo, sem dados), exit != 0 | Nível erro |
| Script: usuário existe com outro papel | Recusa | Manual | Exit != 0, mensagem pt-BR pedindo resolução manual | Nível aviso, sem e-mail |
| Script: URL remota sem flag | Recusa antes da rede | Manual | Exit != 0 | Nível erro |
| `change-password`: JWT inválido | 401 | Sim | 401 pt-BR | Nível info |
| `change-password`: validação zod | 400 | Sim | 400 pt-BR, sem eco da senha | Nível info, sem senha |
| `change-password`: flag `false` | 409 `password_change_not_required` | Sim | 409 | Nível info |
| `change-password`: `updateUserById` falha | Senha não gravada | Sim, repetir | 500 pt-BR, flag intacta | Nível erro, sem senha |
| `change-password`: RPC falha após senha gravada | Flag continua `true` | Sim, repetir (senha repetida é aceita) | 500 pt-BR | Nível erro, sem senha |
| `admin-subscription` com flag `true` | Bloqueio | Sim, após troca | 403 `password_change_required` | Nível info |

Validação de entrada externa:
- `change-password`: corpo `.strict()` (zod), só `newPassword`. Tipo string. Mínimo 8 caracteres,
  máximo 72 bytes UTF-8. Diferente da constante padrão. Qualquer outra chave gera 400.
- Script: `SUPABASE_URL` obrigatória, `https` ou `http://localhost`/`127.0.0.1`.
  `SUPABASE_SERVICE_ROLE_KEY` obrigatória, não vazia. A flag `--allow-remote` é a única forma de
  apontar para remoto.
- Resposta de `listUsers`: só `id` e `email` são lidos, com checagem de tipo.

---

## 10. Testes

### 10.1 Unidade (`vitest`, `tests/unit` ou `src/**`)

- Validação zod de `newPassword` (limites de 7, 8, 72 e 73 bytes; igual à padrão; campo extra).
- Função pura que decide o resultado do script a partir do estado lido (`criado`, `ja_existe`,
  recusa por papel, recusa por URL remota). Cliente mockado.
- Constante padrão: presença do comentário de provisoriedade (verificação de código, opcional).

### 10.2 Integração (`vitest.integration.config.ts`, stack local com Docker)

- CA-01 a CA-06, CA-07 a CA-09, CA-11 a CA-14, CA-16, CA-17.
- Setup: `supabase db reset` antes da suíte. Usuários de teste criados por Admin API e por
  `signUp`, com limpeza ao final.
- Chamadas HTTP às Edge Functions com `supabase functions serve` (ou com a URL local).

### 10.3 Manual / CI

- CA-15 (`supabase db reset` do zero) e CA-18 (build e typecheck). Ambos rodam no CI ou localmente.

Não escrever testes que dependam de ordem entre casos. Cada caso cria e limpa o próprio usuário.

---

## 11. Dependências e ordem de entrega

1. Confirmações de §8 (migration 092000 a 092300, senha, limpeza local, constraint, escopo).
2. Migrations 1 a 4 (§6.2), com `supabase db reset` verde.
3. Constante compartilhada `_shared/super-admin-bootstrap.ts` e script `scripts/bootstrap-super-admin.ts`.
4. Edge `change-password` (ADR-08) e gate em `admin-subscription` (ADR-09).
5. Suíte de integração (ADR-10) cobrindo CA-01 a CA-17.
6. Frontend (ADR-11 a 15), conforme `analysis-frontend.md`.
7. Atualizar `adr/index.json`: ADR-04, ADR-06 e ADR-07 passam a `superseded` (conversão e seed
   removidos). Esta análise não altera o índice.
8. Branch nova a partir de `feat/adr-01-password-gate` (HEAD `0225d19`), PR.

---

## 12. Enquadramento no roadmap e mapa de decisões

- Painel super admin: Fatia 1 (PR #17) é pré-requisito. Esta entrega destrava o acesso.
- Fase 1 do produto (agenda, cobrança, WhatsApp) não é afetada.
- Fase 3 (autoagendamento, métricas) não é afetada.

Mapa das decisões do usuário nesta conversa:

| Decisão | Onde está nesta análise |
|---|---|
| Opção A: super_admin criado direto, sem tenant | §1, §3, §6.2 |
| Conversão da ADR-04 descartada | §3.5, migration 2 |
| Tenant órfão e remoção condicional descartados, sem delete de tenant | §4.3, §8.3 |
| Marcador em `raw_app_meta_data`, flag em `profiles` | §3.1, §3.4 |
| Senha padrão fixa até o beta, com comentário de troca | §3.6, §8.2 |
| Troca obrigatória no primeiro login | §4.1 RF-06, CA-12, CA-13 |
| Redirect para `/admin/empresas` | §4.1 RF-07, §8.5 |
| `admin@neox.com.br` como identificador | §4.1 RF-03 |
| Entrega em branch nova com PR | §11 item 8 |

---

## 13. Respostas às decisões em aberto

Este documento não resolve sozinho os pontos de §8. Eles vão ao gate de PRD antes da
implementação:

- §8.1 Manter ou apagar as migrations 092000 a 092300. Recomendação: manter, dropar a função por
  migration nova.
- §8.2 Aceitar o risco de senha fixa e a trava de `--allow-remote`.
- §8.3 Autorizar `supabase db reset` local para limpar `admin@neox.com.br` se ele já existir.
- §8.4 Aprovar a constraint de super_admin sem tenant.
- §8.5 Incluir ADR-05, ADR-08, ADR-09 e o frontend na mesma entrega.

Este é o estado de entrada da etapa de implementação, não uma decisão já tomada.
