# ADR-19 — Frontend: `check` fundido no polling e QR persistente em `aguardando_qr`

**Status:** proposto
**Escopo:** frontend (React + Vite + TS)
**Branch:** `feat/whatsapp-base-mock`
**Depende de:** **ADR-18** (action `check` no backend, `pair` parando em `aguardando_qr`) e **ADR-17**
(`CheckResponse`/`checkResponseSchema` — contrato de fio). Também de ADR-06 (hooks de dados / contrato
de fio do frontend).
**Deriva de:** ADR-16 (registro consolidado de OQ-01). **Fecha OQ-01** fim a fim.

## Contexto (causa-raiz no frontend, confirmada no código)

- `src/hooks/useWhatsAppInstance.ts`: `useWhatsAppInstance` já tem `refetchInterval` condicional
  (`AWAITING_QR_POLL_MS = 2500` enquanto `connection_status === "aguardando_qr"`, `false` nos estados
  estáveis) e valida a linha com `whatsAppInstanceRowSchema`. `usePairWhatsApp` invoca `action: "pair"`.
  Mas o `queryFn` só **relê a linha** — não dispara nenhuma `check`, então a linha nunca transiciona
  sozinha para `conectado` quando a Evolution confirma o pareamento.
- `src/app/config/whatsapp/ConnectionCard.tsx`: renderiza o QR só no ramo `status === "aguardando_qr"`;
  o ramo `conectado` não renderiza QR. Hoje o QR some porque, com o bug do backend (corrigido em
  ADR-18), a linha virava `conectado` cedo demais. Com `pair` parando em `aguardando_qr`, o ramo certo
  é alcançado — resta blindar para que os refetches do polling **não** zerem o QR.
- `src/lib/whatsapp.ts`: tem o vocabulário de `connection_status` mas **nenhum** DTO `check`.

## Decisão (abordagem A — reconciliação fundida no `queryFn`, decidida em `analysis-frontend.md`)

Sem rota/guard/dependência nova. Nenhum segundo timer. `tenant_id` nunca sai do cliente (corpo só
`{ action: "check" }`).

1. **`src/lib/whatsapp.ts`:** espelhar o DTO de ADR-17 — `CheckRequest = { action: "check" }` e
   `CheckResponse = { connection_status: WhatsAppConnectionStatus; last_connected_at?: string | null }`.
   Os dois arquivos (este e `schemas.ts`) são espelho explícito; se o contrato mudar no backend,
   atualizar aqui.

2. **`src/hooks/useWhatsAppInstance.ts` — fundir `check` no `queryFn`** (não em segundo hook/useEffect):
   reusar o `refetchInterval` de 2500 ms já existente. No `queryFn`, quando o estado atual (cache) é
   `aguardando_qr`, invocar `supabase.functions.invoke("whatsapp", { body: { action: "check" } })` em
   modo **best-effort** dentro de `try/catch` que **engole** a falha (log técnico curto, sem PII, nunca
   relança) e valida a resposta com um zod local (`checkResponseSchema` espelho); **em seguida** reler a
   linha de `whatsapp_instances` sob RLS (como hoje), validada por `whatsAppInstanceRowSchema` — esse é
   o dado **canônico**. A transição para `conectado` desliga o `refetchInterval` (polling para sozinho).
   Ordem preferida (análise, nota de boundary): ler a linha e, se vier `aguardando_qr`, disparar a
   `check` e reler, para reconciliar já no primeiro tick mesmo sem cache anterior. Invariantes: (a)
   `check` só roda enquanto `aguardando_qr`; (b) falha de `check` nunca derruba a leitura nem o QR; (c)
   nenhum segundo timer. `usePairWhatsApp` permanece como está (muda só o shape da resposta validada,
   agora `aguardando_qr` + `qr_code_base64`).

3. **`src/app/config/whatsapp/ConnectionCard.tsx` — não descartar o QR entre refetches:** o
   `qr_code_base64` é estado local efêmero (`useState`), obtido na resposta de `pair`. Garantir que,
   enquanto a linha está `aguardando_qr`, os refetches do polling **não** limpem esse estado — o card
   continua renderizando o QR até a linha virar `conectado`. Ajuste defensivo: **não introduzir** nenhum
   efeito que zere o `useState` do QR ao ligar o polling de `check`. O QR nunca é persistido nem
   recolocado em cache de query.

