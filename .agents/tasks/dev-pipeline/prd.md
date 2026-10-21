# PRD — WhatsApp Fase 2, Fatia 1: Templates de mensagem editáveis por tenant

Projeto: **atlas-agenda** · base: `master` (default branch) · tipo de rota: **Feature**
Documento de **contrato da demanda** (o QUE precisa existir e COMO se prova). A solução técnica
detalhada vem nas ADRs do planejamento, após a aprovação humana deste PRD.

Fontes consolidadas: `analysis-data.md` (dados/segurança), `analysis-frontend.md` (frontend),
steerings `produto.md` / `dominio.md` / `stack.md` / `seguranca-multitenant.md` /
`convencoes-codigo.md`, e leitura do código atual (`supabase/functions/whatsapp/index.ts`,
`src/types/domain.ts`, `src/lib/whatsapp.ts`, `src/hooks/usePermissions.ts`, `src/router.tsx`).

---

## 1. Problema e valor de negócio

Hoje o disparo de WhatsApp sob demanda envia **texto cru**: em
`supabase/functions/whatsapp/index.ts`, `handleSend` chama
`adapter.sendText({ ..., text: input.template })` — ou seja, manda a **string da chave**
(`"confirmacao"`, `"lembrete_d1"`, …) como se fosse o corpo da mensagem. O cliente final recebe
literalmente a palavra-chave, não uma mensagem útil.

Esta fatia entrega o **CRUD de templates de mensagem por tenant**, com **variáveis**, e troca a
origem do texto enviado: o disparo passa a usar o **template renderizado do tenant** (variáveis
substituídas, com fallback previsível). Valor quando estiver pronto:

- **Comunicação personalizada e padronizada:** cada empresa envia mensagens com nome do cliente,
  serviço, data/hora e nome da empresa, em vez de texto genérico/cru — o degrau que torna a régua
  de comunicação (objetivo central do produto) utilizável e prepara a confirmação interativa da
  Fatia 2.
- **Autonomia do admin:** cada tenant edita seus próprios textos sem depender de deploy
  ("mensagens personalizadas" é diferencial dos planos Clínica/Pro — produto.md).
- **Nova superfície de domínio sob isolamento:** introduz uma tabela nova de dados do tenant; o
  isolamento por RLS é requisito inegociável desde o primeiro registro.

### Definição de defeito (do pedido do usuário — cada item vira critério de aceite nesta fatia)

1. Template **vazar entre tenants** (falha de RLS).
2. **Quebrar o envio sob demanda atual** (regressão do fluxo `send`).
3. Renderizar **variável não resolvida sem controle** (ex.: enviar `{nome}` cru ao cliente final).
4. **Expor segredo/PII em log** (telefone, texto renderizado com dado pessoal, token).

---

## 2. Escopo

### 2.1 Dados / Supabase (entra)

- Nova tabela `message_templates` por tenant: uma linha por `(tenant_id, template_key)` para as 4
  chaves padrão (`confirmacao`, `lembrete_d1`, `cobranca`, `comprovante`), com `body` pt-BR,
  `active`, timestamps. `unique (tenant_id, template_key)`, índice em `tenant_id`, **RLS
  habilitada**. Migration versionada em `supabase/migrations` (nova, idempotente, nunca editar
  migration aplicada).
- **Seed/baseline** dos 4 templates padrão pt-BR: ao criar tenant novo (acoplado a
  `handle_new_user`, via função `security definer` idempotente) e backfill idempotente para
  tenants existentes.
- **Renderização no envio (server-side):** `handleSend` passa a carregar o `body` do template do
  tenant (service role, dentro do tenant resolvido), resolver as variáveis e enviar o **texto
  renderizado** ao adapter, em vez de `input.template` cru.

### 2.2 Frontend (entra)

- Nova sub-rota de Configurações `/app/config/mensagens` (ver decisão de rota em §7-D1): tela que
  lista os **4 templates** do tenant em cards (domínio fechado, sem "novo"/"excluir") e abre um
  `Dialog` de edição por chave.
