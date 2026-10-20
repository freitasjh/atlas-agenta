# Parecer do Revisor B — ADR-04 (Verificação ponta-a-ponta E.164-BR)

Normalização de telefone para E.164-BR (DDI 55) no envio de WhatsApp — ADR-04 fecha o bugfix A+B
provando que origem (cadastro) + borda (Edge Function) juntas resolvem o caso do número legado sem
DDI e não produzem `5555...`. A ADR-04 não escreve código de aplicação: executa a verificação
estática (build/typecheck + conferência de migrations, PII e isolamento) e registra a camada ao vivo
(`EVOLUTION_MODE=real` + prova visual no `/app/clientes`) como `qaPending`, conforme sua própria
decisão §3. Revisei o diff do escopo integral do bugfix (`01758ae..7cfa028`): o helper compartilhado,
o schema zod, o adapter da borda, o form de cadastro e o script de dev.

**Watch for:** o JSDoc do `applyBrDdi` (borda do servidor) contradiz o próprio código no tratamento
de números de 10/11 dígitos que começam com `55` — a documentação diz "que NÃO começam com 55", mas
o código prefixa incondicionalmente (comportamento correto, igual ao cliente). Defeito de
documentação, não de comportamento (confirmed).

**Verdict**: APPROVED

## High-level view

A contraprova estática passou aqui de forma independente: `npm run build` (`tsc -b && vite build`)
saiu com exit 0 e o único aviso é o de chunk >500kB, pré-existente e não bloqueante. Não há script de
lint/test no `package.json` (só `dev`, `dev:functions`, `build`, `typecheck`, `preview`), então a
contraprova de qualidade disponível é o build/typecheck — e ele está limpo.

As fronteiras invioláveis que o fix toca estão preservadas. O `tenant_id` continua derivado do
JWT/`profiles` no servidor (`resolveIdentity`) e o `customer` é resolvido com `.eq('tenant_id',
tenantId)` sob service role — nenhum `tenant_id` vindo do payload entra no caminho do envio. Nenhum
`console.*` do `index.ts` loga `customer.phone`, `number` ou o texto da mensagem; só motivo técnico
curto. RBAC, idempotência (`dedupe_key`) e opt-in não foram alterados pelo fix.

A regra E.164-BR foi espelhada em duas implementações (cliente `toE164BR` puro em `src/lib/phone.ts`;
servidor `applyBrDdi` em `evolution-adapter.ts`), como RF-E164-05 permite quando não há módulo comum
entre Vite/TS e Deno. Tracei a tabela de casos nas duas pontas: o *código* é consistente (10/11 díg →
prefixa `55`; 12/13 díg com `55` → mantém; idempotente). A divergência está no *comentário* do
servidor, que descreve uma condição de prefixo (`NÃO começam com 55`) que o código não implementa —
risco de alguém "consertar" o código para casar com o comentário errado e quebrar o DDD-55 (RS).

A camada ao vivo (AC-04-c/d) e o `deno check` (parte do AC-04-a) não puderam rodar neste ambiente
(sem Evolution/ngrok, sem chrome-devtools MCP, sem binário `deno`). A ADR §3 e os critérios
AC-04-c/AC-04-d autorizam explicitamente registrar essa parte como `qaPending` com a camada estática
como piso — o `adr-04.qa.json` faz exatamente isso, de forma honesta e rastreável. Aceito o registro;
o fechamento ao vivo é responsabilidade do QA (step seguinte), não deste review.

<details>
<summary>Issues (2)</summary>

1. **JSDoc do `applyBrDdi` contradiz o código (confirmed)** — o comentário em
   `supabase/functions/whatsapp/evolution-adapter.ts` afirma "10 ou 11 díg que NÃO começam com `55`
   → prefixa `55`", mas o código prefixa `55` para TODO número de 10/11 díg (correto, igual ao
   cliente e coerente com o caso DDD-55/RS que o próprio comentário logo abaixo descreve). Corrigir a
   linha do comentário para remover a condição "que NÃO começam com 55", alinhando-a ao bloco de
   código e ao `src/lib/phone.ts`. Não bloqueia: o comportamento está certo; é saneamento de doc para
   não induzir regressão futura.

