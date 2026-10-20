# ADR-17 — Parecer do Revisor B

Porta `EvolutionAdapter.getConnectionState` + contrato da action `check` (schemas.ts): infra/contrato puro, sem mudança de comportamento observável.

A mudança adiciona (1) a assinatura `getConnectionState(instanceName): Promise<ConnectionStateResult>` na interface `EvolutionAdapter`, implementada no mock (`{ state: "open" }`) e no real (`GET /instance/connectionState/{inst}` → valida com `connectionStateSchema` → devolve só `state`), e (2) o contrato de fio da action `check` em `schemas.ts` (`checkInputSchema`, inclusão na `requestSchema`, `checkResponseSchema` + tipos). Nenhum handler invoca a porta e nenhuma rota roteia `action: "check"` ainda — isso é ADR-18. O escopo revisado é o commit `8616ebf` (dois arquivos, +76 linhas, nenhuma remoção).

Watch for: a contraprova de **boot da Edge Function (CA-17.1)** não pôde ser executada neste ambiente — Deno não está instalado e `supabase functions serve` exigiria Docker + dev server (vedado a este step). Isso é uma lacuna de verificação, não um defeito observado (confirmed); a verificação estática do grafo de módulos não acusou símbolo faltante.

**Verdict**: APPROVED

## High-level view

O real reusa `credentials()`, `evolutionFetch` (timeout/rede já tratados, ADR-09) e `connectionStateSchema` (dado externo validado antes de ler `instance.state`), e falha com `Error` pt-BR sem vazar corpo cru nem API key. Nada de rede/banco/tenant na porta, como manda a RNF-RE-04.

O contrato da action `check` segue a forma de `pair` (corpo só `action`), entra na `discriminatedUnion` e reusa `connectionStatusSchema`, de modo que nenhum `tenant_id` de cliente é aceito pelo schema. A escolha do nome `check` (em vez de `status`) evita colisão com `connection_status`/`subscription_status` do domínio.

Fronteiras: sem migration, sem dependência nova, grep de `VITE_EVOLUTION` em `supabase/functions/**` vazio, mock fecha a demo com `open` (RF-QR-05). Multi-tenant/RLS/RBAC não são tocados nesta unidade (a reconciliação com `whatsapp_instances` sob service role é ADR-18) — correto para uma ADR de contrato puro.

A contraprova do frontend (`tsc -b` + `vite build`) passou limpa; o warning de chunk > 500 kB é pré-existente e não tem relação com Edge Functions Deno (não entram no bundle Vite).

<details>
<summary>Issues (2)</summary>

1. **Boot da Edge Function não verificado (CA-17.1)** — Deno ausente e `supabase functions serve` exigiria Docker/dev server (vedado aqui); o boot real do grafo de módulos não foi exercido. Deixar para o QA (step seguinte) confirmar `supabase functions serve whatsapp` sobe sem erro. Não-bloqueante: verificação estática + build do frontend passaram. (confirmed, lacuna de verificação)
2. **`last_connected_at: z.string()` sem validação de datetime** — `checkResponseSchema` aceita qualquer string em `last_connected_at`. Espelha exatamente `pairResponseSchema` (consistência intencional) e é saída do próprio servidor (não dado externo não confiável), então é aceitável; se um dia se quiser rigor, `z.string().datetime()`. Não-bloqueante. (possible, melhoria opcional)

</details>

<details>
<summary>Details</summary>

### Aderência à ADR-17 e aos critérios de aceite

Os quatro pontos da Decisão estão implementados exatamente como descritos. `ConnectionStateResult` existe como tipo dedicado ("a porta é dona do formato — não vaza o corpo cru"), a interface declara `getConnectionState`, e **ambos** os adapters a implementam (CA-17.2 satisfeito — o módulo tipa sem `any` e sem membro faltante; TypeScript recusaria uma classe `implements EvolutionAdapter` sem o método). `EvolutionState` é derivado de `evolutionStateSchema` via `connectionStateSchema`, sem `any`.

