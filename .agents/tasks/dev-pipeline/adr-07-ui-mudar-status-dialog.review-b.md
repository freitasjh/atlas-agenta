# Revisor B — ADR-07: `MudarStatusDialog` (react-hook-form + zod) consumindo a mutation

Dialog de operação de `subscription_status` por empresa no painel do super admin. O super_admin
abre a ação numa linha/card, escolhe um status destino (só transições válidas aparecem) e um motivo
opcional (≤280), e a escrita vai pela Edge Function `admin-subscription` via
`useChangeSubscriptionStatus`. Sucesso fecha o dialog, dá toast pt-BR e invalida a lista (badge novo
sem reload); falha mantém o dialog aberto com a mensagem pt-BR em `role="alert"` sem tocar a lista.
O commit de fix endereça o ponto onde o parecer real precisava: recuperar o corpo não-2xx do
`functions.invoke` (que vive em `error.context`, não em `error.message`) para que o mapeador pt-BR
resolva 409/403/404/400/401 em vez de cair sempre no genérico.

Watch for: o gatilho/slot foi ligado em `EmpresasPage` + `EmpresasTable.renderAction`, não no
`EmpresaRow` como o texto da ADR diz (confirmed) — equivalente e arguably mais limpo, mas é um
desvio do "Arquivos afetados"; e a interação do fechar-enquanto-salva (Esc/overlay) não está travada
durante o `pending` (confirmed, baixo impacto).

**Verdict**: APPROVED

## High-level view

A fatia fica funcionalmente completa e a trava de segurança continua no lugar certo: a escrita de
`subscription_status` só existe via `functions.invoke("admin-subscription")`; não há nenhum
`.update()`/UPDATE de `tenants.subscription_status` no cliente (varredura em `src/` confirma) e
nenhuma referência a `service_role`/`SERVICE_ROLE` no bundle. O `tenantId` viaja como alvo no corpo,
o JWT do super_admin é a credencial, e o servidor (ADR-03) revalida papel e transição — a UI é
defesa de usabilidade, não a trava.

O contrato de fio bate ponta a ponta. O select oferece exatamente
`getAllowedSubscriptionTransitions(statusAtual)` da fonte única `subscription-status.ts`, que espelha
1:1 a `ALLOWED_TRANSITIONS` da Edge Function; o DTO de sucesso (`{ ok, tenant_id, old_status,
new_status }`) e o corpo de erro (`{ error }` + HTTP 401/403/404/409/400/500) conferem com
`changeStatusResponseSchema` e com o mapeador. O fix do `normalizeInvokeError` é o que torna o
feedback de erro correto na prática — sem ele todos os 4xx caíam no genérico porque o corpo não-2xx
não está em `error.message`.

A implementação divergiu do "Arquivos afetados" da ADR: em vez de plugar o botão dentro do
`EmpresaRow`, o dialog é injetado por `EmpresasPage` através do slot `renderAction` que a ADR-06 já
expôs em `EmpresasTable`/`EmpresaRow`. O comportamento final é o mesmo (full-width no card mobile via
`[&>*]:w-full`, compacto na tabela), e centralizar a injeção num único ponto é defensável — mas é um
desvio não anotado na ADR.

O erro tem dois canais (toast + `role="alert"`), pt-BR em todos os caminhos, sem vazar schema nem
PII. A a11y herda o Dialog shadcn (foco preso, Esc, `DialogTitle`) e os campos usam `FormLabel` via
contexto do `FormField`. Build, typecheck e a suíte (129 testes, incluindo os novos de
`normalizeInvokeError` e do `required_error` pt-BR) estão verdes.

<details>
<summary>Issues (4)</summary>

1. **Slot ligado fora do `EmpresaRow`** (confirmed, informativo) — a ADR lista `EmpresaRow.tsx` como
   arquivo afetado, mas a injeção ficou em `EmpresasPage` via `EmpresasTable renderAction`.
   Comportamento equivalente; apenas registrar o desvio no índice/PRD para não parecer AC-07 não
   cumprido.
2. **Fechar durante o `pending` não está travado** (confirmed, baixo) — "Cancelar" fica `disabled`
   ao salvar, mas Esc/clique no overlay ainda disparam `onOpenChange(false)` e fecham o dialog com a
   mutation em voo; o `onSuccess`/`toast` rodam sobre componente possivelmente desmontado. Considerar
   bloquear `onOpenChange` enquanto `isPending` para alinhar com o "Cancelar" desabilitado.
