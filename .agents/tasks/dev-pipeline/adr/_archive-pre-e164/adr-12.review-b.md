# Review B — ADR-12: Endurecimento final (segredo/PII, mock intacto, confinamento, dívida OQ-01)

Revisor independente B. Modelo distinto do revisor A; não vi o parecer A. ADR-12 é a fatia de
**fechamento/verificação** da sequência ADR-09→12 (tirar o mock da Evolution e habilitar envio
real), não uma ADR de código novo: a decisão §4 exige que o diff de aplicação fique confinado a
`supabase/functions/whatsapp/evolution-adapter.ts` e as demais decisões são auditorias das
fronteiras invioláveis (segredo, PII, mock, travas negativas) mais o registro da dívida OQ-01.

**Watch for:** nada bloqueante. A dívida OQ-01 (`connection_status` otimista no fluxo real) é
real e **aceita por decisão de escopo** — está documentada na ADR e no brain, com a correção
apontada para a fase de reconciliação; não é um defeito a corrigir aqui. (confirmado)

**Verdict**: APPROVED

## Visão de alto nível

A codificação da ADR-12 não tocou código: as auditorias não apontaram ajuste necessário no
adapter, então o único arquivo de aplicação alterado em toda a fase (vs base `scaffold-inicial`)
é `evolution-adapter.ts`, o que satisfaz o confinamento R12/AC-12 e as travas negativas R14/AC-14.

A auditoria de segredo (R8/AC-08) passa: nem a API key nem a URL ngrok aparecem em arquivo
rastreado, no `src/` ou no bundle construído; `EVOLUTION_API_URL`/`EVOLUTION_API_KEY` só existem
como nome de env lido via `Deno.env` no servidor, sem prefixo `VITE_`; `supabase/functions/.env`
está git-ignored e não rastreado.

A auditoria de PII (R9/AC-09) passa: todos os `console.error` do adapter logam apenas um motivo
técnico curto (`timeout`/`network`), o status HTTP ou uma categoria — nunca `to` (telefone),
`text` (corpo) ou o corpo cru da Evolution (que carrega `token` por instância).

O mock (R10/AC-10) segue intacto e é o default: `createEvolutionAdapter()` cai em
`MockEvolutionAdapter` quando `EVOLUTION_MODE` não é `real`, com QR fake (PNG 1x1) e id
`mock-<uuid>`, zero rede.

A dívida OQ-01 está registrada na ADR e na nota de arquitetura do brain, com a correção endereçada
à fase de reconciliação (webhook `connection.update` / polling de `connectionState`).

<details>
<summary>Issues (0)</summary>

Nenhum issue acionável. Pendências restantes (R11 boot Deno, AV-01→AV-04 visual, teste manual de
envio §9) são do QA/usuário por decisão explícita (D-02), não do escopo codificável desta ADR.

</details>

<details>
<summary>Details</summary>

### Confinamento do diff (R12/AC-12) e travas negativas (R14/AC-14)

`git diff --name-only` contra a base `feat/scaffold-inicial-atlas-agenda` lista, entre os
arquivos de aplicação, **somente** `supabase/functions/whatsapp/evolution-adapter.ts`. `index.ts`,
`schemas.ts`, migrations e UI estão inalterados; a árvore de trabalho não tem nenhuma edição de
código pendente para a ADR-12, consistente com "sem código novo, só auditoria". (confirmado)

A trava "não tocar `index.ts`" é respeitada, o que é exatamente o que torna a dívida OQ-01 uma
limitação aceita em vez de um bug a corrigir aqui. Nenhum webhook de entrada, cron, agendador ou
régua foi introduzido — `git grep` por `webhook|cron|schedule|connection.update|setInterval` no
diretório da função só acha o comentário de `index.ts` afirmando a ausência
("Não há webhook de entrada nesta fase."). (confirmado)

### Segredo (R8/AC-08)

`git grep` pelo literal da API key (`odwmDRlkTz4aJ2ijTQOXeEGrdq8uQ9C1`) e pela URL ngrok
(`suction-crazy-volumes`) em arquivos rastreados: vazio. `grep` nos mesmos literais e em
`EVOLUTION_API_KEY` dentro de `dist/` após `npm run build`: vazio — o segredo não vaza para o
bundle do cliente. Não há `VITE_EVOLUTION*` em nenhum lugar do `src/`. O adapter (edge function
Deno) não é importado por nenhum arquivo de `src/`, então não entra no grafo do cliente.
`git check-ignore supabase/functions/.env` confirma o `.env` ignorado; as chaves presentes são
`EVOLUTION_MODE`, `EVOLUTION_API_URL`, `EVOLUTION_API_KEY` (nomes server-side, sem valor ecoado
aqui). (confirmado)

