# `pair` para em `aguardando_qr` e nova action `check` reconcilia o estado real da Evolution (ADR-18)

Revisor independente B. Diff revisado: commit `eba9613` contra o pai `8616ebf` (ADR-17). Escopo: um único arquivo, `supabase/functions/whatsapp/index.ts` (+69/-12).

A mudança remove de `handlePair` o bloco "Pareamento simulado conclui" — resíduo do mock que, no mesmo request, marcava a linha como `conectado` e devolvia o QR junto. Era a causa-raiz de OQ-01: a tela recebia `conectado`, caía no ramo "conectado" e descartava o QR. Agora `pair` para honestamente em `aguardando_qr` e retorna só `{ connection_status, qr_code_base64 }`. A conclusão da conexão migra para um novo handler `handleCheck`, roteado em `action === "check"`, que consulta o estado REAL via a porta `adapter.getConnectionState` (ADR-17), transiciona para `conectado` apenas quando a Evolution confirma `state === "open"`, e relê a linha para devolver o estado persistido.

Watch for: a mudança é backend-puro e intermediária — o frontend ainda não dispara `check` (ADR-19), então o fluxo fim-a-fim não fecha nesta ADR (esperado pela quebra). A única transição para `conectado` passa a depender da Evolution confirmar `open`; no modo real isso exige o celular escanear o QR (decisão de produto aprovada, msg 12). O boot do edge-runtime passa e todos os critérios de fronteira estão honrados.

**Verdict**: APPROVED

## High-level view

A causa-raiz está corretamente excisada: grep por "Pareamento simulado" em `supabase/functions/` retorna vazio, e a única escrita de `connection_status: "conectado"` que sobra no arquivo está dentro de `handleCheck`, guardada por `realState?.state === "open"`. `handlePair` agora retorna `aguardando_qr` + QR sem tocar mais a linha após o upsert. Isso fecha o lado servidor de RF-QR-01.

`handleCheck` espelha fielmente as fronteiras de `handlePair`: exige `role === "admin"`, rejeita `tenantId` ausente, deriva `instanceName = tenant-<tenantId>` do JWT (nunca do cliente), e escreve com service role — o único caminho auditado que transiciona o estado. RBAC, multi-tenant e isolamento estão intactos.

A reconciliação é idempotente por construção: gravar `conectado` repetidamente é inócuo e nenhum recurso é criado na checagem. A falha do adapter é tratada como não-fatal — loga motivo técnico curto e devolve o estado atual da linha, sem derrubar a resposta (RF-QR-06 server-side). Nenhum QR, corpo cru ou token é logado.

O contrato de resposta de `handleCheck` (`{ connection_status, last_connected_at }`) é exatamente o `checkResponseSchema` da ADR-17, e a action `check` já está na `requestSchema`. O module graph com o novo handler e a nova rota sobe limpo no edge-runtime.

<details>
<summary>Issues (2)</summary>

1. **Contraprova Deno indireta** — Não há binário `deno` nem script de lint/typecheck que cubra `supabase/functions/` (o `tsc -b` do projeto inclui só `src`). A verificação de tipos do handler é indireta, via boot do edge-runtime; o `strict`/`noImplicitAny` do Deno não roda aqui. Não bloqueante — o boot valida o module graph — mas vale anotar como dívida de ferramenta.
2. **Fallback `desconectado` quando a linha não existe** — `handleCheck` devolve `connection_status: "desconectado"` se a instância ainda não foi upsertada (`check` chamado antes de `pair`). Comportamento correto e seguro; só registrar que o frontend (ADR-19) precisa tolerar esse caso ao ligar o polling.

</details>

<details>
<summary>Details</summary>

### Causa-raiz excisada, não mascarada

A correção ataca a causa, não o sintoma. O bloco antigo gravava `conectado` + `last_connected_at` dentro de `handlePair` e incluía ambos (mais o QR) na resposta do mesmo request. A excisão é limpa: `handlePair` termina no upsert para `aguardando_qr`, obtém o QR via `adapter.pair`, e retorna `{ connection_status: "aguardando_qr", qr_code_base64 }`. Verificado por grep — "Pareamento simulado" não existe mais em `supabase/functions/`, e a cadeia de escrita de `conectado` restante no arquivo está só no novo handler e no guard pré-existente de `handleSend` (L368, intacto). Isto fecha CA-18.2.