2. **`deno check` não executado (confirmed, mitigado)** — o typecheck da Edge Function faz parte do
   AC-04-a mas o binário `deno` está ausente do ambiente. Fica como `qaPending`, o que a ADR permite.
   Garantir que o QA com Deno disponível rode `deno check supabase/functions/whatsapp/index.ts` antes
   do fechamento definitivo.

</details>

<details>
<summary>Details</summary>

### Contraprova estática reexecutada de forma independente

Rodei `npm run build` a partir do working tree atual: exit 0, `✓ built in ~6s`. O único aviso é
`Some chunks are larger than 500 kB` no bundle `index-*.js` (~741 kB / 215 kB gzip) — confirmei que é
pré-existente (não introduzido por este diff, que não adiciona dependência de runtime nova; o
`package.json` só ganhou o script `dev:functions`). Não é erro e não bloqueia (AC-04-a parte
frontend satisfeita).

Não existe suíte de teste nem script de lint no projeto (`package.json` tem apenas `dev`,
`dev:functions`, `build`, `typecheck`, `preview`). Portanto a contraprova de qualidade que o ambiente
oferece é build/typecheck, e está limpa. `deno check` não roda (sem binário `deno`): registrado como
pendência, coerente com o `adr-04.qa.json`.

Migrations: `git status --short supabase/migrations/` vazio; a última migration é
`20250220091000_messages.sql`, nenhuma criada/alterada por este bugfix. AC-08 confirmado de forma
independente.

### Consistência da regra entre as duas pontas (RF-E164-05)

Tracei as duas implementações caso a caso:

```
entrada 47992391751 (11 díg, legado sem DDI)
  cliente toE164BR     → len 11  → "+55" + díg  → +5547992391751
  servidor applyBrDdi  → len 11  → "55" + díg   → 5547992391751   (sendText tira o +)
  => AC-01 satisfeito: number = 5547992391751, sem 5555, sem 400 esperado

entrada +5547992391751 (13 díg, já normalizado — caso de reenvio origem→borda)
  cliente toE164BR     → len 13, startsWith 55 → mantém → +5547992391751
  servidor applyBrDdi  → len 13 → mantém → 5547992391751
  => idempotência (AC-04) satisfeita: origem+borda não duplicam o 55
```

O código das duas pontas concorda. A diferença **intencional** está na política de inválido: o
cliente devolve `null` (o `customerSchema` recusa o submit com erro pt-BR — RF-E164-03), e a borda
devolve os dígitos como estão (defesa que não lança; a Evolution recusa). Essa assimetria está
documentada e é correta.

O defeito é textual e está só no servidor. O comentário de cabeçalho do `applyBrDdi` lista:

> `- 10 ou 11 díg que NÃO começam com 55 (fixo/móvel nacional sem DDI) → prefixa 55.`

mas o código é incondicional por comprimento:

```ts
if (len === 10 || len === 11) {
  return `55${digits}`;   // prefixa mesmo quando digits começa com "55"
}
```

O comentário inline logo abaixo já explica certo (DDD 55 / RS = 11 díg → `5555...`), e o cliente
documenta certo na tabela. Ou seja: a cláusula "que NÃO começam com 55" do cabeçalho é residual e
conflita com a decisão de "fronteira por comprimento" que o resto do arquivo e a ADR-01 fixam. Se um
mantenedor futuro tomar o cabeçalho como especificação e adicionar um guard `!startsWith("55")`, um
número de Rio Grande do Sul de 11 dígitos deixaria de receber DDI e voltaria a falhar com 400 — a
mesma classe de bug que esta ADR fecha. Por isso vale corrigir o texto, ainda que não bloqueie.

