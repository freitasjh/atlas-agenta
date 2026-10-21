# ADR-05 — Gerador de slots puro (`lib/scheduling-slots.ts`) e `useAvailableSlots`

**Status:** proposto

## Contexto

O coração da feature é gerar, **sob demanda e sem materializar** (restrição dura, AC-21), os
horários de início livres para `(profissional, serviço, dia)`. As duas análises (data §5/§6.4,
frontend §4.3) e o PRD §9 ponto 5 (aprovado no gate) recomendam **computar no cliente, em uma função
pura**, a partir de dados **já lidos sob RLS** — reusando `src/lib/datetime.ts` (que trata DST por
instante) e sem round-trip extra (RNF01, agenda < 1,5s). Migrar para RPC fica como evolução só se a
performance exigir; o contrato do front (`useAvailableSlots` → lista de inícios/`{startUtc,endUtc}`)
é estável nos dois casos.

**Cascata de precedência** que o gerador deve seguir, por dia (data §8, PRD §3.2):

1. **vigência** (`schedule_start_date`/`schedule_end_date`): fora de `[início, fim]` → **sem slots**.
2. **exceção** (`schedule_overrides` para a data): `is_closed=true` → **sem slots**;
   `is_closed=false` → usa a **janela da exceção** (com break opcional), ignorando a grade.
3. **grade semanal** (`working_hours` do `weekday`): só quando não há exceção e está dentro da
   vigência; **pode ter múltiplas faixas por weekday** (working_hours é permissivo) → união das
   janelas.

Regras de encaixe:

- os inícios andam de `slot_step_minutes` em `slot_step_minutes` a partir do começo de cada janela
  (AC-15);
- o bloco ofertado tem `services.duration_minutes`; um início só é slot se o bloco `[início,
  início+duração)` **cabe inteiro** na janela (não cruza fim/break) e **não sobrepõe** agendamento
  **ativo** (status ∉ {`cancelado`,`nao_compareceu`}) do profissional (AC-13/14);
- horários no **passado** (relativo a "agora" no fuso do tenant) não são ofertados no dia corrente
  (AC-17);
- tudo fatiado no **fuso do tenant** e comparado em UTC via `datetime.ts` (AC-16); duração > janela →
  lista vazia (vazio honesto); profissional sem grade no dia → vazio.
- em **edição** de agendamento, o próprio agendamento é excluído do desconto de ocupados (o slot que
  ele ocupa continua ofertável).

A não-sobreposição no banco (`appointments_no_overlap`) **não é alterada**: o gerador só reflete
ocupados; a trava real segue no banco (criar a partir de slot ainda passa pela constraint — ADR-06).

Helpers já disponíveis em `datetime.ts`: `tenantDateTimeToUtc`, `fromTenantLocal`, `toTenantLocal`,
`tenantDayRangeUtc`, `addMinutes`, `formatTimeInTenantTz`.

## Decisão

1. **Função pura** `src/lib/scheduling-slots.ts`, sem React e sem acesso a dados, assinatura do tipo:

   ```
   generateAvailableSlots(input: {
     day: string;                    // YYYY-MM-DD no fuso do tenant
     timeZone: string;
     durationMinutes: number;        // services.duration_minutes
     slotStepMinutes: number;        // professionals.slot_step_minutes
     scheduleStartDate: string | null;
     scheduleEndDate: string | null;
     workingHours: WorkingHour[];    // faixas do weekday (0..N)
     override: ScheduleOverride | null; // exceção da data, se houver
     busy: { startsAt: string; endsAt: string }[]; // agendamentos ativos do dia/prof
     nowUtc?: Date;                  // injetável para teste; default new Date()
   }): { startUtc: string; endUtc: string; label: string }[]
   ```

   Implementa a cascata de precedência, a varredura por passo-base, o encaixe por duração, o desconto
   de ocupados e passado, o fuso via `datetime.ts`, e a união de múltiplas faixas por weekday.
   Determinística — `nowUtc` injetável para teste.

