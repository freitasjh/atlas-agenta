# PRD: Troca de senha e RBAC do super admin com Auth nativo, Edge Functions e claims no JWT

Status: aguardando aprovação humana (ver `prd-approval.json`).
Base: branch `feat/adr-01-password-gate`. Nova branch de trabalho a partir dela.
Fontes: `analysis-data.md`, `analysis-frontend.md`, steerings `produto.md`, `dominio.md`,
`stack.md`, `seguranca-multitenant.md`, `convencoes-codigo.md`, e o histórico de decisões da
seção 7.

Este documento é o contrato da demanda. Descreve o que precisa existir e como se prova que ficou
pronto. Nomes de funções, colunas de migração e ordem interna das etapas ficam nas ADRs, depois da
aprovação. Onde a análise propõe um desenho, ele aparece aqui como decisão ou como pergunta.

---

## 1. Problema e valor de negócio

A troca de senha e o acesso do super admin foram construídos com uma cadeia de estado no banco:
trigger em `auth.users`, tabela ou colunas de reserva com token, RPC com travas e policies de RLS
que mudam com um flag. Essa cadeia gerou quatro dias de ciclos de correção (ADRs 04 a 10). Cada
correção abria outro caso de borda.

Quando esta demanda estiver pronta:

- A senha fica no Auth nativo. Nenhuma tabela guarda senha, token de reserva ou prazo.
- A troca de senha obrigatória passa por uma Edge Function com service role. Ela grava a senha e
  limpa o flag em uma única chamada à API de administração do Auth.
- Papel e empresa do usuário saem do JWT, emitidos por um custom access token hook. O frontend lê
  essas claims e não consulta `profiles` para identidade.
- O super admin inicial, `admin@neox.com.br`, é criado por uma Edge Function idempotente, com
  service role. Ela não cria empresa, não converte profile de empresa e não apaga nada.
- O banco fica responsável por uma coisa: isolar os dados de cada empresa por `tenant_id` (RLS).
  Nenhuma regra de senha, papel ou flag vive em trigger ou em policy.
- O cliente nunca altera papel, empresa ou flag, por nenhum caminho.

Resposta à pergunta do usuário sobre backend e RBAC: sim, a lógica de senha e de papel sai do
Postgres e vai para o backend (Edge Functions e hook). O Postgres continua com RLS para isolamento
de dados. O backend continua existindo, mas fica com lógica sem estado.

Valor: o painel do super admin (`/admin`) passa a funcionar com troca obrigatória de senha, sem
os ciclos de correção. A evolução de senha e de RBAC deixa de depender de trigger e reserva.

---

## 2. Escopo

### Entra

Dados e Supabase:

- Migração de limpeza nova (sem editar migration aplicada) que remove o que restou dos desenhos
  das ADRs 01 a 10: colunas de flag e de reserva em `profiles`, funções de reserva e de troca,
  funções de bootstrap por conversão, policies de super admin com condição de flag, e o guard de
  colunas de `profiles`.
- Custom access token hook: Edge Function que emite `user_role`, `tenant_id` e
  `must_change_password` no access token. Não emite a claim `role`.
- Flag `must_change_password` em `app_metadata` do usuário, gravado só pelo service role.
- Edge Function `change-password`: troca a senha com a API de administração do Auth e limpa o
  flag na mesma chamada.
- Edge Function `bootstrap-super-admin`: cria `admin@neox.com.br` com senha provisória, flag
  ligado e profile `super_admin` sem tenant. Idempotente. Protegida por segredo de operador.
- Revogação de escrita de `profiles` pelo cliente (`anon` e `authenticated`).
- RLS apenas para isolamento por `tenant_id`, com as policies de super admin na forma sem flag.
- Constraint de banco: `super_admin` sem `tenant_id`, e os demais papéis com `tenant_id`
  obrigatório (decisão D-09).
- Configuração de `supabase/config.toml` para o hook e as funções.

Frontend:

- Leitura de identidade a partir das claims do JWT (`parseAuthClaims`, `useAuthClaims`), sem
  consulta a `profiles`.
- Tela `/trocar-senha` com layout de casca própria, validação e erros em pt-BR.
- Guard de troca obrigatória em `/app` e em `/admin`.
- Redirecionamento pós-login pela sessão: flag ligado vai para `/trocar-senha`, super admin vai
  para `/admin/empresas`, demais papéis para o destino ou `/app`.
