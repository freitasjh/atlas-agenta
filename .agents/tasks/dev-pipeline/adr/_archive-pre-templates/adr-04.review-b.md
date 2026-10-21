# Revisor B — ADR-04: Hooks de dados (exceções + vigência/passo)

Revisão independente (modelo B) da ADR corrente `adr-04` do pipeline de agenda. Escopo revisado: commit `47bc315` (`feat: hooks de dados...`) mais a parte do commit `ed4f273` que estende o `select` de `professionals` com as colunas de ADR-01. Arquivos tocados: `src/hooks/useProfessionals.ts` (editado) e `src/hooks/useScheduleOverrides.ts` (novo).

A ADR entrega exatamente o que prometeu: dois hooks de leitura/escrita sob TanStack Query, shape validado por zod, zero `tenant_id` no corpo de qualquer mutation, e o seletor fino de vigência derivado de `useProfessionals` (sem request duplicado). As fronteiras multi-tenant/RLS/RBAC são respeitadas — o isolamento continua sendo do banco, e os hooks não tentam replicá-lo. A tradução pt-BR do `23505` ("exceção duplicada") está implementada e só nessa mutation. Build e typecheck passam limpos.

Watch for: a chave de query de `useScheduleOverrides` colapsa `professionalId === null` em `"none"` enquanto a query fica `enabled: false` — comportamento correto mas que merece um olhar para não cachear lixo (confirmed, não-bloqueante); e a assimetria de que o upsert embrulha o erro em `new Error(mapOverrideError)` enquanto o delete usa `mapSchedulingError` cru sem embrulhar em `Error` (confirmed, menor).

**Verdict**: APPROVED

## High-level view

A camada de dados nova segue o padrão de `useWorkingHours`/`useProfessionals` já consolidado: `useQuery` com shape validado por `z.object` local, `useMutation` sem `tenant_id`, invalidação por `queryKey`. Nenhuma regra de RLS/RBAC é reimplementada no cliente — `professional_id` vai no corpo do insert (não `tenant_id`), e a FK composta + RLS do banco garantem o isolamento.

O `select` genérico adicionado a `useProfessionals` (`useProfessionals<TData>`) é a mudança de maior raio: ela altera a assinatura de um hook consumido em várias telas de catálogo. A não-regressão se sustenta porque o default `TData = Professional[]` e o `select` opcional preservam o retorno antigo — confirmado pelo typecheck/build limpos. `useScheduleValidity` reusa esse `select` para derivar a vigência do profissional sem nova query, exatamente como a ADR recomenda.

A coerência zod↔banco foi herdada de ADR-03 (`scheduleOverrideSchema` reusa `refineScheduleWindow`, que espelha o CHECK `schedule_overrides_window`); o `toRow` do hook traduz o input de tela nas colunas e zera a janela quando `is_closed=true`, batendo com o CHECK. A única tradução de erro específica (`23505` → "Já existe uma exceção para esta data.") está no caminho de upsert; o delete cai no mapeamento genérico, o que é adequado porque delete não viola o `unique`.

<details>
<summary>Issues (3)</summary>

1. **Embrulho de erro assimétrico** — `useUpsertScheduleOverride` faz `throw new Error(mapOverrideError(error))` (mensagem pt-BR pronta em `error.message`), mas `useDeleteScheduleOverride` faz `throw new Error(mapSchedulingError(error))` com a genérica e `useUpdateScheduleValidity`/`useProfessionals` fazem `throw error` cru (PostgrestError, `error.message` em inglês). As telas de ADR-07 precisam saber que para overrides `error.message` já é pt-BR, mas para vigência não. Documentar/uniformizar para a UI não exibir mensagem técnica em inglês. (confirmed, menor)
2. **`useScheduleValidity` conflui loading e not-found em `null`** — o retorno `null` cobre "lista ainda carregando", "profissionalId nulo" e "profissional inexistente/de outro tenant". A tela de ADR-07 não consegue distinguir "carregando" de "não achei" só pelo `data`; precisará olhar `isLoading`/`isPending` do hook. Está documentado no comentário, mas vale deixar explícito no contrato para ADR-07 não renderizar vazio durante o fetch. (confirmed, menor)
3. **Chave de query com placeholder `"none"`** — `useScheduleOverrides(null)` gera `queryKey: ["schedule-overrides", "none"]` com `enabled: false`. Não executa, então não cacheia, mas o placeholder vira uma entrada de cache sintética se algum dia a query for habilitada manualmente. Padrão idêntico ao `useWorkingHours` existente — consistente, mas confirmo que é intencional e inócuo hoje. (confirmed, não-bloqueante)

