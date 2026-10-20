# ADR-16 — QR visível e conexão real por polling (`check`): fecha OQ-01

**Status:** proposto
**Escopo:** dados (Edge Function Deno) + frontend (React/Vite/TS)
**Branch:** `feat/whatsapp-base-mock` (reaproveita a base de WhatsApp; não recria)
**Fecha:** dívida OQ-01 aberta pela base de WhatsApp real (ADR-09/10/11/12)
**Depende de:** ADR-04 (contrato da Edge Function `whatsapp`), ADR-09 (cliente HTTP,
`connectionStateSchema`, `evolutionFetch`, credenciais do env), ADR-10 (`pair` real),
ADR-06 (hooks de dados / contrato de fio do frontend).

## Contexto (causa-raiz confirmada no código)

No modo REAL o admin **não consegue** conectar o WhatsApp. `handlePair`
(`supabase/functions/whatsapp/index.ts`) marca corretamente `aguardando_qr` no upsert
(~L163), obtém o QR real via `adapter.pair`, mas **logo em seguida** (bloco "Pareamento
simulado conclui", ~L186) atualiza a linha para `connection_status = 'conectado'` +
`last_connected_at` no **mesmo request** e retorna `conectado` (~L195). Esse bloco é resíduo
do mock instantâneo.

No frontend, `ConnectionCard.tsx` só renderiza o QR no ramo `status === "aguardando_qr"`.
`usePairWhatsApp` faz `invalidateQueries` → `useWhatsAppInstance` relê a linha → vem
`conectado` → o card cai no ramo "WhatsApp conectado" e **descarta** o `qr_code_base64`.
Resultado: QR gerado, nunca exibido/escaneável; a instância aparece "conectada" sem nunca ter
sido pareada de verdade. OQ-01 deixa de ser cosmética e **quebra** o pareamento (e com ele RF08
e toda a régua de comunicação).

A infra para a correção **já existe**: `useWhatsAppInstance` tem `refetchInterval` condicional
de 2500 ms enquanto `aguardando_qr`; a ADR-09 já expõe `connectionStateSchema`
(`{ instance: { instanceName, state } }`, `state ∈ open|connecting|close`), `evolutionFetch` e a
resolução de credenciais. Falta: o backend parar de mentir `conectado`, expor uma checagem do
estado **real**, e o frontend acionar essa checagem pelo polling já existente sem descartar o QR.

## Decisão

Correção de causa-raiz em duas pontas, sem migration nova, sem dependência nova, QR efêmero,
segredo só no servidor, `tenant_id` sempre do JWT (corpo só `{ action }`).

### Backend — `supabase/functions/whatsapp/` (Deno)

1. **`pair` para em `aguardando_qr`:** remover do caminho REAL o bloco "Pareamento simulado
   conclui" (`index.ts` ~L186–L196) que marca `conectado` + `last_connected_at` e o inclui na
   resposta. `handlePair` passa a: garantir a linha em `aguardando_qr` (upsert já existente),
   chamar `adapter.pair(instanceName)` para obter o QR, e retornar
   `{ connection_status: "aguardando_qr", qr_code_base64 }`. No modo real `pair` **nunca** grava
   nem retorna `conectado`.

2. **Nova action `check`** (nome escolhido: `check` — "checar o estado da conexão"; preferido a
   `status` para não colidir com o campo `connection_status`/`subscription_status`):
   - `schemas.ts`: nova variante `checkInputSchema = z.object({ action: z.literal("check") })`
     adicionada à `requestSchema` (discriminated union por `action`). Novo DTO de resposta
     `checkResponseSchema = z.object({ connection_status: connectionStatusSchema, last_connected_at: z.string().nullable().optional() })`
     com tipo `CheckResponse`.
   - `index.ts`: novo `handleCheck(ctx, service)` exigindo papel `admin` (parear e reconciliar são
     atos de configuração do dono do tenant, espelhando `handlePair`). Deriva
     `instanceName = tenant-<tenant_id>`, chama `adapter.getConnectionState(instanceName)`; quando
     `state === "open"`, atualiza `connection_status = "conectado"` + `last_connected_at = now()`
     com service role (idempotente — gravar o mesmo `conectado` repetido é inócuo, nenhum recurso
     é criado). Relê e retorna a linha (`connection_status`, `last_connected_at`). Falha da
     Evolution em `check` é **não-fatal**: retorna o estado atual da linha sem derrubar nada.
     Rotear no entrypoint: `action === "check" → handleCheck`.

3. **Porta `EvolutionAdapter` ganha `getConnectionState`:**
   - Interface: `getConnectionState(instanceName: string): Promise<{ state: EvolutionState }>`.
   - `RealEvolutionAdapter`: implementa via `evolutionFetch` em
     `GET /instance/connectionState/{instance}`, validando o corpo com `connectionStateSchema`
     (dado não confiável) antes de ler `instance.state`; corpo fora do contrato → falha pt-BR
     controlada, sem vazar o corpo cru nem a API key. Timeout/rede já tratados por `evolutionFetch`.
   - `MockEvolutionAdapter`: retorna `{ state: "open" }` para a demo concluir a conexão sem
     rede/celular (fallback preservado).

### Frontend — `src/` (abordagem A, decidida na análise de frontend)

4. **Reconciliação FUNDIDA no `queryFn` de `useWhatsAppInstance`** (`src/hooks/useWhatsAppInstance.ts`),
   **não** em segundo hook/useEffect/timer. Reusa o `refetchInterval` condicional de 2500 ms já
   existente. No `queryFn`: se a linha atual está `aguardando_qr`, dispara a action `check`
   (`supabase.functions.invoke("whatsapp", { body: { action: "check" } })`) em modo **best-effort**
   (erro da chamada é engolido — nunca lança); o dado **canônico** é a releitura da linha
   `whatsapp_instances` via PostgREST sob RLS logo em seguida, validada por zod
   (`whatsAppInstanceRowSchema`). A transição para `conectado` desliga o `refetchInterval`
   (polling para sozinho). Nenhum segundo timer é criado; estrutura dos hooks não é reescrita.

5. **`src/lib/whatsapp.ts`:** espelhar o DTO da nova action — `CheckRequest { action: "check" }` e
   `CheckResponse { connection_status: WhatsAppConnectionStatus; last_connected_at?: string | null }`
   (camelCase de fio no corpo = só `action`; nenhum `tenant_id`). Validação zod defensiva da
   resposta de `check` no hook (dado não confiável).

6. **`ConnectionCard.tsx` não descarta o QR entre refetches:** o `qr_code_base64` é estado local
   efêmero (`useState`), obtido na resposta de `pair`. Garantir que, enquanto a linha está
   `aguardando_qr`, os refetches do polling **não** limpem esse estado — o card continua
   renderizando o QR até a linha virar `conectado`. (Hoje o QR só some porque o ramo muda para
   `conectado` cedo demais; com o fix do backend o ramo permanece `aguardando_qr` e o `useState`
   do QR é preservado. Conferir que nenhum efeito o zera nos refetches.)

7. **Erro transitório silencioso (RF-QR-06):** Evolution indisponível durante `aguardando_qr` não
   emite toast a cada tick (o `check` é best-effort e não lança); o QR e o estado permanecem; o
   próximo tick tenta de novo. Só a falha de **leitura da linha** (não do `check`) leva ao painel
   "Não foi possível carregar a conexão" (comportamento já existente em `WhatsAppPage`).

### Fora de escopo (não tocar)

Webhook de entrada da Evolution (a reconciliação é client-driven por polling), régua automática
de mensagens, fluxo de `send`/`messages`, qualquer tela/rota/guard/dependência nova, qualquer
migration. `whatsapp_opt_in` não é acionado (não há disparo ao cliente final aqui).

## Regras de fronteira (o que a demanda arrisca)

- **RLS / multi-tenant:** `tenant_id`/`role` do JWT via `resolveIdentity`; cliente nunca envia
  `tenant_id`. `instanceName = tenant-<tenant_id>` derivado no servidor. Policies
  `whatsapp_instances_select_same_tenant` / `_write_admin` intactas; a transição de estado roda na
  Edge Function com service role (caminho auditado) — única escrita que transiciona o estado.
- **RBAC:** `pair` e `check` exigem `admin`. Leitura do estado segue liberada a
  `admin/receptionist/professional` sob RLS (estado de conexão não é dado financeiro); sem CTA de
  parear para não-admin.
- **Status de assinatura:** `bloqueado`/`cancelado` já interceptados por
  `RequireActiveSubscription`; guard herdado, não alterado.
- **Idempotência / autenticidade:** sem webhook nesta tarefa. `check` é polling idempotente; o
  estado nunca vem do cliente, só da chamada servidor→Evolution.
- **Dado externo não confiável:** resposta da Evolution validada por `connectionStateSchema` antes
  de ler qualquer campo; resposta da action `check` validada por zod no frontend.
- **Segredos:** `EVOLUTION_API_URL`/`EVOLUTION_API_KEY`/service role só em `Deno.env`, nunca com
  prefixo `VITE_`, nunca no bundle/git/DOM/log.
- **LGPD/PII:** nunca logar `qr_code_base64`, telefone, documento ou token.

## Plano de implementação (ordenado por dependência)

Cada item deixa o código compilável. Verificação usa os comandos reais do projeto:
`npm run build` (`tsc -b && vite build`), `npm run typecheck` (`tsc -b`) e boot da Edge Function
com `supabase functions serve whatsapp --env-file supabase/functions/.env`. **Não há suíte de
testes** no projeto (sem vitest/jest em `package.json`); a verificação é build/typecheck limpos +
boot da function + QA ao vivo (Chrome DevTools) executado pela orquestração.

- [ ] 1. Estender a porta `EvolutionAdapter` com `getConnectionState` e implementá-la nos dois
      adapters. Interface: `getConnectionState(instanceName: string): Promise<{ state: EvolutionState }>`.
      `RealEvolutionAdapter`: `evolutionFetch(GET /instance/connectionState/{instance})` →
      `connectionStateSchema.safeParse` → retorna `{ state: data.instance.state }`; fora do contrato
      ou `!ok` → `Error` pt-BR sem vazar corpo. `MockEvolutionAdapter`: retorna `{ state: "open" }`.
      Arquivos: `supabase/functions/whatsapp/evolution-adapter.ts`.
      Verificar: `supabase functions serve whatsapp --env-file supabase/functions/.env` sobe sem erro
      de boot (module graph compila).

- [ ] 2. Adicionar a variante `check` ao schema de requisição e o DTO de resposta. Criar
      `checkInputSchema = z.object({ action: z.literal("check") })`, incluí-lo na
      `requestSchema = z.discriminatedUnion("action", [pairInputSchema, sendInputSchema, checkInputSchema])`,
      e exportar `checkResponseSchema` + tipo `CheckResponse`
      (`{ connection_status, last_connected_at? }`).
      Arquivos: `supabase/functions/whatsapp/schemas.ts`.
      Verificar: boot da function sem erro; `deno`/typecheck do módulo limpo.

- [ ] 3. Corrigir `handlePair`: remover o bloco "Pareamento simulado conclui" (marca `conectado` +
      `last_connected_at`) do caminho real; `pair` passa a retornar
      `{ connection_status: "aguardando_qr", qr_code_base64 }` e nunca grava/retorna `conectado`.
      Arquivos: `supabase/functions/whatsapp/index.ts`.
      Verificar: boot sem erro; grep por "Pareamento simulado conclui" no caminho real = vazio;
      `pair` nunca referencia `conectado` no `handlePair`.

- [ ] 4. Adicionar `handleCheck(ctx, service)` e roteá-lo no entrypoint. Exige `role === "admin"` e
      `tenantId`; `instanceName = tenant-<tenantId>`; chama `adapter.getConnectionState`; se
      `state === "open"` atualiza a linha para `conectado` + `last_connected_at = now()` (service
      role, idempotente); relê e retorna `{ connection_status, last_connected_at }`. Falha do adapter
      é não-fatal (retorna o estado atual da linha). No `Deno.serve`, `action === "check" → handleCheck`.
      Arquivos: `supabase/functions/whatsapp/index.ts`.
      Verificar: boot sem erro; probe sem auth → 401 estruturado (prova que o module graph executa).

- [ ] 5. Espelhar o DTO de `check` no frontend: `CheckRequest`/`CheckResponse` em `src/lib/whatsapp.ts`.
      Arquivos: `src/lib/whatsapp.ts`.
      Verificar: `npm run typecheck` limpo.

- [ ] 6. Fundir a reconciliação no `queryFn` de `useWhatsAppInstance`: antes de reler a linha, se o
      estado atual é `aguardando_qr`, invocar `check` best-effort (try/catch que engole o erro) e
      validar a resposta com um zod local; o canônico é a releitura da linha (schema já existente).
      Reusar o `refetchInterval` de 2500 ms; sem segundo timer/useEffect.
      Arquivos: `src/hooks/useWhatsAppInstance.ts`.
      Verificar: `npm run build` limpo; polling para ao virar `conectado`.

- [ ] 7. Garantir que `ConnectionCard` não descarta o `qr_code_base64` entre refetches enquanto
      `aguardando_qr` (QR permanece até a linha virar `conectado`); conferir que nenhum efeito zera o
      `useState` do QR no polling.
      Arquivos: `src/app/config/whatsapp/ConnectionCard.tsx`.
      Verificar: `npm run build` limpo; QA ao vivo (item abaixo) confirma QR persistente entre ticks.

- [ ] 8. QA ao vivo (orquestração, Chrome DevTools MCP + `functions serve` + Evolution real):
      modo real → clicar "Conectar WhatsApp" leva a `aguardando_qr` e exibe
      `<img alt="QR Code para conectar o WhatsApp">` sem pular para "conectado"; Network mostra
      invocações periódicas com `action: "check"`; modo mock → polling conclui para `conectado` sem
      reload. **Nunca** enviar mensagem real a terceiro; o scan real com celular é teste manual do
      usuário.
      Verificar: critérios visuais da seção 8 do PRD (QR visível/persistente, badge, aria-live,
      RBAC, erro transitório silencioso, responsivo/dark, console limpo).

## Consequências

- **Positivo:** o admin vê um QR real escaneável e a tela transita sozinha para "conectado" quando
  a Evolution confirma o pareamento real, sem reload. Estado passa a refletir a verdade. Mock segue
  fechando a conexão sozinho para demo.
- **Negativo/risco:** no modo real, conectar passa a **exigir** escanear o QR de verdade (precisa do
  celular) — mudança de comportamento vs o mock, decisão de produto já aprovada pelo usuário.
- **Arquivos afetados:** `supabase/functions/whatsapp/{index.ts,schemas.ts,evolution-adapter.ts}`,
  `src/hooks/useWhatsAppInstance.ts`, `src/lib/whatsapp.ts`,
  `src/app/config/whatsapp/ConnectionCard.tsx`. Sem migration, sem dependência nova.

### Critérios de aceite (rastreio ao PRD)

RF-QR-01 (item 3), RF-QR-02 (itens 1/2/4), RF-QR-03 (item 6), RF-QR-04 (item 7), RF-QR-05
(item 1 mock + 6), RF-QR-06 (itens 4/6/7). CA-BOOT (itens 1–4), CA-BUILD (itens 5–7),
CA-SEGREDO / CA-FORA-ESCOPO / CA-QA-VIVO (item 8 + auditoria de grep).
