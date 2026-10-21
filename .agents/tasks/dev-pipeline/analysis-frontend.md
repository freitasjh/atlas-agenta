# Design de Frontend — Templates de mensagem WhatsApp por tenant (Fatia 1, WhatsApp Fase 2)

Papel: DESIGNER DEDICADO de frontend. Este documento define telas, componentes, rotas/guards,
direção visual, acessibilidade, arquitetura React e critérios de aceite visuais para a entrega da
**Fatia 1**: CRUD de templates de mensagem editáveis por tenant, com variáveis, consumidos no
disparo sob demanda existente. Não contém código de aplicação — ele é produzido nas etapas de
codificação, uma ADR por vez.

> Contexto de fronteira: esta fatia **toca tela** (nova sub-rota de Configurações +
> alteração mínima no `SendMessageDialog`). O documento cobre o front; o modelo de dados,
> migrations e RLS/RBAC são do documento de dados; a renderização server-side das variáveis no
> disparo é da Edge Function. Aqui eu sinalizo essas peças como **dependências** e desenho a UI
> contra o contrato esperado.
>
> Nota: `.agents/tasks/dev-pipeline/analysis-data.md` e a `adr/` ainda refletem o run anterior
> (evolução da Agenda). Este arquivo foi reescrito para a demanda atual (templates WhatsApp).

---

## 0. Decisão de escopo: isto toca tela?

Sim. A Fatia 1 precisa de:

1. **Uma tela nova de CRUD** para o admin criar/editar os 4 templates do tenant (`confirmacao`,
   `lembrete_d1`, `cobranca`, `comprovante`), cada um com corpo pt-BR e variáveis.
2. **Uma alteração cirúrgica no fluxo de envio existente** (`SendMessageDialog`): em vez de só
   escolher a chave do template, o usuário passa a ver um **preview do texto renderizado** que
   será enviado (variáveis substituídas, com fallback), confirmando o que o cliente final receberá.
   O texto renderizado de verdade é resolvido **no servidor** (ADR da Edge Function); o preview da
   UI é derivado do mesmo template + dados já disponíveis do agendamento/cliente, como camada de
   confiança e defesa em profundidade — nunca a fonte da verdade do envio.

O restante (renderização canônica, idempotência, opt-in, service role) permanece no servidor e não
é redesenhado aqui — só preservado.

---

## 1. Telas, componentes, rotas e guards

### 1.1 Rota nova

Dentro do grupo de Configurações do tenant (`/app/config`), espelhando `servicos` e `whatsapp`:

```
/app/config
  ├─ /servicos                      (existe)
  ├─ /profissionais                 (existe)
  ├─ /whatsapp                      (existe — conexão)
  └─ /mensagens        ← NOVA       (templates de mensagem)
```

Registro em `src/router.tsx`, como filha de `config`:

```
{ path: "mensagens", element: <TemplatesMensagemPage /> }
```

Diretório novo: `src/app/config/mensagens/`.

**Por que sub-rota de `config` e não dentro de `/app/config/whatsapp`:** a tela de WhatsApp hoje é
a máquina de estados da *conexão* (parear QR, status). Templates são *conteúdo editorial* do
tenant, conceito distinto e de ciclo de vida próprio. Colocá-los numa rota dedicada mantém cada
tela com um trabalho só (princípio do design system do projeto) e evita inflar a tela de conexão.
O hub de Configurações ganha um 4º atalho.

### 1.2 Guards (herdados, sem rota especial)

A rota nasce dentro de `RequireAuth → RequireActiveSubscription → AppLayout`, então herda:

- **Autenticação:** sem sessão Supabase → `/login`.
- **Status de assinatura:** `bloqueado` → redireciona para `/app/quitacao`; `cancelado` →
  conta cancelada. O guard central (`RequireActiveSubscription`) já intercepta antes de montar
  qualquer módulo de `/app`. A tela de templates **não** precisa de lógica de assinatura própria.
