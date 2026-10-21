# Revisor B — ADR-03: Tipos de domínio e schemas zod de exceção/vigência

Fundação de tipos + validação para o módulo de agenda: estende `Professional` com
vigência/passo, adiciona a interface `ScheduleOverride` (`src/types/domain.ts`), cria
`src/lib/validations/schedule.ts` com `scheduleValiditySchema`/`scheduleOverrideSchema`, e
extrai a validação de janela/break de `catalog.ts` para uma função reusável
(`refineScheduleWindow`) consumida tanto pela grade quanto pela exceção. O hook
`useProfessionals.ts` passa a selecionar e validar as três colunas novas. Nenhum dado novo é
escrito e nenhuma UI é montada — a camada é pura, como a ADR exige.

Watch for: (1) divergência de contorno no `reason` — o zod aceita string vazia, o CHECK do
banco exige 1..200 (**likely**); (2) a edição de `useProfessionals.ts` é um hook e cai no
escopo nominal da ADR-04, não da ADR-03 (**confirmed**, baixa severidade — é consequência
necessária da extensão do tipo).

**Verdict**: APPROVED

## Visão de alto nível

A extração de `refineScheduleWindow` é um movimento verbatim do corpo do antigo `superRefine`
de `workingHoursDaySchema`; o schema da grade e seus consumidores (`WeekScheduleForm`,
`DayRow`) continuam com contrato idêntico, então a não-regressão (AC-20) se sustenta e o build
confirma. A reutilização atende à instrução da ADR de preferir extração a replicar o
`superRefine`.

Os limites do zod batem com os CHECKs do banco nos pontos que importam: `slotStepMinutes`
5..240 espelha o CHECK da ADR-01; a coerência de vigência (início ≤ fim, nulo dispensa)
espelha `professionals_schedule_vigencia_coherent`; e a janela de exceção reusa exatamente a
mesma regra de janela/break, com os `<=`/`<` alinhados ao CHECK `schedule_overrides_window`
(break pode começar no início da janela, consistente em ambos os lados). A única folga é
`reason`: o banco exige comprimento 1..200, o zod só limita o teto — uma string vazia passa no
cliente e só falha no Postgres, sem a mensagem pt-BR amigável que a camada de UX promete.

A ADR-03 lista como arquivos afetados apenas `domain.ts`, `schedule.ts` e `catalog.ts`. O
commit de HEAD também edita `useProfessionals.ts` (hook), que nominalmente é escopo da ADR-04.
Isso não é defeito de fronteira — é necessário para manter a ADR-03 coerente: sem incluir as
colunas no `professionalRowSchema` e no `select`, o `useQuery<Professional[]>` prometeria um
tipo que os objetos em runtime não teriam. Fica registrado como nota de escopo, não como
bloqueio.

As fronteiras de segurança estão respeitadas por omissão correta: schemas são UX, a trava real
é CHECK/RLS (as migrations da ADR-01/02 já aprovadas); o hook não envia `tenant_id` em nenhuma
escrita; vigência/passo são read-only aqui (escrita fica para a ADR-07). Nada de segredo, nada
de PII — `reason` é explicitamente rótulo não-PII.

<details>
<summary>Issues (3)</summary>

1. **`reason` aceita vazio no zod, banco exige 1..200** — `scheduleOverrideSchema.reason` é
   `.string().trim().max(200).optional()` sem `.min(1)`; o CHECK `reason is null or char_length
   between 1 and 200` rejeita `""`/espaços. Alinhar o zod (ex.: transformar `""` trimado em
   `undefined`, ou aplicar `.min(1)` com mensagem pt-BR) para que o erro apareça como feedback
   de formulário, não como erro cru do Postgres. Baixa severidade — o banco continua sendo a
   trava.
2. **Edição de hook fora do escopo nominal da ADR** — `useProfessionals.ts` pertence à ADR-04;
   aqui entrou junto por necessidade. Sem ação de código; registrar que a ADR-04 não deve
   re-editar o `select`/row schema de `professionals` para não duplicar trabalho.
3. **String de `select` repetida 4×** — as colunas de `professionals` são listadas literalmente
   em quatro lugares de `useProfessionals.ts`. Nit de manutenção (extrair uma constante
   `PROFESSIONALS_COLUMNS`); não bloqueia.