- Editor com **react-hook-form + zod**, `Textarea` (novo primitivo shadcn), **barra de chips de
  variável** que inserem o token no cursor, contador de caracteres e **preview ao vivo** com dados
  de exemplo pt-BR mostrando a substituição e o fallback.
- `SendMessageDialog` (envio sob demanda) ganha um **bloco de preview** do texto renderizado que
  será enviado; o contrato de fio de `send` **não muda** (payload `action|template|customerId|
  appointmentId?`). O preview da UI é defesa em profundidade; a renderização canônica é do servidor.
- Dados via **TanStack Query** (`useMessageTemplates` / `useUpsertMessageTemplate`), escrita do
  cliente sob RLS (não via Edge Function — templates são conteúdo editorial, como `services`).
- Nova capacidade `canManageMessageTemplates` (= `isAdmin`) em `usePermissions`, espelhando
  `canManageWhatsAppConnection`.

### 2.3 Fora de escopo (Fatia 2, próximo run — contrato preparado, NÃO implementar)

Confirmação interativa, webhook de entrada da Evolution, `pg_cron`/agendador (lembrete D-1), fila
de retentativa, botões interativos. **Decisões já tomadas** para a Fatia 2: resposta por **opção
numérica** (`1 confirmar`) e lembrete D-1 via **pg_cron** do Supabase. Nesta fatia isso se traduz
**apenas** em: o texto do `lembrete_d1` pode conter `1 confirmar / 2 reagendar` como texto livre,
sem nenhuma lógica de parsing/webhook/cron acoplada.

### 2.4 Fora de escopo (MVP — Fase 3, não antecipar)

Link público de autoagendamento, taxa de reserva antecipada, métricas consolidadas (produto.md).
Também fora desta fatia: variável `{valor}`/PIX (depende do módulo Asaas/cobranças —
ver §7-D4), customização por plano, histórico/versionamento de templates.

---

## 3. Requisitos e critérios de aceite testáveis

Cada requisito traz entrada → saída observável. Numeração alinhada às análises de origem.

### RF-T01 — Tabela de templates por tenant
- **Entrada:** aplicar a migration (`supabase db reset` / `supabase start`).
- **Saída (AC-01):** existe `message_templates` com as colunas de §8-dados, `unique (tenant_id,
  template_key)`, índice em `tenant_id`, RLS habilitada; aplica sem erro.

### RF-T02 — Baseline/seed dos 4 templates
- **Entrada:** cadastro de empresa nova (`handle_new_user`); e re-execução da baseline em tenant
  que já tem as 4 linhas.
- **Saída (AC-02):** tenant novo nasce com exatamente **4 linhas** (uma por chave), textos padrão
  pt-BR não vazios; re-executar **não duplica** (idempotência via `on conflict do nothing`).

### RF-T03 — Leitura dos templates
- **Entrada:** admin abre `/app/config/mensagens`.
- **Saída:** a tela lista os 4 templates do tenant com o texto atual. Leitura permitida a `admin`
  (ver §5). Recepção/profissional **não** leem/editam (a renderização é server-side; não precisam).

### RF-T04 — Edição pelo admin
- **Entrada:** admin edita o `body` de um template no editor e salva.
- **Saída:** persiste em `message_templates` sob RLS do tenant; toast pt-BR "Modelo atualizado";
  a prévia do card reflete o novo texto (cache invalidado).

### RF-T05 — Conjunto fechado de variáveis
- **Entrada:** `body` com variáveis.
- **Saída:** suporta o conjunto **fechado** `{nome}`, `{servico}`, `{dataHora}`, `{empresa}`
  (ver §7-D4 sobre `{valor}` fora de escopo). Variável fora da lista (ex.: `{foo}`) **não quebra**
  o save nem o envio — tratada na renderização (ver RF-T07). Lista travada em const/enum
  compartilhado entre preview (cliente) e servidor.

### RF-T06 — Renderização no envio (server-side) — cobre defeito #2/#3
- **Entrada:** admin edita `confirmacao` para `"Olá {nome}, seu horário de {servico} é {dataHora}."`
  e dispara "Enviar mensagem" para um cliente com opt-in.
