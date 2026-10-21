# Análise de Frontend — Fatia 2 do WhatsApp (Confirmação interativa D-1)

> Papel: Designer dedicado de frontend do pipeline. Stack travada: React + Vite +
> TypeScript + Tailwind + shadcn/ui, React Router, TanStack Query, react-hook-form + zod.
> Base: branch `feat/message-templates-schema-rls` (Fatia 1 já entregue: `message_templates`
> + render server-side no `handleSend`; `lembrete_d1` já carrega "1 confirmar / 2 reagendar").

## 0. Veredito de escopo — esta fatia é BACKEND-pesada, com superfície de frontend PEQUENA mas real

A Fatia 2 entrega quatro peças de servidor: (1) cron `pg_cron` do lembrete D-1,
(2) Edge Function de **webhook de entrada** da Evolution, (3) casamento resposta→agendamento
com marcação `confirmado`, (4) fila de retentativa. Nenhuma delas é uma tela. O usuário final
(cliente do tenant) interage **dentro do WhatsApp**, não no app.

Mas a fatia **toca o frontend** por efeito colateral observável, e aqui está o trabalho de
design que importa — não inventar telas, e sim tornar o efeito do backend **legível** na UI
que já existe:

1. **Agenda** — um agendamento que era `pendente` vira `confirmado` + ganha `confirmed_at`
   quando o cliente responde "1". Hoje a UI mostra o badge `Confirmado`, mas **não distingue**
   uma confirmação feita pelo próprio cliente (via WhatsApp D-1) de uma feita manualmente pela
   recepção. Essa distinção é o valor de negócio da fatia (reduzir no-show provando que o
   cliente confirmou). **Precisa aparecer.**
2. **Histórico de mensagens** (`/app/config/whatsapp`) — passa a receber linhas novas:
   `lembrete_d1` disparado pelo cron, e (decisão c) a mensagem automática de retorno quando o
   cliente responde "2". Hoje a lista assume disparo **sob demanda** e não tem conceito de
   origem (automático/cron) nem de **mensagem recebida**. Precisa de ajuste de leitura e de
   rótulo, sem virar um inbox.
3. **Estado `fila`/`falha`** — a fila de retentativa muda a semântica de `messages.status`:
   `fila` agora pode significar "aguardando retentativa" e `falha` só aparece após o limite N.
   O badge já existe; o texto de apoio precisa refletir a nova realidade para não assustar o
   admin ("Na fila" por 2h é normal agora).

Conclusão: **documento de frontend com escopo contido**. Zero rota nova, zero módulo novo.
Ajustes cirúrgicos em componentes existentes + um elemento de design novo (o selo de
"confirmado pelo cliente"). Tudo o mais é dependência de dados/contrato do backend que o
planejador deve honrar para que a UI possa ler o efeito.

---

## 1. Telas, componentes, rotas e guards

### 1.1 Rotas — NENHUMA nova

Todas as mudanças vivem em rotas e layouts já existentes, sob os guards já montados
(`RequireAuth → RequireActiveSubscription → AppLayout`, mais os gates por capacidade de
`usePermissions`). Não há rota pública, de auth, de admin ou de tenant nova.

| Superfície | Rota existente | Guard de acesso |
| --- | --- | --- |
| Agenda (selo de confirmação pelo cliente) | `/app/agenda` | auth + assinatura ativa; leitura por qualquer papel do tenant |
| Histórico de mensagens (lembrete/recebida/retorno) | `/app/config/whatsapp` | auth + assinatura ativa; `RecentMessagesList` já é PII-safe e lida por qualquer papel |
| Config de template `lembrete_d1` (já existe) | `/app/config/mensagens` | `canManageMessageTemplates` (admin) — **sem mudança nesta fatia** |

### 1.2 RBAC — quem vê o quê

- **admin / receptionist / professional** — todos veem o badge `Confirmado` e o selo de origem
  na agenda (é informação operacional, não financeira). `receptionist` continua **sem** telas
  de cobrança; esta fatia não toca financeiro, então nada a esconder a mais.
