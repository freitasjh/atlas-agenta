# ADR-01 — Regra de normalização E.164-BR na borda do servidor

**Status:** proposto

## Contexto

A Edge Function `whatsapp` dispara para a Evolution via `RealEvolutionAdapter.sendText`, que
chama `normalizePhoneForEvolution(to)` em `supabase/functions/whatsapp/evolution-adapter.ts`.
Hoje essa função só faz `to.replace(/\D+/g, "")`: remove não-dígitos mas **não adiciona o DDI
55**. O `index.ts` (`handleSend`) passa `customer.phone` cru. Registros legados gravados sem DDI
(ex.: `47992391751`, 11 dígitos, DDD 47) chegam assim à Evolution v2.3.7, que responde **HTTP
400** no `POST /message/sendText` — causa raiz confirmada em QA (análise-data §1, PRD §1).

Esta é a ponta (A) do recorte A+B e a **última garantia** antes da chamada externa: precisa
cobrir os legados em tempo de envio, sem migration de backfill (decisão PRD §7 / análise-data
§4.2). O helper é puro (sem rede, sem relógio, sem segredo) — a Evolution API key nunca passa por
ele. É a primeira ADR porque define a **especificação canônica** da regra E.164-BR que a ponta do
cadastro (ADR-02) terá de reproduzir idêntica.

### Decisão de mecanismo de compartilhamento (resolve a OQ do PRD §7 / análise-data §7)

Os runtimes são distintos — Vite/TS em `src/` e Deno em `supabase/functions/` (sem `deno.json`
nem import_map na pasta das functions, imports via `npm:`/`jsr:`). Um módulo único importável
cruzando os dois acoplaria o bundler do Vite ao resolvedor do Deno e é frágil. **Decisão: duas
implementações com uma única especificação de regra**, fixada por uma **tabela de casos de teste
idêntica** documentada nesta ADR e replicada na ADR-02. O requisito de contrato (RF-E164-05) é
que a regra **não divirja** — garantido pela mesma tabela de casos, não por import compartilhado.
Esta ADR é a **dona** da especificação; ADR-02 a espelha.

### Especificação canônica E.164-BR (tabela de casos — fonte da verdade para ADR-01 e ADR-02)

Dado o número de entrada, após `replace(/\D+/g, "")` (remove `+`, espaços, parênteses, hífens):

| Entrada (dígitos após limpar) | Regra | Saída (dígitos, sem `+`) |
|---|---|---|
| 10 díg, não começa com `55` (fixo com DDD) | prefixa `55` | `55` + entrada |
| 11 díg, não começa com `55` (móvel com DDD) | prefixa `55` | `55` + entrada |
| 12 díg começando com `55` (fixo BR já com DDI) | mantém | entrada |
| 13 díg começando com `55` (móvel BR já com DDI) | mantém | entrada |
| já E.164-BR (idempotência) | no-op | mesma entrada |
| curto demais (< 10 díg após limpar, sem DDI) | inválido | ver tratamento por ponta* |
| > 13 díg | inválido | ver tratamento por ponta* |

\* **Tratamento de inválido difere por ponta** (mesma regra de reconhecimento, ação distinta):
- **Servidor (ADR-01):** a normalização de borda é defesa-em-profundidade sobre dado já
  persistido; ela **não valida/rejeita** — apenas aplica a regra de DDI e devolve os dígitos.
  Se o número for genuinamente inválido, quem recusa é a Evolution (400 → `send_failed`), como
  hoje. O helper de borda nunca lança por formato.
- **Cadastro (ADR-02):** rejeita no submit com erro pt-BR (RF-E164-03). Ver ADR-02.

Observação de desambiguação: o prefixo `55` só é aplicado quando o número **não começa com 55**.
Um número de 10/11 díg que por acaso comece com `55` (ex.: DDD 55 — Rio Grande do Sul, Santa
Maria) é um caso de borda reconhecido: 11 díg começando com `55` é tratado como **nacional sem
DDI** (prefixa → 13 díg `55` + `55...`), porque DDD 55 + 9 díg = 11 díg nacionais; 12–13 díg
começando com `55` é tratado como **já com DDI**. A fronteira é o **comprimento** (10/11 =
nacional; 12/13 = com DDI), não só o prefixo. Registrar este caso na tabela de testes.