- **RBAC por capacidade (defesa em profundidade, a trava real é RLS):** a escrita é gate por uma
  **nova capacidade** `canManageMessageTemplates` em `usePermissions`, seguindo o padrão
  `canManageCatalog`/`canManageWhatsAppConnection`. Decisão de papéis:
  - `admin`: **cria/edita** templates (é configuração do dono do tenant, mesmo nível de
    `canManageWhatsAppConnection`).
  - `professional` / `receptionist`: **não** gerenciam templates nesta fatia. Como a tela é de
    configuração editorial do tenant (não operação do dia a dia), e para manter o escopo enxuto,
    estes papéis **não acessam a tela** — o atalho no hub de Configurações só aparece para quem
    tem `canManageMessageTemplates`, e a página renderiza `AccessDenied` (componente existente em
    `src/components/AccessDenied.tsx`) para quem entrar pela URL. Isso espelha como o projeto trata
    telas de escrita exclusiva de admin.
  - Observação para o planejador de dados: a RLS de leitura pode ser mais ampla que a de escrita
    (a Edge Function lê o template sob service role no envio, então os demais papéis não precisam
    de SELECT no cliente para a Fatia 1). Mantido fechado por padrão.

> Dependência de RBAC: adicionar `canManageMessageTemplates: boolean` a `Permissions` e ao retorno
> de `usePermissions()` (`= isAdmin`). É mudança de 1 linha no hook, mas é contrato — registrar na
> ADR.

### 1.3 Árvore de componentes

```
src/app/config/mensagens/
  TemplatesMensagemPage.tsx        # página: lista os 4 templates, abre o editor
  TemplateEditorDialog.tsx         # diálogo criar/editar 1 template (rhf + zod)
  TemplateBodyField.tsx            # textarea do corpo + barra de variáveis + contador
  TemplatePreview.tsx              # preview do texto renderizado com dados de exemplo
  VariableChips.tsx                # chips clicáveis que inserem {variavel} no cursor
```

Reaproveitamento (nunca recriar):

- `PageHeader`, `Button`, `Card`, `Badge`, `Dialog*`, `Form*`, `Input`, `Switch`, `Skeleton`,
  `Separator`, `Table*` (de `src/components` e `src/components/ui`).
- `StatePanel` local (o mesmo molde já repetido em `ServicosPage`/`WhatsAppPage`): manter a cópia
  local por consistência com o projeto (ainda não foi extraído para compartilhado; não extrair
  agora para não alargar o escopo).
- `getMessageTemplateLabel` de `src/lib/whatsapp.ts` para os rótulos pt-BR das 4 chaves.

#### Dependência de UI primitiva: `Textarea`

O corpo do template é **multilinha** e hoje **não existe** `src/components/ui/textarea.tsx` no
projeto (só `input.tsx`). É preciso adicionar o primitivo `Textarea` do shadcn/ui (arquivo padrão,
sem customização além dos tokens já existentes). Sinalizado como dependência de componente; é a
peça shadcn canônica, não um primitivo caseiro.

### 1.4 Layout da tela (`TemplatesMensagemPage`)

Os templates são um **conjunto fixo e conhecido de 4 chaves** — não é uma lista de tamanho
variável como serviços/clientes. Isso muda o padrão: em vez de "tabela + botão Novo", a tela é uma
**lista dos 4 cards de template**, cada um sempre presente, com ação **Editar**. Não há "criar do
zero" nem "excluir" na UI — as 4 chaves são o domínio fechado (seed garante a existência; ver §4 e
dependência de dados). Isso também evita o risco de o tenant ficar sem um template obrigatório.

ASCII (desktop → o mobile empilha os cards):