- Rota índice de `/admin` redireciona para `/admin/empresas`.
- Botão de troca desabilitado durante a chamada.

Fica para as ADRs 11 a 15 (frontend), ajustadas ao contrato novo. As ADRs 04 a 10 ficam
arquivadas, sem edição.

### Fora de escopo

- Troca voluntária de senha (quem não está com o flag ligado). Confirmar em P-14.
- Recuperação de senha por e-mail, sem alteração no fluxo que já existe.
- Criar empresas (tenants) pelo painel do super admin.
- Dashboard `/admin` (o componente `AdminDashboardPage` pode ficar no código, sem rota).
- Convite e troca de papel de membros de tenant.
- Senha aleatória por ambiente. Fica para antes do beta.
- Remoção ou alteração de qualquer tenant existente. Nenhuma empresa é apagada.
- Pagamento (Asaas), WhatsApp (Evolution), agenda e métricas.
- Limite de criação de contas e captcha no cadastro (ver P-08).
- Reescrita das migrações já aplicadas (`20250228090000` a `20250228095100`). Elas ficam como
  histórico.

---

## 3. Requisitos e critérios de aceite

Cada requisito tem entrada, saída observável e o modo de verificação. Os nomes de rota e de
código seguem as análises de dados e de frontend.

**RQ-01 Bootstrap cria o super admin sem tenant.**
- Entrada: chamada à Edge Function de bootstrap com o segredo de operador correto, em banco sem
  `admin@neox.com.br`.
- Saída: um usuário no Auth com esse e-mail, e-mail confirmado, flag `must_change_password`
  ligado em `app_metadata`. Um profile com `role = super_admin` e `tenant_id` nulo. Nenhuma linha
  nova em `tenants`. Resposta de criação.
- Verificação: teste de integração contra o stack local, com contagem de `tenants` antes e depois.

**RQ-02 Bootstrap é idempotente.**
- Entrada: segunda chamada com o mesmo segredo, com o super admin já existente.
- Saída: resposta `ja_existe`. Mesmo id de usuário. Senha e flag não mudam.
- Verificação: login com a senha inicial antes e depois, e comparação do id.

**RQ-03 Bootstrap recusa e-mail de outro papel.**
- Entrada: chamada com o e-mail de um admin de empresa, ou de um usuário sem profile.
- Saída: 409 `email_com_outro_papel`. Nenhum profile, tenant, senha ou flag muda.
- Verificação: teste de integração com contagem e leitura do profile antes e depois.

**RQ-04 Bootstrap protegido por segredo.**
- Entrada A: `BOOTSTRAP_SECRET` não definido no ambiente. Saída A: 404.
- Entrada B: segredo errado. Saída B: 401.
- Entrada C: a comparação do segredo é feita em tempo constante. Verificação: revisão do código.

**RQ-05 Hook emite papel e tenant no JWT.**
- Entrada: login de um usuário com profile válido.
- Saída: access token com `user_role`, `tenant_id` e `must_change_password`. A claim `role`
  continua `authenticated`, e o PostgREST segue aplicando RLS.
- Verificação: decodificar o token em teste de integração e checar as claims e o `role`.

**RQ-06 Hook falha fechado.**
- Entrada A: requisição ao hook sem assinatura válida. Saída A: 401.
- Entrada B: erro ao ler `profiles`. Saída B: 500, e o login é recusado.
- Entrada C: usuário sem profile. Saída C: `user_role` e `tenant_id` nulos. As rotas do app
  negam acesso.
- Verificação: três testes de integração, um por entrada. Log sem e-mail, telefone nem id.

**RQ-07 Login do super admin com senha provisória fica bloqueado até a troca.**
- Entrada: login de `admin@neox.com.br` com a senha inicial.
- Saída: token com `user_role = super_admin` e `must_change_password = true`. Qualquer rota de
  `/admin` ou `/app` leva a `/trocar-senha`. A chamada a `admin-subscription` responde 403
  `password_change_required`. Consulta a `tenants` de outra empresa retorna zero linhas.
- Verificação: integração (token, consulta com a sessão e chamada HTTP) e QA visual (seção 8).