- **Saída (AC-05):** o `text` entregue ao adapter é o **texto renderizado** com `{nome}/{servico}/
  {dataHora}` substituídos pelos dados reais — **nunca** a string `"confirmacao"`. Renderização
  ocorre **no servidor** (Edge Function), dados resolvidos sob service role dentro do tenant.

### RF-T07 — Fallback previsível — cobre defeito #3
- **Entrada:** template com `{nome}` disparado para um caso em que o dado falta (ex.: sem
  agendamento → sem `{servico}/{dataHora}`).
- **Saída (AC-06):** a variável é substituída por um **fallback pt-BR definido** — nunca o
  placeholder cru. Tabela de fallback (contrato compartilhado cliente↔servidor):
  - `{nome}` → `cliente`
  - `{servico}` → `seu atendimento`
  - `{dataHora}` → `no horário combinado`
  - `{empresa}` → `trade_name` do tenant, ou `nossa equipe` se nulo
  - token **desconhecido** → mantido literal (decisão consciente — só as variáveis conhecidas têm
    fallback), nunca exibindo um erro ao cliente.
  - **Template ausente** (tenant legado sem baseline): servidor usa o **texto de sistema padrão**
    da chave — nunca envia vazio nem a chave crua.

### RF-T08 — Preservar o envio atual — cobre defeito #2
- **Entrada:** disparos nas condições atuais.
- **Saída (AC-07):** os 5 `outcome` de `send` (`sent | duplicate | opt_out | not_connected |
  send_failed`) continuam produzidos nas mesmas condições e com os mesmos status HTTP. Opt-in,
  idempotência (`dedupe_key`) e checagem de instância conectada permanecem antes do envio. O
  contrato de fio de `send` **não muda**.

### RF-T09 — Contrato preparado para a Fatia 2 (sem implementar)
- **Entrada:** `body` do `lembrete_d1` com `1 confirmar / 2 reagendar`.
- **Saída (AC-09):** renderiza o texto sem erro; **nenhum** endpoint de webhook/entrada, job de
  cron ou parsing é adicionado neste run (verificável pela ausência de arquivos/migrations
  correspondentes). A modelagem não impede evolução aditiva futura.

### RNF-T01 — Isolamento multi-tenant — cobre defeito #1
- **Entrada:** dois tenants A e B; usuário autenticado de A (anon key + JWT, **não** service role).
- **Saída (AC-03):** `select` em `message_templates` retorna **somente** linhas de A; `update` de
  linha de B é **negado** por RLS. `tenant_id` deriva do JWT/`profiles` (`current_tenant_id()`),
  nunca de parâmetro do cliente.

### RNF-T02 — Segredos e PII em log — cobre defeito #4
- **Saída (AC-08):** nenhum log da Edge Function imprime telefone do cliente nem o texto
  renderizado em claro; `messages.payload` continua sem PII (pode registrar `template_key` e
  metadados não sensíveis); nenhum segredo da Evolution em log/resposta/bundle; `grep` por `VITE_`
  não encontra chave da Evolution.

### RNF-T03 — TS estrito + validação zod
- **Saída:** tipos novos sem `any`; `body` e payload de edição validados com zod no cliente; shape
  lido do banco validado antes do uso; lista de variáveis como enum fechado.

### RNF-T04 — Migration versionada e idempotente
- **Saída:** mudança de schema em migration nova (timestamp posterior à última aplicada),
  idempotente no re-apply (`create table if not exists` / `drop policy if exists` / `on conflict
  do nothing`); nenhuma migration aplicada é editada.

### RNF-T05 — Determinismo da renderização
- **Saída:** a função de render é pura e determinística dado (template, dados resolvidos): mesma
  entrada → mesma saída; testável isolada.

### AC-10 — Build/typecheck + QA ao vivo
- **Saída:** `npm run build` / typecheck limpos. QA ao vivo (chrome-devtools) em
  `/app/config/mensagens`: admin edita um template, dispara "Enviar mensagem" (Agenda/Clientes) e
  confirma que o texto enviado é o **renderizado**, não a string crua. Ambiente local:
  `supabase start`; `supabase functions serve whatsapp --env-file supabase/functions/.env`;
  `npm run dev` (porta a partir de 5173).

---