No `schemas.ts`, `checkInputSchema = z.object({ action: z.literal("check") })` entra na `discriminatedUnion("action", [...])` e `checkResponseSchema`/`CheckResponse` são exportados reusando `connectionStatusSchema`. CA-17.3: a union passa a aceitar `{ action: "check" }`; um corpo com campo de estado forjado é simplesmente ignorado (nenhuma variante declara `.passthrough()`), que é o comportamento esperado. CA-17.4: grep de `VITE_EVOLUTION` em `supabase/functions/**` retornou vazio e `MockEvolutionAdapter.getConnectionState` retorna `{ state: "open" }`.

A ADR é honesta sobre o "código correto, porém inerte": `getConnectionState` e `checkInputSchema` existem mas ninguém os invoca até ADR-18. Confirmei lendo o arquivo inteiro — nenhum caller novo foi adicionado, nenhum caminho de execução mudou. É a menor unidade revisável como anunciado.

### Fronteiras de segurança (multi-tenant / segredos / dado externo)

O `getConnectionState` real respeita as invariantes da análise de dados:

- **RNF-QR-03 (segredos só no servidor):** credenciais vêm de `this.credentials()` → `resolveEvolutionCredentials` (lê `Deno.env` via `createEvolutionAdapter`), e a API key viaja só no header `apikey` dentro de `evolutionFetch`. Os dois `console.error` do novo método logam apenas um status numérico e uma string fixa — nunca o corpo cru nem a key. Confirmado linha a linha.
- **RNF-QR-06 / R6 (dado externo não confiável):** `connectionStateSchema.safeParse(stateRes.body)` roda antes de qualquer leitura de `instance.state`; fora do contrato → `Error` pt-BR controlado. O `!ok` é tratado antes do parse. Mesmo padrão já validado em `pair`/`sendText`.
- **RNF-RE-04 (porta pura):** o método não toca banco, não resolve tenant, não conhece papéis. A reconciliação com `whatsapp_instances` + checagem de `role=admin` é responsabilidade declarada da ADR-18. Correto não antecipar isso aqui.
- **Sem `tenant_id` no contrato:** `checkInputSchema` aceita só `action`. O `instanceName` chega por parâmetro de função (será derivado do JWT pelo `index.ts` em ADR-18), não pelo corpo. `encodeURIComponent(instanceName)` evita injeção de path na URL.

Não há RLS/RBAC/idempotência/LGPD exercidos nesta unidade — é contrato/infra. A ausência deles aqui é esperada e não é lacuna: o enforcement vive no `index.ts` (ADR-18), fora do escopo deste diff.

### Design doc React

Não se aplica: o diff é 100% Edge Function Deno (`supabase/functions/whatsapp/*.ts`). O contrato `CheckResponse` será consumido e validado pela UI em ADR-19; nada de frontend mudou neste commit.

### Contraprova

`npm run build` (`tsc -b && vite build`) concluiu com sucesso. O build do frontend não compila o grafo Deno das Edge Functions, então CA-17.1 (boot via `supabase functions serve`) permanece a cargo do QA. `deno check` não foi possível (Deno não instalado). A verificação estática — leitura integral de `evolution-adapter.ts` e `schemas.ts` — confirma que todos os símbolos referenciados pelo código novo (`EvolutionState`, `connectionStateSchema`, `evolutionFetch`, `credentials()`, `ConnectionStateResult`) existem e estão tipados.

</details>

<details>
<summary>Arquivos no escopo</summary>

- `supabase/functions/whatsapp/evolution-adapter.ts` — nova interface `ConnectionStateResult`, assinatura `getConnectionState` na porta `EvolutionAdapter`, impl no `MockEvolutionAdapter` (`open`) e no `RealEvolutionAdapter` (GET connectionState + validação zod).
- `supabase/functions/whatsapp/schemas.ts` — `checkInputSchema`, inclusão na `requestSchema`, `checkResponseSchema` + tipos `CheckInput`/`CheckResponse`.

Diff completo: `git show 8616ebf`.

</details>
