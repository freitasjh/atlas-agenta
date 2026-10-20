# ADR-18 — `pair` para em `aguardando_qr` + `handleCheck` reconcilia o estado real

**Status:** proposto
**Escopo:** dados (Edge Function Deno — lógica de handler, muda comportamento do backend)
**Branch:** `feat/whatsapp-base-mock`
**Depende de:** **ADR-17** (porta `EvolutionAdapter.getConnectionState`, `checkInputSchema`,
`checkResponseSchema`). Também de ADR-04 (`handlePair`, `resolveIdentity`, roteamento do entrypoint),
ADR-10 (`pair` real).
**Deriva de:** ADR-16 (registro consolidado de OQ-01).

## Contexto (causa-raiz confirmada no código)

`handlePair` em `supabase/functions/whatsapp/index.ts` faz o upsert correto marcando `aguardando_qr`
(~L158–165), obtém o QR real via `adapter.pair`, mas **logo em seguida** (bloco comentado "Pareamento
simulado conclui", ~L182–L198) atualiza a linha para `connection_status = 'conectado'` +
`last_connected_at` no **mesmo request** e retorna `conectado` + `qr_code_base64`. Esse bloco é resíduo
do mock instantâneo e é a causa-raiz de OQ-01: a linha volta `conectado`, o frontend cai no ramo
"conectado" e descarta o QR.

Não existe caminho server-side que consulte o estado REAL da Evolution e reconcilie a linha. É o que
esta ADR adiciona, consumindo a porta e o contrato criados em ADR-17.

## Decisão

Sem migration nova. Escrita de estado só pela Edge Function com **service role** (caminho auditado que
bypassa RLS — a única escrita que transiciona o estado). `tenant_id`/`role` sempre do JWT.

1. **`pair` para em `aguardando_qr`:** remover do caminho real o bloco "Pareamento simulado conclui"
   (`index.ts` ~L182–L198) que marca `conectado` + `last_connected_at` e o inclui na resposta.
   `handlePair` passa a: garantir a linha em `aguardando_qr` (upsert já existente), chamar
   `adapter.pair(instanceName)` para obter o QR, e retornar
   `{ connection_status: "aguardando_qr", qr_code_base64 }`. No modo real, `pair` **nunca** grava nem
   retorna `conectado`.

2. **Novo `handleCheck(ctx, service)`** roteado no entrypoint (`action === "check" → handleCheck`):
   - Exige `role === "admin"` (parear e reconciliar são atos de configuração do dono do tenant,
     espelhando a checagem já existente em `handlePair` ~L149). `receptionist`/`professional` → 403
     estruturado.
   - Deriva `instanceName = tenant-<tenantId>` no servidor (tenant do JWT; cliente não envia).
   - Chama `adapter.getConnectionState(instanceName)` (ADR-17). Quando `state === "open"`, atualiza a
     linha para `connection_status = "conectado"` + `last_connected_at = now()` com service role —
     **idempotente** (gravar o mesmo `conectado` repetido é inócuo; nenhum recurso é criado na checagem).
   - Relê a linha e retorna `{ connection_status, last_connected_at }` validável por `checkResponseSchema`.
   - **Falha da Evolution em `check` é não-fatal:** retorna o estado atual da linha sem derrubar nada
     (RF-QR-06 do lado servidor). Nunca logar QR, corpo cru da Evolution ou token.

## Consequências

- **Positivo:** no modo real a instância fica legitimamente em `aguardando_qr` até o pareamento real; a
  única transição para `conectado` passa a ser a `check` condicionada a `state === "open"` validado por
  zod. Fecha o lado servidor de RF-QR-01/02 e CA-04/CA-02/CA-01. No mock, `getConnectionState → open`
  faz a `check` concluir a conexão (RF-QR-05/CA-03).
- **Negativo/risco:** mudança de comportamento no modo real — conectar passa a **exigir** escanear o QR
  (precisa do celular). Decisão de produto já aprovada pelo usuário (msg 12). Até ADR-19, o frontend
  ainda não dispara `check`, então o fluxo fim-a-fim só fecha com a ADR seguinte — este é o estado
  intermediário esperado da quebra; o backend é verificável sozinho por boot + probe.
- **Nota de durabilidade:** "a transição de `conectado` só vem de `check` com `state==='open'`" é
  invariante de segurança durável (evita o "conecta sozinho" no real); candidata a `docs/` depois.

## Arquivos afetados

- `supabase/functions/whatsapp/index.ts` — remoção do bloco simulado em `handlePair`; novo
  `handleCheck`; roteamento de `action === "check"` no `Deno.serve`.

## Regras de fronteira

- **RLS / multi-tenant:** `tenant_id`/`role` do JWT via `resolveIdentity`; cliente nunca envia
  `tenant_id`. `instanceName = tenant-<tenant_id>` derivado no servidor. Policies
  `whatsapp_instances_select_same_tenant` / `_write_admin` **intactas**; transição de estado só pela
  Edge Function com service role.
- **RBAC:** `pair` e `check` exigem `admin`. Leitura do estado segue por RLS a
  `admin/receptionist/professional` (estado de conexão não é dado financeiro) — não tocada aqui.
- **Idempotência:** `check` é polling idempotente; o estado nunca vem do cliente, só da chamada
  servidor→Evolution.
- **Segredos / LGPD:** credenciais só em `Deno.env`; nunca logar `qr_code_base64`, telefone, documento
  ou token.
- **Fora de escopo:** sem webhook de entrada, sem régua automática, sem mudança em `send`/`messages`.

## Critérios de aceite testáveis (desta ADR)

- **CA-18.1 (boot):** `supabase functions serve whatsapp --env-file supabase/functions/.env` sobe sem
  erro de boot.
- **CA-18.2 (`pair` honesto):** grep por "Pareamento simulado conclui" / `connection_status: "conectado"`
  dentro do caminho real de `handlePair` = vazio; `pair` retorna `connection_status: "aguardando_qr"` +
  `qr_code_base64` e **nunca** `conectado` no modo real (CA-04/RF-QR-01).
- **CA-18.3 (RBAC/roteamento):** probe de `{ action: "check" }` sem auth → 401 estruturado; com papel
  não-admin → 403 (prova que o module graph executa e a autorização está no lugar).
- **CA-18.4 (reconciliação):** com `getConnectionState → "open"`, `handleCheck` grava `conectado` +
  `last_connected_at` e é idempotente ao ser chamado de novo (modo mock verifica isso sem rede;
  `select connection_status ...` → `conectado`). Falha do adapter não derruba a resposta.

## Dependência da ADR anterior

Depende de **ADR-17**: usa `adapter.getConnectionState`, `checkInputSchema` (já na `requestSchema`) e
`checkResponseSchema`. Sem ADR-17, `handleCheck` não tem porta nem contrato para consumir.
