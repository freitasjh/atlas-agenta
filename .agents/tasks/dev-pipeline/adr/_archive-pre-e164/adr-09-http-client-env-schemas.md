# ADR-09 — Fundação HTTP: cliente, credenciais do env, schemas zod e normalização de número

**Status:** proposto

## Contexto

O `RealEvolutionAdapter` em `supabase/functions/whatsapp/evolution-adapter.ts` é hoje um stub
que lança `"Integração real da Evolution não implementada nesta fase."` em `pair` e `sendText`
(verificado no arquivo). Antes de implementar qualquer operação de negócio (ADR-10 `pair`,
ADR-11 `sendText`), precisa existir a **infra compartilhada** que ambas usam: leitura das
credenciais do `Deno.env`, um cliente HTTP com header `apikey` + timeout, os schemas zod que
validam as respostas não confiáveis da Evolution, e a normalização determinística do número
E.164. Infra antes de feature: esta ADR monta esses blocos sem acionar nenhuma chamada real
ainda — o stub de `pair`/`sendText` permanece, o `MockEvolutionAdapter` continua o único que
roda de fato, e a function sobe sem erro de boot.

A Evolution em uso é **v2.3.7** (confirmado na análise de dados, §5) e o servidor está atrás de
**ngrok** (risco de latência/timeout → RNF-RE-06 / R13). As credenciais `EVOLUTION_API_URL` e
`EVOLUTION_API_KEY` já estão em `supabase/functions/.env` (git-ignored, confirmado com
`git check-ignore`) e `EVOLUTION_MODE` seleciona `mock|real`. A API key tem o mesmo peso de
segredo que a service role key (RNF-RE-01): só do env no servidor, nunca em log/resposta/bundle,
nunca com prefixo `VITE_`.

## Decisão

Adicionar ao **mesmo módulo** `evolution-adapter.ts` (nenhum arquivo novo; R12/AC-12 exige diff
só neste arquivo) os seguintes blocos de infra, ainda **não** fiados em `pair`/`sendText`:

1. **Resolução de credenciais do env.** Um helper que lê `EVOLUTION_API_URL`/`EVOLUTION_API_KEY`
   de `Deno.env` e, se qualquer um estiver ausente/vazio, lança um `Error` com mensagem pt-BR
   explícita (ex.: `"Credenciais da Evolution ausentes no servidor."`) — **sem** chamada de rede
   (R7/AC-07). O construtor atual do `RealEvolutionAdapter` já recebe `apiUrl`/`apiKey` via
   `createEvolutionAdapter()` (lidos do env lá); manter essa injeção e fazer a validação de
   presença no ponto de uso/entrada das operações. `createEvolutionAdapter()` permanece
   selecionando por `EVOLUTION_MODE` com default `mock` (R10/AC-10) — **não** alterar essa
   seleção.
2. **Cliente HTTP com timeout.** Um helper `evolutionFetch` (nome a critério do implementador,
   no mesmo módulo) que monta a requisição com `apikey: <key>` em todas as chamadas,
   `Content-Type: application/json` nos POSTs, base-URL normalizada (sem barra dupla), e
   **`AbortController`** com timeout (ngrok pode pendurar). Timeout/erro de rede viram falha
   pt-BR controlada (ex.: `"Falha de comunicação com o servidor de WhatsApp."`), nunca exceção
   crua (R13/AC-13). O corpo de resposta **nunca** é logado cru (há `token` por instância em
   `fetchInstances`; RNF-RE-02): em erro, logar só status/motivo técnico curto.
3. **Schemas zod das respostas** (dado não confiável — RNF-RE-02/R6/AC-06), no mesmo módulo,
   cobrindo o contrato v2.3.7 da análise §5:
   - **connect/QR:** união que aceita ou `{ instance: { instanceName, state } }` (conectada,
     sem QR) ou `{ base64, code?, pairingCode?, count? }` (aguardando pareamento, com QR).
   - **connectionState:** `{ instance: { instanceName, state: "open"|"connecting"|"close" } }`.
   - **create:** shape tolerante que confirma criação ou detecta o erro "já existe" (403/409
     "name already in use").
   - **sendText:** `{ key: { id: string, remoteJid?: string, fromMe?: boolean } }` —
     `providerMessageId` sai de `key.id`.
   Respostas fora do contrato → falha controlada pt-BR, sem vazar o corpo do provedor.
4. **Normalização de número E.164.** Helper determinístico que recebe o `to` em E.164 (`+55...`,
   passado pelo `index.ts` a partir de `customer.phone`) e devolve o formato aceito pela
   Evolution v2 (strip do `+`). Puro, sem rede, testável isolado. Fica **dentro** do adapter,
   sem tocar o contrato de fio.

Mantido estrito (RNF-RE-05): `strict: true`, sem `any` implícito, retornos de `fetch`/zod
tipados. Nesta ADR `pair`/`sendText` **continuam** sendo o stub (ou já podem referenciar os
helpers internamente sem alterar o comportamento observável de lançar "não implementado"); a
troca de comportamento é das ADR-10/11. O importante: a function sobe sem erro de boot/typecheck
e o mock segue intacto.

## Consequências

- **Escopo:** dados (backend / Edge Function Deno). Sem frontend.
- **Arquivos afetados:** `supabase/functions/whatsapp/evolution-adapter.ts` (único).
  Nenhuma migration, nenhum `index.ts`, nenhum `schemas.ts`, nenhuma UI.
- **Positivo:** ADR-10 e ADR-11 passam a montar operações sobre uma base validada e com timeout,
  sem reimplementar cliente/validação. Credencial ausente falha cedo e claro, sem rede.
- **Negativo/risco:** o contrato da Evolution pode mudar se o servidor for atualizado; os schemas
  refletem v2.3.7 (anotar no código que v2.3.x usa `text` direto no sendText e que versões
  antigas usavam `textMessage.text`).
- **Dependência:** nenhuma (primeira ADR). É base das ADR-10 e ADR-11.

### Critérios de aceite testáveis (desta ADR)

1. `supabase functions serve whatsapp --env-file supabase/functions/.env` sobe **sem erro de boot
   nem de typecheck** (R11/AC-11).
2. Com `EVOLUTION_MODE=real` e `EVOLUTION_API_URL`/`EVOLUTION_API_KEY` ausentes/vazios, a
   resolução de credenciais lança a mensagem pt-BR **sem** efetuar chamada de rede (R7/AC-07).
3. A normalização de número transforma `+5511999999999` em `5511999999999`
   (determinístico, puro).
4. Os schemas zod rejeitam payload fora do contrato (campo ausente/tipo errado) retornando falha
   controlada, não exceção crua (R6/AC-06 — base).
5. `EVOLUTION_MODE=mock` continua selecionando `MockEvolutionAdapter`; `git diff --name-only`
   mostra **apenas** `supabase/functions/whatsapp/evolution-adapter.ts` (R10/R12).
6. `grep` pela API key no código-fonte e no diff = **vazio**; nenhum valor de segredo em string
   literal (R8/AC-08).
