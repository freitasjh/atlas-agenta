# Revisor B — ADR-19: `check` fundido no polling e QR persistente em `aguardando_qr`

Fecha OQ-01 do lado do frontend: funde a reconciliação (`action: "check"`) dentro do `queryFn` do
polling já existente do `useWhatsAppInstance`, espelha o DTO `CheckRequest`/`CheckResponse` do
backend em `src/lib/whatsapp.ts` + zod local no hook, e blinda o QR efêmero do `ConnectionCard`
contra zeragem entre refetches. Três arquivos de frontend, sem rota/guard/dependência/migration
nova. A abordagem A (fundir no `queryFn`, sem segundo timer) foi seguida fielmente à
`analysis-frontend.md`, inclusive a ordem preferida (ler linha → se `aguardando_qr`, `check` → reler).

Watch for: nada bloqueante. Um ponto informativo sobre custo de I/O por tick (ler → check → reler)
que é escolha consciente da ADR, não defeito (confirmed). O contrato de fio frontend↔backend confere
byte a byte com `schemas.ts` (confirmed).

**Verdict**: APPROVED

## High-level view

A reconciliação entra como duas funções puras extraídas do `queryFn` — `readWhatsAppInstanceRow`
(dado canônico, sob RLS) e `reconcileWhatsAppCheck` (best-effort, engole falha). O `queryFn` só
dispara o `check` quando a linha lida está em `aguardando_qr`, satisfazendo a invariante (a) da ADR
("check só roda enquanto aguardando_qr") sem depender do cache — a leitura fria no reload já em
`aguardando_qr` reconcilia no primeiro tick. O `refetchInterval` condicional de 2500 ms não foi
tocado: ao virar `conectado` ele mesmo se desliga.

As fronteiras estão respeitadas. O corpo do `check` é só `{ action: "check" }` — nenhum `tenant_id`
sai do cliente; o servidor deriva do JWT e `handleCheck` ainda exige `role === "admin"`. A falha de
`check` (rede, Evolution fora, parse zod) é engolida com log técnico curto sem PII e nunca relança,
então um tick ruim não derruba QR nem estado nem emite toast (RF-QR-06). O `CheckResponse` do
frontend e o `checkResponseSchema` zod são espelho exato do `checkResponseSchema` do backend
(`connection_status` + `last_connected_at?`), e o `satisfies z.ZodType<CheckResponse>` trava a
divergência em tempo de compilação.

O QR continua estado local efêmero do `ConnectionCard`, setado só em `handleConnect`, nunca
persistido nem recolocado em cache. A mudança no card é só um comentário documentando a invariante;
nenhum efeito novo zera o `useState`, então o QR sobrevive aos refetches até a linha virar
`conectado`. `npm run build` (`tsc -b && vite build`) passou limpo, TS estrito, sem `any`, sem
dependência nova — CA-19.1 satisfeito.

<details>
<summary>Issues (1)</summary>

1. **Custo de I/O por tick (informativo)** — em `aguardando_qr`, cada tick faz read → invoke(check)
   → read (2 leituras PostgREST + 1 função por 2500 ms). É a ordem preferida (i) escolhida
   explicitamente pela ADR/analysis para reconciliar já no primeiro tick; o polling para sozinho ao
   conectar. Nenhuma ação exigida — registrado só para o QA observar que não há timer/loop extra.

</details>

<details>
<summary>Details</summary>

### Contrato de fio: espelho exato e travado por tipo

`src/lib/whatsapp.ts` adiciona `CheckRequest = { action: "check" }` e
`CheckResponse = { connection_status: WhatsAppConnectionStatus; last_connected_at?: string | null }`.
Conferi contra o `schemas.ts` do backend (ADR-17, presente e commitado em HEAD):
`checkInputSchema = z.object({ action: z.literal("check") })` está no `requestSchema`
(discriminated union) e `checkResponseSchema = { connection_status: connectionStatusSchema,
last_connected_at: z.string().nullable().optional() }`. O mirror é fiel. O zod local do hook
(`checkResponseSchema`) reusa `WHATSAPP_CONNECTION_STATUSES` (mesma fonte do enum de domínio) e
carrega `satisfies z.ZodType<CheckResponse>` — se o DTO e o schema zod divergirem, o build quebra.
É a melhor trava possível para um espelho mantido à mão em dois repositórios de código.