### Isolamento multi-tenant, RBAC, segredos e PII (AC-06/AC-07, RNF-E164-01/02)

No `index.ts`, o `handleSend` resolve `tenantId = identity.tenantId` (do JWT/`profiles`) e lê o
`customer` com `.eq('tenant_id', tenantId).eq('id', input.customerId)` sob service role — não há
`tenant_id` vindo do cliente no caminho do fix, nenhuma policy RLS afrouxada. Confirmado por leitura
direta das linhas 272–289.

Varredura de `console.*` no `index.ts`: todos emitem só `err.message` / motivo técnico curto / nomes
de etapa. Nenhum loga `customer.phone`, `number` ou `input.template`. `normalizePhoneForEvolution` e
`applyBrDdi` não logam. RNF-E164-01 (sem PII) e AC-06 preservados.

O `scripts/dev-functions.sh` lê os segredos via `--env-file supabase/functions/.env` e nunca ecoa o
conteúdo (checa só existência do arquivo com `[[ -f ]]`). `set -euo pipefail` e o quoting de
`"$ENV_FILE"`/`"$FUNCTION_NAME"` evitam injeção/word-splitting. Nenhum segredo no script. Coerente
com `seguranca-multitenant.md`.

### Design doc React (cadastro)

`customerSchema.phone` troca o antigo `E164_REGEX` por `.transform(toE164BR).refine(v => v !== null)`
com mensagem pt-BR "Informe um telefone com DDD (ex.: (11) 99999-8888)". O `refine` usa predicado de
narrowing (`(value): value is string`), então o tipo de saída do campo é `string`, não `string|null`
— é isso que faz `values.phone` chegar ao `mutateAsync` já normalizado sem o build quebrar por tipo
nulo (decisão não óbvia de tipagem). Em edição, `form.reset({ phone: customer.phone })` recarrega o
valor já E.164 e o resubmit é idempotente (traçado acima), então reeditar um cliente não re-prefixa
o DDI.

### Camada ao vivo — aceite do `qaPending`

AC-04-c (reenvio real → `outcome: "sent"`, `number` com DDI, sem 400) e AC-04-d (PRD §8 itens 1–5 no
navegador) dependem de Evolution/ngrok + chrome-devtools MCP, ausentes nesta sessão. A ADR §3 e os
critérios AC-04-c/AC-04-d preveem registrar essa parte como `qaPending` com a camada estática como
piso. O `adr-04.qa.json` documenta isso com evidência específica por AC e lista a pendência ao vivo de
forma honesta. Está dentro do contrato da ADR; o fechamento ao vivo é do QA no step seguinte — não
rebaixo o parecer por isso, conforme instrução de não subir dev server neste step.

</details>

<details>
<summary>Arquivos no escopo do bugfix (01758ae..7cfa028)</summary>

- `src/lib/phone.ts` — novo helper puro `toE164BR` (E.164-BR, retorna `null` se inválido).
- `src/lib/validations/scheduling.ts` — `customerSchema.phone` passa a usar `toE164BR` + erro pt-BR.
- `src/app/clientes/CustomerFormDialog.tsx` — copy da `FormDescription` avisando DDI 55 automático.
- `supabase/functions/whatsapp/evolution-adapter.ts` — `applyBrDdi` + `normalizePhoneForEvolution`
  agora aplicam DDI (cobre legados). **JSDoc do `applyBrDdi` a corrigir (issue 1).**
- `scripts/dev-functions.sh` + `package.json` — script `dev:functions` (ADR-03, já aprovada).
- `.agents/tasks/dev-pipeline/adr/adr-04-*.md`, `adr-04.qa.json`, `index.json` — artefatos do
  pipeline (não é código de aplicação).

Diff completo: `git diff 01758ae..7cfa028`.

</details>