**RQ-08 Troca grava a senha e limpa o flag.**
- Entrada: super admin autenticado envia `{ password }` válida.
- Saída: 200. A senha nova vale no login. A senha inicial deixa de valer. O flag fica `false`
  em `app_metadata`. As chaves `provider` e `providers` de `app_metadata` continuam presentes.
- Verificação: integração com login antes e depois, leitura de `app_metadata`.

**RQ-09 Troca rejeita entradas inválidas sem mudar nada.**
- Entrada A: senha com 7 caracteres. Saída A: 400 `password_too_short`.
- Entrada B: senha com mais de 72 bytes UTF-8. Saída B: 400 `password_too_long`.
- Entrada C: senha igual à inicial. Saída C: 400 `password_is_initial`.
- Entrada D: campo extra no corpo. Saída D: 400 `invalid_body`.
- Entrada E: requisição sem JWT válido. Saída E: 401.
- Entrada F: flag já `false`. Saída F: 409 `password_change_not_required`.
- Em todos os casos, a senha e o flag ficam como estavam.
- Verificação: uma chamada por caso, com leitura do flag e do login antes e depois.

**RQ-10 Última escrita vence, sem reserva.**
- Entrada: duas chamadas de troca com senhas diferentes, quase simultâneas.
- Saída: cada chamada responde 200 ou 409. O flag fica `false`. A senha válida no fim é a
  última gravada, e a outra deixa de valer.
- Verificação: teste de integração com duas chamadas em paralelo. Não exige estado no banco.

**RQ-11 Redirecionamento depois da troca.**
- Entrada: troca concluída (200), depois `refreshSession` e navegação.
- Saída: super admin vai para `/admin/empresas`. Admin de empresa vai para `/app`. O token novo
  traz `must_change_password = false`.
- Verificação: QA visual (seção 8) e teste unitário da função de destino.

**RQ-12 Botão de troca desabilitado durante a chamada.**
- Entrada: clique em "Salvar nova senha" e segundo clique (ou Enter) antes da resposta.
- Saída: o botão fica `disabled` enquanto a mutation está pendente. O segundo envio não gera
  segunda requisição.
- Verificação: `list_network_requests` e `button.disabled` durante a chamada, no QA visual.

**RQ-13 Cliente não altera papel, empresa, flag nem `app_metadata`.**
- Entrada A: usuário autenticado, em cada um dos quatro papéis, tenta `update` de `role`,
  `tenant_id` ou `id` em `profiles`, ou tenta `insert` e `delete` em `profiles`.
- Saída A: recusado (erro de permissão ou zero linhas). Os valores ficam como estavam.
- Entrada B: `updateUser` com `data: { app_metadata: ... }`.
- Saída B: `app_metadata` não muda.
- Verificação: testes negativos de integração, um por papel e por operação.

**RQ-14 RLS isola empresas e não tem condição de flag.**
- Entrada: admin da empresa A consulta `tenants`, `profiles` e as tabelas de domínio existentes
  da empresa B.
- Saída: zero linhas da empresa B.
- Entrada extra: leitura do catálogo de policies.
- Saída extra: nenhuma policy referencia `must_change_password`, nem a função de flag.
- Verificação: regressão do RLS atual e consulta ao catálogo.

**RQ-15 Migração de limpeza.**
- Entrada: `supabase db reset` a partir de um banco limpo.
- Saída: sem erro. Após o reset, não existem as colunas `must_change_password`,
  `password_changed_at` e `password_change_claimed_until` em `profiles`, nem as funções de reserva
  e de flag, nem o trigger de guarda de colunas. Nenhuma migration aplicada foi editada.
- Verificação: os dois comandos rodam sem falha. Consulta ao catálogo retorna vazio para cada item
  removido. `git diff` mostra zero alterações nos arquivos `20250228090000` a `20250228095100`.

**RQ-16 Nenhuma empresa é apagada nem convertida.**
- Entrada: qualquer caminho desta entrega (bootstrap, troca, hook, cadastro).
- Saída: nenhuma linha de `tenants` é apagada. Nenhum profile de tenant vira super admin.
- Verificação: revisão do código novo (sem `delete` em `tenants`) e teste de integração com
  contagem.