```
┌───────────────────────────────────────────────────────────────┐
│  Modelos de mensagem                                            │
│  Os textos que seus clientes recebem no WhatsApp.               │
├───────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────┐  ┌──────────────────────────┐ │
│  │ ● Confirmação      [Ativo]  │  │ ● Lembrete (24h antes)   │ │
│  │ "Olá {nome}, confirmando…"  │  │ "Oi {nome}, seu horário…"│ │
│  │                    [Editar] │  │                 [Editar] │ │
│  └─────────────────────────────┘  └──────────────────────────┘ │
│  ┌─────────────────────────────┐  ┌──────────────────────────┐ │
│  │ ● Cobrança         [Ativo]  │  │ ● Comprovante   [Ativo]  │ │
│  │ "{nome}, o valor de…"       │  │ "Recebemos o pagamento…" │ │
│  │                    [Editar] │  │                 [Editar] │ │
│  └─────────────────────────────┘  └──────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

Cada card mostra: rótulo pt-BR da chave, um **badge de estado** (Ativo/Inativo via `Switch` no
editor), e as **primeiras ~2 linhas do corpo** (`line-clamp`, texto truncado) como prévia rápida.
Grade `grid gap-4 sm:grid-cols-2` (mobile-first: 1 coluna no pequeno, 2 a partir de `sm`),
reusando o padrão do `ConfigHubPage`.

Estados da tela: `Skeleton` enquanto carrega; `StatePanel` de erro com "Tentar novamente"; **não
há estado vazio** real (o seed garante as 4 chaves) — mas se o fetch vier com menos de 4 (tenant
antigo sem seed), a tela **mostra os que faltam como cards "a configurar"** derivados de
`MESSAGE_TEMPLATES`, com um default honesto, em vez de sumir. Isso torna a UI robusta a lacuna de
seed.

### 1.5 Editor (`TemplateEditorDialog`)

Diálogo (não rota), espelhando `ServiceFormDialog`: `Dialog` + `Form` (react-hook-form + resolver
zod), rodapé Cancelar/Salvar com `Loader2` em `isPending`, `toast` de sucesso/erro em pt-BR.
Campos:

- **Chave (read-only):** título do diálogo = "Editar modelo: {rótulo}". A chave não é editável
  (domínio fechado).
- **Corpo (`TemplateBodyField`):** `Textarea` controlado pelo rhf. Acima dele, a
  **barra de variáveis** (`VariableChips`): chips clicáveis `{nome}`, `{servico}`, `{dataHora}`,
  `{empresa}`, `{valor}` que inserem o token na posição do cursor. Abaixo, um contador de
  caracteres e dica pt-BR ("Use as variáveis para personalizar — se faltar o dado, um texto padrão
  entra no lugar").
- **Ativo (`Switch`):** template inativo não é oferecido no envio. (Decisão de produto conservadora:
  manter sempre pelo menos as 4 chaves existindo no banco; o `Switch` controla *oferta*, não
  *existência*.)
- **Preview (`TemplatePreview`):** renderização ao vivo do corpo com um **conjunto de dados de
  exemplo fixo** pt-BR (ex.: nome "Maria Silva", serviço "Consulta", dataHora "qui, 15/02 às
  14:00", empresa = `trade_name` do tenant atual, valor "R$ 150,00"), mostrando exatamente a
  substituição e o **fallback** quando um token não resolve. O preview usa a **mesma função de
  renderização** que o servidor conceitualmente aplica, mas implementada no cliente só para
  pré-visualização (ver §4.3). Deixa claro ao admin o que o cliente verá.

ASCII do editor (mobile-first, uma coluna; o preview vai abaixo do campo no mobile e ao lado em
`md`):

```
┌──────────────────────────────────────────────┐
│ Editar modelo: Confirmação                [x] │
│ O texto enviado ao cliente para este modelo.   │
├──────────────────────────────────────────────┤
│ Variáveis:  [{nome}] [{servico}] [{dataHora}]  │
│             [{empresa}] [{valor}]              │
│ ┌──────────────────────────────────────────┐ │
│ │ Olá {nome}, confirmando seu {servico} em   │ │
│ │ {dataHora}. Até lá!                        │ │
│ │                                            │ │
│ └──────────────────────────────────────────┘ │
│ 72/1000 caracteres                             │
│                                                │
│ Prévia (com dados de exemplo):                 │
│ ┌──────────────────────────────────────────┐ │
│ │ Olá Maria Silva, confirmando seu Consulta  │ │
│ │ em qui, 15/02 às 14:00. Até lá!            │ │
│ └──────────────────────────────────────────┘ │
│                      [ Cancelar ]  [ Salvar ]  │
└──────────────────────────────────────────────┘
```

### 1.6 Alteração no `SendMessageDialog` (preservar o envio atual)

O diálogo de envio **continua funcionando igual** (escolhe template, confirma, invoca a Edge
Function). Única adição: ao selecionar um template, mostrar um **bloco de preview** com o texto
renderizado que será enviado àquele cliente/agendamento (variáveis resolvidas com os dados reais
disponíveis + fallback). Isso cumpre o critério de aceite "o envio sob demanda usa o template
renderizado" de forma **visível e verificável** na UI, sem mudar o contrato de `send` (o corpo
continua `{ action, template, customerId, appointmentId? }` — o servidor resolve o texto).

- O preview lê o template do tenant via a mesma query de templates (`useMessageTemplates`) e
  resolve as variáveis com os dados do cliente/agendamento já presentes no contexto do diálogo
  (nome do cliente já é passado como prop; serviço/dataHora vêm do agendamento quando
  `appointmentId` existe).
- Quando faltar dado (ex.: envio a partir de Clientes, sem agendamento → sem `{dataHora}`),
  o preview mostra o **mesmo fallback** que o servidor aplicará, deixando explícito que não haverá
  `{dataHora}` cru no texto.
- Se o template da chave estiver **inativo**, o select não o oferece; se nenhum template ativo
  existir para a chave, a UI explica em pt-BR e desabilita o envio daquela chave (defesa em
  profundidade; a trava final é do servidor).

Risco coberto (do role): **nunca renderizar `{variavel}` cru para o cliente** — o preview e o
fallback tornam isso visível ao admin antes do disparo, e a renderização canônica do servidor é a
garantia real.

---

## 2. Direção visual e design system

A linguagem visual já está estabelecida (tema "painel de operação calmo": ardósia/azul-noite +
acento jade, display Space Grotesk, corpo Inter, mono JetBrains, raio 0.75rem, dark por padrão).
Esta tela **adere** a essa linguagem — não é lugar de introduzir uma nova direção. O que ela traz
de próprio, com intenção, é o tratamento do **texto do template como artefato editável**:

- **O corpo do template é código-como-conteúdo.** Tokens de variável (`{nome}`, `{dataHora}`) são
  renderizados no preview com a **família mono (JetBrains Mono, já carregada)** e um leve realce
  (`bg-primary/10 text-primary rounded px-1`) para distinguir visualmente "slot que será
  substituído" de texto fixo. É o único toque de personalidade da tela, e é derivado do assunto
  (templates com variáveis), não decoração.
- **Chips de variável** usam `Badge`/`Button` `variant="secondary"` em tamanho pequeno, com o nome
  da variável em mono — consistente com o realce do preview, de modo que o admin associa o chip
  que clica ao token que aparece.
- **Cards de template** reusam `Card` com o mesmo hover de borda (`group-hover:border-primary/50`)
  do `ConfigHubPage`, mantendo a família visual de Configurações.
- **Tokens:** nenhum token novo de cor. Estado Ativo/Inativo usa o `Badge` padrão
  (`variant="default"` / `"secondary"`) como em `ServicosPage` (não os tokens `--status-*`, que são
  da máquina de estados do agendamento — reusá-los aqui seria incoerente semanticamente).
- **Espaçamento/raio/tipografia:** herdados (`space-y-6` nas páginas, `font-display` nos títulos,
  `--radius`). Mobile-first: cards empilham em 1 coluna, editor em coluna única no pequeno.

Copy (pt-BR, voz do produto, sem floreio):
- Título da tela: "Modelos de mensagem". Descrição: "Os textos que seus clientes recebem no
  WhatsApp."
- Dica de variáveis: "Use as variáveis para personalizar. Se um dado faltar, entra um texto padrão
  no lugar."
- Sucesso ao salvar: "Modelo atualizado." Erro: "Não foi possível salvar o modelo. Tente
  novamente."
- Nomes de ações consistentes ponta a ponta: botão "Salvar" → toast "Modelo atualizado".

---

## 3. Acessibilidade (obrigatório)

- **Labels associados:** `Textarea` com `FormLabel` via `FormField` (o `Form` do shadcn já liga
  `htmlFor`/`id` e `aria-describedby` para a dica e a mensagem de erro). Chips de variável são
  `<button type="button">` com texto visível (o próprio token) — nome acessível implícito; se o
  visual for só ícone em algum ponto, usar `aria-label` ("Inserir variável nome").
- **Foco visível:** herdado do `focus-visible:ring-2 ring-ring` já aplicado globalmente aos
  primitivos; os cards-link do hub já têm o anel. Os chips, sendo `Button`, herdam o anel.
- **Teclado:** inserir variável funciona por clique **e** por `Enter`/`Espaço` no chip (botão
  nativo). O editor é um `Dialog` shadcn (foco preso, `Esc` fecha, retorna foco ao gatilho) — não
  quebrar isso. A tela inteira é navegável por `Tab` na ordem: cards → Editar → (diálogo) chips →
  textarea → Switch → Cancelar/Salvar.
- **Região viva:** o contador de caracteres e, se útil, a mudança de preview podem ser anunciados
  via `aria-live="polite"` discreto (seguir o padrão de `WhatsAppPage`, que usa `role="status"`).
  Manter sóbrio para não poluir o leitor.
- **Contraste (WCAG AA ≥ 4.5:1 para texto):**
  - Texto do preview: `foreground` sobre `card`. No dark, `--foreground: 210 20% 96%` (L≈95%)
    sobre `--card: 222 20% 13%` (L≈13%) → razão ≈ **15:1** (AAA). No claro, `222 30% 12%` sobre
    `0 0% 100%` → ≈ **16:1** (AAA). OK.
  - Token mono realçado: `text-primary` sobre `bg-primary/10`. `--primary` no dark é
    `160 64% 45%` (verde jade, L≈45%); o texto jade sobre fundo jade a 10% de opacidade sobre card
    escuro mantém o verde como cor de texto sobre fundo quase-card → razão do jade (L≈45%) vs card
    (L≈13%) ≈ **3.2:1**. **Abaixo de 4.5:1 para texto normal.** Mitigação obrigatória: o token no
    preview **não depende só da cor** — usar `font-medium` + as chaves `{}` como delimitadores
    textuais (a informação "isto é variável" é carregada por forma, não só cor) e, para garantir
    contraste de texto, renderizar o token com `text-foreground` + leve `bg-primary/15` como
    *realce de fundo* (não como cor do texto). Decisão: **realce de fundo, texto em `foreground`**,
    assim o contraste do texto fica no mesmo ≈15:1 do corpo e a cor jade entra só como camada
    decorativa de fundo (não portadora de informação). O QA verifica.
  - Badge Ativo (`variant="default"`, `primary`/`primary-foreground`): par já usado em
    `ServicosPage`, calibrado pelo tema. OK.
- **Reduced motion:** sem animação nova além de transições de hover já cobertas pelo
  `prefers-reduced-motion` global.
- **Nota de conformidade:** estimativas de contraste acima são calculadas a partir dos tokens HSL;
  validação WCAG completa exige teste manual com ferramenta de contraste e leitor de tela — o QA
  por ADR (Chrome DevTools) confere os pares reais renderizados.

---

## 4. Arquitetura React

### 4.1 Dados (TanStack Query, nunca `fetch` solto)

Novo hook `src/hooks/useMessageTemplates.ts`, espelhando `useServices`/`useMessages`:

- `useMessageTemplates()` → `useQuery`, lê `message_templates` do tenant via PostgREST sob RLS
  (cliente Supabase do browser, **anon key + sessão**; RLS isola por `tenant_id` do JWT — o
  cliente **nunca** envia `tenant_id`). Projeção: `id, tenant_id, template_key, body, active,
  created_at`. Resposta validada com **zod** antes do uso (dado externo não confiável), `template_key`
  no enum `MESSAGE_TEMPLATES`.
- `useUpsertMessageTemplate()` → `useMutation` que faz `upsert` por `(tenant_id, template_key)`
  (ver dependência de dados: unique nessa dupla). Em sucesso, `invalidateQueries` da chave de
  templates. Mensagens de erro traduzidas (sem vazar schema).
- Chave de query dedicada: `MESSAGE_TEMPLATES_KEY = ["message-templates"]` em `src/lib/whatsapp.ts`
  (fonte única de chaves do módulo, onde já moram `MESSAGES_KEY`/`WHATSAPP_INSTANCE_KEY`).

A escrita de template é **do cliente sob RLS** (diferente de `messages`, cuja escrita é exclusiva
da Edge Function). Templates são dado editorial do tenant, não operação privilegiada — o `admin`
grava direto via PostgREST, a RLS garante o isolamento e o RBAC (política de escrita só para
`admin`). Isso é coerente com como `services`/`professionals` são editados (cliente + RLS).

### 4.2 Formulário (react-hook-form + zod)

Schema novo em `src/lib/validations/whatsapp.ts` (ao lado de `sendMessageSchema`):

```
messageTemplateSchema = z.object({
  templateKey: z.enum(MESSAGE_TEMPLATES),
  body: z.string()
         .trim()
         .min(1, "Escreva o texto do modelo.")
         .max(1000, "O texto do modelo é muito longo."),
  active: z.boolean(),
})
```

- `body` validado: obrigatório, limite de 1000 caracteres (coerente com mensagem de WhatsApp;
  o planejador de dados confirma o limite da coluna). **Variáveis desconhecidas** no corpo (ex.:
  `{foo}`) não quebram o save — são tratadas na renderização como "não resolvida" e substituídas
  pelo fallback (ver §4.3); opcionalmente o editor pode avisar em pt-BR ("A variável {foo} não é
  reconhecida e será removida no envio"), como ajuda, não como bloqueio.
- Resolver `zodResolver`; mensagens em pt-BR.

### 4.3 Renderização de variáveis (preview no cliente + contrato do servidor)

Função pura utilitária `renderTemplate(body, vars)` em `src/lib/message-templates.ts` (novo),
usada **só para o preview** no cliente. Contrato:

- **Lista fechada de variáveis suportadas** (decisão desta fatia): `{nome}` (cliente),
  `{servico}` (serviço do agendamento), `{dataHora}` (início do agendamento no fuso do tenant,
  formatado pt-BR via `src/lib/datetime.ts`), `{empresa}` (`trade_name` do tenant), `{valor}`
  (`price_cents` do agendamento formatado em R$ via `src/lib/money.ts`). Qualquer outro `{token}`
  é desconhecido.
- **Fallback previsível** quando o dado falta ou o token é desconhecido: substituir por um texto
  neutro pt-BR por variável, **nunca** deixar `{token}` cru. Tabela de fallback:
  - `{nome}` → "você"
  - `{servico}` → "seu atendimento"
  - `{dataHora}` → "o horário combinado"
  - `{empresa}` → `trade_name` do tenant, ou "nossa equipe" se nulo
  - `{valor}` → "o valor combinado"
  - token desconhecido → remove (string vazia), nunca exibe `{...}`.
- O preview **declara** que isto é também o comportamento esperado do servidor. **Dependência de
  contrato:** a Edge Function `handleSend` hoje envia `text: input.template` (a string crua da
  chave — bug funcional do ponto de vista do produto). A Fatia 1 muda isso para o servidor
  **carregar o `message_templates` do tenant pela chave (sob service role) e renderizar com a
  mesma tabela de fallback** antes de `adapter.sendText`. A UI e o servidor devem compartilhar a
  **mesma lista fechada e a mesma tabela de fallback** — registrar como contrato na ADR para não
  divergirem. O frontend não implementa o lado servidor; só desenha o preview coerente com ele.

### 4.4 Componentes vs hooks vs estado

- Estado de servidor: só via TanStack Query (templates, tenant atual para `{empresa}`).
- Estado local de UI: qual template está em edição, abertura do diálogo (`useState` na página),
  posição do cursor para inserir chip (ref do textarea no `TemplateBodyField`).
- Nenhum `fetch`/efeito solto; o `TemplatePreview` deriva do estado do form (`form.watch("body")`)
  — reatividade pura, sem efeito.

---

## 5. Dependências (sinalizadas para as etapas seguintes)

1. **Dados — tabela nova `message_templates`** (`id, tenant_id, template_key, body, active,
   created_at`), unique `(tenant_id, template_key)`, índice em `tenant_id`, **RLS habilitada**
   (SELECT/INSERT/UPDATE para `admin` do tenant; escrita só `admin`). Migration versionada em
   `supabase/migrations`. — *documento de dados / ADR de migration.*
2. **Dados — seed dos 4 templates padrão pt-BR** por tenant (ao criar tenant e/ou backfill para
   tenants existentes), para a tela não começar vazia. Textos padrão em pt-BR com as variáveis
   corretas; `lembrete_d1` já redigido de forma a **comportar** a instrução "1 confirmar / 2
   reagendar" (preparando a Fatia 2 **sem** acoplar webhook agora — só o texto). — *documento de
   dados / ADR de seed.*
3. **Servidor — `handleSend` passa a renderizar** o template do tenant (carrega por
   `template_key` sob service role, aplica `renderTemplate` com a tabela de fallback acordada) em
   vez de enviar `input.template` cru. — *ADR da Edge Function.* **Este é o ponto que cumpre o
   critério de aceite central.**
4. **RBAC — `canManageMessageTemplates`** em `usePermissions` (= `isAdmin`). — *ADR de frontend.*
5. **UI primitiva — `src/components/ui/textarea.tsx`** (shadcn padrão). — *ADR de frontend.*
6. **Util compartilhado — `src/lib/message-templates.ts`** (lista fechada de variáveis + tabela de
   fallback + `renderTemplate`), reusável por preview (cliente) e espelhado no servidor. — *ADR de
   frontend; o servidor replica a mesma tabela.*

Fora de escopo (Fatia 2, **não** desenhar/implementar agora): confirmação interativa numérica,
webhook de entrada da Evolution, pg_cron/agendador do `lembrete_d1`, fila de retentativa, botões
interativos. O único preparo permitido é **o texto** do `lembrete_d1` comportar "1 confirmar / 2
reagendar".

---

## 6. Critérios de aceite visuais (verificáveis pelo QA Chrome DevTools)

1. Em `/app/config` existe o atalho "Modelos de mensagem" (visível só para `admin`); clicar leva a
   `/app/config/mensagens`.
2. A tela lista os **4 cards** (Confirmação, Lembrete (24h antes), Cobrança, Comprovante), cada um
   com rótulo pt-BR, badge Ativo/Inativo e prévia truncada do corpo. Mobile (<`sm`): 1 coluna, sem
   overflow horizontal. Desktop: 2 colunas.
3. "Editar" abre o `Dialog` com o corpo atual no `Textarea`, os chips de variável e o preview ao
   vivo. Clicar um chip insere o `{token}` no texto; o preview atualiza substituindo variáveis por
   dados de exemplo pt-BR e **nunca** exibe `{token}` cru (fallback visível quando o dado falta).
4. Salvar mostra toast "Modelo atualizado", fecha o diálogo e a prévia do card reflete o novo
   texto (cache invalidado).
5. No diálogo de **Enviar mensagem** (Agenda/Clientes), ao escolher um template aparece o preview
   do texto renderizado que será enviado; o envio continua funcionando (sucesso/duplicate/opt_out/
   not_connected/send_failed inalterados) e o texto efetivo é o **template renderizado**, não a
   string crua da chave. (Verificação de ponta: inspecionar o disparo de teste e confirmar o texto
   renderizado — o lado servidor é da ADR da Edge Function, mas o critério é observável aqui.)
6. **Isolamento por tenant:** logado em tenant A, a tela mostra só os templates de A; não há como
   enviar `tenant_id` pelo cliente para ver os de outro (RLS). Editar em A não afeta B.
7. Acessibilidade: `Tab` alcança cards → Editar → chips → textarea → Switch → Salvar/Cancelar;
   foco visível em todos; `Esc` fecha o diálogo e devolve o foco ao gatilho; labels associados;
   contraste do texto do preview e do realce de token conferidos (realce de token por **fundo**,
   texto em `foreground`).
8. Build/typecheck limpos (`tsc`/build do projeto) e verificação ao vivo (tela + envio) sem erro
   de console.

---

## 7. Resumo das decisões de frontend (travadas após aprovação)

- Rota: **`/app/config/mensagens`**, dentro do grupo de Configurações; atalho no hub.
- Padrão de tela: **lista fixa de 4 cards** (domínio fechado), editor em `Dialog`, sem "novo"/
  "excluir". Robusta a lacuna de seed (cards "a configurar" derivados de `MESSAGE_TEMPLATES`).
- RBAC: escrita e acesso só para **`admin`** (`canManageMessageTemplates`), demais papéis veem
  `AccessDenied`; a trava real é RLS.
- Dados: **TanStack Query** (`useMessageTemplates`/`useUpsertMessageTemplate`), escrita do cliente
  sob RLS (não via Edge Function). Formulário **rhf + zod**; `body` 1–1000 chars.
- Variáveis: lista fechada `{nome} {servico} {dataHora} {empresa} {valor}`; **fallback previsível**
  por variável, token desconhecido removido — **nunca** `{token}` cru para o cliente.
- Preview no cliente via `renderTemplate` compartilhado; **renderização canônica é do servidor**
  (`handleSend` passa a renderizar o template do tenant).
- Visual: adere ao tema existente; único toque próprio é o **realce de token por fundo** (texto em
  `foreground`, cor jade só decorativa) — escolha feita para não ferir contraste.
- Stack travada: React + Vite + TS estrito + Tailwind + shadcn/ui + React Router + TanStack Query +
  react-hook-form + zod. Novo primitivo shadcn: `Textarea`.
```
