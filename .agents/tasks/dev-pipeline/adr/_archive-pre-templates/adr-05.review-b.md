# Gerador de slots puro (`lib/scheduling-slots.ts`) e `useAvailableSlots` — Revisor B

Revisão independente da ADR-05 (escopo: commits `4659e0d` + `cba4200`, diff `47bc315..cba4200`). A ADR introduz o núcleo da feature de agenda: uma função pura que deriva os horários livres de `(profissional, serviço, dia)` sob demanda, sem materializar nada no banco, mais o hook `useAvailableSlots` que orquestra as leituras já sob RLS e chama o gerador num `useMemo`. O desenho segue a decisão do gate (PRD §9.5): computar no cliente sobre dados lidos por RLS, reusando `datetime.ts` para o fuso. Acrescenta `vitest` como devDependency fixada e um suite de 16 testes do gerador.

Watch for: nada bloqueante. A cascata de precedência, o encaixe por duração, o corte de passado, o desconto de ocupados ativos e o fuso estão corretos e cobertos por teste — inclusive um caso de **transição real de DST** (America/New_York) além do caso Brasil estável (confirmed). As observações abaixo são menores e não impedem o avanço: a semântica de união de janelas com break divergente entre faixas sobrepostas (confirmed, mas é o comportamento especificado na ADR), e a ausência de teste para vigência de ponta aberta (`null` em uma das pontas) e para o passo que não divide a janela (possible).

**Verdict**: APPROVED

## High-level view

O gerador respeita a cascata vigência → exceção → grade exatamente como a ADR e o PRD §3.2 definem: fora da vigência retorna vazio, exceção fechada retorna vazio, exceção aberta usa a janela da exceção ignorando a grade, e sem exceção usa a união das faixas do weekday. A aritmética de janela é feita convertendo cada `HH:MM` de parede do dia em instante UTC via `tenantDateTimeToUtc` e comparando tudo em UTC — a borda onde um bug de fuso apareceria está concentrada nos helpers já testados de `datetime.ts`, e o suite prova a invariância do rótulo de parede com o instante UTC mudando na virada de DST.

A fronteira multi-tenant está limpa: o gerador é função pura sem acesso a dados e sem `tenant_id`; o hook deriva o fuso de `useTenant` (JWT via RLS) e lê grade/exceção/vigência/ocupados pelos hooks existentes, todos filtrados por RLS. Nenhum `tenant_id` sai do cliente, nenhum segredo entra, nenhuma superfície nova no banco. RBAC e idempotência não se aplicam a esta ADR (só leitura derivada; a trava de escrita e a não-sobreposição seguem no banco, intactas).

O desconto de ocupados usa apenas agendamentos ativos, centralizado em `isActiveAppointmentStatus` (`scheduling-status.ts`), que espelha 1:1 o `where status not in ('cancelado','nao_compareceu')` da constraint `appointments_no_overlap`. A exclusão do próprio agendamento em edição é feita no hook (`excludeAppointmentId`), não no gerador — coerente com a ADR, que mantém o gerador agnóstico de identidade de agendamento. A adição do `vitest` é justificada pela ADR (a corretude do gerador é "defeito se divergir") e não altera o runtime da aplicação.

<details>
<summary>Issues (3)</summary>

1. **União de janelas com break divergente** — faixas sobrepostas do mesmo weekday com breaks diferentes resultam na oferta do slot pela faixa sem break (confirmed). É o comportamento de "união permissiva" que a ADR especifica; registrar como decisão consciente, não corrigir aqui.
2. **Vigência de ponta aberta sem teste** — `isWithinValidity` trata `start`/`end` nulos corretamente, mas o suite só cobre ambas as pontas preenchidas (possible). Vale um caso com `scheduleEndDate: null` (ou `scheduleStartDate: null`) para travar a regra "null = sem limite".
3. **Passo que não divide a janela sem teste** — a varredura por `slotStepMinutes` nunca ancora no fim da janela, então um passo que não divide a janela pode deixar uma folga final ofertável perdida (possible, e é o comportamento esperado de grade ancorada no início). Documentar/testar o caso evita regressão futura.

</details>

<details>
<summary>Details</summary>

## Cascata de precedência e encaixe por duração

`resolveWindows` implementa a ordem exata da ADR. A vigência é checada primeiro por comparação lexical de `YYYY-MM-DD` — correta porque datas zero-padded ordenam lexicograficamente igual a cronologicamente, e o comentário no código deixa isso explícito. A exceção aberta com janela incompleta (`start_time`/`end_time` nulos) cai em `return null` (sem slots) em vez de vazar para a grade; é defensivo e o CHECK do banco (ADR-02) já impede essa linha de existir, então a dupla trava é consistente.

O encaixe por duração está correto: o laço só gera um início quando `cursor + durationMinutes*60000 <= windowEndMs`, garantindo que o bloco inteiro cabe na janela (AC-14). O teste de 1h vs 2h prova a redução de opções, e o de "duração > janela → vazio" cobre o vazio honesto. O corte de break usa `overlaps` sobre o intervalo do break convertido a UTC — o teste AC-09 confirma que 09:30/10:00/10:30 somem quando o break é 10:00–11:00 e sobra 09:00 e 11:00.

A união de múltiplas faixas por weekday deduplica por instante de início via `Map<number, AvailableSlot>`, e o teste cobre o não-duplicar quando duas faixas compartilham 09:00. Uma sutileza confirmada por leitura: se duas faixas sobrepostas tiverem breaks diferentes, o início é ofertado pela primeira faixa que o aceita (a sem break "ganha"). Isso é exatamente a semântica de união permissiva que a ADR escolhe ("working_hours é permissivo → união das janelas"), então não é defeito — mas é um comportamento não-óbvio que merece ficar registrado como decisão, porque um leitor futuro poderia esperar que o break de uma faixa bloqueasse o slot globalmente.