**RQ-17 Segredos fora do cliente, do log e das respostas.**
- Entrada: bootstrap, troca, login errado e erro de hook.
- Saída: senha inicial, senha nova, service role, segredo do hook e `BOOTSTRAP_SECRET` não aparecem
  em log, em resposta HTTP, em console do navegador nem em `dist/` após o build.
- Verificação: `grep` dos literais em `dist/`, leitura das respostas de rede e dos logs.

**RQ-18 Super admin com flag ligado não chama a ação de assinatura.**
- Entrada: chamada a `admin-subscription` com token de super admin e flag ligado.
- Saída: 403 `password_change_required`. Com o flag limpo, a mesma chamada segue o caminho atual.
- Verificação: teste de integração nos dois estados.

**RQ-19 Cadastro sem regra de papel em trigger (condicional a P-01).**
- Entrada: `signUp` de cliente comum.
- Saída: a criação da empresa e do profile `admin` acontece em uma transação de Edge Function.
  Se qualquer etapa falha, o usuário Auth recém-criado é removido e nenhuma empresa fica. O
  trigger `on_auth_user_created` deixa de existir.
- Verificação: teste de integração com falha forçada na etapa de banco. Contagem de `tenants` e
  de `auth.users` antes e depois.
- Esta exigência depende da resposta a P-01. Se P-01 não for aprovada, o cadastro segue como hoje
  e o trigger permanece, com esse risco registrado.

**RQ-20 Rotas e textos em pt-BR.**
- Entrada: acesso a `/admin` com a troca concluída, e acesso a `/trocar-senha`.
- Saída: `/admin` vai para `/admin/empresas`. `/trocar-senha` mostra o selo "Primeiro acesso",
  o título "Crie sua nova senha", os campos "Nova senha" e "Confirmar nova senha" e o botão
  "Salvar nova senha". Erros seguem a tabela de `analysis-frontend.md`, seção 4.2.
- Verificação: QA visual e varredura de texto.

**RQ-21 Build, typecheck e testes.**
- Entrada: branch final.
- Saída: `npm run typecheck`, `npm run build` e a suíte de testes passam. A suíte de integração
  passa contra o stack local.
- Verificação: os comandos reais do projeto, com resultado registrado no PR.

**RQ-22 Entrega em branch e PR.**
- Entrada: fim da implementação.
- Saída: branch nova a partir de `feat/adr-01-password-gate`, com PR. Nenhum commit direto em
  `main` ou `master`.
- Verificação: `git log` da branch e link do PR.

---

## 4. Regras de fronteira que a demanda arrisca

- **Isolamento multi-tenant (RLS).** Só isolamento de dados por `tenant_id`. O `tenant_id` vem do
  banco ou do claim do JWT, nunca de parâmetro enviado pelo cliente. Helpers de RLS leem
  `profiles` (fonte da verdade), não o claim (RQ-14).
- **Super admin cross-tenant.** Só por política específica de `super_admin`, sem condição de flag,
  ou por Edge Function com service role (auditada). Com o flag ligado, a leitura pela sessão do
  cliente ainda é possível pelo banco (ver R1 em P-04, risco aceito pelo usuário).
- **RBAC.** `admin`, `professional` e `receptionist` seguem as regras atuais. A recepção continua
  sem leitura de `charges` (RQ-14).
- **Escalonamento de privilégio.** Nenhum caminho do cliente escreve papel, empresa ou flag (RQ-13).
  O hook e as Edge Functions são o único escritor de `app_metadata` e de papel.
- **Papel no JWT.** O hook emite `user_role`, não `role`, para não quebrar o RLS do PostgREST.
- **Segredos.** Service role, segredo do hook e `BOOTSTRAP_SECRET` só em variáveis de ambiente ou
  secrets do Supabase. Nunca no bundle, nunca em `.env` versionado (RQ-17).
- **Senha inicial.** Fixa e provisória até o beta, por decisão do usuário (D-06). Ela fica
  documentada no código como provisória. Ver P-03 sobre o lugar exato dela.
- **Concorrência.** Última escrita vence, sem reserva nem lock (D-07). O efeito é limitado pelo
  botão desabilitado (RQ-12).
