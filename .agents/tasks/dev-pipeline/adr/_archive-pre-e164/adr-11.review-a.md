# ADR-11 Revisão A — `sendText` real

**Revisor:** Independente A  
**Data:** 2025-10-19  
**Status:** Leitura completa + testes de build + inspeção estática

---

## Sumário

ADR-11 substitui o stub de `RealEvolutionAdapter.sendText` por uma implementação real que posta em `/message/sendText/{instance}` da Evolution API v2.3.7, normaliza o número E.164 antes do envio e extrai o `providerMessageId` real da resposta. A mudança fica isolada em `evolution-adapter.ts` (47 inserções, 9 deleções), sem alterar `index.ts`, `schemas.ts`, migrations ou UI — respeitando a trava de "transparência mock→real" (RNF-RE-07/R12/AC-12). Validação da resposta com zod e timeout/erro de rede tratado como falha pt-BR controlada.

**Watch for:** a implementação atende os critérios de aceite da especificação; nenhuma issue técnica encontrada em build, typecheck ou revisão de código. Duas observações (não-bloqueantes) estão apontadas abaixo sobre comportamento esperado vs. estado real.

---

## High-level view

O adapter real resolve credenciais do env no ponto de uso (falha cedo e clara sem rede se ausentes, conforme AC-07). A normalização de número E.164 é determinística — strip de dígitos — via helper puro reutilizado da ADR-09. O POST é feito com cliente HTTP que aplica timeout de 15s e AbortController, traduzindo timeout/erro de rede em exceção pt-BR controlada. A resposta external (não-confiável) é validada com zod antes de ler qualquer campo; resposta fora do contrato resulta em exceção pt-BR que o `index.ts` captura no `catch` do `sendText` e traduz em outcome `send_failed` (502). Logs são minimalistas: nenhum `to` (telefone) ou `text` (corpo) em claro; apenas status HTTP e categoria de erro. Nenhum segredo da Evolution persiste no código; `.env` permanece git-ignored. A interface `EvolutionAdapter` não muda; a seleção mock/real é por `EVOLUTION_MODE`; mock continua funcional.

---

## Build e testes

- `npm run typecheck`: ✅ OK (TS estrito, sem erros)
- `npm run build`: ✅ OK (vite 5.4.11, prod bundle compiled)
- Audit de segredo: `grep` por API key no código = vazio
- `.env` git-ignored: ✅ confirmado (`git check-ignore`)
- Logs verificados: nenhum `to` ou `text` em claro; apenas status/categoria de erro

---

## Detalhes de implementação

<details>
<summary>Comportamento do `sendText` real</summary>

A função:

1. Resolve credenciais via `this.credentials()` → falha pt-BR se `EVOLUTION_API_URL` ou `EVOLUTION_API_KEY` faltarem (R7/AC-07)
2. Normaliza `params.to` (E.164, ex.: `+55...`) via `normalizePhoneForEvolution` → strip de dígitos (determinístico)
3. Posta em `POST /message/sendText/{instance}` com corpo `{ number, text: params.text }`
4. Cliente HTTP aplica timeout de 15s (AbortController); timeout/erro de rede → exceção pt-BR controlada (não vaza erro bruto)
5. Resposta validada com `sendTextResponseSchema` (zod); fora do contrato → exceção pt-BR "Resposta inválida do servidor de WhatsApp."
6. Extrai `providerMessageId` de `parsed.data.key.id`; o `index.ts` grava em `messages.provider_message_id` sem mudança de código (transparência mock→real, R5/AC-05)

Fluxo de erro:
- Rede/timeout: `console.error("evolution: falha de comunicação (network|timeout)")` → exceção pt-BR genérica
- Resposta HTTP não-ok: `console.error("sendText: envio falhou (status X)")` → exceção pt-BR sem corpo do provedor
- Resposta fora do contrato: `console.error("sendText: resposta de envio fora do contrato")` → exceção pt-BR genérica

Nenhum `to`/`text` em claro nos logs (AC-09 confirmado).

</details>

<details>
<summary>Conformidade de fronteiras</summary>

- **RLS**: não afeta (adapter não toca banco); `index.ts` escreve `messages` com service role, isolamento garantido
- **`tenant_id` do JWT, nunca do cliente**: ✅ adapter recebe `instanceName` já derivado no `index.ts` a partir do JWT (`tenant-<tenant_id>`); não resolve tenant nem aceita `tenant_id` de parâmetro (RNF-RE-04)
- **Segredo fora do cliente**: ✅ `EVOLUTION_API_URL`/`EVOLUTION_API_KEY` lidos via `Deno.env` no servidor; nunca hardcode, nunca em bundle (sem prefixo `VITE_`), nunca ecoados
- **Dado externo validado com zod**: ✅ resposta da Evolution validada antes de usar (RNF-RE-02, AC-06)
- **PII mínima em log**: ✅ nenhum `to` (telefone) ou `text` (corpo) em claro; motivo técnico curto (status/categoria)
- **Idempotência**: não afeta (adapter não toca banco); `index.ts` + índice unique parcial garantem idempotência (fora do escopo do adapter)
- **RBAC**: não afeta (adapter não conhece papéis)

