# ADR-11 — `sendText` real: enviar texto e devolver `providerMessageId` real

**Status:** proposto

## Contexto

Com a fundação da ADR-09 pronta, esta ADR troca o stub de `RealEvolutionAdapter.sendText` pela
chamada **real** à Evolution. O `index.ts` chama
`adapter.sendText({ instanceName, to, text })` após ter conferido opt-in LGPD, idempotência
(`dedupe_key`) e instância conectada; ele grava `messages.provider_message_id` com o retorno —
hoje `mock-<uuid>`, passando a ser o id real — **sem alterar código** (R5/AC-05, mesmo caminho de
escrita). O adapter **não** toca o banco, **não** conhece papéis, **não** resolve tenant
(RNF-RE-04).

Contrato v2.3.7 (análise §5, verificado):
- **Enviar texto:** `POST /message/sendText/{instance}` com corpo
  `{ number: <E.164 sem '+' ou JID>, text }`. Em v2.3.x o campo é `text` direto (versões antigas
  usavam `textMessage.text` — reconferir se o servidor mudar).
- **Resposta:** `{ key: { id, remoteJid?, fromMe? } }`; `providerMessageId` sai de `key.id`.
  Se `key.id` faltar → falha controlada.

Fronteiras de risco centrais aqui: **PII fora do log** (`to`/telefone e `text`/corpo **nunca**
em claro — RNF-RE-03/R9) e **dado não confiável validado com zod** antes de ler `key.id`
(RNF-RE-02/R6).

## Decisão

Implementar `RealEvolutionAdapter.sendText({ instanceName, to, text })` no mesmo módulo, usando
os helpers da ADR-09:

1. Resolver credenciais do env (helper ADR-09); ausentes → falha pt-BR sem rede (R7/AC-07).
2. **Normalizar o número** com o helper da ADR-09 (strip `+` do E.164 → formato aceito pela
   Evolution v2).
3. **Enviar** via `POST /message/sendText/{instance}` com corpo
   `{ number: <normalizado>, text }`, usando o cliente HTTP com timeout da ADR-09.
4. **Validar a resposta com o schema `sendText` da ADR-09** e extrair `providerMessageId` de
   `key.id`. Resposta fora do contrato (campo ausente, tipo errado, corpo de erro) → falha
   controlada pt-BR; o `index.ts` já traduz exceção de `sendText` no outcome `send_failed`
   (502) existente, **sem** vazar o corpo do provedor (R6/AC-06).
5. Devolver `SendResult { providerMessageId }` com o id **real** (R5/AC-05).
6. Timeout/erro de rede (ngrok) → falha pt-BR controlada (R13/AC-13).
7. **PII mínima em log (R9/AC-09):** nenhum `console.*` do adapter pode conter `to` (telefone) ou
   `text` (corpo) em claro. Em falha de envio, logar motivo técnico curto (status/categoria do
   erro), nunca o número nem o corpo; a correlação é por `provider_message_id`/`customer_id`
   (feita no `index.ts`), não pelo telefone. API key nunca logada/ecoada (R8).

## Consequências

- **Escopo:** dados (backend). Sem frontend.
- **Arquivos afetados:** `supabase/functions/whatsapp/evolution-adapter.ts` (único). `index.ts`
  (que grava `provider_message_id`), `schemas.ts`, migrations e UI inalterados.
- **Positivo:** mensagens reais passam a sair pela porta existente; `messages.provider_message_id`
  recebe o id real da Evolution sem mudança no `index.ts`. Fecha, com a ADR-10, o par
  `pair`+`sendText` reais que o PRD exige.
- **Negativo/risco:** envio real a terceiro **não** é feito no QA automatizado (D-02/R14) — o
  teste de envio real é do usuário (§9 do PRD). O QA cobre os caminhos sem disparo
  (credenciais ausentes, resposta inválida, normalização, mock intacto).
- **Dependência:** **ADR-09** (cliente HTTP com timeout, schema de sendText, normalização de
  número, resolução de credenciais). Independente da ADR-10 em código, mas ordenada depois dela
  (parear logicamente precede enviar).

### Critérios de aceite testáveis (desta ADR)

1. `RealEvolutionAdapter.sendText` **não** lança mais "Integração real da Evolution não
   implementada nesta fase."; executa `POST /message/sendText/{instance}` real (R1/AC-01).
2. `sendText` devolve `{ providerMessageId }` extraído de `key.id` da resposta real; o `index.ts`
   grava em `messages.provider_message_id` sem alteração de código (R5/AC-05).
3. Resposta da Evolution fora do contrato (sem `key.id`, tipo errado, corpo de erro) → falha
   controlada pt-BR traduzida pelo `index.ts` em `send_failed` (502), sem vazar o corpo do
   provedor (R6/AC-06).
4. Número E.164 (`+55...`) é normalizado para o formato aceito pela Evolution v2 antes do POST.
5. Nenhum `console.*` do adapter contém `to` (telefone) ou `text` (corpo) em claro; falha loga
   motivo técnico curto (R9/AC-09 — revisão de código + inspeção de `console.*`).
6. Falha de rede/timeout vira falha pt-BR controlada; a function não derruba o request
   (R13/AC-13).
7. `supabase functions serve whatsapp --env-file supabase/functions/.env` sobe sem erro de
   boot/typecheck (R11/AC-11); `git diff --name-only` = só o adapter (R12/AC-12); API key não
   aparece em código/diff/log (R8/AC-08).