3. **Ramo "sem transições" é inalcançável** (confirmed, baixo) — todos os 5 status têm ≥1 destino
   (`cancelado → [ativo]`), então `hasTransitions` nunca é falso. O branch/estado vazio e o `disabled`
   do gatilho são defesa morta; manter como defesa é aceitável, só não é exercitável pelo QA.
4. **Resposta 2xx com corpo malformado vira "falha" genérica sem invalidar** (possible, herdado da
   ADR-05) — se o servidor efetivou a mudança mas devolveu um shape que o `changeStatusResponseSchema`
   recusa, o usuário vê erro genérico e a lista não é invalidada, divergindo do estado real. É
   consequência do zod-na-borda (intencional) e não é novo nesta ADR; registrar para QA conferir o DTO
   real de sucesso contra o schema.

</details>

<details>
<summary>Details</summary>

### Fronteira de escrita: único caminho é a Edge Function

A invariante central da fatia continua respeitada. A varredura por `subscription_status` em
`src/**/*.{ts,tsx}` mostra que toda escrita passa por `functions.invoke("admin-subscription", { body:
{ action: "set_status", tenantId, status, reason } })`; os demais usos no cliente são leitura
(`useAdminTenants`, `useCurrentUser`, guards) ou derivação de UI (contagem/filtro). Não há
`supabase.from("tenants").update(...)` de status em lugar nenhum da tela, e `SERVICE_ROLE`/
`service_role` não aparece em `src/` — coerente com AC-07.3/AC-07.4 e com R-05/R-11/R-12. A
confirmação final no bundle servido é tarefa do QA (DevTools), mas estruturalmente o segredo só vive
na Edge Function.

O comentário de topo do `MudarStatusDialog` deixa explícito o modelo: `tenantId` é alvo, não
credencial; o JWT do super_admin é a credencial validada no servidor. O `handleSetStatus` da Edge
Function deriva `role` de `profiles` pelo JWT (`resolveIdentity`), recusa não-super_admin com 403 e
revalida a transição com 409 — a UI esconder destinos inválidos é só usabilidade.

### Contrato de fio: select, DTO e mapa de erro batem com o servidor

O select é alimentado por `getAllowedSubscriptionTransitions`, que lê `ALLOWED_SUBSCRIPTION_TRANSITIONS`
em `subscription-status.ts`. Esse mapa é idêntico, par a par, ao `ALLOWED_TRANSITIONS` da Edge
Function (`trial/ativo/pendente/bloqueado/cancelado` com os mesmos destinos, sem no-op, sem voltar a
`trial`). Fonte única evita divergência entre o select e a trava do servidor.

O DTO de sucesso (`changeStatusResponseSchema`: `ok: true, tenant_id, old_status, new_status`) casa
com o `SetStatusResponse` retornado por `jsonResponse(body, 200)`. O corpo de erro do servidor é
sempre `{ error: string, ...extra }` com os códigos 401/403/404/409/400/500, exatamente o que o
`normalizeInvokeError` lê de `context.json()` + `context.status` e o que `mapSubscriptionError`
resolve. A tabela da ADR-04 (409 → "Transição de status não permitida.", etc.) está implementada.

### O fix do `normalizeInvokeError` é o que torna o erro correto na prática

```
functions.invoke ──erro──► FunctionsHttpError
                            ├─ message: "Edge Function returned a non-2xx status code"  (genérico)
                            └─ context: Response { status, json() → { error } }        (o que importa)
```

Antes do fix, o hook fazia `if (error) throw error` e o dialog mapeava a partir de `error.message` —
que nunca contém o código nem o texto pt-BR do corpo, então todo 4xx caía no genérico (o oposto de
CA-07, que pede o dialog aberto com a mensagem específica em 409). O `normalizeInvokeError` recupera
`status` + `{ error }` de `context`, embute ambos numa `message` e seta `.status`, e o
`mapSubscriptionError` resolve por `\b409\b`/keyword. Os testes novos exercitam o caminho real
(`{ context: { status, json() } }`) em vez dos shapes sintéticos antigos, incluindo o caso de
`json()` lançar (só o status já resolve) e o degradar-para-genérico sem `context`. É a prova
executável que faltava para CA-07 sem subir rede.

