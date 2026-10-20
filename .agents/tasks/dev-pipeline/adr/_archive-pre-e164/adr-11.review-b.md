# ADR-11 — `sendText` real na Evolution: parecer do Revisor B

Troca o stub de `RealEvolutionAdapter.sendText` por uma chamada real à Evolution v2.3.7:
resolve credenciais do env, normaliza o número E.164, faz `POST /message/sendText/{instance}`
com `{ number, text }` pelo cliente HTTP com timeout da ADR-09, valida a resposta com o schema
zod `sendTextResponseSchema` e extrai `providerMessageId` de `key.id`. O `index.ts`, os schemas,
as migrations e a UI ficam intactos — o único arquivo tocado é o adapter. O build frontend passa
limpo, o diff está confinado a `evolution-adapter.ts`, nenhum segredo aparece no diff e nenhum
`console.*` do adapter vaza telefone ou corpo da mensagem.

**Watch for:** não há obstáculo bloqueante — o typecheck Deno real da function não pôde ser rodado
neste ambiente (Deno ausente), então o AC-11 (`supabase functions serve ... sobe sem erro`) fica
como dívida de verificação a cargo do QA/usuário (confirmed). A única observação de design é
pré-existente e fora do escopo desta ADR: o `index.ts` envia `text: input.template` (o nome do
template, ex. `"confirmacao"`), não um corpo renderizado em pt-BR — ADR-11 só fia o adapter, então
não é defeito desta ADR (confirmed).

**Verdict**: APPROVED

## High-level view

A implementação segue o contrato verificado na análise §5 ao pé da letra: endpoint, corpo
`{ number, text }`, extração de `key.id`. O adapter reutiliza toda a infra da ADR-09
(`resolveEvolutionCredentials`, `evolutionFetch` com `AbortController`, `normalizePhoneForEvolution`,
`sendTextResponseSchema`) em vez de reintroduzir rede/parsing próprios, então as garantias de
timeout, header `apikey` e tolerância a corpo não-JSON vêm de graça e já foram revisadas nas ADRs
anteriores.

As fronteiras multi-tenant estão nas mãos certas: o adapter não toca o banco, não resolve tenant e
não conhece papéis — recebe `instanceName` já derivado do tenant pelo `index.ts` (RNF-RE-04). A
resposta da Evolution é tratada como dado não confiável: `safeParse` antes de ler `key.id`, e
qualquer desvio de shape vira erro pt-BR controlado sem ecoar o corpo do provedor (R6/AC-06). O
`index.ts` já traduz essa exceção no outcome `send_failed` (502) existente, sem mudança de código
— confirmado lendo o `catch` do `handleSend`.

Todos os `console.error` do caminho de envio logam só motivo técnico curto (status, categoria
rede/timeout); nenhum carrega `to` nem `text`. A API key só trafega no header `apikey` e o `.env`
que a contém está git-ignored e não rastreado. O valor real do id de mensagem passa a vir de
`key.id` e é gravado pelo mesmo caminho de escrita que antes gravava `mock-<uuid>` (R5/AC-05).

O limite de verificação é o typecheck da function: o build do projeto (`tsc -b && vite build`) só
inclui `src`, então não compila o código Deno sob `supabase/functions`. O AC-11 depende de
`supabase functions serve`, que exige Deno — indisponível aqui. Isso não é falha do código; é
cobertura que recai no QA e no teste real do usuário, como a própria ADR previu (D-02/R14).

<details>
<summary>Issues (2)</summary>

1. **Typecheck Deno não executado (AC-11)** — Deno ausente neste ambiente; o boot da function
   (`supabase functions serve whatsapp --env-file supabase/functions/.env`) não foi verificado.
   Não bloqueante para o parecer, mas deve ser coberto pelo QA/usuário antes do envio real.
2. **`text` = nome do template (pré-existente, fora de escopo)** — `index.ts` passa
   `text: input.template`, então o envio real mandaria a string `"confirmacao"` em vez de uma
   mensagem renderizada. Não é defeito da ADR-11 (que só fia o adapter); registrar como dívida
   para a fase de régua/templates, não corrigir aqui.

</details>

<details>
<summary>Details</summary>

### Aderência ao contrato verificado (AC-01, AC-02, AC-04)