## 4. Regras de fronteira que a demanda arrisca

Esta fatia introduz uma tabela de domínio nova e troca a origem do texto enviado — ambas tocam
fronteiras de segurança inegociáveis.

- **Isolamento multi-tenant por RLS:** `message_templates` com `tenant_id not null default
  current_tenant_id()` + índice + **RLS habilitada**. `tenant_id` sempre do JWT/`profiles`,
  **nunca** de parâmetro do cliente. Políticas de escrita com `WITH CHECK` espelhando o `USING`
  (barra gravar linha de outro tenant). Reusar os helpers `current_tenant_id()` /
  `current_role_name()` (security definer) — **não** reimplementar (evita recursão de RLS).
- **RBAC admin/professional/receptionist:** edição e leitura de templates **somente `admin`**
  (configuração do dono do tenant, espelha `whatsapp_instances`/`tenants`). O envio continua
  disponível a admin/receptionist/professional (`canSendWhatsAppMessage`) porque quem lê o template
  no envio é a Edge Function com service role, não o cliente — logo restringir a leitura dos
  templates ao admin **não** quebra o envio. `super_admin` **sem** caminho cross-tenant pelo
  cliente a esta tabela.
- **Status de assinatura:** a trava de suspensão de disparo (`bloqueado`/`cancelado`) já existe em
  `handleSend` e **permanece intacta**; esta fatia não a altera.
- **Renderização server-side (fronteira única de envio):** o cliente **nunca** monta o texto final
  — fecha a porta a forjar corpo/burlar log. O preview no cliente é só defesa em profundidade.
- **Segredos fora do cliente:** token/URL da Evolution continuam só em env do servidor; nenhuma var
  `VITE_` com segredo; `anon key` é a única chave no bundle.
- **LGPD (opt-in + PII mínima em log):** opt-in (`whatsapp_opt_in`) permanece conferido antes do
  envio; o **texto renderizado** (que contém o nome do cliente) e o telefone **não** vão a log em
  claro; `messages.payload` segue sem PII. O `body` do template não é segredo nem PII (é texto com
  placeholders).
- **Idempotência / autenticidade de webhook:** não há webhook nesta fatia (Fatia 2). A
  idempotência do `send` (`dedupe_key` + índice único parcial) **permanece intacta**.
- **Dados não confiáveis:** o shape lido do banco e o payload de edição são validados com zod antes
  do uso; variável desconhecida no `body` nunca vira erro enviado ao cliente.

---

## 5. Perfis de acesso

| Ação | super_admin | admin | professional | receptionist |
|---|---|---|---|---|
| Ler templates do tenant (`select`) | — (sem caminho cross-tenant pelo cliente) | ✅ | ❌ | ❌ |
| Criar/editar template (`insert`/`update`) | — | ✅ | ❌ | ❌ |
| Acessar a tela `/app/config/mensagens` | — | ✅ | ❌ (`AccessDenied`) | ❌ (`AccessDenied`) |
| Disparar "Enviar mensagem" (inalterado) | — | ✅ | ✅ | ✅ |
| Renderizar o template no envio | — (feito pela Edge Function com service role, dentro do tenant) | — | — | — |

A trava real de todas as linhas acima é **RLS** no banco; o gate de UI (`canManageMessageTemplates
= isAdmin`, atalho no hub só para admin, `AccessDenied` por URL) é defesa em profundidade.

---

## 6. Enquadramento no roadmap e dependências anteriores

| Fase | Entregue | Esta fatia |
|---|---|---|
| Fase 1 (MVP) | Conexão por QR, envio **sob demanda** (ADR-04/06/07/08), log `messages`, idempotência por `dedupe_key`, opt-in LGPD, E.164 | — |
| **WhatsApp Fase 2 — Fatia 1** | — | **Templates editáveis por tenant + renderização no envio sob demanda** ← este run |
| WhatsApp Fase 2 — Fatia 2 | — | Confirmação interativa numérica, webhook de entrada Evolution, pg_cron (lembrete D-1), fila de retentativa — **contrato preparado, não implementado** |
| Fase 3 | — | Autoagendamento público, taxa de reserva, métricas (fora de escopo) |

