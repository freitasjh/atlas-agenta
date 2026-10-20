# Revisão B — ADR-06: Hooks TanStack Query de WhatsApp (`useWhatsAppInstance`, `useMessages`)

Dois hooks de dados que encapsulam o único ponto da UI que conversa com a Edge Function `whatsapp`: `useWhatsAppInstance` lê a instância do tenant via PostgREST sob RLS com polling condicional e dispara `pair`; `useMessages` lê o log de disparos com projeção PII-safe e dispara `send`. O diff é cirúrgico — exatamente os dois arquivos que a ADR previu (`src/hooks/useWhatsAppInstance.ts`, `src/hooks/useMessages.ts`), 247 linhas adicionadas, nada fora do escopo. A contraprova (`npm run build`, que inclui `tsc -b`) passa limpa; não há script de lint/test no projeto, então o typecheck é o gate completo disponível.

Watch for: um ponto de contrato (frontend aceita `message_id` como string não-UUID, enquanto o backend emite UUID — divergência benigna de rigor, **possible**) e uma decisão de projeção de `payload` que merece confirmação explícita contra LGPD (**likely**). Nenhum dos dois bloqueia.

**Verdict**: APPROVED

## Visão de alto nível

O isolamento multi-tenant está correto na borda do cliente: nenhuma das duas invocações da Edge Function coloca `tenant_id` no corpo (só `action`/`template`/ids), e o servidor deriva o tenant do JWT. As ocorrências de `tenant_id` no diff são todas em schemas de leitura (coluna que o banco devolve) ou comentários — nunca em filtro ou body de escrita. RLS continua sendo a fonte de verdade do isolamento; os hooks não tentam contorná-la.

O contrato de fio bate com a ADR-04 (dona do contrato). Os schemas zod do frontend (`pairResponseSchema`, `sendResponseSchema`, `messageRowSchema`) espelham `supabase/functions/whatsapp/schemas.ts` e a projeção de `src/lib/whatsapp.ts`. A única divergência é `message_id`: o backend valida `z.string().uuid().nullable()` e o frontend `z.string().nullable()` — o cliente é mais frouxo, o que é seguro (aceita o que o servidor emite), mas vale alinhar para pegar regressões cedo.

O tratamento das condições de negócio do `send` que chegam como HTTP não-2xx é o trecho mais sofisticado e está bem resolvido: `readSendResponseFromError` recupera o corpo da `Response` em `error.context` de forma defensiva, valida com `safeParse`, e só promove a resultado de negócio quando o shape casa; caso contrário cai no `mapWhatsAppError`. Isso evita que um `opt_out`/`not_connected`/`send_failed` seja tratado como erro genérico de infra.

A projeção PII-safe de `messages` não seleciona telefone/e-mail/documento — o vínculo ao destino é só `customer_id`, como manda a ADR-03 e o domínio. O único ponto a confirmar é `payload`, selecionado como jsonb inteiro.

O polling condicional atende A2: `refetchInterval` só retorna um intervalo quando `connection_status === "aguardando_qr"`, e `false` nos estados estáveis — a transição `aguardando_qr → conectado` fica observável sem reload e sem custo fora do estado transitório.

<details>
<summary>Issues (2)</summary>

1. **Projeção de `payload` inteiro vs. "payload restrito" da ADR** (likely) — a ADR (A5) diz "`payload` só campos não sensíveis / payload restrito", mas o `select` traz a coluna jsonb inteira. A garantia de ausência de PII fica só no servidor (a Edge Function escreve o payload). Não é vazamento hoje, mas a borda da UI não reforça a invariante. Confirmar com o autor que a garantia server-side basta, ou documentar que `payload` é controlado exclusivamente pela function e nunca recebe PII — e manter isso no review da ADR-04/08 quando o `send` real for implementado.
2. **`message_id` mais frouxo que o contrato** (possible) — frontend valida `z.string().nullable()`, backend emite `z.string().uuid().nullable()`. Divergência benigna (o cliente aceita o que o servidor manda), mas alinhar para `.uuid()` deixaria o espelho de contrato exato e pegaria regressão de formato. Opcional.

</details>

<details>
<summary>Details</summary>

### Fronteira multi-tenant: nenhum `tenant_id` no fio

