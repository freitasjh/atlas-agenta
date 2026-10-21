# Review B — ADR-07: Vigência e exceções na tela de horários (`HorariosPage`)

Revisor independente B. ADR corrente: **adr-07** (status `pending`). Diff revisado: commit `a45da38`
(`feat: vigência e exceções por data na tela de horários (ADR-07)`), 5 arquivos, +878/-1.

A ADR adiciona duas seções abaixo da grade semanal em `/app/config/profissionais/:id/horarios`:
**vigência + passo-base** (admin-only) e **exceções por data** (folga/horário atípico, RBAC espelhando a
grade). Tudo frontend, reusando hooks de ADR-04, schemas de ADR-03 e o padrão de RBAC já em
`HorariosPage`. O escopo do diff bate exatamente com os 5 arquivos declarados na ADR — nenhuma mudança
fora de fronteira (nada em `/admin`, migrations, Edge Functions, roteamento ou guards).

Watch for: nada bloqueante. Dois pontos menores de UX/validação (confirmed) que não impedem a entrega.
`tsc -b`, `vite build` e `vitest` (16/16) passam limpos.

**Verdict**: APPROVED

## High-level view

A aderência à ADR é integral: componentes nos caminhos declarados, `HorariosPage` montando as seções
abaixo do `WeekScheduleForm` sem tocar o comportamento da grade (AC-20 preservado), e dependências
(ADR-03/04) resolvidas corretamente. O gerador de slots não é tocado aqui — esta ADR só alimenta os
dados que o gerador de ADR-05 consome.

As fronteiras de segurança estão respeitadas por construção. Nenhuma escrita envia `tenant_id` do
cliente (o RLS deriva do JWT); `useUpdateScheduleValidity` toca **apenas** as três colunas de schedule
em `professionals`, sem ampliar a superfície para `profile_id`/`active`; o erro de unicidade
(`23505`) vira a mensagem pt-BR especificada. Não há segredo, webhook, PII nova nem dado financeiro
nesta tela — as fronteiras de idempotência/LGPD não se aplicam, como o PRD §4 já previa.

O RBAC da UI é defesa em profundidade coerente com PRD §5: vigência é `readOnly={!isAdmin}`
(admin-only no MVP), exceções espelham a regra da grade (`canEditAnySchedule || (canEditOwnSchedule &&
isOwnSchedule)`), e a `OverrideFormDialog` nem é montada em leitura. A trava real continua sendo o RLS
de ADR-01/02.

O design doc de frontend é seguido: react-hook-form + zod, mensagens pt-BR, reuso de `refineScheduleWindow`
para a janela atípica (mesma validação da grade), formatação de data sem passar por `Date`/UTC (evita o
deslocamento de um dia), estados de loading/erro/vazio no padrão das telas existentes, e os
`aria-label`/`FormLabel` esperados.

<details>
<summary>Issues (2)</summary>

1. **Vigência: "sem data de término" não valida fim preenchido** — ao desligar o switch (quer data de
   fim) e deixar o campo vazio, o form salva `schedule_end_date = null` silenciosamente em vez de pedir a
   data. Não é bug de dados (null = sem fim é válido), mas a intenção do usuário é ignorada sem feedback.
   Opcional: exigir `scheduleEndDate` quando `hasEndDate` é true. (confirmed, menor)
2. **`slot_step_minutes` fora de [5,240] só barra no submit** — o input usa `min/max/step` HTML mas aceita
   digitação livre; a mensagem zod aparece ao salvar. Comportamento aceitável e coberto pelo CHECK do
   banco (AC-08); apenas registrar que a borda é validada no submit, não ao digitar. (confirmed, menor)

</details>

<details>
<summary>Details</summary>

### Aderência à ADR e ao escopo

Os cinco arquivos previstos existem nos caminhos exatos: `ScheduleValidityForm.tsx`,
`ScheduleOverridesSection.tsx`, `OverrideFormDialog.tsx`, `OverrideItem.tsx` (novos) e `HorariosPage.tsx`
(editado). O diff não encosta em mais nada — nenhuma mudança oportunista na grade, no roteamento ou nos
guards de `/app`, como a ADR exige ("Nenhuma mudança na grade semanal, no roteamento ou nos guards").

`HorariosPage` monta as duas seções **abaixo** do `WeekScheduleForm` dentro de `Card`s próprios, passando
`professionalId`, `readOnly={!canEdit}` para exceções e `readOnly={!isAdmin}` para vigência. O
`WeekScheduleForm` é invocado igual ao anterior (só os `Card`s novos foram acrescentados), então AC-20
(grade continua salvando igual) é preservado por construção. A migração de `isAdmin` ao hook
`usePermissions` é o que habilita o `readOnly` admin-only da vigência — e `usePermissions` expõe `isAdmin`,
confirmado.

### Fronteiras multi-tenant / RLS / segredos

Nenhuma das mutations envia `tenant_id`: `useUpsertScheduleOverride` manda `professional_id` no insert e o
RLS/FK composta garantem o tenant; `useDeleteScheduleOverride` filtra só por `id` (o RLS isola);
`useUpdateScheduleValidity` filtra por `id` e atualiza só `schedule_start_date`/`schedule_end_date`/
`slot_step_minutes`. Essa última é a fronteira sensível que o PRD §9.3 destacou — "não ampliar a
superfície de escrita em `professionals`, que carrega `profile_id`/`active`" — e o hook respeita: o
`.update({...})` lista exatamente as três colunas de schedule, nada mais. O `.select(...)` até lê
`profile_id`/`active` de volta para revalidar o row com `professionalRowSchema`, mas isso é leitura, não
escrita. Correto.