Dependências/reuso (não recriar):
- `MESSAGE_TEMPLATES` (enum das 4 chaves) já existe em `src/types/domain.ts`; `getMessageTemplateLabel`
  em `src/lib/whatsapp.ts`; `messages.template` já é esse enum no banco.
- Edge Function `whatsapp` (service role, resolução de `tenant_id`/`role` do JWT, opt-in,
  idempotência, checagem de instância conectada, normalização E.164) permanece intacta — esta
  fatia só troca a origem do `text` enviado ao adapter.
- Padrão de config sob `src/app/config/` (hub + sub-rotas `servicos`/`profissionais`/`whatsapp`) e
  de RBAC por capacidade em `usePermissions` (`canManageWhatsAppConnection: isAdmin`).
- ADR-08 "Enviar mensagem sob demanda" (diálogo com opt-in + idempotência + checagem de instância)
  é a base preservada.

---

## 7. Pontos levantados pelo usuário e decisões (nenhum descartado)

Pontos do usuário (mensagens 11–12) e divergências entre as duas análises — cada um registrado como
decisão tomada ou pergunta em aberto.

- **Usuário: "primeiro os templates, depois a interação."** → Decisão: esta fatia entrega **só os
  templates + renderização**; a interação (confirmação) é Fatia 2. Respeitado.
- **Usuário: resposta por opção numérica (`1 confirmar`).** → Decisão (Fatia 2, não implementar
  agora): só o **texto** do `lembrete_d1` comporta `1 confirmar / 2 reagendar` como texto livre.
  Nenhum parsing/webhook neste run (RF-T09).
- **Usuário: lembrete D-1.** → Decisão (Fatia 2): via **pg_cron** do Supabase; não neste run.
- **D1 — Rota da tela (divergência entre análises).** `analysis-frontend.md` propôs
  `/app/config/mensagens` (sub-rota nova); `analysis-data.md` citou editar dentro de
  `/app/config/whatsapp`. → **Decisão: `/app/config/mensagens`** (sub-rota nova no grupo de
  Configurações). Razão: a tela de WhatsApp é a máquina de estados da **conexão** (parear QR,
  status); templates são **conteúdo editorial** do tenant, ciclo de vida distinto. Rota dedicada
  mantém cada tela com um trabalho só e evita inflar a tela de conexão. O hub de Configurações
  ganha um 4º atalho, visível só para admin.
- **D2 — Padrão da tela.** → Decisão: **lista fixa de 4 cards** (domínio fechado), editor em
  `Dialog`, sem "novo"/"excluir"; robusta a lacuna de seed (cards "a configurar" derivados de
  `MESSAGE_TEMPLATES` quando o fetch vier com < 4).
- **D3 — Onde moram os templates.** → Decisão: **tabela própria `message_templates` por tenant**
  (uma linha por `(tenant_id, template_key)`, seed dos 4 padrões), em vez de "defaults de sistema +
  override difuso". Razão: caminho de leitura único (banco), tela mais simples (sem estado
  "herdado vs customizado"), evolução mais fácil; o fallback de template ausente cobre tenant
  legado até a baseline rodar.
- **D4 — Variável `{valor}` (divergência entre análises).** `analysis-frontend.md` listou `{valor}`
  nos chips; `analysis-data.md` excluiu (depende do módulo Asaas/cobranças). → **Decisão: fora de
  escopo da Fatia 1.** A lista fechada desta fatia é `{nome} {servico} {dataHora} {empresa}`.
  `{valor}` é evolução **aditiva** futura (não quebra a modelagem). Consequência para o
  planejamento: **manter a lista fechada idêntica entre o chip-bar do editor, o `renderTemplate` do
  preview e o render do servidor** — não introduzir `{valor}` em nenhum dos três nesta fatia.
- **D5 — Onde a renderização acontece.** → Decisão: **100% no servidor** (`handleSend`). Renderizar
  no cliente e enviar texto pronto foi **rejeitado** (abriria espaço para forjar corpo/burlar log;
  o servidor é a fronteira única de envio). O preview no cliente é só defesa em profundidade.