- **professional** — vê o selo apenas nos próprios agendamentos (o RLS/escopo da agenda já
  resolve isso; o selo herda o mesmo recorte de linhas).
- O histórico de `/app/config/whatsapp` já é legível por qualquer papel do tenant com projeção
  **sem PII** (ver `RecentMessagesList`/`useRecentMessages`). As mensagens novas (lembrete,
  recebida, retorno) herdam a mesma projeção — **nunca** expor telefone nem o texto recebido
  do cliente.

### 1.3 Status de assinatura

Guard central já cobre: `bloqueado` → tela de quitação (`BillingGateLayout`), `cancelado` →
acesso suspenso. Nenhum tratamento novo. Observação de produto para o planejador (não é
frontend): o **cron** do lembrete D-1 deve respeitar o status do tenant no servidor
(`bloqueado`/`cancelado` suspendem disparos, por `seguranca-multitenant.md`). A UI não dispara
o cron; só não há onde mostrar isso além do histórico ficar vazio — aceitável.

### 1.4 Componentes tocados / criados

**Alterados (mínimo):**

- `src/app/agenda/AppointmentBlock.tsx` e a lista em `AgendaPage.tsx` — acrescentar o
  **selo de "confirmado pelo cliente"** ao lado do `StatusBadge` quando o status for
  `confirmado` **e** a confirmação tiver vindo do cliente (ver §1.5 sobre a fonte do dado).
- `src/app/config/whatsapp/RecentMessagesList.tsx` — (a) suportar a direção
  recebida/enviada; (b) distinguir disparo automático (cron) de sob demanda no rótulo;
  (c) texto de apoio para `fila` sob retentativa.
- `src/lib/whatsapp.ts` — acrescentar rótulos pt-BR dos novos estados/origens (fonte única de
  vocabulário; nada de literais soltos nos componentes).

**Criado (1 componente pequeno, reaproveitando primitivos):**

- `src/components/ConfirmationSourceBadge.tsx` (ou um prop no `StatusBadge` existente — ver
  §2.4 para a decisão) — o selo visual "✓ pelo cliente" / "✓ pela recepção". **Decisão:**
  componente irmão dedicado, no molde do `WhatsAppStatusBadge` (que já foi criado como irmão
  do `StatusBadge` justamente para não inchar o existente). Reusa os tokens de status já
  calibrados AA; não cria token de cor novo.

Nenhum primitivo de `src/components/ui` é recriado. Tudo consome o que já existe
(`Badge`/`span` tokenizado, `Table`, `Skeleton`, `Tooltip` para o detalhe de origem).

### 1.5 Dependência de dados crítica (o frontend NÃO pode resolver sozinho)

Para a agenda distinguir "confirmado pelo cliente" de "confirmado manualmente", a UI precisa de
um dado que hoje **não existe** no shape lido. `appointments.confirmed_at` existe mas é só um
timestamp — não diz **quem** confirmou. Duas opções para o planejador (decisão de contrato,
sinalizada como **dependência de dados**):

- **Opção A (preferida):** coluna nova `appointments.confirmed_via` (enum
  `cliente_whatsapp | manual`, nullable), gravada pelo webhook (service role) quando casa a
  resposta "1", e deixada `manual` quando a recepção muda o status pela UI. É uma coluna de
  domínio, versionada em migration, sob o RLS já existente de `appointments`. O frontend lê e
  escolhe o selo. **Barata, determinística, legível.**
- **Opção B (sem migration de appointments):** derivar a origem cruzando `appointments` com a
  última `messages` do tipo `lembrete_d1`/resposta daquele `appointment_id`. **Rejeitada:** é
  um join frágil, exige expor mais de `messages` na leitura da agenda (risco de PII/escopo) e
  não é determinístico se houver reenvio. O selo é informação de agenda; deve morar em
  `appointments`.