Nenhum segredo no cliente, nenhuma chamada a service role, nenhum uso de Edge Function. Coerente com o
PRD §4 (esta demanda não envolve service role).

### RBAC (defesa em profundidade)

A regra de `HorariosPage` é `canEdit = canEditAnySchedule || (canEditOwnSchedule && isOwnSchedule)`, com
`isOwnSchedule` derivado de `professional.profile_id === profile.id`. Mapeando para PRD §5:

- **admin**: `canEditAnySchedule=true` → edita vigência (admin-only via `isAdmin`) e exceções de qualquer
  profissional. ✓
- **professional na própria grade**: `canEditOwnSchedule && isOwnSchedule` → edita exceções; vigência em
  leitura (`!isAdmin`). ✓ (bate com §5: professional escreve exceções próprias, lê vigência)
- **professional na grade de outro**: `isOwnSchedule=false` → tudo em leitura. ✓
- **receptionist**: ambos `false` → tudo em leitura. ✓

A `OverrideFormDialog` só é montada quando `!readOnly` (em `ScheduleOverridesSection`), então o usuário em
leitura não tem como abrir o formulário de criação nem o de edição — a UI não oferece o caminho de
escrita. A trava real permanece o RLS de ADR-01/02; isto é defesa em profundidade, como a ADR descreve.

O caso que o QA deve confirmar ao vivo é o professional na própria grade: ele edita as próprias exceções
mas vê a vigência em leitura (admin-only por design). A assimetria é intencional e a copy do card já
sinaliza ("Só o administrador edita.").

### Schemas zod espelhando os CHECKs (design doc)

`scheduleOverrideSchema` reusa `refineScheduleWindow` (de `catalog.ts`) para a janela atípica — a **mesma**
função que valida a grade semanal, garantindo que "horário atípico" siga as mesmas regras de janela/break
que um dia da grade (início < fim, break ambos-ou-nenhum, break dentro da janela). Quando `isClosed=true`
o refine é pulado (folga não tem janela), espelhando o CHECK `schedule_overrides_window`. `reason` é
`.trim().max(200)`, espelhando o limite da migration. `toRow` zera a janela quando fechado e grava
`null` em break quando `hasBreak=false` — coerente com o CHECK de coerência de break.

`ScheduleValidityForm` usa um `validityFormSchema` local (shape de UI com `hasEndDate` + strings) em vez
do `scheduleValiditySchema` de domínio, convertendo no submit via `toValidityInput`. Os limites batem
(passo 5..240, início ≤ fim quando ambos presentes). A duplicação do schema é intencional e documentada no
próprio arquivo — razoável, porque o form trabalha com `""`/`hasEndDate` e o domínio com `null`.

### Correção de fuso na exibição de datas

`OverrideItem.formatOverrideDate` extrai `YYYY-MM-DD` por regex e remonta `dd/MM/yyyy` **sem** instanciar
`Date`, evitando o clássico deslocamento de um dia que ocorreria ao interpretar uma data pura como
meia-noite UTC. É exatamente a disciplina de fuso que o PRD §4 e a análise de frontend §4.3 pediram para
datas de calendário. Bom padrão.

### Pontos menores de validação/UX

O `validityFormSchema` não exige `scheduleEndDate` quando `hasEndDate` é true: desligar o switch e deixar o
campo vazio salva `schedule_end_date = null` em silêncio. Não corrompe dados (null é um fim válido), mas
descarta a intenção do usuário sem avisar. Um `superRefine` adicional ("informe a data de fim ou marque
sem término") fecharia a borda; fica como melhoria opcional, não bloqueante.

O passo em minutos só rejeita valor fora de [5,240] no submit (a validação zod dispara no handleSubmit);
os atributos HTML `min/max/step` guiam, mas não travam a digitação. Aceitável — o CHECK do banco (AC-08) é
a trava final e a mensagem pt-BR aparece ao salvar.

### Contraprova

- `npm run typecheck` (`tsc -b`): limpo.
- `npm run build` (`tsc -b && vite build`): limpo (aviso pré-existente de chunk > 500 kB, não introduzido
  por esta ADR).
- `npm run test` (`vitest run`): 16/16 passam (`scheduling-slots.test.ts`; ADR-07 não adiciona testes,
  coerente com a convenção de "testes só quando pedido").

QA ao vivo (folga zera slots, vigência reflete nos chips, unicidade, RBAC em leitura por papel) é do step
seguinte via Chrome DevTools — não executado aqui por instrução.

</details>

<details>
<summary>Mapa de arquivos</summary>

- `src/app/config/profissionais/horarios/HorariosPage.tsx` — monta os dois `Card`s (vigência, exceções)
  abaixo da grade; passa `readOnly` admin-only p/ vigência e espelhado-da-grade p/ exceções.
- `src/app/config/profissionais/horarios/ScheduleValidityForm.tsx` (novo) — form de vigência + passo-base;
  schema de UI próprio convertido para o input de domínio no submit.
- `src/app/config/profissionais/horarios/ScheduleOverridesSection.tsx` (novo) — lista + confirmação de
  remoção; `OverrideFormDialog` só montado quando editável.
- `src/app/config/profissionais/horarios/OverrideFormDialog.tsx` (novo) — criar/editar exceção (folga vs
  atípico), reusa `scheduleOverrideSchema`; traduz erro de unicidade para o campo de data.
- `src/app/config/profissionais/horarios/OverrideItem.tsx` (novo) — item com badge de tipo, resumo de
  janela e ações; formata data sem `Date`/UTC.

Diff completo: `git show a45da38`.

</details>