`grep tenant_id` nos dois hooks retorna só: (a) campos dos schemas de leitura (`tenant_id: z.string()`), que validam a coluna que o PostgREST devolve sob RLS; (b) as strings de `select`; (c) comentários. Nenhuma ocorrência em `.eq("tenant_id", …)` nem no `body` de `functions.invoke`. Os corpos são literalmente `{ action: "pair" }` e `{ action: "send", template, customerId, appointmentId? }`. Isso satisfaz A3 e o CA-21/CA-F10, e respeita a regra inegociável de que o isolamento é do banco. O `appointmentId` só entra no body quando presente (spread condicional), coerente com o `.optional()` do contrato.

### Contrato de resposta espelha a ADR-04

`pairResponseSchema` do hook (`connection_status`, `qr_code_base64?`, `last_connected_at?`) é idêntico ao `pairResponseSchema` da function. `sendResponseSchema` do hook cobre os cinco outcomes (`sent`/`duplicate`/`opt_out`/`not_connected`/`send_failed`), `message_id` nullable, `status` no enum, `provider_message_id` nullable opcional — alinhado ao backend, exceto o rigor de UUID em `message_id` (ver Issues). Os enums vêm de `@/types/domain` (`MESSAGE_STATUSES`, `MESSAGE_TEMPLATES`, `WHATSAPP_CONNECTION_STATUSES`), fonte única — sem literais mágicos duplicados. O QR é tratado como estado efêmero: `pairResponseSchema` não é persistido em cache de instância; `onSuccess` só invalida `WHATSAPP_INSTANCE_KEY`.

### Recuperação do corpo de negócio no canal de erro

`readSendResponseFromError` é o ponto delicado e está robusto: checa `typeof error === "object"`, presença de `context`, e que `context.json` é função antes de chamar; envolve o `.json()` em try/catch; usa `safeParse` e devolve `null` quando não casa. Só um `SendResponse` válido vira resultado; o resto propaga como erro traduzido. Isso impede que a UI leia um 502 (`send_failed`) como "conecte o WhatsApp", distinção que o mapa de erro (`whatsapp-errors.ts`) também preserva. O shape da resposta continua sendo dado não confiável validado por zod (A4) tanto no caminho 2xx (`sendResponseSchema.parse(data)`) quanto no corpo do erro.

### Projeção PII-safe de `messages`

`MESSAGE_SELECT` lista `id, tenant_id, customer_id, appointment_id, channel, template, status, provider_message_id, failure_reason, payload, created_at`. Todas as colunas existem na migration `20250220091000_messages.sql`; nenhuma é PII em claro (sem `phone`/`email`/documento). `failure_reason` é descrito na migration como "técnico curto, SEM PII". O ponto aberto é `payload`: a coluna é jsonb de metadados controlada pela Edge Function, e a migration garante ausência de PII no servidor, mas o `select` pega o objeto inteiro em vez de projetar campos específicos — a ADR pedia projeção restrita. Como nenhum `send` real grava payload ainda (adapter mock), não há exposição concreta hoje; fica como item a reforçar quando o envio real entrar.

### Convenções e tratamento de nulo

`useWhatsAppInstance` usa `maybeSingle()` e trata `data === null` antes do parse — sem isso o zod quebraria no estado "tenant ainda sem instância". Tipagem explícita nas mutations (`useMutation<SendResponse, Error, SendMessageInput>`, `useMutation<PairResponse>`); sem `any`, satisfazendo A1. O estilo segue o padrão de `useCustomers`/`useAppointments` (zod no retorno, chaves de query de `@/lib/whatsapp`).

</details>

<details>
<summary>Mapa de arquivos</summary>

- `src/hooks/useWhatsAppInstance.ts` (novo) — `useWhatsAppInstance` (query RLS + polling condicional) e `usePairWhatsApp` (invoke `pair`); schemas zod da linha e da resposta de pair.
- `src/hooks/useMessages.ts` (novo) — `useRecentMessages` (query RLS, projeção PII-safe) e `useSendMessage` (invoke `send` com recuperação do corpo de negócio no canal de erro); schemas zod da linha e da resposta de send.

Diff completo: `git show a6ea9ef` no branch `feat/scaffold-inicial-atlas-agenda` (base: commit `658634a`, ADR-05).

</details>