## Fuso e DST

A conversão parede→UTC passa por `tenantDateTimeToUtc` (que faz duas passadas de offset para resolver a borda de transição) e a comparação de ocupados/passado é toda em `ms` de instante UTC — o eixo certo. O suite não só assume o Brasil estável (sem DST desde 2019, offset fixo -03:00) como adiciona um caso de **transição real** em `America/New_York`: 09:00 de parede em 2025-03-03 (EST) vira 14:00Z e em 2025-03-10 (EDT) vira 13:00Z, com o rótulo de parede idêntico nos dois lados. Esse é o teste que de fato exercita a lógica de DST do `datetime.ts` e fecha a lacuna que um caso só-Brasil deixaria. `windowTimeToUtc` faz `time.slice(0,5)` para tolerar o `HH:MM:SS` que o Postgres devolve em colunas `time` — correto e necessário.

## Passado e ocupados

O corte de passado é `slotStart < nowMs` (estritamente menor), então um slot exatamente em "agora" permanece ofertável — o teste AC-17 ancora essa borda (10:00 == agora é ofertado, 09:00 não). `nowUtc` é injetável e o default é `new Date()`, mantendo a função determinística para teste. O desconto de ocupados filtra por `isActiveAppointmentStatus` **no hook**, não no gerador: o gerador recebe só os `busy` já ativos. Isso mantém o gerador agnóstico de status e concentra a regra de "o que ocupa a agenda" em `scheduling-status.ts`, que documenta e espelha a constraint `appointments_no_overlap`. A exclusão do próprio agendamento em edição também é do hook (`a.id !== excludeAppointmentId`), coerente com a ADR e com `hasLocalConflict`.

Uma observação de robustez já tratada: `busyMs` filtra instantes não-finitos (`Number.isFinite`), evitando que um `starts_at`/`ends_at` malformado contamine o `overlaps`. Boa defesa contra dado inesperado, mesmo que o zod de `useAppointments` já valide o shape.

## Fronteira multi-tenant / segredos / contrato de dados

O gerador é função pura sem React e sem `tenant_id`. O hook deriva o fuso de `useTenant` (JWT via RLS) e lê grade (`useWorkingHours`), exceção (`useScheduleOverrides`), vigência/passo (`useScheduleValidity` sobre `useProfessionals`) e ocupados (`useAppointments`) — todos com a mesma chave de query da lista do dia, sem request novo (RNF01, sem waterfall). Nenhum insumo carrega `tenant_id` do cliente; o isolamento é do banco. Nenhum segredo entra no bundle. Confirmado que `useScheduleValidity` reusa a chave de `useProfessionals` (seletor fino) em vez de abrir request duplicado, e que o `select` de `professionals` já traz as colunas de vigência/passo (ADR-03). O `weekdayOf` calcula o dia-da-semana via `Date.UTC` a partir do `YYYY-MM-DD` do tenant, evitando o deslocamento que `getDay()` no fuso do navegador causaria — detalhe correto e fácil de errar.

## Testes e toolchain

O suite cobre AC-09 a AC-17, união de faixas, vazio honesto, sem-grade, edição e os dois casos de fuso. 16 testes passam. A adição de `vitest@2.1.8` (versão fixada, alinhada ao Vite 5.4.11 já presente) com `environment: "node"` e alias `@` reusado é a decisão correta — a ADR a justifica e o `tsconfig.node.json` foi atualizado para incluir `vitest.config.ts` no typecheck, fechando o loop.

Duas lacunas de cobertura, ambas não-bloqueantes: (1) a vigência só é testada com ambas as pontas preenchidas; falta um caso de ponta aberta (`scheduleEndDate: null`) para travar a regra "null = sem limite" que `isWithinValidity` implementa. (2) Nenhum teste usa um `slotStepMinutes` que não divide a janela (ex.: passo 45 numa janela de 180 min) — o comportamento (grade ancorada no início, folga final não ofertada) é o esperado, mas um teste o fixaria contra regressão.

## Contraprova

- `npm run typecheck` — limpo.
- `npm run build` — ok (10.5s; aviso pré-existente de chunk > 500 kB, fora do escopo desta ADR).
- `npm run test` — 16/16 passam (1.02s).

</details>

<details>
<summary>Arquivos</summary>

- `src/lib/scheduling-slots.ts` (novo) — gerador puro: cascata de precedência, varredura por passo, encaixe por duração, desconto de ocupados/passado, fuso via `datetime.ts`, dedup por instante.
- `src/hooks/useAvailableSlots.ts` (novo) — orquestra leituras sob RLS (reusa chave de `useAppointments`), filtra ocupados ativos, exclui o próprio em edição, chama o gerador em `useMemo`.
- `src/lib/scheduling-status.ts` (editar) — adiciona `INACTIVE_APPOINTMENT_STATUSES` + `isActiveAppointmentStatus`, espelhando a constraint do banco.
- `src/lib/scheduling-slots.test.ts` (novo) — 16 casos (AC-09..17, união, vazio, edição, DST real + Brasil estável).
- `package.json` (editar) — devDependency `vitest@2.1.8` fixada + script `test`.
- `vitest.config.ts` (novo) — ambiente `node`, alias `@`, include `src/**/*.test.ts`.
- `tsconfig.node.json` (editar) — inclui `vitest.config.ts` no typecheck.
- `package-lock.json` (editar) — lockfile do `vitest`.

Diff completo: `git diff 47bc315..cba4200`.

</details>
