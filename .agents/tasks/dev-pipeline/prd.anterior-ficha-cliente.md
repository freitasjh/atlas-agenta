# PRD: Ficha do cliente para clínicas (Fase 1b / ramo clínica)

Status: aguardando aprovação humana (ver `prd-approval.json`).
Tipo de rota: Feature, com alteração de schema e dado sensível (LGPD, art. 5º, II).
Base de código: `origin/master` em `4fb5598` (já contém PR #14 comissão e PR #15 pacotes).
Fontes: `analysis-data.md`, `analysis-frontend.md` e steerings `produto.md`, `dominio.md`,
`stack.md`, `seguranca-multitenant.md`, `convencoes-codigo.md`.

Este documento descreve o que precisa existir e como se prova que ficou pronto. A solução técnica
detalhada (tabelas, migrations, componentes) fica para as ADRs do planejamento, depois da aprovação.

---

## 1. Problema e valor de negócio

Hoje a clínica não tem onde registrar, de forma estruturada, o que importa para a continuidade do
cuidado: alergias conhecidas, medicamentos em uso e observações do atendimento. Essas informações
ficam espalhadas ou fora do sistema.

Quando esta demanda estiver pronta:

- Profissional de uma clínica registra a ficha de um cliente durante ou após um atendimento, e o
  histórico fica disponível na ficha do cliente.
- Correções não apagam nem alteram o que foi registrado. Cada correção é um registro novo, e o
  original continua no histórico.
- Recepção organiza a agenda sem ver conteúdo clínico. Admin vê a ficha inteira do próprio tenant.
- Barbearia, salão e tenants legados não ganham nenhuma tela nova de ficha e seguem sem mudança.

Valor: a clínica passa a ter histórico clínico básico dentro do produto, com a mesma separação de
dado sensível que já existe para financeiro (comissão e cobrança).

---

## 2. Escopo

### 2.1 Dentro do escopo

Dados e Supabase:

- Registro de ficha ligado a um atendimento e, por consequência, a um cliente.
- Três campos de conteúdo clínico: alergias, medicamentos em uso e observações do atendimento
  (decisão D-05, §7).
- Registros append-only. Correção = registro novo que aponta para o original.
- Políticas de acesso por papel (admin, profissional, recepção) e por status de assinatura.
- Alteração aditiva em `appointments` para permitir o vínculo composto cliente/atendimento.
- Testes de banco que provem as regras de RLS e de imutabilidade (o repositório não tem suíte de
  RLS hoje, então esta demanda cria a primeira).

Frontend:

- Ação "Ficha" na lista de clientes, visível só para tenant clínica e papel permitido.
- Tela da ficha do cliente com informações básicas, observações e histórico, em rota própria.
- Ação "Registrar ficha" no atendimento da agenda, visível só para tenant clínica, papel permitido
  e status `em_atendimento` ou `concluido`.
- Ação "Registrar correção" em registros que ainda não têm correção.
- Guard de segmento na própria rota da ficha (não só no atalho), reutilizando a flag de
  `useSegmentFeatures`.
- Limpeza do cache de dados do usuário no evento de saída da sessão (pré-requisito, §3 RF-11).

Base de exemplo (pedido original do usuário):

- Script de desenvolvimento que cria uma base de demonstração com um tenant por segmento
  (barbearia, salão e clínica), usuários por segmento e dados fictícios. Detalhes e riscos em §4.4
  e §7 (D-09, Q-06, Q-09).

### 2.2 Fora do escopo

- Edição ou exclusão de registro clínico (inclusive por admin). Não existe na UI nem no banco.
- Anexos, fotos, documentos e arquivos de prontuário (Storage).
- Exportação ou impressão da ficha.
- Campos além dos três definidos: CPF, RG, convênio, endereço, data de nascimento, histórico
  familiar e campos de especialidade.
- Indicador de "tem ficha" em qualquer listagem (agenda, clientes, dashboard).
- Qualquer envio de conteúdo clínico para WhatsApp, Evolution API, Asaas, analytics ou logs.
- Acesso cross-tenant de suporte (super admin) à ficha.
- Procedimento de retenção, prazo de guarda e pedido de eliminação (LGPD art. 18). Ver Q-03.
- Adequação jurídica e definição da base legal de tratamento (LGPD art. 11). Ver Q-04.
- Edge Functions novas nesta demanda. Leitura e escrita passam pela sessão do usuário e pela RLS.
- Demais itens de Fase 3 de `produto.md`: autoagendamento público, taxa de reserva antecipada e
  métricas consolidadas.

---

## 3. Requisitos e critérios de aceite

Cada requisito tem entrada, saída observável e prova. A prova indica se é teste de banco, teste
unitário (vitest) ou QA visual com Chrome DevTools MCP.

### 3.1 Requisitos funcionais

RF-01 Registrar ficha no atendimento.
- Entrada: admin do tenant, ou profissional dono do atendimento, informa pelo menos um dos três
  campos para um atendimento com status `em_atendimento` ou `concluido`.
- Saída: registro criado, com autor e data/hora gravados. Ele aparece no topo do histórico do
  cliente daquele atendimento.
- Prova: teste de banco + QA visual.

RF-02 Status do atendimento que não aceita ficha.
- Entrada: tentativa de registrar em atendimento `pendente`, `confirmado`, `cancelado` ou
  `nao_compareceu`.
- Saída: a ação não aparece na agenda. Um insert direto no banco é recusado.
- Prova: teste de banco + QA visual.

RF-03 Validação de conteúdo.
- Entrada: campos vazios, só com espaços, ou acima do limite (alergias 500, medicamentos 500,
  observações 2000 caracteres).
- Saída: registro sem nenhum conteúdo é recusado. Texto acima do limite é recusado. A mensagem é
  em pt-BR, indica o campo e nunca repete o valor digitado.
- Prova: vitest (schema) + teste de banco + QA visual.

RF-04 Correção como registro novo.
- Entrada: usuário com permissão escolhe "Registrar correção" em um registro sem correção.
- Saída: novo registro vinculado ao original, no mesmo atendimento e cliente. O original permanece
  visível com a marca "Corrigido em dd/mm/aaaa hh:mm". O novo registro mostra "Correção de
  dd/mm/aaaa hh:mm".
- Restrições: uma correção por registro. Correção para outro atendimento ou outro cliente é
  recusada.
- Prova: teste de banco + QA visual.

RF-05 Imutabilidade.
- Entrada: qualquer tentativa de UPDATE, DELETE ou TRUNCATE em registro clínico, por qualquer papel
  do banco, inclusive service role.
- Saída: operação recusada. Nenhuma linha muda. Nenhuma tela oferece editar ou excluir.
- Prova: teste de banco + inspeção de código/QA.

RF-06 Histórico na ficha do cliente.
- Entrada: usuário com permissão abre a ficha de um cliente.
- Saída: lista em ordem cronológica decrescente, com data e hora no fuso do tenant (padrão
  `America/Sao_Paulo`), autor, atendimento de origem e cadeia de correções. Os dados clínicos só
  são buscados ao abrir a ficha.
- Prova: QA visual + teste de banco.

RF-07 Gating por ramo na própria rota.
- Entrada: usuário de tenant com segmento diferente de `clinica` (barbearia, salão ou legado
  `null`) acessa a URL da ficha diretamente.
- Saída: painel de indisponibilidade em pt-BR, sem nenhum dado clínico renderizado e sem nenhuma
  requisição de registro clínico na aba de rede.
- Prova: QA visual com Chrome DevTools MCP, nos três ramos.

RF-08 Visão por papel dentro do tenant clínica (ver §5).
- Entrada: recepção acessa a ficha por menu ou por URL direta.
- Saída: "Acesso restrito" em pt-BR, sem request de conteúdo clínico. Nenhum botão de ficha ou de
  registro aparece para recepção.
- Prova: teste de banco (select retorna zero linhas, insert recusado) + QA visual com login de
  recepção.

RF-09 Sem conteúdo clínico fora da ficha.
- Entrada: uso normal da agenda, da lista de clientes e do dashboard.
- Saída: nenhuma consulta a registros clínicos nessas telas. Nenhum indicador de existência de
  ficha. Nenhum conteúdo clínico em toast, log, URL ou armazenamento do navegador.
- Prova: QA visual com aba de rede + busca no diff por `console.` e logs no módulo de ficha.

RF-10 Status de assinatura.
- Entrada: tenant `bloqueado` ou `cancelado` tenta registrar ou corrigir ficha.
- Saída: recusado pelo banco. A app também não oferece a ação. Leitura segue a regra existente de
  redirecionamento para `bloqueado`.
- Prova: teste de banco + QA visual. (Ver Q-02.)

RF-11 Limpeza de sessão.
- Entrada: evento de saída da sessão (logout ou expiração) em um navegador compartilhado.
- Saída: o cache de dados do usuário anterior é removido. Nenhum registro da conta anterior aparece
  antes do novo carregamento.
- Prova: QA visual com troca de usuário no mesmo navegador. Hoje só o botão de sair limpa o cache.
  Este requisito cobre também o evento de sessão.

RF-12 Sem regressão de ramo.
- Entrada: uso de agenda, clientes, comissão (barbearia) e combos (salão) em tenants de cada ramo.
- Saída: comportamento idêntico ao da master atual. Nenhuma tela nova aparece nesses ramos.
- Prova: vitest + QA visual.

RF-13 Base de exemplo por segmento (ver D-09).
- Entrada: desenvolvedor executa o script de demonstração em ambiente local, com a flag de
  ambiente explícita.
- Saída: um tenant por segmento (barbearia, salão, clínica), com usuário administrador em cada um.
  Para clínica, também um profissional e uma recepção, para validar RBAC. Para clínica, há
  atendimentos em `em_atendimento` e `concluido` e alguns registros de ficha.
- Restrições: rodar de novo não duplica dados. Nenhuma senha fica em código versionado. O script
  recusa rodar contra endereço que não seja local, a menos que o usuário autorize explicitamente.
- Prova: execução do script duas vezes (segunda não cria duplicatas) + verificação de login por
  papel no QA.

### 3.2 Requisitos não funcionais

RNF-01 Carregamento. A agenda e a lista de clientes não ganham nenhuma consulta nova. A ficha
carrega sob demanda. (Referência: RNF01 de `stack.md`, carregamento da agenda < 1,5 s.)

RNF-02 Idioma. Textos de interface, erros e estados vazios em pt-BR.

RNF-03 Acessibilidade. Campos com rótulo associado, foco visível, navegação completa por teclado
(incluindo abrir e fechar o diálogo com Esc e devolver o foco ao gatilho), cabeçalho com títulos
hierárquicos. Contraste de texto da ficha de pelo menos 4,5:1 medido no DOM renderizado.

RNF-04 Mobile-first. Tela de ficha e formulário usáveis em 390 px e em 1280 px, nos temas claro e
escuro.

RNF-05 Qualidade. `npm run typecheck`, `npm run build` e `npm run test` (vitest) verdes. As
migrations aplicam com `supabase db reset` sem erro, sem duplicar objetos, se o CLI estiver
disponível no ambiente (não verificado nesta análise).

### 3.3 Critérios de aceite (pronto = todos verdes)

AC-01 Tenant clínica, admin, atendimento `concluido`: registra a ficha com um campo. Ele aparece no
topo do histórico do cliente. [RF-01, RF-06] Prova: QA visual + teste de banco.

AC-02 Tenant clínica, profissional dono do atendimento em `em_atendimento`: registra a ficha. O
mesmo profissional não registra em atendimento de outro profissional. [RF-01, §5] Prova: teste de
banco + QA.

AC-03 Atendimento em `pendente`, `confirmado`, `cancelado` ou `nao_compareceu`: a ação não aparece e
o banco recusa o insert. [RF-02] Prova: teste de banco + QA.

AC-04 Conteúdo vazio, só com espaços, ou acima do limite: recusado em zod e no banco. [RF-03]
Prova: vitest + teste de banco.

AC-05 Correção de um registro: o original mostra "Corrigido", o novo mostra "Correção de". Segunda
correção do mesmo registro é recusada. Correção de outro atendimento ou outro cliente é recusada.
[RF-04] Prova: teste de banco + QA.

AC-06 UPDATE, DELETE e TRUNCATE em registro clínico falham para usuário autenticado e para service
role. Nenhuma linha muda. [RF-05] Prova: teste de banco.

AC-07 Recepção: a ficha não é lida (zero linhas no select), o insert é recusado, e a UI não mostra
seção, botão de ficha nem botão de registro. [RF-08] Prova: teste de banco + QA com login de
recepção.

AC-08 Admin lê todas as fichas do tenant e registra ou corrige em qualquer atendimento permitido.
[§5] Prova: teste de banco + QA.

AC-09 Profissional lê e registra só em atendimentos próprios. Lista de clientes e agenda mostram o
botão apenas nos atendimentos permitidos. [§5] Prova: teste de banco + QA.

AC-10 Usuário de outro tenant (inclusive de outro tenant clínica) não lê, não insere e não corrige.
Um `tenant_id` enviado pelo cliente é ignorado. [§4, isolamento] Prova: teste de banco.

AC-11 Tenant barbearia, salão ou legado: acesso por URL direta à ficha mostra o painel de
indisponibilidade em pt-BR, sem dado renderizado e sem requisição de registro clínico na aba de
rede. Repetido nos três ramos. [RF-07] Prova: QA visual com Chrome DevTools MCP.

AC-12 Tenant clínica: a ficha abre, registra e mostra histórico. [RF-01, RF-06] Prova: QA visual.

AC-13 Listagem de clientes, agenda e dashboard: nenhuma consulta a registros clínicos na aba de
rede. Nenhum valor de campo clínico em log, erro ou toast. [RF-09] Prova: QA visual + busca no
diff.

AC-14 Tenant `bloqueado` ou `cancelado`: não registra nem corrige. [RF-10] Prova: teste de banco +
QA.

AC-15 Após sair, ou após expiração da sessão, e entrar com outra conta no mesmo navegador: nenhum
registro da conta anterior aparece. [RF-11] Prova: QA visual.

AC-16 Barbearia e salão: agenda, clientes, comissão e combos sem regressão, sem erro de console.
[RF-12] Prova: QA visual + vitest.

AC-17 Typecheck, build e vitest verdes. Migrations aplicam sem erro. [RNF-05] Prova: execução
local.

AC-18 Base de exemplo: o script roda duas vezes sem duplicar, cria um tenant por segmento e o login
de cada papel funciona. Nenhuma senha aparece em arquivo versionado. [RF-13] Prova: execução +
QA de login.

---

## 4. Regras de fronteira que a demanda arrisca

Esta seção lista o que a demanda pode quebrar. Cada item vira verificação no PR.

4.1 Isolamento multi-tenant.
- O tenant de cada linha nova vem do banco (identidade do usuário autenticado), nunca de um
  parâmetro do cliente. Política de RLS compara a linha com o tenant do usuário.
- RLS habilitado na tabela nova. Nenhuma tabela de domínio fica sem política.
- Relações entre cliente, atendimento e registro usam chave composta que inclui o tenant. Um
  registro de um tenant não pode apontar para cliente ou atendimento de outro, mesmo com erro de app.
- Super admin não ganha caminho cross-tenant para esta tabela. Acesso de suporte futuro exige Edge
  Function auditada, fora desta demanda.

4.2 Segmento não é fronteira de dado.
- O ramo `clinica` controla só a exposição de tela (gating na própria rota). Não aparece em nenhuma
  cláusula de RLS.
- Um tenant de outro ramo sem permissão no banco também não lê, mesmo que a UI seja burlada.

4.3 RBAC dentro do tenant.
- Admin: tudo do tenant.
- Profissional: somente os próprios atendimentos (vínculo por `professionals.profile_id`).
- Recepção: nenhum acesso ao conteúdo clínico. Mesmo tratamento dado às comissões e cobranças.
- Super admin: nenhum acesso pelo cliente comum.

4.4 Status de assinatura.
- `bloqueado` e `cancelado` não escrevem ficha. Decisão D-08, com confirmação em Q-02.
- A base de exemplo não toca tenant de produção. Ver item de segredos abaixo.

4.5 Webhooks, idempotência e autenticidade.
- Não se aplicam: esta demanda não recebe nem processa webhook.

4.6 Segredos e credenciais.
- Nenhum segredo novo no bundle do frontend. Só a anon key e a sessão do usuário.
- Service role, quando usada pela base de exemplo, fica somente em variável de ambiente local,
  nunca em arquivo versionado e nunca no cliente.
- A senha de demonstração, quando existir, vem de variável de ambiente local. Nenhuma senha fixa
  em código.

4.7 LGPD e dado de saúde (ponto de atenção já comunicado ao usuário, que optou por seguir).
- Dado de saúde é dado pessoal sensível (art. 5º, II). A demanda trata isso como fronteira
  explícita: nenhum dado clínico em log, erro, telemetria, toast, URL, armazenamento do navegador,
  payload de listagem, mensagem WhatsApp ou requisição a Evolution API e Asaas.
- Minimização: três campos de texto livre, com limite de tamanho e validação zod. Sem CPF, RG,
  endereço ou convênio.
- O registro de autor usa o identificador do usuário. Nome do autor é exibido a partir do perfil,
  sem copiar nome para o registro clínico.
- `whatsapp_opt_in` não é consentimento para tratamento clínico. Não é reutilizado para esta
  finalidade.
- A base legal de tratamento (art. 11) e os papéis (controlador/operador) não são definidos por
  esta demanda. Ver Q-04.
- Retenção e pedido de eliminação ficam fora da demanda. Ver Q-03.

4.8 Dados não confiáveis.
- Nenhum webhook e nenhuma API externa entra nesta demanda. Entradas de usuário são validadas com
  zod antes de chegar ao banco.

4.9 Dinheiro e tempo.
- A ficha não tem valor monetário. Datas são gravadas em UTC (timestamptz) e exibidas no fuso do
  tenant.

4.10 Migrations.
- Toda mudança de schema é migration nova em `supabase/migrations`, com timestamp posterior a
  `20250226096000`. Nenhuma migration aplicada é editada.
- Migrations são idempotentes. Funções existentes mantêm o corpo atual, salvo mudança explícita.

4.11 Branch e base.
- Branch nova a partir de `origin/master` (4fb5598). Não a partir de `feat/combos-pacotes-salao`,
  que está atrás e tem alterações não commitadas que não fazem parte desta demanda.
- Sem push direto em master. PR novo ao final.

---

## 5. Perfis de acesso

Legenda: sim = pode; não = recusado no banco e na UI; próprio = só atendimentos em que é o
profissional responsável.

| Ação | super_admin | admin (tenant clínica) | professional (vinculado) | receptionist | Tenant não clínico |
|------|:-:|:-:|:-:|:-:|:-:|
| Ler ficha (histórico e básicos) | não | sim (todo o tenant) | sim (próprio) | não | não (tela indisponível) |
| Registrar ficha | não | sim, em `em_atendimento`/`concluido` | sim, em próprio atendimento | não | não |
| Registrar correção | não | sim, em `em_atendimento`/`concluido` | sim, só em registro de autoria própria, no próprio atendimento | não | não |
| Editar ou excluir registro | não | não | não | não | não |
| Ver botão "Ficha" em clientes | não | sim | sim | não | não |
| Ver botão "Registrar ficha" na agenda | não | sim | sim, no próprio atendimento | não | não |
| Profissional sem vínculo (`profile_id` ausente) | — | — | sem acesso; mensagem "Perfil sem vínculo" | — | — |

Observação: a UI apenas reflete o que o banco permite. A fronteira real é a RLS.
Correção pelo profissional só vale sobre registro de autoria própria (o original foi criado pelo
próprio usuário). Correção de registro do admin ou de outro profissional, mesmo no próprio
atendimento, é recusada. A restrição não se aplica ao admin.

---

## 6. Enquadramento no roadmap e dependências

- Dependências já atendidas (master): Fase 1a (personalização por segmento); Fase 1b barbearia
  (comissão, PR #14); Fase 1b salão (combos, PR #15).
- Enquadramento: Fase 1b do ramo clínica, primeiro recurso de domínio da clínica. Não consta
  entre os itens de Fase 3 de `produto.md`, então segue como extensão da Fase 1b, conforme pedido
  do usuário.
- Dependências de schema já existentes e usadas: `customers` (com `unique (tenant_id, id)`),
  `appointments` (com `unique (tenant_id, id)`, migration `20250220089000`), `professionals` (com
  vínculo `profile_id`), `tenants.segment` e `tenants.subscription_status`.
- Alteração necessária em `appointments`: adicionar unique `(tenant_id, id, customer_id)` para a
  chave composta cliente/atendimento. Aditiva, sem risco com dado existente.
- Fora do MVP, não tocar: autoagendamento público, taxa de reserva antecipada, métricas
  consolidadas (Fase 3).
- Dependência de ambiente: o QA visual exige tenant clínica com atendimentos em `em_atendimento` e
  `concluido`, profissional vinculado, profissional sem vínculo, recepção, e tenants de barbearia,
  salão e legado. A base de exemplo (RF-13) atende a isso, ou os dados são criados manualmente.

---

## 7. Pontos levantados pelo usuário e decisões

Cada ponto do pedido está listado. Itens com "Decidido" já têm resposta do usuário ou decisão
explícita do PRD. Itens "Aberto" precisam de resposta antes do planejamento.

| # | Ponto | Status | Onde |
|---|-------|--------|------|
| P-01 | Recurso da clínica = ficha do cliente (informações básicas, observações e histórico) | Decidido (usuário, 1=a) | §2.1 |
| P-02 | Fluxo real ponta a ponta, mesmo padrão das fases anteriores | Decidido (usuário, 2=sim) | §3 |
| P-03 | Pronto = funciona só para `segment='clinica'`, sem afetar barbearia, salão e legado | Decidido (usuário, 3=sim) | RF-07, RF-12, AC-11, AC-16 |
| P-04 | Dado de saúde (LGPD, dado sensível): ponto já comunicado, usuário optou por seguir | Decidido (fronteira explícita) | §4.7 |
| P-05 | Registrar durante ou após atendimento concluído | Decidido com interpretação: "durante" = `em_atendimento`; "após" = `concluido`. Ver Q-10. | RF-01, RF-02 |
| P-06 | Ficha imutável; correções geram novo registro | Decidido | RF-04, RF-05 |
| P-07 | Recepcionista não lê conteúdo clínico | Decidido | RF-08, §5 |
| P-08 | Admin lê tudo do tenant | Decidido | §5, AC-08 |
| P-09 | Profissional lê conforme o vínculo definido no PRD | Decidido: só atendimentos próprios (D-06). Confirmação em Q-01. | §5, AC-02, AC-09 |
| P-10 | Acesso por URL direta em tenant de outro ramo mostra painel de indisponibilidade, sem dados | Decidido | RF-07, AC-11 |
| P-11 | Isolamento multi-tenant preservado | Decidido | §4.1, AC-10 |
| P-12 | Nenhum conteúdo clínico em log | Decidido | RF-09, AC-13 |
| P-13 | typecheck, build e vitest verdes; QA visual ao vivo; PR novo | Decidido | RNF-05, AC-17, §8 |
| P-14 | Base de exemplo para barbearia, salão e clínica, para testar e para cliente validar | Decidido em escopo (RF-13). Destino e senha em aberto (Q-06, Q-09). | §2.1, RF-13, AC-18 |
| P-15 | Usuário por segmento, com senha demo, para não criar empresa toda vez | Parcial. Usuário por segmento: decidido. Senha `demo`: aberto (Q-06). | RF-13, D-09 |
| P-16 | Recepção sem acesso a dado sensível (paridade com financeiro) | Decidido | §5 |
| P-17 | Ajuste de contraste dos tokens de cor (pré-existente, afeta o app todo) | Aberto (Q-08) | §8 |
| P-18 | Limpeza de cache no evento de sessão | Decidido (RF-11) | RF-11, AC-15 |

Decisões do PRD (D-xx) e perguntas em aberto (Q-xx):

D-01 Ficha append-only. Sem edição e sem exclusão na UI nem no banco. Correção = registro novo.
Motivo: preservar histórico clínico e cumprir P-06.

D-02 Registro permitido em `em_atendimento` e `concluido`. Motivo: "durante ou após" o atendimento.
Se o usuário quiser só `concluido`, a mudança é de uma lista. Ver Q-10.

D-03 Profissional só vê e registra em atendimentos que são dele. Motivo: mínimo privilégio. Ver Q-01.

D-04 Segmento fora de RLS. Gating só de UI, na própria rota. Motivo: `seguranca-multitenant.md`
e lição do PR #15 (guard na página, não só no atalho).

D-05 Três campos clínicos: alergias (até 500), medicamentos (até 500) e observações do
atendimento (até 2000). Motivo: minimização, LGPD art. 6º, III. A análise de frontend propôs um
quarto campo (histórico relevante, até 1000) e nomes de tabela diferentes (`clinical_entries`) da
análise de dados (`clinical_records`). Decidido o conjunto de três campos. Nome de tabela e de
coluna fica para a ADR de schema, que deve unificar as duas análises. Ver Q-05.

D-06 Vínculo do profissional pelo `profile_id` em `professionals`, como já é feito em
agendamentos e comissões. Recepção nunca lê.

D-07 Sem Edge Function nesta demanda. Leitura e escrita por PostgREST com RLS e sessão.

D-08 Assinatura: `bloqueado` e `cancelado` não gravam ficha. A regra vale no banco e na app. O
padrão atual do projeto aplica só na app; aqui vai também ao banco, por ser dado sensível. Ver Q-02.

D-09 Base de exemplo: script de desenvolvimento em `scripts/`, fora de `src/` e fora de
`supabase/migrations`. Usa service role só a partir de variável de ambiente local. Só roda contra
endereço local, com flag explícita. Cria um tenant por segmento, usuário administrador em cada um,
e para clínica também profissional e recepção. Dados fictícios, sem PII real, telefones em faixa
reservada, idempotente. Motivo: seed com senha conhecida não pode ser migration, porque roda em
todo ambiente.

D-10 Pré-carga das informações básicas no novo registro a partir do registro vigente mais recente
visível ao usuário. É sugestão editável, nunca gravada sem envio. Motivo: reduz digitação
repetida. Ver Q-07.

D-11 Limite de texto livre validado em zod e no banco, com o mesmo valor. Divergência é defeito.

Perguntas em aberto (com a alternativa padrão que o planejamento usará se não houver resposta):

Q-01 Histórico entre profissionais. Um profissional deve ver a ficha registrada por outro profissional
no mesmo cliente? Padrão: não (D-03). Se a clínica quiser histórico compartilhado, muda a regra de
leitura, sem mudar o resto.

Q-02 Bloqueio de escrita no banco para `bloqueado` e `cancelado`. Padrão: sim (D-08). Hoje o projeto
faz isso só na app. Se a decisão for só app, o banco deixa de proteger esse caso.

Q-03 Retenção e eliminação. Qual prazo de guarda e qual procedimento para pedido de eliminação?
Depende da profissão atendida e de orientação própria. Fora desta demanda. Sem resposta, nenhuma
eliminação existe no produto.

Q-04 Base legal e papéis LGPD (controlador e operador). Não é decisão técnica. Fora desta demanda.
Validar com assessoria jurídica antes de colocar em produção com dado real de cliente.

Q-05 Campos básicos. Os três campos cobrem o que o usuário quer? Padrão: sim (D-05). Se quiser o
campo de histórico relevante, a alteração é aditiva, mas precisa de decisão de minimização.

Q-06 Senha da base de exemplo. O pedido original fala em senha `demo`. A análise aponta que `demo`
tem 4 caracteres e que o Auth do Supabase, no padrão do GoTrue, pede 6 (não verificado neste
projeto; `supabase/config.toml` não define o valor). Opções: (a) manter `demo` com ajuste de Auth só
no ambiente local; (b) senha de 6 ou mais caracteres. Padrão: (b) com senha vinda de variável de
ambiente local. Em nenhum caso a senha vai para código versionado.

Q-07 Pré-carga de informações básicas (D-10). Padrão: sim, como sugestão editável. Se preferir que
cada registro seja preenchido do zero, a regra muda só na UI.

Q-08 Ajuste de tokens de contraste. Os tokens de cor do tema claro têm pares que falham WCAG AA
(botão primário, anel de foco, borda de campo). Afetam o app inteiro, não só a ficha. Padrão: commit
separado, na mesma branch, antes do commit da ficha, para não misturar mudança visual com
funcionalidade. Valores exatos ficam para o planejamento e a medição no DOM.

Q-09 Destino da base de exemplo. Roda só local, ou também em um projeto de demonstração separado?
Padrão: só local. Qualquer execução contra projeto remoto exige aprovação explícita do usuário, e
nunca contra o projeto de produção. Também: entra no mesmo PR, em commit separado, ou em PR próprio?
Padrão: mesmo PR, commit separado.

Q-10 Estados permitidos. Confirmar se "durante" é `em_atendimento` e "após" é `concluido` (D-02).
Padrão: sim.

---

## 8. Critério de aceite visual (QA com Chrome DevTools MCP)

Todos os itens sem erro de console. Cada item precisa de evidência (snapshot, lista de rede ou
medição).

V-01 Clínica, admin: "Ficha" aparece em Clientes. A ficha mostra informações básicas, histórico e o
aviso de dado sensível. Registro criado a partir de atendimento `concluido` aparece no topo.

V-02 Clínica, admin: "Registrar correção" abre o diálogo com o conteúdo do original. Depois de
salvar, o original mostra "Corrigido" e o novo mostra "Correção de". Não existem botões de editar
ou excluir.

V-03 Clínica, profissional com vínculo: vê só registros dos próprios atendimentos. O botão
"Registrar ficha" aparece só nos próprios atendimentos em `em_atendimento` ou `concluido`.
Atendimento `pendente` ou `confirmado` não mostra o botão.

V-04 Clínica, profissional sem vínculo: mostra "Perfil sem vínculo" e não mostra botão de registro.

V-05 Clínica, recepção: sem "Ficha" em Clientes, sem "Registrar ficha" na agenda. Pela URL direta,
mostra "Acesso restrito". A rede não tem chamada a registros clínicos.

V-06 Barbearia, salão e legado (`null`), por URL direta à ficha: mostra "disponível apenas para
clínicas". Nenhum dado, nenhum esqueleto de registro, nenhuma chamada a registros clínicos na rede.
Repetir nos três ramos.

V-07 Sem flash de conteúdo clínico: o primeiro quadro, em qualquer caminho, não mostra dado clínico
(screencast ou trace).

V-08 Responsivo e tema: 390 px e 1280 px, tema claro e escuro. Sem quebra de layout. Contraste de
texto do cartão, do rodapé e do selo de 4,5:1 ou mais, medido no DOM.

V-09 Teclado: do cabeçalho ao botão de correção em ordem de leitura. Esc fecha o diálogo e o foco
volta ao gatilho. Foco visível em todos os controles.

V-10 Descarte: com alteração não salva, fechar pede confirmação. Sem alteração, fecha direto.

V-11 Limites: 501 caracteres em alergias mostra erro e bloqueia o envio. O contador é anunciado
por leitor de tela.

V-12 Sessão: após sair e entrar com outra conta no mesmo navegador, nenhum registro da conta
anterior aparece antes do novo carregamento.

V-13 Console: nenhuma mensagem de erro ou aviso nos caminhos positivos e negativos. Nenhum conteúdo
de registro em mensagem de console.

V-14 Base de exemplo: login com o usuário de cada papel e segmento funciona, e o histórico de
clínica aparece com dados fictícios.

---

## 9. Riscos conhecidos

- Recepção ver a ficha por atalho de UI (badge, contador). Mitigado por AC-07, RF-09 e pela regra
  de não indicar existência.
- Confundir gating de rota com fronteira de dado. Mitigado por D-04 e AC-10.
- Erro de banco com valor de campo em log. Mitigado por mensagens fixas e por não ecoar valor.
- Cache de ficha após troca de usuário. Mitigado por RF-11 e AC-15.
- Base de exemplo com senha conhecida em ambiente remoto. Mitigado por D-09 e Q-09.
- Migration aplicada e depois editada. Proibido. Qualquer ajuste vira migration nova.
- Ausência de suíte de RLS hoje. A demanda cria a primeira; o planejamento escolhe a ferramenta de
  teste de banco.
