# ADR-17 — Porta `EvolutionAdapter.getConnectionState` + contrato da action `check`

**Status:** proposto
**Escopo:** dados (Edge Function Deno — infra/contrato, sem mudança de comportamento observável)
**Branch:** `feat/whatsapp-base-mock` (reaproveita a base de WhatsApp; não recria)
**Depende de:** ADR-04 (contrato da Edge Function `whatsapp`, `schemas.ts`), ADR-09 (`evolutionFetch`,
`connectionStateSchema`, resolução de credenciais do env). Não depende de ADR nova.
**Deriva de:** ADR-16 (registro consolidado de OQ-01), aqui quebrado em unidade infra/contrato.

## Contexto

Para corrigir OQ-01 (QR gerado, nunca escaneável; ver ADR-16 e `analysis-data.md`), a Edge Function
`whatsapp` precisa, no fim, consultar o estado REAL da Evolution e expor uma action de checagem. Antes
de qualquer mudança de comportamento, é preciso existir a **porta** para consultar o estado e o
**contrato de fio** da nova action — duas peças de infra puras, sem efeito observável até os handlers
(ADR-18) e o frontend (ADR-19) as consumirem.

O código confirma o ponto de partida: `evolution-adapter.ts` já exporta `connectionStateSchema`
(`{ instance: { instanceName, state } }`, `state ∈ open|connecting|close`) e `evolutionFetch`, mas a
interface `EvolutionAdapter` **não** tem método de checagem de estado. `schemas.ts` tem
`requestSchema = z.discriminatedUnion("action", [pairInputSchema, sendInputSchema])` e
`pairResponseSchema`, mas **nenhuma** variante `check` nem DTO de resposta de checagem.

Esta ADR é a menor unidade revisável que estabelece o contrato; ela não muda nenhum caminho de
execução (nenhum handler chama `getConnectionState` ainda, nenhuma rota aceita `action: "check"` ainda —
isso é ADR-18). Por isso é segura de revisar e buildar isolada.

## Decisão

Sem migration, sem dependência nova, segredo só em `Deno.env`, nada de `tenant_id` no contrato.

1. **Estender a porta `EvolutionAdapter`** (`evolution-adapter.ts`) com
   `getConnectionState(instanceName: string): Promise<{ state: EvolutionState }>`, onde `EvolutionState`
   é o tipo já derivado de `connectionStateSchema` (`open|connecting|close`). A interface é a dona do
   formato; não vaza o corpo cru da Evolution.
   - `RealEvolutionAdapter.getConnectionState`: `evolutionFetch(GET /instance/connectionState/{instance})`
     → `connectionStateSchema.safeParse` do corpo (dado não confiável) → retorna
     `{ state: data.instance.state }`. Corpo fora do contrato ou resposta `!ok` → `Error` com mensagem
     pt-BR controlada, **sem** vazar o corpo cru nem a API key. Timeout/rede já são tratados por
     `evolutionFetch` (reusar, não recriar). Nunca logar QR, corpo cru ou token.
   - `MockEvolutionAdapter.getConnectionState`: retorna `{ state: "open" }` — mantém o fallback de demo
     capaz de concluir a conexão sem rede/celular (RF-QR-05).

2. **Adicionar o contrato da action `check` em `schemas.ts`:**
   - `checkInputSchema = z.object({ action: z.literal("check") })` (corpo só `action`, igual a `pair`).
   - Incluí-lo na union:
     `requestSchema = z.discriminatedUnion("action", [pairInputSchema, sendInputSchema, checkInputSchema])`.
   - `checkResponseSchema = z.object({ connection_status: connectionStatusSchema, last_connected_at: z.string().nullable().optional() })`
     e `export type CheckResponse = z.infer<typeof checkResponseSchema>`. Reusa o `connectionStatusSchema`
     já existente (`desconectado|aguardando_qr|conectado`).

Nome escolhido: **`check`** (preferido a `status`, para não colidir com os campos
`connection_status`/`subscription_status` do domínio) — mesma escolha registrada na ADR-16.

## Consequências

- **Positivo:** o contrato e a porta ficam prontos e revisáveis sozinhos; ADR-18 (handlers) e ADR-19
  (frontend) passam a ter um alvo estável e tipado. Mock permanece fechável para demo.
- **Negativo/risco:** até ADR-18, `getConnectionState` e `checkInputSchema` existem mas ninguém os
  invoca (código correto, porém inerte) — esperado numa quebra por dependência; a revisão desta ADR
  valida tipos e contrato, não comportamento de fluxo.
- **Nota de durabilidade:** o formato da porta `EvolutionAdapter` é decisão de arquitetura durável;
  pode ser promovida a `docs/` depois (não copiar agora).

## Arquivos afetados

- `supabase/functions/whatsapp/evolution-adapter.ts` — nova assinatura na interface + impl Real/Mock.
- `supabase/functions/whatsapp/schemas.ts` — `checkInputSchema`, inclusão na `requestSchema`,
  `checkResponseSchema` + tipo `CheckResponse`.

## Regras de fronteira

- **Dado externo não confiável:** corpo de `GET /instance/connectionState/{inst}` validado por
  `connectionStateSchema` antes de ler `instance.state`; fora do contrato → falha pt-BR, nunca exceção
  crua nem vazamento do corpo.
- **Segredos:** `EVOLUTION_API_URL`/`EVOLUTION_API_KEY` só via `Deno.env` (dentro de `evolutionFetch`),
  nunca com prefixo `VITE_`, nunca logados/ecoados. API key tem o peso da service role.
- **Sem `tenant_id` no contrato:** `checkInputSchema` só aceita `{ action: "check" }`.
- **TS/Deno estrito:** sem `any`; `EvolutionState` tipado a partir do schema.

## Critérios de aceite testáveis (desta ADR)

- **CA-17.1 (boot):** `supabase functions serve whatsapp --env-file supabase/functions/.env` sobe **sem
  erro de boot** (o module graph com a nova assinatura e os novos schemas compila).
- **CA-17.2 (interface):** `EvolutionAdapter` declara `getConnectionState` e **ambos** os adapters
  (Real e Mock) a implementam — o módulo tipa sem `any` e sem membro faltante.
- **CA-17.3 (contrato):** `requestSchema` aceita `{ action: "check" }` e rejeita corpo com campo de
  estado forjado (campos extras ignorados pela union). `checkResponseSchema`/`CheckResponse` exportados.
- **CA-17.4 (segredo/mock):** grep por `VITE_EVOLUTION` em `supabase/functions/**` = vazio;
  `MockEvolutionAdapter.getConnectionState` retorna `open`.

## Dependência da ADR anterior

Primeira ADR ativa desta rodada (as ADRs 01–16 já foram executadas/consolidadas). Fecha a base para
ADR-18 depender diretamente desta porta e deste contrato.
