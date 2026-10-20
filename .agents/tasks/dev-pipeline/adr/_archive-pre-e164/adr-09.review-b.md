# Parecer do Revisor B — ADR-09 (Fundação HTTP: cliente, env, schemas zod, normalização de número)

Infra compartilhada da trilha real da Evolution adicionada ao `evolution-adapter.ts`: resolução de credenciais do env, cliente HTTP com `apikey` + `AbortController`/timeout, schemas zod das respostas v2.3.7 e normalização determinística de E.164. Nenhum desses blocos é fiado em `pair`/`sendText` ainda — ambos continuam lançando "Integração real da Evolution não implementada nesta fase.", o `MockEvolutionAdapter` segue intacto e `createEvolutionAdapter()` continua selecionando por `EVOLUTION_MODE` (default `mock`). O diff do commit `bda71cd` fica confinado ao único arquivo exigido.

Watch for: a leitura do corpo da resposta em `evolutionFetch` roda **fora** da proteção do `AbortController` (timeout já foi limpo no `finally`), então um body que pendura não é cortado pelo timeout (possible — R13 parcialmente coberto); a união `connectResponseSchema` é correta mas depende de ordem e da ausência de `base64` no shape de estado (confirmed, sem issue).

**Verdict**: APPROVED

## Visão de alto nível

O desenho respeita a trava central da ADR: infra antes de feature, sem acionar rede. `pair`/`sendText` do adapter real permanecem stub, o boot não muda de comportamento e o mock segue como único adapter que roda. A mudança é puramente aditiva (novos exports de helpers/schemas) mais a renomeação cosmética dos campos do construtor de `RealEvolutionAdapter` — nada disso cruza a fronteira de fio nem toca `index.ts`/`schemas.ts`/migrations/UI, então AC-12 está satisfeito.

A postura de segredo está correta: a API key só é lida de `Deno.env` dentro de `createEvolutionAdapter()`, nunca aparece em literal no código nem no diff, nunca com prefixo `VITE_`, e `supabase/functions/.env` continua git-ignored. `evolutionFetch` passa a key pelo header `apikey` e, em erro, loga apenas um motivo técnico curto (`timeout`/`network`) — nunca o corpo da resposta, que pode carregar `token` por instância (RNF-RE-02). A validação zod cobre o contrato v2.3.7 descrito na análise §5, tratando toda resposta como dado não confiável.

O timeout via `AbortController` cobre a fase de `fetch` (ngrok que pendura → RNF-RE-06/R13), mas não a leitura do corpo, que acontece após o `clearTimeout`. É uma lacuna estreita e não bloqueia esta ADR de infra, mas vale registrar como dívida para a ADR-10/11, onde essas chamadas passam a rodar de fato.

As fronteiras multi-tenant/RLS/RBAC não são tocadas: o adapter não resolve tenant, não aceita `tenant_id`, não consulta banco. Idempotência e LGPD vivem no `index.ts`, inalterado. Nada a sinalizar nesses eixos nesta ADR.

<details>
<summary>Issues (3)</summary>

1. **Timeout não cobre a leitura do corpo** (possible) — o `clearTimeout` no `finally` roda antes de `response.text()`; um corpo que pendura (ngrok) não é abortado. Para ADR-09 (infra, sem chamada real) é inócuo, mas as ADR-10/11 devem envolver a leitura do corpo no mesmo deadline (ex.: `signal` compartilhado ou segundo timeout) para cumprir R13 de ponta a ponta. Registrar como dívida.
2. **`createInstanceSchema` muito tolerante** (likely) — `instance`, `hash` e os campos internos são todos `optional`, então um objeto vazio `{}` valida. Isso é intencional (ADR delega a detecção de "já existe" ao status HTTP na ADR-10), mas significa que o schema não garante nada sobre o sucesso da criação. Documentar na ADR-10 que a decisão criar-vs-conectar vem do status, não do shape, para o schema não dar falsa sensação de validação.
3. **Contrato acoplado à versão v2.3.7** (confirmed, aceito) — os schemas refletem o servidor atual; `sendText` usa `text` direto (não `textMessage.text`). Já há comentário no topo do arquivo pedindo reconferência se o servidor for atualizado. Sem ação nesta ADR; é a dívida de contrato já anotada.

</details>

<details>
<summary>Details</summary>

### Aderência à ADR e confinamento do diff (AC-12, R12)

`git show bda71cd --name-only` lista exclusivamente `supabase/functions/whatsapp/evolution-adapter.ts` (221 inserções, 10 remoções). `schemas.ts`, `index.ts`, migrations e UI não aparecem no commit. A renomeação de `_apiUrl`/`_apiKey` → `apiUrl`/`apiKey` no construtor de `RealEvolutionAdapter` é interna à classe (campos `private readonly`); `index.ts` só consome `createEvolutionAdapter()`, cuja assinatura não muda. Os novos símbolos exportados (`resolveEvolutionCredentials`, `evolutionFetch`, schemas, `normalizePhoneForEvolution`, tipos) são aditivos e não colidem com nada importado em `index.ts`.