> **Decisão de design:** adotar **Opção A**. O planejador cria `confirmed_via`; o hook
> `useAppointments` passa a selecioná-lo; o selo da agenda é função pura de
> `(status, confirmed_via)`. Se o planejador decidir não criar a coluna nesta fatia, o selo de
> origem **sai de escopo do frontend** e fica só o badge `Confirmado` já existente — registrar
> isso explicitamente como corte, não implementar a Opção B.

Dependências de dados que o planejador deve garantir para a leitura PII-safe do histórico:

- `messages` precisa de uma forma de distinguir **direção** (recebida vs enviada) e **origem**
  (automática/cron vs sob demanda). Sinalizado como dependência: coluna `direction`
  (`inbound | outbound`) e/ou `origin` (`cron | on_demand | webhook_reply`) em `messages`,
  ou um `template`/`payload` que já carregue isso. O frontend só **lê e rotula**; não infere
  direção de texto (o texto recebido não deve nem chegar ao cliente por PII).
- A mensagem recebida do cliente **não deve** trazer o conteúdo bruto para a UI. O histórico
  mostra "Cliente respondeu (confirmação)" / "Cliente respondeu (reagendar)" como rótulo
  derivado do efeito, **nunca** o texto literal digitado.

---

## 2. Direção visual e design system

A régua visual já está estabelecida pelas fatias anteriores (tokens `--status-*` calibrados AA,
`StatusBadge`/`WhatsAppStatusBadge`, `font-display` nos títulos, mobile-first, dark mode). Esta
fatia **não abre direção nova** — seria ruído. O trabalho é integrar o único elemento novo (o
selo de origem da confirmação) com a mesma disciplina.

### 2.1 Tokens — reuso total, zero token novo

Cor, tipografia, espaçamento e raio saem do que já existe:

- **Status** — tokens `--status-confirmado` / `--status-confirmado-foreground` (já AA) para o
  badge `Confirmado`. O selo de origem **não** ganha cor própria: é uma variação de **peso e
  ícone** sobre o mesmo token confirmado, para não competir com o badge nem criar um segundo
  sistema de cor de status.
- **Tipografia** — `text-xs font-medium` dos badges existentes; `font-display` só nos títulos
  de seção já estabelecidos. Nada novo.
- **Espaçamento/raio** — `rounded-full px-2.5 py-0.5` dos badges; gap `gap-1` ao alinhar selo +
  badge, como o `AppointmentBlock` já faz entre horário e `StatusBadge`.

### 2.2 O elemento de assinatura desta fatia: o selo "confirmado pelo cliente"

O valor de negócio da fatia é **a prova de que o cliente confirmou sozinho**. O design deve
tornar isso instantâneo no scan da agenda, sem poluir. Proposta:

- Badge `Confirmado` (verde, como hoje) **mais** um micro-selo discreto adjacente: um ícone
  `MessageCircle` (lucide, já usado na agenda para "enviar mensagem") pequeno, cor
  `text-status-confirmado-foreground` sobre fundo transparente, com `title`/`aria-label`
  "Confirmado pelo cliente no WhatsApp". Quando a confirmação foi manual, **nenhum** micro-selo
  — a ausência é o sinal, e o `title` do badge diz "Confirmado pela recepção".
- Em `AppointmentBlock` (bloco de calendário, espaço apertado): o micro-selo aparece **só** no
  modo não-compacto; no compacto ele cai no `title` junto do resto (o bloco já joga detalhe no
  `title` quando é baixo). Na **lista** da `AgendaPage` há espaço para selo + badge lado a lado.

Isso respeita "gaste a ousadia num lugar só": o selo é o único elemento novo, e é deliberado —
ícone que já pertence ao vocabulário do WhatsApp no app, não um enfeite genérico.

### 2.3 Histórico de mensagens — legibilidade dos novos tipos