- **Tenant nunca é apagado nem convertido** (RQ-16).
- **Status de assinatura.** Os guards de assinatura (`bloqueado` e `cancelado`) não mudam.
- **LGPD.** Nenhum dado pessoal novo de cliente final. O e-mail do super admin é identificador de
  conta. Log sem e-mail, telefone nem id do usuário (RQ-06).
- **Dados não confiáveis.** Corpo da troca, corpo do cadastro e payload do hook são validados com
  zod no servidor. Respostas de Auth não são confiadas além do necessário.
- **Dinheiro e tempo.** Sem campo monetário nesta entrega. Timestamps em `timestamptz` UTC.
- **Migrações.** Nenhuma migration aplicada é editada. A limpeza entra como migração nova.

---

## 5. Perfis de acesso

| Ação | super_admin | admin | professional | receptionist |
|---|---|---|---|---|
| Criar o super admin inicial (Edge de bootstrap, com segredo de operador) | não se aplica (ação de operador) | não | não | não |
| Entrar no app com flag ligado | só `/trocar-senha` | não se aplica | não se aplica | não se aplica |
| Trocar a senha inicial (`change-password`) | sim | não | não | não |
| Entrar em `/admin` com flag limpo | sim | não | não | não |
| Ler empresas de outros tenants | sim, com flag limpo | não | não | não |
| Alterar `subscription_status` de empresa | sim, com flag limpo | não | não | não |
| Alterar o próprio papel, empresa, id ou flag | não | não | não | não |
| Criar ou apagar linhas de `profiles` pelo cliente | não | não | não | não |
| Cadastrar empresa (visitante) | não se aplica | cria a empresa e vira `admin` | não | não |
| Acessar dados financeiros de `charges` | não se aplica | sim | não | não (regra atual, sem mudança) |
| Acessar agenda | não se aplica | todas | apenas a própria | todas |

Nenhum papel ganha permissão nova por esta entrega. O super admin continua sendo o único papel
fora de tenant.

---

## 6. Enquadramento no roadmap e dependências

- **Roadmap:** Fase 1 (MVP). A demanda entra na fatia "Super Admin" (`/admin`, operação de
  empresas) e no onboarding (cadastro de empresa). Não é funcionalidade de cliente final.
- **Fase 3 não entra:** autoagendamento público, taxa de reserva antecipada obrigatória e painel
  de métricas consolidadas.
- **Não afeta:** agenda, cobrança PIX, WhatsApp e webhooks de pagamento.
- **Dependências já entregues na base `feat/adr-01-password-gate`:**
  - PR #17 (painel admin, Fatia 1): mergeado, conforme o histórico do usuário.
  - ADR-01 (colunas e flag) e ADR-02 (guarda de colunas): reaproveitadas no que não conflita. A
    parte de flag em `profiles` e a guarda por trigger saem, porque o desenho novo usa
    `app_metadata` e revogação de privilégio.
  - ADR-03 (policies de super admin com flag): a parte útil (`profiles_super_admin` só de leitura)
    fica. A condição de flag sai.
  - Testes de fronteira de isolamento entre empresas: reaproveitados. Os de reserva saem.
- **Substituídas:** ADRs 04 a 10. Arquivadas em `_anteriores/`, sem edição.
- **Frontend:** ADRs 11 a 15 são mantidas e ajustadas ao contrato novo. ADR-12 perde a consulta a
  `profiles`. ADR-13 perde os códigos `in_progress` e `superseded`.
- **Ordem de entrega sugerida:** hook e claims, Edge de troca, Edge de bootstrap, migração de
  limpeza, frontend, suíte de integração e QA visual. A ordem final vai para o planejamento.

---

## 7. Pontos levantados pelo usuário

Cada ponto está registrado como decisão ou como pergunta em aberto. Nenhum foi descartado.

### 7.1 Decisões

- **D-01 Substituir o desenho de senha por forma simples.** Pedido do usuário: a conversão de
  profile, as salvaguardas de delete de tenant, a tabela de reserva e a RPC com travas saem.
- **D-02 Auth nativo para senha.** A troca é feita pela Edge Function `change-password`, com a
  API de administração do Auth (RQ-08).
- **D-03 Papel e tenant no JWT** por custom access token hook. Claims `user_role` e `tenant_id`
  (RQ-05, RQ-06).