- **D6 — RBAC de leitura dos templates.** → Decisão: **leitura e escrita só `admin`**. Recepção/
  profissional não precisam ler os templates para disparar (render é server-side), então restringir
  reduz a superfície sem quebrar o envio.
- **D7 — Primitivo `Textarea`.** → Decisão: adicionar `src/components/ui/textarea.tsx` (shadcn
  padrão); hoje o projeto só tem `input.tsx`. Peça canônica, não primitivo caseiro.
- **Pergunta em aberto (não bloqueante):** limite de caracteres do `body`. `analysis-frontend.md`
  sugeriu zod `max(1000)`; `analysis-data.md` sugeriu `check (char_length between 1 and 2000)` na
  coluna. → Assunção para o planejamento: **a coluna aceita até 2000; o form limita a 1000** (o
  banco é o teto de segurança, a UI o limite prático). O planejamento confirma/ajusta na ADR de
  schema — não bloqueia a aprovação do PRD.

---

## 8. Critério de aceite visual (verificável via Chrome DevTools)

1. Em `/app/config` existe o atalho "Modelos de mensagem", **visível só para `admin`**; clicar leva
   a `/app/config/mensagens`. Papel não-admin que acessa a URL vê `AccessDenied`.
2. A tela lista os **4 cards** (Confirmação, Lembrete (24h antes), Cobrança, Comprovante), cada um
   com rótulo pt-BR, badge Ativo/Inativo e prévia truncada do corpo. Mobile (<`sm`): 1 coluna, sem
   overflow horizontal; desktop: 2 colunas.
3. "Editar" abre o `Dialog` com o corpo atual no `Textarea`, os chips de variável e o preview ao
   vivo. Clicar um chip insere o `{token}` no texto; o preview atualiza substituindo variáveis por
   dados de exemplo pt-BR e **nunca** exibe `{token}` cru (fallback visível quando o dado falta).
4. Salvar mostra toast "Modelo atualizado", fecha o diálogo e a prévia do card reflete o novo texto.
5. No diálogo de **Enviar mensagem** (Agenda/Clientes), ao escolher um template aparece o preview do
   texto renderizado que será enviado; o envio continua funcionando (os 5 outcomes inalterados) e o
   texto efetivo é o **template renderizado**, não a string crua da chave.
6. **Isolamento por tenant:** logado em tenant A, a tela mostra só os templates de A; editar em A
   não afeta B; não há como enviar `tenant_id` pelo cliente para ver os de outro (RLS).
7. **Acessibilidade:** `Tab` alcança cards → Editar → chips → textarea → Switch → Salvar/Cancelar;
   foco visível; `Esc` fecha o diálogo e devolve o foco ao gatilho; labels associados; contraste do
   texto do preview e do realce de token conferidos (realce de token por **fundo**, texto em
   `foreground` — não depender só da cor para marcar a variável). Validação WCAG completa exige
   teste manual com ferramenta de contraste/leitor de tela; o QA por ADR confere os pares renderizados.
8. Build/typecheck limpos e verificação ao vivo (tela + envio) **sem erro de console**.

---

## 9. Verificação da fatia (resumo)

- **Unit (render):** substituição correta, fallback por variável faltante, token desconhecido
  mantido literal, template ausente cai no padrão de sistema (RNF-T05, AC-05/AC-06).
- **Integração (RLS):** duas sessões autenticadas (dois tenants) — A não lê/edita template de B;
  receptionist/professional não editam (AC-03/AC-04). Via anon key + JWT, não service role.
- **Integração (envio):** adapter mock recebe o texto **renderizado**; os 5 outcomes continuam
  corretos (AC-05/AC-07).
- **Migration/baseline:** `supabase db reset` aplica; tenant novo nasce com 4 templates; backfill
  não duplica (AC-01/AC-02).
- **Build/QA ao vivo:** `npm run build`/typecheck limpos; QA chrome-devtools em
  `/app/config/mensagens` (AC-10).

Entrega sobre `master`, em **branch nova + commit**. O repo tem remote (origin github
freitasjh/atlas-agenta) e a default é `master` — pode pushar para branch de feature, mas **não**
fazer merge em `master` sem pedido; PR opcional.