## Decisão

Alterar `normalizePhoneForEvolution(to: string): string` em
`supabase/functions/whatsapp/evolution-adapter.ts` para aplicar a especificação canônica acima:

1. Limpar não-dígitos (`replace(/\D+/g, "")`) — comportamento atual preservado.
2. Aplicar a regra de DDI pela tabela: 10/11 díg sem DDI → prefixa `55`; 12/13 díg com `55` →
   mantém; demais comprimentos → devolve os dígitos como estão (sem lançar; a Evolution recusa).
3. Permanecer **puro e determinístico** (RNF-E164-04): sem rede, sem relógio, sem segredo.
4. Atualizar o JSDoc para refletir que agora **garante o DDI 55**, encerrando o descompasso de
   contrato apontado na análise (o `to` deixa de depender de já vir `+55`).
5. **Nunca logar** o número (RNF-E164-01): nenhuma linha nova de log com `to`/`number`.

Fatiar a regra numa função auxiliar pura pequena (ex.: `applyBrDdi(digits: string): string`)
dentro do mesmo arquivo é permitido ao implementador, desde que `normalizePhoneForEvolution`
continue sendo o ponto chamado por `sendText` e o resultado siga a tabela. Nenhuma mudança em
`index.ts`, `schemas.ts`, no mock, nem na porta `EvolutionAdapter` — a assinatura de
`normalizePhoneForEvolution` não muda.

Esta ADR é candidata a promoção futura para `docs/` (regra durável de domínio E.164-BR), mas
**não copiar para `docs/` agora** — anotação apenas.

## Consequências

- **Positivas:** legados sem DDI passam a sair com `5547992391751`; a Evolution para de responder
  400; `handleSend` retorna `sent`. Defesa-em-profundidade independente do cadastro. Regra
  isolada e testável sem rede.
- **Negativas / riscos:** heurística por comprimento tem zona cinzenta (DDD 55); mitigada pela
  regra explícita de comprimento e pela tabela de casos. Números internacionais não-BR não são
  objetivo deste recorte — a regra assume Brasil (decisão do produto, PRD §7).
- **Reversível:** mudança local numa função pura; reverter é restaurar o `replace` simples.

## Escopo

**dados** (servidor / Edge Function).

## Arquivos afetados

- `supabase/functions/whatsapp/evolution-adapter.ts` — corpo e JSDoc de
  `normalizePhoneForEvolution` (e, opcionalmente, um auxiliar puro no mesmo arquivo).

Sem migration, sem RLS, sem mudança de schema, sem tocar `index.ts`/`schemas.ts`/mock/porta.

## Critérios de aceite testáveis (desta ADR)

- **AC-01-a:** `normalizePhoneForEvolution("47992391751")` → `"5547992391751"` (legado 11 díg,
  cenário do usuário). Cobre AC-01/AC-04 do PRD na parte de borda.
- **AC-01-b:** `normalizePhoneForEvolution("+55 47 99239-1751")` e `"5547992391751"` →
  `"5547992391751"` (mantém DDI, sem duplicar; não vira `5555...`). Cobre AC-03/AC-04.
- **AC-01-c:** `normalizePhoneForEvolution("1133224455")` (fixo 10 díg) → `"551133224455"`.
- **AC-01-d (idempotência):** aplicar o helper duas vezes ao mesmo número E.164-BR devolve o
  mesmo valor (no-op na 2ª aplicação).
- **AC-01-e (DDD 55):** `"55999887766"` (11 díg, DDD 55 móvel) → `"5555999887766"` (prefixa).
- **AC-01-f (sem PII/sem lançar):** a função não introduz log do número e não lança para formato
  inválido (devolve os dígitos; a Evolution decide).
- **Verificação:** `deno check supabase/functions/whatsapp/index.ts` passa limpo (AC-09 lado
  servidor). Como o projeto não tem suíte Deno instalada (análise-data §6), validar os casos
  acima por inspeção determinística do helper puro; a prova ponta-a-ponta do legado→`sent` é a
  verificação ao vivo consolidada na ADR-04 (QA do run).

## Dependência

Nenhuma (primeira ADR). Define a especificação consumida por ADR-02 e ADR-04.