O comportamento observável está intacto conforme a ADR exige: `pair`/`sendText` do `RealEvolutionAdapter` continuam lançando "Integração real da Evolution não implementada nesta fase." (linhas 285/289). O helper `credentials()` existe mas não é acionado pelo stub — fica pronto para as ADR-10/11. Isso satisfaz a condição "function sobe sem erro de boot/typecheck e o mock segue intacto" sem antecipar comportamento das próximas ADRs.

### Segredo e PII (AC-08, RNF-RE-01/02/03)

`grep` pela API key literal (`odwmDRlkTz4aJ2ijTQOXeEGrdq8uQ9C1`) e pela URL ngrok no código-fonte (`src` + `supabase/functions`) retorna vazio. Nenhum `VITE_` ligado a Evolution. `git check-ignore supabase/functions/.env` confirma o ignore. A key só é lida em `createEvolutionAdapter()` via `Deno.env.get("EVOLUTION_API_KEY")` e viaja apenas no header `apikey` dentro de `evolutionFetch`.

O log de erro de rede (`console.error("evolution: falha de comunicação (${reason})")`) usa só `timeout`/`network`, nunca o corpo nem a key. O parser de corpo descarta o conteúdo em erro (`body = null`) sem logar. Como `pair`/`sendText` ainda são stub, não há caminho que passe `to`/`text` por `evolutionFetch` nesta ADR — a checagem de PII em claro (RNF-RE-03/AC-09) recai efetivamente sobre a ADR-11; aqui não há regressão.

### Schemas zod e o contrato v2.3.7 (R6/AC-06)

Os schemas batem com a análise §5: `connectionStateSchema` (`instance.state` em `open|connecting|close`), `connectQrSchema` (`base64` obrigatório, demais opcionais), a união `connectResponseSchema = z.union([connectQrSchema, connectStateSchema])` e `sendTextResponseSchema` extraindo `key.id`. Ponto de atenção na ordem da união (QR primeiro): o shape de estado (`{instance:{...}}`) não tem `base64`, então nunca é capturado por engano pelo ramo de QR; e um payload de QR não tem `instance`, então não casa com o ramo de estado. A desambiguação depende dessa ausência mútua de campos — se a Evolution passar a incluir `base64` junto do `instance`, a união resolveria para o ramo errado. Hoje não ocorre; vale uma nota para a ADR-10.

Para `createInstanceSchema` (todos os campos `optional`, valida `{}`), ver Issue 2.

### Cliente HTTP e timeout (R13/AC-13, RNF-RE-06)

`evolutionFetch` monta `apikey` em toda chamada, adiciona `Content-Type: application/json` só no POST, compõe a URL sobre a base já normalizada (sem barra dupla, graças ao `replace(/\/+$/,"")` em `resolveEvolutionCredentials`) e traduz abort/erro de rede em `"Falha de comunicação com o servidor de WhatsApp."`. O `AbortController` com `EVOLUTION_TIMEOUT_MS = 15_000` cobre a fase de `fetch`.

Lacuna estreita: `clearTimeout(timeout)` roda no `finally` do bloco de `fetch`, antes de `await response.text()`. Se o servidor responder os headers mas pendurar no corpo, a leitura não é abortada. Para esta ADR (nenhuma chamada real roda) é inócuo; para ADR-10/11, recomendo compartilhar o deadline com a leitura do corpo para fechar R13 de ponta a ponta. Registrado como dívida, não como bloqueio.

### Normalização de número (AC desta ADR, item 3)

`normalizePhoneForEvolution(to)` faz `to.replace(/\D+/g, "")` — puro, determinístico, sem rede. `+5511999999999` → `5511999999999` conforme o critério. Remover todo não-dígito (não só o `+`) é robusto contra espaços/traços remanescentes e não altera o contrato de fio. Testável isolado, como a ADR pede.

### Contraprova

- `npm run build` (`tsc -b && vite build`): **passou** (`✓ built in 7.43s`). O adapter é código Deno e não entra no build do frontend, mas a build confirma que nenhuma mudança vazou para o bundle.
- Não há scripts de lint/test no `package.json` (só `build`/`typecheck`).
- `deno check` **não foi executado**: Deno não está instalado no ambiente (`deno NOT installed`). O typecheck Deno do AC-11 não pôde ser confirmado por esta estação; a revisão estática do arquivo (TS estrito, sem `any`, retornos de `fetch`/zod tipados) não encontrou violação. `supabase functions serve` não foi executado deliberadamente — subir a function é decisão do QA (step seguinte) e esta estação não sobe dev server.

</details>

<details>
<summary>Arquivos no escopo da ADR-09</summary>

- `supabase/functions/whatsapp/evolution-adapter.ts` — único arquivo do commit `bda71cd`. Adicionados: `resolveEvolutionCredentials`, `evolutionFetch` + tipos auxiliares, schemas zod (`connectionStateSchema`, `connectQrSchema`, `connectResponseSchema`, `createInstanceSchema`, `sendTextResponseSchema`, `evolutionStateSchema`), `normalizePhoneForEvolution`, import de `zod`, método `credentials()` no `RealEvolutionAdapter` e renomeação dos campos do construtor. Stub de `pair`/`sendText` e `MockEvolutionAdapter` inalterados em comportamento.

Diff completo: `git show bda71cd -- supabase/functions/whatsapp/evolution-adapter.ts`.

</details>
