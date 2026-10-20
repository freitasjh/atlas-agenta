# ADR-03 — Tipos de domínio e schemas zod de exceção/vigência

**Status:** proposto

## Contexto

As migrations de ADR-01 (colunas de vigência/passo em `professionals`) e ADR-02 (tabela
`schedule_overrides`) introduzem formas de dados novas que o frontend precisa tipar e validar antes
de usar. O projeto já tem a disciplina de (a) tipos de linha em `src/types/domain.ts` e (b) schemas
zod em `src/lib/validations/*` que **espelham os CHECKs do banco** — a validação do cliente é UX
(pt-BR, feedback imediato) e a trava real é o Postgres (convencoes-codigo; catalog.ts documenta isso
no topo).

Para manter esse padrão, os novos shapes precisam entrar nos dois lugares antes dos hooks (ADR-04),
do gerador de slots (ADR-05) e das telas (ADR-06/07/08) que os consomem. Esta ADR é uma unidade de
fundação pequena, sem acesso a dados e sem UI — só tipos + schemas puros, buildáveis isoladamente.

Padrões a reusar:

- `workingHoursDaySchema` (`src/lib/validations/catalog.ts`) já implementa a validação de janela +
  break ambos-ou-nenhum + coerência; a validação de exceção `horario_atipico` deve **reusar a mesma
  lógica**, não reescrever.
- `Professional` e `WorkingHour` (`src/types/domain.ts`) são o molde dos novos tipos de linha.
- O `timeString` regex (`^([01]\d|2[0-3]):[0-5]\d$`) de catalog.ts é o padrão de `HH:MM`.

## Decisão

1. **Tipos de domínio** (`src/types/domain.ts`): adicionar
   - `interface ScheduleOverride` (linha de `schedule_overrides`): `id`, `tenant_id`,
     `professional_id`, `override_date: string` (ISO `YYYY-MM-DD`), `is_closed: boolean`,
     `start_time: string | null`, `end_time: string | null`, `break_start: string | null`,
     `break_end: string | null`, `reason: string | null`, `created_at: string`.
   - estender `Professional` com `schedule_start_date: string | null`, `schedule_end_date:
     string | null`, `slot_step_minutes: number`.

2. **Schemas zod** em um arquivo novo `src/lib/validations/schedule.ts` (mantém `catalog.ts` focado no
   catálogo; o novo arquivo importa de `catalog.ts` o que reusar):
   - `scheduleValiditySchema`: `scheduleStartDate`/`scheduleEndDate` (`YYYY-MM-DD` opcionais via
     refine; quando ambos, início ≤ fim) + `slotStepMinutes` (int 5..240). Mensagens pt-BR espelhando
     o CHECK de ADR-01.
   - `scheduleOverrideSchema`: `overrideDate` (`YYYY-MM-DD` obrigatória), `isClosed` (boolean), e,
     quando `isClosed=false`, janela (`startTime`/`endTime`/`hasBreak`/`breakStart`/`breakEnd`)
     validada com a **mesma** regra de `workingHoursDaySchema` (extrair a lógica comum de janela/break
     para uma função reutilizável em `catalog.ts` e chamá-la de ambos, ou replicar o `superRefine`
     espelhando-o — preferir a extração para evitar divergência); `reason` opcional ≤ 200 chars.
     Quando `isClosed=true`, janela/break ausentes.
   - exportar os tipos `ScheduleValidityInput` e `ScheduleOverrideInput` via `z.infer`.

Nenhum dado é lido/escrito aqui; nenhum componente é montado. Só definições puras, cobertas pelo
typecheck.

## Consequências

- **Positivas:** hooks e telas das ADRs seguintes consomem tipos/validação prontos; a validação de
  exceção reusa a de grade (uma só fonte de verdade de UX).
- **Custos/limitações:** se a extração da lógica de janela de `workingHoursDaySchema` tocar
  `catalog.ts`, é preciso garantir que `WeekScheduleForm`/`DayRow` continuam compilando e com o mesmo
  comportamento (não-regressão, AC-20).
- **Risco controlado:** schemas são UX; a trava é CHECK/RLS (ADR-01/02).

### Escopo

Ambos (tipos e validação compartilhados entre dados-cliente e frontend; sem SQL, sem UI).

### Arquivos / pastas afetados

- `src/types/domain.ts` (editar: novo `ScheduleOverride`, estender `Professional`).
- `src/lib/validations/schedule.ts` (novo).
- `src/lib/validations/catalog.ts` (editar **apenas** se extrair a função de validação de janela/break
  para reuso; manter o comportamento atual).

### Critérios de aceite testáveis (desta ADR)

- **Build/typecheck:** `npm run typecheck` passa limpo com os novos tipos/schemas.
- **Coerência com o banco (revisão):** os limites do zod batem com os CHECKs de ADR-01/02
  (`slot_step_minutes` 5..240; início ≤ fim; janela de exceção coerente; `reason` ≤ 200).
- **Não-regressão:** se `catalog.ts` for tocado, `npm run build` conclui e nada em
  `WeekScheduleForm`/`DayRow` muda de contrato (AC-20).

### Dependência

Depende de **ADR-01** e **ADR-02** (os tipos/schemas espelham o schema que elas criam). Não exige o
banco rodando — só reflete o contrato.