</details>

<details>
<summary>Details</summary>

### Fronteira multi-tenant / RLS / RBAC

`useUpdateScheduleValidity` atualiza **apenas** as três colunas de agenda (`schedule_start_date`/`schedule_end_date`/`slot_step_minutes`), sem tocar `name`/`active`/`profile_id` — não amplia a superfície de escrita de `professionals` além do que o RBAC admin-only pretende. A leitura de `useScheduleOverrides` filtra por `professional_id` e deixa o recorte de tenant para o RLS. A trava de RBAC (admin / próprio professional / receptionist só-leitura) fica no banco; os hooks não tentam replicá-la — a defesa-em-profundidade da UI (esconder botões) é escopo de ADR-07. Nada aqui abre caminho cross-tenant nem toca `charges`.

### Coerência zod ↔ CHECK do banco

`toRow` mapeia o `ScheduleOverrideInput` para as colunas: quando `isClosed=true`, zera `start_time`/`end_time`/`break_start`/`break_end` (satisfazendo o ramo `is_closed=true and ... is null` do CHECK `schedule_overrides_window`); quando aberto, grava a janela e aplica break só se `hasBreak`. O caminho de **update** reusa o mesmo `toRow` com todos os campos, então um override que muda de fechado→aberto (ou vice-versa) manda o conjunto completo e não deixa resíduo de janela — importante porque um update parcial que só trocasse `is_closed` violaria o CHECK. `reason` vazio/whitespace vira `null` (`input.reason?.trim() ? ... : null`), batendo com o CHECK `char_length(reason) between 1 and 200` que rejeita string vazia. A validação de janela (início<fim, break dentro da janela) é herdada de ADR-03 via `refineScheduleWindow`, uma só fonte de verdade com a grade — sem divergência.

### Tradução de erro pt-BR

`mapOverrideError` lê `error.code` defensivamente (trata erro como dado não confiável, sem assumir shape) e só traduz `23505`; o resto delega a `mapSchedulingError`. Aplicada só no upsert — único caminho que pode violar o `unique (tenant_id, professional_id, override_date)`; delete não dispara 23505. A assimetria (issue 1): o upsert embrulha em `new Error(...)` com `message` pt-BR, enquanto `useUpdateScheduleValidity` propaga o PostgrestError cru (`message` em inglês); as telas de ADR-07 precisam tratar os dois contratos de erro.

### Select genérico em `useProfessionals` — não-regressão (AC-20)

A assinatura virou `useProfessionals<TData = Professional[]>(options?: { activeOnly?; select? })` com `useQuery<Professional[], Error, TData>`. O default de `TData` e o `select` opcional preservam o retorno `Professional[]` para os chamadores existentes. O typecheck (`tsc -b`) e o build passam limpos — contraprova de AC-20 ao nível de compilação; a verificação de runtime dos consumidores é QA ao vivo (step seguinte), fora do meu escopo. `useScheduleValidity` passa `select` sem `activeOnly`, caindo no cache `{activeOnly:false}` (lista completa) — correto para achar um profissional que pode estar inativo editando a própria vigência.

### Contraprova estática

```
npm run typecheck  → tsc -b, sem erros
npm run build      → tsc -b && vite build, ✓ built (sem erros de tipo)
```

O aviso de chunk > 500 kB no build é pré-existente (bundle único do app, não introduzido por esta ADR — os arquivos tocados são só dois hooks). Não há script de lint no `package.json`; os gates de qualidade existentes são `typecheck` e `build`, ambos verdes. Não subi dev server (decisão do QA).

</details>

<details>
<summary>File map</summary>

- `src/hooks/useScheduleOverrides.ts` (novo) — `useScheduleOverrides` (query por profissional, shape zod), `useUpsertScheduleOverride` (insert/update sem `tenant_id`, tradução `23505`→pt-BR), `useDeleteScheduleOverride`, helpers `toRow`/`mapOverrideError`.
- `src/hooks/useProfessionals.ts` (editado) — `select` genérico plumbado; `useScheduleValidity` (seletor fino derivado, sem request duplicado); `useUpdateScheduleValidity` (atualiza só as 3 colunas de agenda). Colunas de vigência/passo no `select` (parte de ADR-03, commit `ed4f273`).

Diff completo: `git show 47bc315` (+ `git show ed4f273` para o select).

</details>