- **D-04 Flag de troca em `app_metadata`,** gravado só pelo service role. Nunca em `user_metadata`
  e nunca em tabela (RQ-08, RQ-13).
- **D-05 Bootstrap do super admin por Edge Function com service role, idempotente** (RQ-01 a
  RQ-04). Essa escolha substitui a nota do Brain que previa script de operador. O motivo era não
  expor service role como bearer. Com o segredo de operador separado e o service role só no
  servidor, esse motivo deixa de valer. Atualizar a nota do Brain depois da aprovação.
- **D-06 Senha inicial fixa e provisória até o beta,** documentada no código como provisória.
  Troca obrigatória no primeiro login (RQ-07, RQ-08).
- **D-07 Concorrência: última escrita vence,** sem reserva nem lock. O botão de troca fica
  desabilitado durante a chamada (RQ-10, RQ-12).
- **D-08 RLS só para isolamento por `tenant_id`.** As policies de super admin voltam à forma sem
  flag (RQ-14).
- **D-09 Constraint de super admin sem tenant como invariante de banco.** Aprovada na rodada
  anterior (decisão 8.4). Mantida. Constraint complementar: papéis de tenant exigem `tenant_id`.
- **D-10 Revogação de escrita de `profiles` pelo cliente.** Substitui o guard de colunas por
  trigger (RQ-13).
- **D-11 Migrações aplicadas ficam como histórico.** Mudanças entram em migração nova (RQ-15).
  Herdado da rodada anterior (decisão 8.1).
- **D-12 Trocar senha, validar e tratar erros conforme as tabelas de `analysis-data.md` e
  `analysis-frontend.md`.** Mensagens de servidor não chegam à tela. Só os textos pt-BR definidos.
- **D-13 Não existe tela de dashboard de admin com rota.** O componente pode ficar no código
  (ver P-13).
- **D-14 Redirecionamento pós-troca para `/admin/empresas`,** e `/admin` redireciona para lá (RQ-11,
  RQ-20).
- **D-15 Base da branch:** `feat/adr-01-password-gate`. Nova branch de trabalho, com PR (RQ-22).
- **D-16 Nenhuma execução remota do bootstrap sem aceite explícito no momento do comando.**
  Herdado da rodada anterior (decisão 8.2).
- **D-17 Sem edição de ADR já aplicada.** As ADRs 04 a 10 ficam arquivadas (seção 6).
- **D-18 Cadastro comum mantém o fluxo atual até P-01 ser decidida.** RQ-19 depende dela.
- **D-19 Pedido do usuário "faz 4 dias e não saímos":** a demanda muda de desenho, não só de
  código. O planejamento começa só depois da aprovação deste PRD, para evitar nova rodada de
  correção de migration.

### 7.2 Perguntas em aberto

Cada pergunta traz a origem, a recomendação e o efeito de cada resposta.

- **P-01 Cadastro sai do trigger `on_auth_user_created`? (origem: análise de dados, D1.)**
  O trigger `handle_new_user` cria empresa e profile `admin` a cada insert em `auth.users`. Isso é
  regra de papel em trigger, proibida pelo desenho. Também conflita com o bootstrap, porque
  `createUser` do super admin criaria uma empresa.
  Recomendação: sim. O cadastro vira Edge Function `signup-tenant`, com a criação de empresa,
  profile e templates em uma transação. O frontend de `useSignUp` muda junto.
  Efeito de "não": o trigger permanece, o bootstrap pula a empresa por marcador em `app_metadata`,
  e RQ-19 sai. Essa resposta mantém a regra de papel no trigger, que o pedido proíbe.
  **Decidir.**

- **P-02 Executar `supabase db reset` localmente (origem: aprovação anterior 8.3 e pergunta P-03
  da rodada anterior).**
  A aceitação pede `db reset`. Ele apaga os dados do banco local, incluindo qualquer admin de teste
  que exista hoje. Não há remoção de tenant por código.
  Recomendação: rodar o reset só com OK explícito no momento do comando. Até lá, o admin local
  existente é tratado como pendência.
  **Autorizar o reset local, e em qual momento?**