### `handleCheck` espelha as invariantes de `handlePair`

```
handleCheck:
  role !== admin            -> 403 estruturado  (espelha handlePair L149)
  !tenantId                 -> 403
  instanceName = tenant-<tenantId>   (derivado do JWT, cliente não envia)
  getConnectionState(instanceName)   (porta ADR-17)
     state === "open"  -> update conectado + last_connected_at (service role)
  relê a linha -> { connection_status, last_connected_at }
```

A derivação `instanceName = tenant-${tenantId}` a partir de `identity.tenantId` (vindo de `resolveIdentity` → `profiles`, nunca do payload) preserva RNF-QR-01. A escrita roda com o client service-role (`createServiceClient`), caminho privilegiado e auditado — as policies `whatsapp_instances_select_same_tenant`/`_write_admin` não são tocadas, coerente com RNF-QR-04. O RBAC `admin`-only para `check` segue a análise (RNF-QR-05): reconciliar a conexão é ato de configuração do dono do tenant, e a leitura do estado para `receptionist`/`professional` continua pela RLS, não por este handler.

### Idempotência e falha não-fatal

A transição é condicionada a `realState?.state === "open"`; reexecutar a checagem com o mesmo estado só regrava `conectado`/`last_connected_at`, sem criar recurso nem duplicar efeito — idempotente conforme CA-18.4. A falha do adapter cai no `catch`, loga `err.message` (motivo curto, sem corpo cru/QR/token) e segue com `realState = null`, pulando o update e devolvendo o estado atual da linha. É fail-safe: a Evolution indisponível não derruba a resposta nem força uma transição indevida — o estado só avança quando há confirmação positiva de `open`. Nunca há fail-open para `conectado`.

### Contrato de fio alinhado à ADR-17

O corpo devolvido por `handleCheck` — `{ connection_status, last_connected_at }` com fallback `desconectado`/`null` — valida contra o `checkResponseSchema` exportado na ADR-17 (`connectionStatusSchema` + `last_connected_at` nullable/optional). A action `check` já está na `requestSchema` (`discriminatedUnion`), então o roteamento `parsed.data.action === "check" → handleCheck` tipa sem membro faltante. Os casts `as string | null` nas leituras da linha são defensivos sobre o retorno do PostgREST; não introduzem `any`.

### Contraprova executada

`npm run build` (tsc -b + vite) passou — mas cobre só `src`, não a Edge Function. Para o escopo real desta ADR (Deno), rodei o boot probe: `supabase functions serve whatsapp --env-file supabase/functions/.env` subiu no `supabase-edge-runtime-1.77.4` (Deno 2.1.4) com "Serving functions on ..." e sem erro de boot/module-graph; o processo só encerrou pelo `timeout` (SIGTERM). Isso satisfaz CA-18.1 e, por tabela, valida que o grafo de imports com o novo handler e a nova rota compila. Não há binário `deno` local nem script de lint para rodar o `strict` do Deno diretamente — a checagem de tipos aqui é indireta (via boot), o que anoto como limitação de ferramenta, não como falha da ADR. Não subi dev server (decisão do QA).

### Disciplina de escopo

O commit toca exclusivamente `index.ts` (+69/-12), exatamente os "Arquivos afetados" da ADR. Sem migration, sem mudança em `schemas.ts`/`evolution-adapter.ts` (consumidos da ADR-17), sem toque em `send`/`messages`. Nenhuma mudança não relacionada embarcada no diff.

</details>

<details>
<summary>Arquivos alterados</summary>

- `supabase/functions/whatsapp/index.ts` — remove o bloco "Pareamento simulado conclui" de `handlePair` (passa a retornar `aguardando_qr` + QR); adiciona `handleCheck` (RBAC admin, derivação de instância do JWT, reconciliação idempotente condicionada a `state === "open"`, falha não-fatal, releitura da linha); roteia `action === "check"` no `Deno.serve`.

Diff completo: `git diff 8616ebf eba9613 -- supabase/`.

</details>