4. **Erro transitório silencioso (RF-QR-06):** Evolution indisponível durante `aguardando_qr` **não**
   emite toast a cada tick (a `check` é best-effort e não lança); QR e estado permanecem; o próximo tick
   tenta de novo. Só a falha de **leitura da linha** leva ao painel "Não foi possível carregar a
   conexão" (comportamento já existente em `WhatsAppPage`).

## Consequências

- **Positivo:** fecha OQ-01 fim a fim — o admin vê o QR real escaneável em `aguardando_qr`, o QR
  persiste entre os ticks, e a tela transita sozinha para "WhatsApp conectado" quando a Evolution (real)
  ou o mock confirma o pareamento, sem reload. Uma única fonte de verdade de polling; sem WebSocket.
- **Negativo/risco:** a `check` roda a cada 2500 ms enquanto aguardando — aceitável (best-effort,
  idempotente no servidor, para sozinha ao conectar). Mudança de comportamento no real (exige scan do
  QR) já aprovada.
- **Arquivos afetados:** `src/lib/whatsapp.ts`, `src/hooks/useWhatsAppInstance.ts`,
  `src/app/config/whatsapp/ConnectionCard.tsx`. Sem migration, sem dependência nova.

## Regras de fronteira

- **Sem `tenant_id` no cliente:** corpo de `check` = só `{ action: "check" }`; servidor deriva do JWT.
- **Dado não confiável:** resposta de `check` validada por zod no frontend; parse falho → ignorado
  (best-effort), confia na releitura da linha.
- **Segredos:** nenhum `VITE_EVOLUTION`/service role no bundle/DOM/Network; QR não persistido.
- **A11y/UI preservadas:** `aria-live="polite"`, alternativa textual (`<ol>`), foco visível,
  `motion-reduce`, responsivo mobile-first e dark — não regredir (ADR-02/06).
- **Status de assinatura:** `bloqueado`/`cancelado` já interceptados por `RequireActiveSubscription`;
  guard herdado, não alterado.

## Critérios de aceite testáveis (desta ADR)

- **CA-19.1 (build):** `npm run build` (`tsc -b && vite build`) e `npm run typecheck` **limpos**, TS
  estrito, **sem `any`**, **sem dependência nova** em `package.json`.
- **CA-19.2 (polling → check):** enquanto `aguardando_qr`, a aba Network mostra invocações periódicas
  (~2500 ms) de `functions/v1/whatsapp` com corpo `{ action: "check" }` e **nenhum** `tenant_id`; ao
  virar `conectado`, o `refetchInterval` para (sem mais invocações).
- **CA-19.3 (QR persistente):** no modo real, clicar "Conectar" leva a `aguardando_qr` com
  `<img alt="QR Code para conectar o WhatsApp">` no DOM, que **permanece** entre os refetches até a
  linha virar `conectado` (RF-QR-04).
- **CA-19.4 (mock conclui):** `EVOLUTION_MODE=mock` → o polling conclui sozinho para `conectado` sem
  reload; card passa a "WhatsApp conectado" (RF-QR-05/CA-03).
- **CA-19.5 (erro silencioso):** derrubar a Evolution durante `aguardando_qr` mantém QR + estado, **sem**
  toast a cada tick; só falha de leitura da linha mostra o painel de erro (RF-QR-06).
- **CA-19.6 (QA ao vivo, Chrome DevTools):** critérios visuais da seção 8 do PRD — QR visível/persistente,
  badge "Aguardando leitura do QR", `aria-live`, RBAC (admin vê CTA; receptionist/professional não),
  responsivo/dark, console limpo. **Nunca** enviar mensagem real a terceiro; scan real é teste manual do
  usuário.

## Dependência da ADR anterior

Depende de **ADR-18** (a action `check` precisa existir e `pair` precisa parar em `aguardando_qr`) e de
**ADR-17** (DTO `CheckResponse`). É a última da cadeia: só com ela o fluxo fecha fim a fim e OQ-01 é
resolvido.