- **P-03 Lugar da senha inicial no código (origem: pedido de senha fixa, e regra
  `stack`/`seguranca-multitenant` de segredos fora do código).**
  O usuário pediu senha fixa e documentada no código como provisória. A regra do projeto diz que
  segredos vivem em variáveis de ambiente. Esta é uma credencial de conta de operador, e o valor
  apareceu no histórico da conversa. Este PRD não reproduz o valor.
  Recomendação: manter a senha fixa no código, como pede o usuário, com comentário de provisória.
  Trocar o valor antes do beta, porque o atual já apareceu no histórico.
  **Confirmar o lugar da senha e se ela muda antes do beta.**

- **P-04 Risco de leitura pelo PostgREST com a senha inicial conhecida (origem: R1 da análise de
  frontend, D2 da análise de dados).**
  Quem souber a senha inicial pode fazer login e ler empresas pelo banco antes da troca. O bloqueio
  de `/trocar-senha` é só de interface, porque a RLS não usa flag (regra do usuário). Mitigações:
  (a) rodar o bootstrap só em ambiente local ou de desenvolvimento, sem envio remoto; (b) trocar a
  senha no primeiro acesso; (c) remover `BOOTSTRAP_SECRET` depois do uso.
  **Aceitar até o beta com (a), (b) e (c)?**

- **P-05 Trava para execução remota do bootstrap (origem: pergunta P-04 da rodada anterior).**
  Recomendação: a função recusa ambiente que não seja local sem uma variável explícita. Nenhuma
  execução remota entra nesta entrega. **Aprovar a trava?**

- **P-06 Escopo da entrega (origem: pergunta P-06 da rodada anterior).**
  Esta entrega inclui troca de senha no servidor, hook de claims, checagem do flag em
  `admin-subscription`, telas e suíte de integração. Sem eles o login completo não se prova.
  **Confirmar que tudo entra na mesma branch e PR?**

- **P-07 Flag genérico ou só para super admin (origem: pergunta P-07 da rodada anterior).**
  O hook e a troca servem a qualquer usuário com o flag ligado. Hoje só o bootstrap liga o flag.
  Recomendação: genérico, para manter uma regra só.
  **Confirmar?**

- **P-08 Limite de criação de conta no cadastro (origem: D3 da análise de dados).**
  O GoTrue limita o cadastro, mas a Edge Function de cadastro, se P-01 for aprovada, não herda
  esse limite. Recomendação: fica registrado como risco de MVP, e o beta ganha limite por IP ou
  captcha. **Aceitar o risco no MVP?**

- **P-09 Contraste de tokens (origem: pergunta P-08 da rodada anterior, e seção 5 da análise de
  frontend).**
  A análise de frontend propõe trocar quatro tokens de cor de `src/index.css`. Essa troca altera
  o botão primário e o anel de foco de todas as telas. Análise anterior recomendava demanda
  separada.
  Recomendação: fazer a correção em demanda separada e, nesta entrega, medir o contraste da tela
  de troca e registrar o resultado. **Qual caminho?**

- **P-10 Recuperação de senha com flag ligado (origem: R3 da análise de frontend, P-09 da rodada
  anterior).**
  `updateUser({ password })` na recuperação não limpa o flag. Quem recupera a senha antes da
  primeira troca volta para `/trocar-senha`. Assumido: comportamento fail-closed. **Confirmar.**

- **P-11 Encerrar as outras sessões na troca (origem: R2 da análise de frontend, P-11 da rodada
  anterior).**
  Sessões abertas com a senha inicial continuam válidas após a troca. Recomendação: a Edge de
  troca encerra as outras sessões do usuário com service role, e as abas abertas caem para
  `/login` na renovação. **Sim ou aceitar o residual?**

- **P-12 Papel desatualizado no JWT (origem: D5 da análise de dados, R4 da análise de frontend).**
  Mudança de papel ou de empresa só aparece no claim depois da renovação (até 1 hora, por
  `jwt_expiry = 3600`). Operações privilegiadas leem `profiles` com service role, e o RLS segue
  com dados. **Aceito para o beta?**

- **P-13 Componente `AdminDashboardPage` (origem: pergunta 4 da análise de frontend).**
  Ficar no código sem rota, ou sair. Assumido: fica no código. **Confirmar.**

- **P-14 Troca voluntária de senha (origem: D4 da análise de dados).**
  A Edge Function só aceita troca com o flag ligado. Troca voluntária (com senha atual) fica fora
  do MVP. **Confirmar.**