</details>

<details>
<summary>Diferença mock vs. real</summary>

**Mock** (continua funcional com `EVOLUTION_MODE=mock`):
- `sendText`: latência simulada 15ms, devolve `mock-<uuid>` determinístico por chamada

**Real** (com `EVOLUTION_MODE=real` + credenciais no `.env`):
- `sendText`: rede real 15s timeout, devolve id real da Evolution v2.3.7

Seleção por `createEvolutionAdapter()` sem mudança de interface — transparência total do `index.ts`.

</details>

---

## Observações de design (não-bloqueantes)

### 1. Comportamento de instância já conectada

A análise (§7) levantou: quando a Evolution responde `state:"open"` (já conectada) **no `pair`**, ele lança erro pt-BR "O WhatsApp já está conectado." Isso mantém a interface `PairResult` intacta e limita o impacto do `index.ts` inalterado. Porém, a semântica é: "pareamento falhou porque já está conectado" — não é exatamente um pareamento bem-sucedido. O `index.ts` captura essa exceção no `catch` do `pair` e retorna 502. Essa é a opção (b) da análise, conforme esperado. Sem bloqueio, mas é digno de nota para teste manual do usuário: se tentar re-parear após já estar conectado, receberá erro.

### 2. Divergência estado de conexão (registrada como dívida na análise)

O `index.ts` marca `whatsapp_instances.connection_status = 'conectado'` logo após `adapter.pair()` retornar o QR. No fluxo **real**, pareamento é **assíncrono**: o cliente recebe o QR mas ainda precisa escanear. O `index.ts` inalterado não faz polling/webhook de confirmação (fora de escopo). Resultado: estado fica **otimista** (marcado conectado antes de o usuário escanear). Isto é uma **inconsistência conhecida do fluxo real**, registrada como dívida na análise (seção 7) para fase de webhook/polling. Não bloqueia esta entrega (o pedido explícito foi "não tocar `index.ts`"), mas é relevante para o teste manual do usuário.

---

<details>
<summary>Issues</summary>

Nenhuma issue técnica encontrada.

Observações de design registradas como dívida:
1. Instância já conectada no `pair` retorna erro pt-BR (comportamento esperado, conforme opção (b) da análise; sem bloqueio)
2. Estado de conexão fica otimista até webhook/polling de confirmação (dívida aceita na análise; fora de escopo desta tarefa)

</details>

---

## Conformidade com critérios de aceite

| AC | Descrição | Status |
|---|---|---|
| AC-01 | stub removido; executa POST real | ✅ Confirmado |
| AC-02 | pair cria/conecta idempotente | ✅ Não afeta ADR-11 (ADR-10); ADR-11 só toca `sendText` |
| AC-03 | pair devolve QR base64 data URL | ✅ Não afeta ADR-11 |
| AC-04 | pair de instância já conectada | ✅ Lança erro pt-BR (opção b, conforme análise) |
| AC-05 | sendText envia e devolve id real | ✅ Implementado; `index.ts` grava sem mudança |
| AC-06 | respostas validadas com zod | ✅ `sendTextResponseSchema.safeParse` antes de ler |
| AC-07 | credenciais só do env, sem credencial faltando | ✅ `resolveEvolutionCredentials` falha cedo/claro |
| AC-08 | sem segredo no código/git | ✅ `.env` git-ignored; grep vazio; nenhum hardcode |
| AC-09 | PII fora do log | ✅ Nenhum `to` ou `text` em `console.*` |
| AC-10 | mock intacto | ✅ `MockEvolutionAdapter` inalterado; seleção por env |
| AC-11 | boot/typecheck | ✅ `npm run typecheck` OK |
| AC-12 | zero mudança fora do adapter | ✅ Diff só em `evolution-adapter.ts` |
| AC-13 | timeout/erro de rede tratado | ✅ AbortController + try-catch; exceção pt-BR |
| AC-14 | travas negativas | ✅ Nenhum webhook, cron, envio a terceiro, mudança de contrato |

---

## Parecer

✅ **APROVAÇÃO SEM RESSALVAS TÉCNICAS**

A implementação está conforme aos critérios de aceite, fronteiras de segurança e convenções de código. Build, typecheck e auditoria de segredo confirmam conformidade. Os logs respeita mínima de PII (sem `to`/`text`). A validação com zod e tratamento de erro de rede/timeout está em lugar e bem implementado. Nenhuma issue técnica bloqueia a entrega.

As duas observações de design (estado otimista, erro ao re-parear conectado) são conhecidas e registradas como dívida/limitação aceita da fase (conforme análise §7). Não afetam a correção técnica desta ADR.

Recomendação: **liberar para QA do usuário**.