O cliente HTTP injeta a key só no header `apikey` e o helper `evolutionFetch` nunca loga corpo de
resposta — coerente com o comentário de que `fetchInstances` carregaria `token` por instância.
(confirmado)

### PII fora do log (R9/AC-09)

Os únicos `console.*` do adapter estão em `evolutionFetch` (reason `timeout`/`network`), em `pair`
(status de criação/conexão e "fora do contrato") e em `sendText` (status de envio e "fora do
contrato"). Nenhum interpola `params.to`, `params.text`, o QR ou o corpo cru da resposta. A
correlação fica por `provider_message_id`, como a ADR exige. (confirmado)

### Mock intacto e seleção por env (R10/AC-10)

`MockEvolutionAdapter.pair` devolve o QR fake data-URL (PNG 1x1) e `sendText` devolve
`mock-<uuid>`, ambos sem rede (só `simulatedLatency`). `createEvolutionAdapter()` lê
`EVOLUTION_MODE` com default `mock` e só instancia `RealEvolutionAdapter` quando o valor é
exatamente `real`. (confirmado)

### Dívida OQ-01 — `connection_status` otimista (AC-06)

Verifiquei o claim diretamente em `index.ts`: após `adapter.pair(instanceName)` devolver o QR, o
handler faz `update({ connection_status: "conectado", last_connected_at })` e responde
`connection_status: "conectado"` (linhas ~184-198). No mock o pareamento é instantâneo, então o
estado é correto; no fluxo real o pareamento é assíncrono (o QR ainda precisa ser escaneado), logo
o estado fica **otimista/incorreto** até existir reconciliação. A ADR-12 §5 e a nota de
arquitetura do brain (`whatsapp-evolution-real-adapter`, tag `divida-tecnica`/`adr-12`) registram
isso como limitação aceita, sem corrigir aqui (trava: não tocar `index.ts`), apontando a correção
para webhook `connection.update` ou polling de `connectionState` na fase seguinte. O registro
exigido por AC-06 existe. (confirmado)

### Contraprova de build/qualidade

Scripts disponíveis no `package.json`: `build` (`tsc -b && vite build`) e `typecheck` (`tsc -b`).
Não há lint nem suíte de testes no projeto. `npm run build` conclui com sucesso (built in ~5.7s;
único aviso é o de tamanho de chunk >500 kB, pré-existente e não relacionado a esta ADR).
`npm run typecheck` passa limpo. A UI está byte-a-byte inalterada, então o build serve como
não-regressão do frontend. Removi o `dist/` gerado pela verificação para não deixar artefato.
(confirmado)

O código Deno da edge function (`evolution-adapter.ts`, `index.ts`) não é coberto por `tsc -b`
(está fora do `tsconfig` do app, importa `npm:`/`Deno`). O boot/typecheck Deno real
(`supabase functions serve whatsapp --env-file ...`) e os checks visuais AV-01→AV-04 ficam para o
QA/usuário — consistente com a ADR §6/§7 e com a decisão D-02 de que o teste de envio real é do
usuário. Não subo dev server nem disparo a terceiro aqui, conforme instruído. (confirmado)

</details>

<details>
<summary>Mapa de arquivos</summary>

- `supabase/functions/whatsapp/evolution-adapter.ts` — único arquivo de aplicação da fase; na
  ADR-12 nenhuma edição foi necessária (auditoria passou sem apontar ajuste). Contém porta
  `EvolutionAdapter`, infra HTTP/zod (ADR-09), `pair`/`sendText` reais (ADR-10/11), mock intacto.
- (referência) `supabase/functions/whatsapp/index.ts` — **não alterado**; fonte do claim OQ-01
  (`connection_status = 'conectado'` logo após o QR). Inspecionado, não modificado.

Diff completo: `git diff feat/scaffold-inicial-atlas-agenda -- supabase/functions/whatsapp/evolution-adapter.ts`.

</details>
