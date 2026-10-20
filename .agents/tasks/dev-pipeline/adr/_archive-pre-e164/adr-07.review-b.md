# Revisão B — ADR-07: Tela de conexão `/app/config/whatsapp`

Tela de conexão de WhatsApp como rota filha de `config`, encenando a máquina de estados de `whatsapp_instances` (desconectado → aguardando_qr → conectado) com pareamento por QR mock, mais um histórico de disparos sem PII. Adiciona um atalho no hub de Configurações e 4 componentes novos sob `src/app/config/whatsapp/`, consumindo os hooks da ADR-06 e a fundação da ADR-05. Não toca banco nem Edge Function — só UI que invoca a função via hook. A abordagem segue o padrão das telas existentes (guards herdados, gate por capacidade no botão, `StatePanel` para erro), e a aderência ao escopo da ADR é exata: os 6 arquivos declarados são os 6 arquivos do diff.

Watch for: nenhum bloqueador. Dois pontos menores de a11y/UX (confirmed) e um de contrato de QR (likely) que valem ajuste, mas não impedem o merge.

**Verdict**: APPROVED

## Visão geral

O diff bate 1:1 com os "Arquivos afetados" da ADR: rota em `router.tsx`, atalho em `ConfigHubPage.tsx`, e os quatro componentes (`WhatsAppPage`, `ConnectionCard`, `QrCodeDisplay`, `RecentMessagesList`). Nenhum arquivo fora do escopo, nenhum componente shadcn recriado — tudo reusa `Card`/`Button`/`Table`/`Skeleton` e o `WhatsAppStatusBadge` da ADR-05.

Fronteiras de segurança estão respeitadas por construção. A tela nunca envia `tenant_id`; o pareamento só carrega `{ action: "pair" }` e o isolamento vem do RLS + autorização na função (ADR-02/04). O gate de UI é por capacidade (`canManageWhatsAppConnection`, só admin) como defesa em profundidade, nunca como trava — coerente com o resto do projeto. Confirmei nas migrations que `messages` e `customers` liberam SELECT para os três papéis operacionais, então `RecentMessagesList` ler ambos não cruza RBAC para nenhum papel que chega à página.

LGPD/PII: o histórico só mostra nome do cliente, rótulo do template, status e quando — a projeção de `useRecentMessages` não traz telefone/corpo, e `customerLabel` cai em "Cliente" quando o nome não resolve. Nenhum segredo no cliente. O QR é estado efêmero (`useState`), nunca persistido nem cacheado.

Qualidade e acessibilidade: `npm run build` (que roda `tsc -b` + `vite build`) passa limpo, sem `any`. A tela traz `aria-live` para transição de status, QR com `alt` e alternativa textual numerada, `motion-reduce` nas animações, foco visível herdado dos primitivos, e badges com cor + texto. Os pontos abaixo são refinamentos, não falhas de barreira.

<details>
<summary>Issues (3)</summary>

1. **QR no estado `aguardando_qr` após reload** — o QR vive só em `useState` do `ConnectionCard`; se o tenant recarregar a página com a instância já em `aguardando_qr`, o card renderiza o painel de QR com `qrCodeBase64` indefinido, caindo no fallback "Não foi possível gerar o código". Não quebra (fallback previsto), mas a mensagem sugere falha onde o certo seria convidar a gerar o código. Considerar copy neutra no fallback ou um CTA primário "Gerar código" nesse caminho.
2. **`aria-live` sempre presente mas com string vazia durante loading** — a região viva em `WhatsAppPage` renderiza `""` enquanto `!isSuccess`. Funciona, mas a primeira transição de "" para o texto pode não ser anunciada de forma consistente entre leitores. Baixo impacto; a instrução textual e o badge cobrem o sinal.
3. **Reconectar não limpa QR anterior** — no estado `conectado`, clicar "Reconectar" dispara `pair` e seta novo QR, mas a UI permanece no card "conectado" até o polling/invalidação mudar o status; o QR recém-gerado não aparece imediatamente. Depende da função mock devolver `aguardando_qr`; se devolver, a invalidação resolve. Vale confirmar no QA o fluxo reconectar.

</details>

<details>
<summary>Details</summary>

### Aderência à ADR e ao design doc