2. **Hook** `src/hooks/useAvailableSlots.ts` (`useQuery` ou `useMemo` derivado) que orquestra as
   leituras já existentes/novas sob RLS e chama a função pura:
   - grade via `useWorkingHours`, exceção via `useScheduleOverrides` (ADR-04), vigência/passo via
     `useScheduleValidity`/`useProfessionals` (ADR-04), ocupados via `useAppointments` (reusa a query
     do dia — mesma chave, sem request novo), duração via `useServices`/o serviço selecionado.
   - chave de query inclui `professionalId`, `serviceId`, `day` e o `appointmentId` em edição (para
     excluir o próprio ocupante). `enabled` só quando `professionalId` + `serviceId` + `day` existem.
   - entrada da query validada (uuid/`YYYY-MM-DD`); **nunca** aceita `tenant_id` do cliente.

3. **Testes unitários do gerador** (PRD §10 / análise §11 pedem cobertura do gerador). O projeto
   **não tem** runner de teste hoje (sem `vitest` no `package.json`), e a convenção é "não adicionar
   testes automaticamente". **Decisão:** o coder desta ADR adiciona **vitest** como devDependency
   (versão fixada, alinhada ao ecossistema Vite já presente) **e** um `src/lib/scheduling-slots.test.ts`
   cobrindo a cascata de precedência, DST, duração > janela, break, passado, múltiplas faixas e
   exclusão do próprio em edição — porque esta é exatamente a situação em que a verificação exige um
   framework e o PRD trata a corretude do gerador como "defeito se divergir". Adicionar o script
   `"test": "vitest run"` ao `package.json`. Se a adição do runner for recusada no review, o fallback
   é documentar os casos e validá-los via o QA ao vivo de ADR-06 — mas a recomendação é adicionar o
   runner, pois é a forma correta de provar esta unidade.

Decisão de arquitetura durável (onde roda a geração de slots e o contrato do hook); candidata a
`docs/` depois do run — não copiar agora.

## Consequências

- **Positivas:** regra determinística, testável isolada, sem superfície nova no banco e sem waterfall;
  fuso concentrado nos helpers já testados; contrato estável se virar RPC.
- **Custos/limitações:** a regra vive no cliente (não compartilhável com autoagendamento público, que
  é Fase 3 e fora de escopo); adicionar vitest incrementa o toolchain (justificado).
- **Risco controlado:** a não-sobreposição continua sendo do banco; slots são oferta otimista.

### Escopo

Frontend (função pura + hook; consome dados sob RLS).

### Arquivos / pastas afetados

- `src/lib/scheduling-slots.ts` (novo).
- `src/lib/scheduling-slots.test.ts` (novo).
- `src/hooks/useAvailableSlots.ts` (novo).
- `package.json` (editar: devDependency `vitest` fixada + script `test`).
- (possível) `vitest.config.ts` ou configuração em `vite.config.ts` (novo/editar), se necessário.

### Critérios de aceite testáveis (desta ADR)

- **AC-09:** slots dentro da janela da grade e fora do break.
- **AC-10:** exceção `is_closed=true` → nenhum slot mesmo com grade no weekday.
- **AC-11:** exceção `is_closed=false` → slots seguem a janela da exceção, não a da grade.
- **AC-12:** fora de `[schedule_start_date, schedule_end_date]` → nenhum slot; dentro → há.
- **AC-13:** bloco que sobrepõe agendamento ativo não é ofertado; `cancelado`/`nao_compareceu` não
  bloqueiam.
- **AC-14:** serviço de 1h vs 2h — o de 2h oferta menos opções; só inícios cujo bloco inteiro cabe.
- **AC-15:** inícios andam de `slot_step_minutes` a partir do começo da janela.
- **AC-16/17:** fuso do tenant respeitado (09:00 local = 09:00); horários passados omitidos no dia
  corrente (com `nowUtc` injetado).
- **Edição:** o próprio agendamento é excluído do desconto de ocupados.
- **Verificação:** `npm run test` (vitest) passa com a tabela de casos acima; `npm run typecheck` e
  `npm run build` limpos.

### Dependência

Depende de **ADR-03** (tipos) e **ADR-04** (hooks de exceção/vigência) e reusa `datetime.ts`,
`useWorkingHours`, `useAppointments`, `useServices` já existentes. É a base consumida por ADR-06
(SlotPicker) e ADR-08 (faixas vazias do calendário).