### `check` só em `aguardando_qr`, falha engolida, dado canônico na releitura

```
queryFn:
  row = readWhatsAppInstanceRow()         // RLS, zod, dado canônico
  if row?.connection_status !== "aguardando_qr": return row   // invariante (a)
  await reconcileWhatsAppCheck()          // best-effort, try/catch engole tudo
  return readWhatsAppInstanceRow()        // relê — canônico
```

A invariante (a) ("check só roda enquanto aguardando_qr") é garantida pela leitura da linha *antes*
do check, não pelo cache — resolve o caso de boundary citado na análise (reload já em
`aguardando_qr`, sem estado anterior). `reconcileWhatsAppCheck` valida a resposta com zod e, em
qualquer falha (invoke error — inclui o 503 que o usuário viu quando a função não estava servida —,
Evolution fora, parse inválido), cai no `catch` com `console.debug` curto sem PII e **não relança**.
A invariante (b) ("falha de check nunca derruba a leitura nem o QR") sai de graça: o `queryFn`
sempre termina na releitura da linha. Invariante (c) ("sem segundo timer"): só o `refetchInterval`
condicional preexistente governa o ritmo; nenhum `setInterval`/`useEffect` novo.

### QR efêmero preservado sem lógica nova

A única mudança no `ConnectionCard` é um comentário. `qrCodeBase64` é `useState` setado
exclusivamente em `handleConnect` (resposta de `pair`); nenhum efeito, nenhum refetch e nenhum
`invalidateQueries` toca esse estado. Enquanto a linha está `aguardando_qr`, o card segue no mesmo
ramo e re-renderiza com o mesmo QR tick após tick; quando vira `conectado`, cai no ramo conectado e
o QR naturalmente deixa de renderizar. O QR nunca é persistido nem recolocado em cache de query —
fronteira de segredos/LGPD preservada (CA-19.3).

### Fronteiras multi-tenant / RBAC / segredos

- **tenant_id nunca no cliente:** corpo do `check` = só `{ action: "check" }` (confirmado no
  `supabase.functions.invoke`). Idêntico a `pair`.
- **RBAC + tenant do JWT:** `handleCheck` no backend exige `role === "admin"` e deriva
  `tenantId` da identidade (`tenant-${tenantId}`); a escrita de `connection_status`/`last_connected_at`
  é da Edge Function com service role, nunca do cliente. O frontend só lê a linha sob RLS. A
  reconciliação no servidor é idempotente (só grava `conectado` quando `state === "open"`; regravar o
  mesmo valor é inócuo) — alinhado à regra de idempotência de fronteira.
- **Segredos:** nenhum `VITE_EVOLUTION`/service role no bundle; o QR não é persistido; a resposta de
  `check` não carrega QR nem credencial. Não há vazamento no corpo validado.
- **Status de assinatura:** guard `RequireActiveSubscription` herdado, não alterado — correto para o
  escopo.

### Contraprova

`npm run build` → `tsc -b && vite build` concluiu em ~9 s, **sem erros de tipo**, 1879 módulos
transformados, TS estrito. Não há script de lint/test no `package.json` (só `build`/`typecheck`);
`typecheck` é o próprio `tsc -b` já coberto pelo build. Sem dependência nova em `package.json`
(CA-19.1 ✓). O warning de chunk > 500 kB é preexistente (bundle único do SPA) e fora do escopo da
ADR-19.

</details>

<details>
<summary>Arquivos no escopo da ADR-19 (commit 7d6231a)</summary>

- `src/lib/whatsapp.ts` — DTOs `CheckRequest`/`CheckResponse` espelhando o backend.
- `src/hooks/useWhatsAppInstance.ts` — `readWhatsAppInstanceRow` + `reconcileWhatsAppCheck` extraídos;
  `queryFn` dispara `check` best-effort só em `aguardando_qr` e relê a linha canônica; `refetchInterval`
  intacto.
- `src/app/config/whatsapp/ConnectionCard.tsx` — comentário documentando a invariante do QR efêmero;
  nenhuma mudança comportamental.

Diff completo: `git show 7d6231a`. Contrato de backend consumido: ADR-17 (`schemas.ts`,
`evolution-adapter.ts`) e ADR-18 (`index.ts handleCheck`), ambos presentes em HEAD.

</details>
