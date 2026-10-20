# ADR-07 — Tela de conexão `/app/config/whatsapp` (rota, hub, pareamento por QR, histórico)

- **Status:** proposto
- **Escopo:** frontend
- **Depende de:** ADR-05 (badge, lib, tipos, permissões) e ADR-06 (hooks `useWhatsAppInstance`, `useMessages`). Não depende de ADR-08.

## Contexto

A primeira das duas superfícies de UI: a tela onde o admin conecta o número por QR Code (mock) e qualquer papel do tenant vê o estado da conexão evoluir, além do histórico recente de mensagens. Entra como rota filha de `config`, herdando `RequireAuth → RequireActiveSubscription → AppLayout` — sem novo guard de router (consistente com `servicos`/`profissionais`, que gateiam por capacidade, não por rota). A tela encena a máquina de estados de `whatsapp_instances` e é a primeira a consumir uma Edge Function.

## Decisão

1. **Rota** em `src/router.tsx`: adicionar `{ path: "whatsapp", element: <WhatsAppPage /> }` como filha de `config`, irmã de `servicos`/`profissionais`, dentro do bloco de guards existente. Nenhum guard novo.

2. **Card no hub** em `src/app/config/ConfigHubPage.tsx`: adicionar um terceiro `SHORTCUT` "WhatsApp" (ícone `MessageCircle`/`Smartphone` do lucide), apontando `/app/config/whatsapp`, no mesmo padrão dos atalhos existentes.

3. **Página e componentes** (um componente por arquivo, PascalCase):
   - `src/app/config/whatsapp/WhatsAppPage.tsx` — `PageHeader` + `WhatsAppStatusBadge` do estado atual + `ConnectionCard` + `RecentMessagesList`; estados de carregamento/erro/vazio com o molde `StatePanel` reusado de Clientes/Agenda.
   - `src/app/config/whatsapp/ConnectionCard.tsx` — encena a máquina de estados: `desconectado` → "Nenhum número conectado ainda." + CTA "Conectar WhatsApp" (só `canManageWhatsAppConnection`); `aguardando_qr` → `QrCodeDisplay` + instruções numeradas + CTA "Gerar novo código" + ponto pulsante discreto; `conectado` → resumo do nome da instância + `last_connected_at` relativo (fuso do tenant) + "Reconectar" (secundário). Papéis sem a capacidade veem os mesmos estados **sem** CTA.
   - `src/app/config/whatsapp/QrCodeDisplay.tsx` — render do QR base64 em `<img alt="QR Code para conectar o WhatsApp">` com moldura clara (quiet zone) para leitura no tema escuro; estado de carregamento; se o QR vier ausente/inválido, não renderiza imagem quebrada (mensagem genérica).
   - `src/app/config/whatsapp/RecentMessagesList.tsx` — lista de `messages` recentes (cliente/nome + template + status via `WhatsAppStatusBadge` + quando), **sem PII**; tabela no desktop, cards no mobile.

4. **Layout do painel de pareamento**: duas colunas no desktop (QR | instruções), empilhadas no mobile (QR acima, instruções abaixo) — mobile-first, sem overflow horizontal em ~375px.

5. **Acessibilidade**: `aria-live="polite"` numa região de status anuncia a transição da conexão; a instrução textual numerada é a alternativa não-visual real ao QR; animação de "aguardando" respeita `prefers-reduced-motion`; foco visível no card do hub, no botão de parear e nos controles; todo badge tem rótulo textual além da cor.

6. **Copy pt-BR** conforme análise de frontend §3.5 ("Conecte o número que fala com seus clientes.", "Nenhum número conectado ainda.", "Aponte a câmera do WhatsApp para este código.", "Aguardando leitura", "Conectado", etc.).

Reutilizar primitivos shadcn existentes (`Card`, `Button`, `Table`, `Skeleton`, `Badge`) e os padrões de página; não recriar componentes.

## Consequências

- Entrega a metade "conectar" do valor da fase: parear + ver status evoluir + histórico, tudo sob os guards já existentes.
- O polling condicional (ADR-06) torna a transição observável sem reload manual.
- A rota sem guard de role mantém o padrão do projeto; o gate é por capacidade no botão.
- A tela não conhece o mock — só invoca a function via hook.

## Arquivos afetados

- `src/router.tsx` (modificar — adicionar rota filha)
- `src/app/config/ConfigHubPage.tsx` (modificar — terceiro atalho)
- `src/app/config/whatsapp/WhatsAppPage.tsx` (novo)
- `src/app/config/whatsapp/ConnectionCard.tsx` (novo)
- `src/app/config/whatsapp/QrCodeDisplay.tsx` (novo)
- `src/app/config/whatsapp/RecentMessagesList.tsx` (novo)

## Critérios de aceite testáveis (desta ADR)

- **A1.** `npm run build` e `npm run typecheck` limpos, sem `any` (CA-16, CA-F11).
- **A2.** O hub de Configurações mostra o card "WhatsApp"; clicar leva a `/app/config/whatsapp` sem erro de console (CA-F01).
- **A3.** Sem instância: "Nenhum número conectado ainda." + "Conectar WhatsApp" só para admin; `professional`/`receptionist` veem o estado sem o botão (CA-F02).
- **A4.** Admin clica "Conectar WhatsApp" (mock): QR base64 renderiza, badge vai a "Aguardando leitura" (âmbar); polling condicional leva a "Conectado" (verde) sem reload manual (CA-F03, CA-14).
- **A5.** Em ~375px o painel de pareamento empilha (QR acima, instruções abaixo) sem overflow; histórico vira cards (CA-F08).
- **A6.** Dark default; foco visível por teclado; `aria-live` anuncia a mudança de status; animação respeita reduced-motion; badges com cor + texto, contraste AA ≥ 4.5:1 em dark e light (CA-F07, CA-F09).
- **A7.** Histórico não mostra telefone/corpo com PII; todo texto em pt-BR (CA-F10, CA-F12). QA via Chrome DevTools cobre o fluxo conectar sem erro de console.
