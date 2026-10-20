# ADR-06 — Hooks de dados TanStack Query (`useWhatsAppInstance`, `useMessages`)

- **Status:** proposto
- **Escopo:** frontend
- **Depende de:** ADR-04 (Edge Function `whatsapp` e seu contrato) e ADR-05 (tipos, enums, chaves de query, zod, mapa de erro). Pré-requisito das telas (ADR-07/08).

## Contexto

As telas precisam ler o estado da instância e o log de mensagens (via PostgREST sob RLS) e disparar as duas operações privilegiadas (via `supabase.functions.invoke`). Seguindo a convenção do projeto (`useCustomers`/`useAppointments`): toda leitura valida o shape com zod; nenhuma escrita envia `tenant_id`; nada de `fetch` solto em `useEffect`. As duas mutations são **invocações da Edge Function**, não PostgREST.

## Decisão

1. **`src/hooks/useWhatsAppInstance.ts`**
   - `useWhatsAppInstance()` → `useQuery(WHATSAPP_INSTANCE_KEY)`: lê a (única) linha de `whatsapp_instances` do tenant via `supabase.from("whatsapp_instances").select(...)` (leitura RLS-safe no PostgREST; não precisa de Edge Function). Valida o retorno com zod. `refetchInterval` **condicional**: ativo só quando `data?.connection_status === "aguardando_qr"` (ex.: ~2,5s); para em `conectado`/`desconectado`. Sem WebSocket.
   - `usePairWhatsApp()` → `useMutation`: chama `supabase.functions.invoke("whatsapp", { body: { action: "pair" } })`; valida a resposta com zod (`{ connection_status, qr_code_base64? }`); `onSuccess` invalida `WHATSAPP_INSTANCE_KEY`. O QR retornado é estado efêmero da página (não persistido, não re-armazenado em cache de query).

2. **`src/hooks/useMessages.ts`**
   - `useRecentMessages(limit)` → `useQuery([...MESSAGES_KEY, { limit }])`: lê `messages` recentes do tenant via PostgREST (RLS), projeção **sem PII** (não seleciona telefone; `payload` só campos não sensíveis). Valida com zod. Ordena por `created_at desc`, `limit`.
   - `useSendMessage()` → `useMutation`: chama `supabase.functions.invoke("whatsapp", { body: { action: "send", template, customerId, appointmentId? } })`; valida a resposta com zod; distingue `outcome` `sent` × `duplicate` × `opt_out` × `not_connected`; `onSuccess` invalida `MESSAGES_KEY`. Erros passam pelo mapa de `src/lib/whatsapp-errors.ts`.

O cliente **nunca** envia `tenant_id` — só `action`/`template`/ids no body. Respostas da function são dado não confiável: validadas por zod antes do uso.

## Consequências

- Encapsula o único ponto da UI que fala com Edge Function; as telas consomem hooks, não `invoke` cru.
- O polling condicional entrega a transição observável `aguardando_qr → conectado` sem reload manual e sem custo fora desse estado.
- A projeção sem PII na leitura de `messages` cumpre LGPD na borda da UI.
- Reusa o padrão zod/TanStack já validado no projeto; baixo risco.

## Arquivos afetados

- `src/hooks/useWhatsAppInstance.ts` (novo)
- `src/hooks/useMessages.ts` (novo)

## Critérios de aceite testáveis (desta ADR)

- **A1.** `npm run build` e `npm run typecheck` limpos, sem `any` (CA-16, CA-F11).
- **A2.** `useWhatsAppInstance` só faz polling quando `connection_status === "aguardando_qr"` (inspeção do `refetchInterval` condicional; verificável em runtime no QA observando as requisições).
- **A3.** `usePairWhatsApp`/`useSendMessage` invocam `supabase.functions.invoke("whatsapp", ...)` com body contendo apenas `action`/`template`/ids — **nenhum `tenant_id`** (CA-21, CA-F10; `grep` por `tenant_id` nos dois hooks retorna vazio no corpo das invocações).
- **A4.** As respostas da função são validadas por zod antes do uso (inspeção); shape inválido não quebra a UI (cai no mapa de erro).
- **A5.** `useRecentMessages` não seleciona colunas com PII (sem `phone`; `payload` restrito) — inspeção do `select`.