</details>

<details>
<summary>Details</summary>

### Extração de `refineScheduleWindow` e não-regressão da grade

O corpo do `superRefine` de `workingHoursDaySchema` foi movido sem alteração de lógica para
`refineScheduleWindow(fields, ctx)`. Os consumidores da grade (`WeekScheduleForm` via
`weeklyScheduleSchema`, `DayRow` via `WeeklyScheduleInput`) importam os mesmos símbolos com o
mesmo `z.infer`, então o contrato público de `catalog.ts` não mudou — a não-regressão (AC-20)
se sustenta no nível de typecheck/compilação; a verificação visual fica para o QA.

### Coerência zod ↔ CHECK do banco

Ponto a ponto contra as migrations da ADR-01/02:

- `slotStepMinutes`: zod `.int().min(5).max(240)` ↔ CHECK `between 5 and 240`. Igual.
- Vigência: zod sinaliza erro quando `scheduleStartDate > scheduleEndDate` (logo início ==
  fim passa) ↔ CHECK `start_date is null or end_date is null or start_date <= end_date`.
  Igual, inclusive no tratamento de nulos.
- Janela de exceção (`isClosed=false`): `refineScheduleWindow` exige `start < end`, break
  ambos-ou-nenhum, `breakStart >= startTime` e `breakEnd <= endTime`. O CHECK
  `schedule_overrides_window` exige `start_time < end_time` e, com break,
  `start_time <= break_start < break_end <= end_time`. Os operadores de contorno (`<=` no
  início do break, `<=` no fim) batem — o break pode encostar nas bordas em ambos os lados.
- `isClosed=true`: o zod faz `return` sem validar janela; o banco rejeita qualquer janela
  preenchida quando fechado. O zod não impede o cliente de *enviar* janela junto com
  `isClosed=true`, mas como a camada de escrita (ADR-04/07) deve montar o payload a partir do
  form, e o banco é a trava, isso é aceitável para uma ADR de definição pura. Vale a ADR-04
  garantir que o payload de exceção fechada não carregue horas residuais.

A única divergência material é o `reason` (ver Issues #1).

### Hook `useProfessionals`

`professionalRowSchema` casa 1:1 com o tipo `Professional` estendido (inclusive nulabilidade de
`schedule_start_date`/`schedule_end_date`), então o `.parse()` não mente sobre o shape que o
`useQuery<Professional[]>` promete. Nenhuma escrita envia `tenant_id` (RLS aplica o isolamento);
create/update só gravam `name`/`active` — vigência e passo permanecem read-only nesta fase,
como a ADR-01 definiu (escrita admin-only vem na ADR-07). A string de colunas repetida quatro
vezes é a única fricção de manutenção (Issues #3).

### Contraprova

`npm run build` → sucesso (`tsc -b` + `vite build`, `✓ built in 5.67s`). O aviso de chunk >
500 kB é pré-existente do bundle e não tem relação com esta ADR. Não há script de lint/test no
`package.json`; `typecheck` é subconjunto do `build`. Dev server não foi subido (decisão do QA
no step seguinte, conforme instrução).

</details>

<details>
<summary>Mapa de arquivos</summary>

- `src/types/domain.ts` — estende `Professional` (vigência + passo) e adiciona a interface
  `ScheduleOverride`.
- `src/lib/validations/catalog.ts` — extrai `refineScheduleWindow` + `ScheduleWindowFields` do
  `superRefine` da grade; promove `timeString` a export. Comportamento preservado.
- `src/lib/validations/schedule.ts` (novo) — `scheduleValiditySchema`, `scheduleOverrideSchema`
  e os tipos inferidos; reusa `refineScheduleWindow`/`timeString`.
- `src/hooks/useProfessionals.ts` — adiciona as 3 colunas ao row schema e aos quatro `select`
  (escopo nominal da ADR-04, incluído por necessidade — ver Issues #2).

Diff completo do escopo: `git diff ce36a14 HEAD -- src/types/domain.ts src/lib/validations/schedule.ts src/lib/validations/catalog.ts src/hooks/useProfessionals.ts`

</details>
