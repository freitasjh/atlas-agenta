# Regra de normalização E.164-BR na borda do servidor (ADR-01) — Revisor B

A ADR-01 altera `normalizePhoneForEvolution` em `supabase/functions/whatsapp/evolution-adapter.ts`
para garantir o DDI `55` antes do envio à Evolution, cobrindo registros legados persistidos sem
código de país — a causa raiz do HTTP 400 relatado em QA. A regra foi extraída num auxiliar puro
`applyBrDdi` e documentada como especificação canônica (fonte da verdade que a ADR-02 espelhará). A
mudança é cirúrgica: um único arquivo, 36 inserções, sem tocar `index.ts`, `schemas.ts`, o mock ou
a porta `EvolutionAdapter`. A assinatura pública não muda e a função segue pura (sem rede, relógio
ou segredo).

Watch for: nenhum bloqueio. Uma observação não-bloqueante sobre números de 12 dígitos sem DDI que
caem no ramo "mantém" (comportamento previsto pela ADR, documentado abaixo). `deno check` não pôde
ser executado localmente (Deno ausente, como a análise-data §6 já previa); a prova ponta-a-ponta é
responsabilidade do QA/ADR-04.

**Verdict**: APPROVED

## High-level view

A implementação adere à tabela de casos canônica da ADR-01 linha a linha. Tracei os seis critérios
de aceite (AC-01-a a AC-01-f) contra o código e todos passam, incluindo a idempotência (reaplicar a
um E.164-BR é no-op) e o caso de borda DDD 55 (11 díg começando com `55` → prefixa, virando
`5555...`), resolvido pela fronteira de comprimento em vez de só prefixo.

As fronteiras de segurança estão respeitadas: o helper não valida/rejeita (defesa-em-profundidade,
quem recusa número inválido é a Evolution via 400 → `send_failed`), não lança por formato, e não
introduz nenhuma linha de log com o telefone — RNF-E164-01 (PII) preservado. A Evolution API key
nunca transita pelo helper, que continua puro.

A disciplina de escopo é exata: só `evolution-adapter.ts` mudou, e `sendText` continua sendo o único
consumidor, passando o resultado como `number` no corpo do POST. O JSDoc foi atualizado para refletir
que o `to` não depende mais de já vir com `+55`, encerrando o descompasso de contrato apontado na
análise.

A contraprova de repositório (`npm run build` = `tsc -b && vite build`) passa limpa. O arquivo da
Edge Function roda em runtime Deno e está fora do grafo do Vite/tsc, então a verificação de tipo
dele fica para o `deno check` (indisponível aqui) e para o QA — consistente com o que a própria ADR
determina.

<details>
<summary>Issues (1)</summary>

1. **12 díg sem DDI não recebem prefixo (observação, não-bloqueante)** — um número com 12 dígitos
   que NÃO comece com `55` cai no ramo "demais comprimentos → devolve como está" e segue sem DDI. É
   comportamento previsto pela tabela da ADR (só 10/11 díg são prefixados; outros comprimentos vão
   à Evolution como estão para serem recusados). Não há ação exigida; registrar apenas para que a
   ADR-02 (cadastro, que rejeita no submit) e o QA tenham ciência da zona cinzenta.

</details>

<details>
<summary>Details</summary>

### Aderência à tabela canônica (AC-01-a … AC-01-f)

Tracei cada critério de aceite contra `applyBrDdi`:

```
applyBrDdi(digits):
  len 10 | 11  → "55" + digits
  else         → digits
```

- **AC-01-a** `"47992391751"` → limpa 11 díg → `"5547992391751"`. ✓
- **AC-01-b** `"+55 47 99239-1751"` → limpa 13 díg → ramo else → `"5547992391751"` (não vira
  `5555...`); `"5547992391751"` (13 díg) idem. ✓
- **AC-01-c** `"1133224455"` → 10 díg → `"551133224455"`. ✓
- **AC-01-d** idempotência: `"5547992391751"` (13) reaplicado → else → mesmo valor. ✓
- **AC-01-e** DDD 55: `"55999887766"` → 11 díg → `"5555999887766"`. ✓ A fronteira por comprimento
  (10/11 = nacional; 12/13 = com DDI) resolve a ambiguidade do prefixo `55` exatamente como a ADR
  especifica.
- **AC-01-f** sem PII / sem lançar: o corpo tem só um `if` e dois `return`; não lança, não loga.
  `grep console.` no arquivo confirma que nenhuma das 8 linhas de log referencia `to`, `number`,
  `phone` ou `text` — todas são status/categoria técnica curta. ✓

A regra de reconhecimento de inválido (comprimentos fora de 10–13) devolve os dígitos sem prefixo,
delegando a recusa à Evolution. Isso é o tratamento de borda que a ADR prescreve explicitamente
("o helper de borda nunca lança por formato").

### Fronteiras (multi-tenant / RLS / RBAC / idempotência / segredos / LGPD)

Nada aqui cruza fronteira de tenant: o helper é um transformador de string puro, sem acesso a banco,
sessão ou `tenant_id`. RLS/RBAC não se aplicam a esta camada — o `index.ts` (fora do escopo, intacto)
é quem já confere opt-in LGPD, idempotência por `dedupe_key` e instância conectada antes de chamar
`sendText`. A API key da Evolution é resolvida em `credentials()` e nunca passa por
`normalizePhoneForEvolution`. A idempotência de contrato pedida pela ADR (RF-E164-05) é a
idempotência *da própria normalização* (reaplicar = no-op), verificada em AC-01-d — não confundir
com a idempotência de webhook, que vive noutra camada.

LGPD/PII: o requisito central desta ADR na dimensão de segurança é não logar o telefone. O diff não
adiciona nenhuma linha de log; `sendText` mantém só `console.error` com status. Preservado.

### Disciplina de escopo e contrato

`git show --stat` confirma um único arquivo alterado. `sendText` continua chamando
`normalizePhoneForEvolution(params.to)` e usando o retorno como `number` no corpo `{ number, text }`
— o ponto de entrada não mudou, coerente com a cláusula da ADR de que a assinatura e o chamador
permanecem. O JSDoc do passo 2 de `sendText` foi reescrito de "espera `+55...`" para "garante o DDI
55 em legados", fechando o descompasso de contrato que a análise havia apontado (o `to` deixa de
depender de já vir normalizado).

### Contraprova

`npm run build` (`tsc -b && vite build`) concluiu com sucesso (`✓ built in 8.36s`). O único aviso é
o de tamanho de chunk (>500 kB), pré-existente e sem relação com esta ADR. Não há outros scripts de
qualidade no `package.json` (sem lint/test configurados). `deno check` — a verificação de tipo
natural do arquivo, por ser runtime Deno fora do grafo do Vite/tsc — não pôde ser executada porque o
Deno não está instalado no ambiente, exatamente a limitação registrada na análise-data §6 e aceita
pela ADR, que delega a prova ponta-a-ponta (legado → `sent`) ao QA/ADR-04. Revisão estática do
helper puro não revelou erro de tipo: entrada e saída `string`, `len` numérico, sem `any`.

</details>

<details>
<summary>File map</summary>

- `supabase/functions/whatsapp/evolution-adapter.ts` — novo auxiliar puro `applyBrDdi` e corpo/JSDoc
  de `normalizePhoneForEvolution` aplicando a regra E.164-BR; JSDoc do passo 2 de `sendText`
  atualizado. Sem outras mudanças.

Diff completo: `git show 71aa041 -- supabase/functions/whatsapp/evolution-adapter.ts`.

</details>