Observação menor de precedência: `mapSubscriptionError` checa 401 antes de 403 e 409 antes de 404/400.
Como `normalizeInvokeError` embute o código HTTP exato, a resolução é por `\b<code>\b` e não há
ambiguidade entre os 4xx conhecidos. Um 500/502 cai no genérico, como a ADR-04 manda.

### Estados e feedback: sucesso, falha e validação em pt-BR

Sucesso: `toast.success("Assinatura atualizada.")`, `setOpen(false)`, e a invalidação vem do
`onSuccess` da mutation (que só roda no caminho feliz). Falha: `catch` seta `submitError` com
`mapSubscriptionError`, o dialog continua aberto, o `<p role="alert">` mostra a mensagem e a lista
**não** é invalidada (o `onSuccess` não disparou) — R-07/CA-07 atendidos. O `required_error` pt-BR
("Selecione o status destino.") substitui o "Required" padrão do zod quando o super_admin submete sem
escolher destino, com teste cobrindo `status` ausente e `undefined`. O motivo tem `maxLength={280}` no
Textarea e o `.max(280)` no zod com mensagem pt-BR.

### Fechar o dialog durante o `pending`

O "Cancelar" fica `disabled` enquanto `isSaving`, mas o `Dialog` ainda fecha por Esc ou clique no
overlay (`onOpenChange` não é bloqueado durante `isPending`). Nesse caso a mutation segue em voo e o
`onSuccess`/`toast.success`/`setOpen(false)` executam sobre um dialog já desmontado. É benigno
(React apenas ignora o set de estado de um nó fora da árvore e o toast ainda aparece), mas é uma
inconsistência com a intenção de travar a saída durante o salvamento. Fácil de alinhar fazendo o
`onOpenChange` ignorar o fechamento quando `changeStatus.isPending`.

### A11y e responsivo (verificação de forma; o visual é do QA)

A estrutura dá o esperado: `DialogTitle`/`DialogDescription` para o leitor de tela, `FormLabel` em
status e motivo via contexto do `FormField` (o Radix Select recebe `aria-labelledby`/`id`), erro em
texto com `role="alert"` (não só toast), botões `type="button"`/`type="submit"` operáveis por
teclado, e o gatilho é um `<button>` real. No mobile a ação vira full-width pelo wrapper
`[&>*]:w-full` do `EmpresaCard` (ADR-06); na tabela fica compacta (`size="sm"`, célula alinhada à
direita). Foco preso, Esc e devolução de foco ao gatilho vêm do Dialog shadcn. A medição de contraste,
ordem de tab efetiva e console limpo nos dois temas/breakpoints ficam para o QA (AC-07.2), que é o
step seguinte — aqui não subo dev server.

### Contraprova executada

`npm run typecheck` (tsc -b) passa. `npm run build` passa (apenas o aviso pré-existente de chunk
>500kB, não relacionado a esta ADR). `npm run test` roda 129 testes em 15 arquivos, todos verdes,
incluindo `src/hooks/useAdminTenants.test.ts` (7, caminho real do `normalizeInvokeError`) e os novos
casos de `required_error` em `admin-subscription.test.ts`. Não há script de lint no `package.json`
(só `dev`, `build`, `typecheck`, `test`), então a contraprova de qualidade é typecheck+build+test.

</details>

<details>
<summary>Arquivos no escopo da ADR-07 (commits de4cd7d, 69cc037)</summary>

- `src/admin/empresas/MudarStatusDialog.tsx` (novo) — dialog da ação "Mudar status".
- `src/admin/empresas/EmpresasPage.tsx` — injeta `MudarStatusDialog` via `renderAction` da tabela.
- `src/hooks/useAdminTenants.ts` — `normalizeInvokeError` + `throw await normalizeInvokeError(error)`
  na mutation (recupera corpo/ status não-2xx).
- `src/hooks/useAdminTenants.test.ts` (novo) — prova o caminho real de erro do `functions.invoke`.
- `src/lib/subscription-errors.ts` — `readErrorText` passa a prefixar o `status` HTTP numérico.
- `src/lib/validations/admin-subscription.ts` — `required_error`/`invalid_type_error` pt-BR no enum de status.
- `src/lib/validations/admin-subscription.test.ts` — casos de status ausente/`undefined`.

Diff completo: `git show de4cd7d` e `git show 69cc037` em `feat/super-admin-empresas`.

</details>