- **Rótulo de template** — `lembrete_d1` já tem rótulo "Lembrete (24h antes)". Acrescentar, via
  `src/lib/whatsapp.ts`, o rótulo da **resposta recebida** ("Confirmação do cliente" /
  "Pedido de reagendamento") e da **mensagem de retorno automática** ("Retorno de
  reagendamento"). Sempre pt-BR, sentence case, voz do produto.
- **Direção** — uma linha recebida ganha um indicador visual leve (ex.: ícone de seta de
  entrada + rótulo "Recebida"), distinto do disparo "Enviada". **Não** usar cor para isso (cor
  é reservada ao status); usar ícone + rótulo textual (a11y: nunca cor como único sinal).
- **Estado `fila` sob retentativa** — o badge `Na fila` continua, mas a célula ganha um
  `title`/tooltip "Aguardando reenvio automático" quando a mensagem está em retentativa, para
  o admin não interpretar como travada. `falha` (após N tentativas) ganha o `title` "Falhou
  após várias tentativas". Textos de `src/lib/whatsapp.ts`.

### 2.4 Decisão: componente irmão vs prop no `StatusBadge`

Duas abordagens para o selo de origem:

- **Prop no `StatusBadge`** — acopla a um componente já consumido por Agenda/Clientes/
  assinatura; inchar com uma preocupação específica de WhatsApp fere o padrão que o próprio
  projeto estabeleceu (o `WhatsAppStatusBadge` foi criado irmão justamente para evitar isso).
- **Componente irmão `ConfirmationSourceBadge`** — isolado, testável, só aparece onde faz
  sentido (agenda). **Escolhido.** Fica em `src/components/`, recebe `confirmed_via` e `status`,
  e renderiza o micro-selo só quando `status === "confirmado" && confirmed_via === "cliente_whatsapp"`.

### 2.5 Dark mode

Todos os tokens usados são theme-aware (trocam com `.dark`), herdados sem ajuste. O micro-selo,
por usar `text-status-confirmado-foreground`, acompanha o tema automaticamente. Verificar
contraste do ícone em ambos os temas no QA (§5).

---

## 3. Acessibilidade

- **Cor nunca é o único sinal.** O selo de origem tem ícone **e** `aria-label`/`title` textual
  ("Confirmado pelo cliente no WhatsApp"). A direção recebida/enviada no histórico usa ícone +
  rótulo textual, não cor. Alinha ao que `WhatsAppStatusBadge`/`StatusBadge` já fazem (rótulo
  pt-BR sempre presente).
- **Contraste WCAG.** O badge `Confirmado` usa tokens já calibrados AA nas fatias anteriores
  (≥ 4,5:1 para texto). O micro-selo é um ícone decorativo-informativo: como ícone pequeno,
  mirar **3:1** (WCAG 1.4.11, componentes gráficos) de `--status-confirmado-foreground` contra
  o fundo do bloco (`bg-card`). O cálculo numérico exato depende dos valores de token e deve
  ser **verificado no QA** com os hex resolvidos (claro e escuro) — não afirmo o número aqui
  sem medir; é critério de aceite §5.
- **Foco visível e teclado.** O `AppointmentBlock` já é um `<button>` focável com
  `focus-visible:ring-2`. O selo é conteúdo dentro dele (não um novo alvo de foco) — não
  adiciona ordem de tab nem armadilha. Se o selo virar um `Tooltip` do shadcn, o gatilho precisa
  ser alcançável por teclado e o conteúdo anunciável; preferir `title` nativo + `aria-label`
  para não introduzir alvo de foco redundante dentro do botão.
- **Região viva.** A `WhatsAppPage` já tem `role="status" aria-live="polite"` para a conexão.
  A agenda **não** precisa de live region para a confirmação (a mudança chega via refetch do
  TanStack Query, não é um evento que o leitor precise ouvir em tempo real). Não adicionar
  ruído de a11y.
- **Labels associados.** Nenhum formulário novo nesta fatia. O template `lembrete_d1` já é
  editado na tela de mensagens existente (labels já associados). Nada a fazer.

---

## 4. Arquitetura React

- **Dados sempre via TanStack Query.** O selo de origem lê de `useAppointments` (já é um
  `useQuery`); basta o `select` passar a trazer `confirmed_via` e o schema zod do hook validar
  o novo campo. O histórico lê de `useRecentMessages` (já `useQuery`); o schema zod passa a
  aceitar os novos campos (`direction`/`origin` ou equivalente) como **dado não confiável
  validado** antes do uso. **Nada de `fetch` em `useEffect`.**
- **Cliente Supabase do browser com anon key + sessão.** A leitura da agenda e do histórico
  segue sob RLS; o cliente **nunca** envia `tenant_id` para filtrar — o isolamento é do banco.
  O webhook e o cron são operações privilegiadas de **servidor** (service role em Edge
  Function/SQL), fora do bundle — o frontend só **lê o efeito** já persistido.
- **Componentes vs hooks vs estado de servidor.**
  - Estado de servidor: `useAppointments`, `useRecentMessages` (existentes, estendidos no
    schema).
  - Lógica pura: o selo é função pura de `(status, confirmed_via)`; o rótulo de mensagem é
    função pura no `src/lib/whatsapp.ts` (fonte única, testável sem render).
  - Componentes: `ConfirmationSourceBadge` (apresentação pura), `RecentMessagesList`
    (apresentação + leitura), `AppointmentBlock`/lista (composição).
- **Invalidação de cache.** Nenhuma mutação nova no cliente nesta fatia (confirmação vem do
  webhook, não de ação do usuário). A agenda e o histórico atualizam no refetch normal do
  TanStack Query (foco/intervalo). Se o produto quiser a confirmação "aparecer sozinha" sem
  reload, reaproveitar o padrão de **polling condicional** já usado em `useWhatsAppInstance`
  (ex.: refetch da agenda com `refetchInterval` curto só quando há agendamentos ~24h à frente
  e `pendente`). **Decisão:** não adicionar polling nesta fatia — é otimização, não requisito;
  o refetch on-focus já cobre o fluxo real (a recepção abre a agenda e vê o estado atual).
  Registrar como melhoria futura.
- **Zod como guarda de dado externo.** Mesmo os dados vindos do próprio banco sob RLS passam
  pelo schema zod dos hooks (o projeto já faz isso). Os campos novos entram no schema com tipo
  estrito (enums fechados), não `string` solta — mantém `strict: true` honrado.
- **Performance (RNF01, agenda < 1,5s).** O selo não adiciona request (vem no mesmo
  `select` da agenda). O histórico continua limitado a 20 linhas (`DEFAULT_LIMIT`). Nenhum
  waterfall novo. Skeletons já existentes cobrem o loading.

---

## 5. Critério de aceite visual verificável (QA por ADR, Chrome DevTools MCP)

Escrito para ser conferível na tela, não no código:

1. **Selo na agenda — confirmado pelo cliente.** Um agendamento com
   `status=confirmado` e `confirmed_via=cliente_whatsapp` mostra o badge `Confirmado` **mais**
   o micro-selo (ícone WhatsApp + `aria-label` "Confirmado pelo cliente no WhatsApp"), tanto na
   lista quanto no bloco de calendário (modo não-compacto). Verificável por inspeção do DOM
   (presença do `aria-label`) e visual.
2. **Selo na agenda — confirmado manualmente.** Um agendamento `confirmado` com
   `confirmed_via=manual` mostra **só** o badge `Confirmado`, sem micro-selo; o `title` do badge
   diz "Confirmado pela recepção". A ausência do selo é o sinal.
3. **Histórico — lembrete automático.** Após o cron disparar, a linha `lembrete_d1` aparece
   no histórico com rótulo "Lembrete (24h antes)" e indicador "Enviada", sem PII (sem telefone,
   sem texto bruto).
4. **Histórico — resposta recebida.** A resposta do cliente aparece como linha "Recebida" com
   rótulo derivado ("Confirmação do cliente" ou "Pedido de reagendamento"), **nunca** o texto
   digitado. Indicador de direção é ícone + texto, não cor.
5. **Histórico — estado fila/retentativa.** Uma mensagem em retentativa mostra badge `Na fila`
   com `title` "Aguardando reenvio automático"; após o limite, badge `Falha` com `title`
   "Falhou após várias tentativas".
6. **Contraste (claro e escuro).** Medir no DevTools o contraste do texto do badge `Confirmado`
   (mirar ≥ 4,5:1) e do ícone do micro-selo contra `bg-card` (mirar ≥ 3:1), nos dois temas.
   Registrar os números medidos; ajustar o token/opacidade do ícone se ficar abaixo.
7. **Teclado/foco.** Tab chega ao bloco do agendamento com anel de foco visível; o selo não
   cria alvo de foco extra nem quebra a ordem de tab. O `aria-label` do selo é lido pelo leitor
   de tela junto do bloco.
8. **Mobile (~375px).** Lista e blocos não estouram horizontalmente com selo + badge; no bloco
   compacto o selo cai no `title`. Histórico em cards no mobile (padrão atual preservado).
9. **PII.** Em nenhuma superfície (agenda, histórico, tooltip, DOM) aparece telefone do cliente
   ou o texto literal recebido. Confirma a invariante LGPD no cliente.

---

## 6. Dependências de dados / contrato (sinalizadas ao planejador)

Frontend **bloqueado** nestes itens até o backend definir — são decisões de contrato, não de
UI:

- **`appointments.confirmed_via`** (enum `cliente_whatsapp | manual`, nullable) — migration +
  gravação pelo webhook e pela mutação manual de status. Sem isso, o selo de origem (§2.2) sai
  de escopo e fica só o badge `Confirmado`.
- **Distinção de direção/origem em `messages`** — forma de a leitura PII-safe rotular
  recebida/enviada e cron/sob-demanda (coluna `direction`/`origin` ou template dedicado). Sem
  isso, o histórico não distingue os novos tipos e fica só com o rótulo de template atual.
- **Garantia PII** — o backend **não** deve persistir o texto bruto recebido do cliente em
  campo que a leitura PII-safe de `messages` traga para a UI. O rótulo exibido é derivado do
  efeito (confirmou/pediu reagendar), não do conteúdo.
- **Enums novos no `src/types/domain.ts`** — assim que o contrato do banco fechar, espelhar os
  enums (`confirmed_via`, `direction`/`origin`) como `const` tipados, no padrão dos enums
  existentes, para alimentar os schemas zod e os mapas de rótulo.

Itens **fora de escopo do frontend** nesta fatia (confirmando o brief): botões interativos do
WhatsApp (a resposta é numérica), reagendamento automático, autoagendamento público, métricas
(Fase 3), módulo Asaas/PIX. A fila de retentativa, o cron e o webhook são servidor — a UI só
reflete o resultado.

---

## 7. Resumo do que o frontend entrega

- 1 componente novo pequeno: `ConfirmationSourceBadge` (micro-selo de origem), irmão do
  `StatusBadge`, sem token de cor novo.
- Ajuste em `AppointmentBlock` + lista da `AgendaPage` para compor o selo quando a confirmação
  veio do cliente.
- Ajuste em `RecentMessagesList` + `src/lib/whatsapp.ts` para rotular lembrete automático,
  resposta recebida (sem PII), retorno de reagendamento e estado de retentativa.
- Extensão dos schemas zod de `useAppointments` e `useRecentMessages` para validar os campos
  novos como dado não confiável, com enums fechados.
- Zero rota nova, zero módulo novo, zero `fetch` solto, zero `tenant_id` no cliente, zero PII
  na UI. Tudo sob os guards e tokens existentes, mobile-first, dark mode, pt-BR.