O `sendText` real bate exatamente com a análise §5: `POST /message/sendText/{instance}` com corpo
`{ number, text }`, `providerMessageId` extraído de `key.id`. O `instanceName` vai por
`encodeURIComponent`, coerente com o `pair` da ADR-10. A normalização usa o helper puro
`normalizePhoneForEvolution`, que faz `to.replace(/\D+/g, "")` — tira o `+` do E.164 e qualquer
separador, produzindo os dígitos que a Evolution v2 aceita (AC-04). O stub que lançava "Integração
real da Evolution não implementada nesta fase." foi removido (AC-01).

### Dado não confiável e falha controlada (AC-03, R6)

```ts
if (!sendRes.ok) {
  console.error(`sendText: envio falhou (status ${sendRes.status})`);
  throw new Error("Não foi possível enviar a mensagem pelo WhatsApp.");
}
const parsed = sendTextResponseSchema.safeParse(sendRes.body);
if (!parsed.success) {
  console.error("sendText: resposta de envio fora do contrato");
  throw new Error("Resposta inválida do servidor de WhatsApp.");
}
return { providerMessageId: parsed.data.key.id };
```

O schema exige `key.id` como `string`; resposta sem `key`, com `id` de tipo errado ou corpo de
erro cai no ramo `!parsed.success` e vira erro pt-BR, sem ler `key.id` cru e sem ecoar o corpo do
provedor. O status `!ok` é tratado antes do parse, cobrindo o corpo de erro do gateway/ngrok. O
`index.ts` converte ambas as exceções em `send_failed` (502) no `catch` do `handleSend`, marca a
`message` como `falha` com `failure_reason: "provider_error"` e devolve o DTO sem PII — confirmado
no arquivo.

### Timeout e erro de rede (AC-13)

O envio reusa `evolutionFetch`, que aplica `AbortController` com `EVOLUTION_TIMEOUT_MS` (15s) e
converte abort/erro de rede em `Error("Falha de comunicação com o servidor de WhatsApp.")`,
logando só `timeout`/`network`. Relevante porque o servidor está atrás de ngrok (R13). Nenhuma
exceção crua de `fetch` escapa.

### PII e segredo (AC-08, AC-09)

Os dois `console.error` do `sendText` (linhas 397 e 403) registram apenas status e categoria —
nunca `params.to` nem `params.text`. A API key só trafega no header `apikey` montado dentro de
`evolutionFetch`, nunca em log nem em resposta, e o `.env` que a guarda está git-ignored e não
rastreado (`git check-ignore` confirma, `git ls-files` não encontra). O diff do commit não contém
o valor literal da chave.

### Confinamento do diff e mock intacto (AC-05, AC-10, AC-12)

`git show 57b4669 --name-only` lista só `supabase/functions/whatsapp/evolution-adapter.ts`
(AC-12). O `MockEvolutionAdapter.sendText` permanece inalterado — continua devolvendo
`mock-<uuid>` sem rede, e `createEvolutionAdapter()` ainda faz default `mock` (AC-10). O caminho de
escrita de `provider_message_id` no `index.ts` não mudou; só o valor deixa de ser fake (AC-05).

### Contraprova

`npm run build` (`tsc -b && vite build`) passou limpo (único aviso: tamanho de chunk, pré-existente
e sem relação com esta ADR). Não há scripts de lint/test no `package.json` além de `build`,
`typecheck` e `preview`. O typecheck Deno da Edge Function não está coberto por `tsc -b` (o
`include` do tsconfig é só `src`) e `deno`/`supabase` não estão instalados neste ambiente, então
o AC-11 (boot da function) não foi exercido aqui — fica para o QA/usuário, conforme a própria ADR
já previa que o disparo real é teste do usuário.

</details>

<details>
<summary>Arquivos no escopo da ADR-11</summary>

- `supabase/functions/whatsapp/evolution-adapter.ts` — `RealEvolutionAdapter.sendText` real
  (normaliza número, `POST /message/sendText`, valida com zod, extrai `key.id`); comentários de
  cabeçalho e docstrings atualizados de "stub até ADR-11" para "REAL". Único arquivo do commit
  `57b4669`.

Diff completo: `git show 57b4669`.

</details>