Cada item da seção "Decisão" tem contrapartida no diff. A rota entra como `{ path: "whatsapp", element: <WhatsAppPage /> }` dentro do bloco de guards existente, sem novo guard de router — exatamente como a ADR pede e como `servicos`/`profissionais` fazem. O atalho no hub é o terceiro `SHORTCUT` com `MessageCircle` e a copy pt-BR especificada ("Conecte o número que fala com seus clientes."). Os três estados da máquina estão encenados com as copys da ADR §3.5 ("Nenhum número conectado ainda.", "Aponte a câmera do WhatsApp para este código.", "Aguardando leitura", etc.). O layout de pareamento é `grid md:grid-cols-2` (QR | instruções) empilhando no mobile — mobile-first, sem overflow aparente em ~375px (a confirmar no QA visual).

O gate por capacidade cobre os três estados: `canManage` some os CTAs para `professional`/`receptionist`, e o estado `desconectado` sem capacidade mostra "Peça a um administrador para conectar o número." em vez de um botão morto — o papel sem permissão vê o estado, não um vazio.

### Fronteiras multi-tenant / RLS / RBAC / segredos

O pareamento invoca a função com corpo `{ action: "pair" }` (via `usePairWhatsApp`), sem `tenant_id`; a leitura da instância e do histórico passa por PostgREST sob RLS. Confirmei em `20250220091000_messages.sql` e `20250219090000_customers.sql` que o SELECT de ambas as tabelas é liberado para `admin`/`receptionist`/`professional` — então `RecentMessagesList`, que chama `useRecentMessages()` e `useCustomers()` sem condicionar por papel, não gera erro nem cruza RBAC para nenhum papel que alcança a tela. `messages` não é dado financeiro (ao contrário de `charges`), então recepção lê por desenho.

### PII / LGPD

A projeção de `useRecentMessages` (`MESSAGE_SELECT`) não inclui `phone`/`email`; `RecentMessagesList` exibe nome (de `customers`, lido sob RLS), template, status e timestamp. Telefone e corpo nunca chegam à tela. `customerLabel` degrada para "Cliente" quando o id não está no mapa — sem vazar id cru. Alinhado ao CA-F10.

### Datas no fuso do tenant

`whenLabel` converte só na borda de exibição via `formatDateInTenantTz`/`formatTimeInTenantTz` com `tenant?.timezone ?? "America/Sao_Paulo"`. `formatRelativeFromNow` trata `NaN` devolvendo string vazia (o render condiciona com `relative ? ...`), então data inválida não imprime "Invalid Date".

### Acessibilidade

QR com `alt` descritivo e moldura branca (quiet zone) para leitura no dark; as instruções numeradas são a alternativa não-visual real. Animações (`animate-pulse`, `animate-spin`) todas com `motion-reduce:animate-none`. O skeleton de loading do QR expõe `aria-busy` + `sr-only`. Badge sempre com rótulo textual além da cor (vem de `WhatsAppStatusBadge`, ADR-05). O ponto aberto é a região viva começar como `""` (issue 2), de baixíssimo impacto.

### Contraprova

`npm run build` → `tsc -b && vite build` passou limpo, zero erro de tipo, sem `any` introduzido (CA-16/CA-F11). O aviso de chunk > 500 kB é pré-existente e global ao bundle (não é introduzido por esta ADR — nenhum dos 6 arquivos adiciona dependência pesada). Não há script de lint/test no `package.json`; `typecheck` é coberto pelo `build`. Dev server e verificação visual ficam para o QA (Chrome DevTools), como instruído.

</details>

<details>
<summary>Mapa de arquivos</summary>

- `src/router.tsx` — adiciona rota filha `whatsapp` sob `config`, dentro dos guards existentes.
- `src/app/config/ConfigHubPage.tsx` — terceiro atalho "WhatsApp" (`MessageCircle`).
- `src/app/config/whatsapp/WhatsAppPage.tsx` (novo) — header + badge + região viva + `ConnectionCard` + histórico; estados loading/erro.
- `src/app/config/whatsapp/ConnectionCard.tsx` (novo) — encena os 3 estados da conexão; CTAs sob `canManage`; QR efêmero em `useState`.
- `src/app/config/whatsapp/QrCodeDisplay.tsx` (novo) — render do QR base64 com fallback para ausência.
- `src/app/config/whatsapp/RecentMessagesList.tsx` (novo) — histórico sem PII; tabela no desktop, cards no mobile.

Diff completo: `git show fa7c190`.

</details>