- **P-15 Respostas sem pergunta correspondente (origem: pergunta P-13 da rodada anterior).**
  O histórico traz respostas curtas (por exemplo "A", "1", "b", "2.b 4. b") a perguntas de rodadas
  anteriores. Elas não estão no contexto desta etapa. A opção A já está em D-01 (super admin nasce
  direto na plataforma). Os demais itens não podem ser mapeados com segurança. Também registro
  que a aprovação anterior (`prd-approval.json`) veio com 8.5, que mandava entregar ADR-05, ADR-08,
  ADR-09 e o frontend juntas. Esse item está superado, porque ADR-05 e ADR-08 foram substituídas
  pelo desenho novo.
  **Confirmar a que pergunta cada resposta se refere, e se alguma muda esta entrega.**

- **P-16 Ciclo de correção (origem: pergunta P-14 da rodada anterior).**
  Cada pergunta de P-01 a P-05 precisa de resposta antes da ADR. Assim a primeira execução das
  migrations já vale como verificação, e não vira nova rodada. **Concordar com essa ordem?**

---

## 8. Critério de aceite visual (frontend)

Pré-condição: `supabase db reset` executado (P-02), bootstrap executado localmente, app servido em
`127.0.0.1`. Verificação com Chrome DevTools, em 390 × 844 e 1280 × 800, tema claro e escuro.
Cada combinação gera screenshot.

1. Sem sessão, `/app/agenda` e `/admin/empresas` levam a `/login`.
2. Login de `admin@neox.com.br` com a senha inicial cai em `/trocar-senha`. O título "Crie sua nova
   senha" aparece. Nenhum conteúdo de `/admin/empresas` aparece no DOM.
3. Acesso direto a `/admin/empresas` e a `/app/agenda` mantém a tela em `/trocar-senha`.
4. Senha de 7 caracteres mostra erro no campo, com `aria-invalid="true"`, e o foco vai para o campo.
5. Senhas diferentes mostram "As senhas não coincidem.".
6. Dois cliques rápidos em "Salvar nova senha" geram uma única requisição a `change-password`.
   Durante a chamada, o botão está `disabled`.
7. Resposta 401 mostra "Sua sessão expirou. Entre novamente." com link para `/login`.
8. Rede desligada mostra o texto genérico e reativa o botão.
9. Após 200, a página renova o token e navega para `/admin/empresas`. Voltar para `/trocar-senha`
   redireciona para `/admin/empresas`.
10. `/admin` leva a `/admin/empresas`.
11. Sair e entrar com a senha nova leva a `/admin/empresas`. Com a senha inicial, mostra
    "E-mail ou senha incorretos.".
12. Admin de empresa entra em `/app` sem passar por `/trocar-senha`.

Técnico:

- Console do navegador sem erro nem aviso em nenhum passo.
- A resposta de `change-password` não contém senha, hash, service role nem o nome do segredo.
- Em 390 px: sem rolagem horizontal, botão com a largura do card, campos com fonte de 16 px ou
  mais, botão com 44 px ou mais de altura.
- Em 1280 px: card centralizado, sem painel lateral.
- Ordem de tabulação: campo 1, campo 2, "Salvar nova senha", "Sair". Enter envia. Foco visível em
  todos os controles.
- Contraste da tela de troca medido com `getComputedStyle`, nos pares de `analysis-frontend.md`,
  seção 6. Mínimos WCAG 2.2 AA. Resultado registrado no relatório de QA (ver P-09).
- Senha inicial não aparece em `dist/` após o build.
- `grep` de `from("profiles")` em `src/` retorna zero resultados, depois da migração dos
  consumidores.

---

## Critério de pronto da demanda

- RQ-01 a RQ-22 verificados pelo método de cada requisito. RQ-19 só se P-01 for aprovada.
- Seção 8 executada em 390 px e 1280 px, claro e escuro, com screenshots.
- `supabase db reset` do zero sem erro, e a migração de limpeza removendo o que restou.
- Testes de integração, build e typecheck passando.
- Nenhuma pergunta de P-01 a P-05 em aberto no momento do planejamento.
- PR aberto a partir de `feat/adr-01-password-gate`.
