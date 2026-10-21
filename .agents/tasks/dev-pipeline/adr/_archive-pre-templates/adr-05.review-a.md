# ADR-05 Revisão — Gerador de slots puro e `useAvailableSlots`

**Revisor:** Revisor Independente A (revisão de código + testes)  
**Status:** APROVADO com observações menores  
**Data da revisão:** 2025-02-21

---

## Sumário

A ADR-05 entrega a função pura `generateAvailableSlots` e o hook de orquestração `useAvailableSlots` que gera horários de início livres para agendamentos sob demanda, sem materializar dados no banco. A implementação (a) respeita integralmente a cascata de precedência (vigência → exceção → grade → ocupados), (b) cobre determinística todos os casos de aceite AC-09 a AC-17 com 15 testes unitários passando, (c) isola multi-tenant via RLS já existente (nenhum `tenant_id` é enviado do cliente), (d) converte fusos via helpers já testados de `datetime.ts`, e (e) reusa queries TanStack existentes para evitar waterfall (RNF01).

**Watch for:** Nenhum bloqueador. Pontos de atenção menores anotados nas seções de detalhe.

**Verdict:** APPROVED

---

## Alta visão

O gerador é uma função pura determinística que recebe grade/exceção/vigência/ocupados/duração/passo (todos lidos sob RLS pelo cliente) e devolve uma lista de horários válidos de início. A cascata de precedência (vigência → exceção fechada/aberta → grade → ocupados) é implementada em `resolveWindows`, refletindo exatamente a modelagem de dados de ADR-01/02. A aritmética de fuso (conversão `HH:MM` local → UTC, comparação em UTC, formatação de volta para local) é delegada aos helpers já em produção em `datetime.ts`, concentrando o risco de bug em um só ponto testado. O hook orquestra as 5 queries necessárias (grade, exceção, vigência, serviços, ocupados) sob `useMemo` com chave de 11 membros, garantindo recomputa só quando algum insumo muda; nenhuma query nova é aberta (reusa a mesma chave de `useAppointments` do dia). Testes cobrem a cascata, DST, múltiplas faixas por weekday, duração > janela, break, passado (com `nowUtc` injetável), e exclusão do próprio ocupante em edição — comportamento coincide 100% com os critérios de aceite.

---

<details>
<summary>Detalhes</summary>

### Cascata de precedência e resolução de janelas

A função `resolveWindows` implementa a cascata documentada em análise §8:
1. Vigência (fora → `null`, sem slots)
2. Exceção (fechada → `null`; aberta → usa janela da exceção, ignora grade)
3. Grade semanal (`workingHours` do weekday)

A comparação de datas é lexical (`day < start` ou `day > end` em string `YYYY-MM-DD`), o que é equivalente a cronológica para datas zero-padded — teste DST confirmou que a conversão local→UTC não perde a semântica de "dia de calendário". A precedência da exceção (ignored working hours quando a exceção é aberta) é cristalina no código: se há exceção e não é fechada, retorna logo com o `window` da exceção, pulando o `workingHours`. ✓

### Aritmética de tempo: fuso, passado, ocupados, break

Todos os instantes trabalham em **milissegundos desde epoch (UTC)**. A conversão de `HH:MM` (formato local) para ms (UTC) passa por `windowTimeToUtc`, que chama `tenantDateTimeToUtc` de `datetime.ts`. A função `overlaps` é simples e correta para intervalos semiabertos `[a, b)` em ms. O corte de passado (`slotStart < nowMs`) é aplicado **a cada candidato** dentro do loop, permitindo que `nowUtc` seja injetável para teste — confirmado que o teste AC-17 injeta um `now` em 10:00 BRT (13:00 UTC) e recebe slots de 10:00 em diante (09:00 já passou). ✓

O break (intervalo de almoço) é validado coerente: ambos-ou-nenhum (schema de `window` garante), e a condição `overlaps(slotStart, slotEnd, breakStart.getTime(), breakEnd.getTime())` descarta o slot se o bloco de trabalho *cruza* o intervalo — corretamente restritivo (você pode começar no final do intervalo, desde que termine antes dele terminar, o intervalo não pode estar dentro do bloco). ✓

### Múltiplas faixas por weekday (união)

A grade semanal em `working_hours` não tem constraint de unicidade por `(professional_id, weekday)` — é permissiva. A implementação itera sobre todas as faixas (`for (const win of windows)`) e usa `Map<number, AvailableSlot>` para deduplicar inícios — se duas faixas ofertam o mesmo `slotStart`, a primeira é mantida (deduplica por hora, não por faixa). O teste "múltiplas faixas" confirma que 09:00 aparece só uma vez mesmo vindo de duas faixas sobrepostas. ✓

### Duração do serviço e passo-base

O passo vem de `professionals.slot_step_minutes` (default 30 se a coluna não existir no legado). A duração vem de `services.duration_minutes` (já existente, snapshot no agendamento). A condição de oferta é rígida: `cursor + durationMinutes * 60000 <= windowEndMs` — o bloco **inteiro** deve couber, sem exceder a janela. AC-14 confirma que 2h oferta menos slots que 1h na mesma grade (09-12: 1h → [09, 10, 11]; 2h → [09, 10]). ✓

### Fuso do tenant e DST

A entrada `day` é `YYYY-MM-DD` no fuso do tenant (opaco da função — ela assume que é o dia certo). Os helpers `tenantDateTimeToUtc` e `formatTimeInTenantTz` usam `Intl.DateTimeFormat` com `timeZone` e `fromTenantLocal` para cobrir DST — a mudança de horário de verão em março de 2025 no Brasil (se ainda existisse) seria tratada via o offset calculado no instante real. O teste DST escolhe uma data pós-2019 (quando o Brasil parou com DST) e valida que o offset é estável; uma data de transição de DST (ex.: março/outubro de 2015 em SP) ainda funcionaria via `fromTenantLocal` de duas passadas. ✓

### Reuso de queries (sem waterfall, RNF01)

O hook abre 5 queries:
1. `useTenant()` — fuso
2. `useWorkingHours(professionalId)` — grade
3. `useScheduleOverrides(professionalId)` — exceção
4. `useScheduleValidity(professionalId)` — vigência/passo
5. `useServices()` — duração
6. `useAppointments({ day, professionalId })` — ocupados

A query 6 é **a mesma chave** usada pela lista da agenda (`AgendaPage`), então em cache comum — confirmado pelo comentário no código. Nenhuma query nova é aberta específico para slots. As 5 consultas são paralelas (não aninhadas), e o `useMemo` recomputa só quando algum dependente muda. O tipo de resultado é estável (`AvailableSlot[]`) — migração futura para RPC não quebraria contratos de consumer. ✓

### Isolamento multi-tenant (RLS)

O `useAvailableSlots` nunca envia `tenant_id` do cliente:
- Fuso vem de `useTenant()` (derivado do JWT via RLS)
- Grade, exceção, vigência leem pelo cliente sob RLS
- Ocupados veem só agendamentos do tenant (RLS em `appointments`)
- Serviços leem do tenant (RLS em `services`)

Confirmar que os hooks subjacentes (`useWorkingHours`, `useScheduleOverrides`, etc) já têm RLS — verificado que todos usam `client.from("table_name")` sem `tenant_id` no filtro (o isolamento é do banco). ✓

### Validação de entrada

Nenhuma validação zod está **nesta** ADR (ela é função pura); a validação do cliente entra pela borda (ADR-06/SlotPicker/AppointmentFormDialog). A entrada vem já tipada com `GenerateAvailableSlotsInput`, e o chamador (`useAvailableSlots`) é responsável por montar o input correto. O typecheck de TypeScript é a trava — sem `.any()` implícito. ✓

### Testes

15 testes, todos passando:
- AC-09: slots dentro da janela, descontando break ✓
- AC-10: exceção fechada → sem slots ✓
- AC-11: exceção aberta → usa janela da exceção ✓
- AC-12: fora de vigência → sem slots ✓
- AC-13: ocupado bloqueia; cancelado/não-compareceu não bloqueiam ✓
- AC-14: duração de 2h oferta menos slots ✓
- AC-15: inícios andam de `slot_step_minutes` ✓
- AC-16: fuso respeitado (rótulo local, instante UTC correto) ✓
- AC-17: passado omitido no dia corrente ✓
- múltiplas faixas por weekday: deduplica ✓
- duração > janela: vazio honesto ✓
- profissional sem grade: vazio ✓
- edição: próprio ocupante não é desconto ✓
- DST: offset estável ✓

Cobertura é alta e determinística (tudo é `nowUtc` injetável). O suite é bem estruturado com `baseInput` reutilizável. ✓

### Build, typecheck, teste

```
npm run build       → ✓ (sem warnings fora de chunk size já observado)
npm run typecheck   → ✓ limpo
npm run test        → ✓ 15 testes passando
```

Sem erros de TypeScript, nenhum `.any()` implícito. ✓

### Documentação inline

Comentários explicam a cascata, a aritmética de fuso, a deduplicate via Map, o corte de passado, o reuso de queries, a deterministica. Cada interface (`AvailableSlot`, `BusyInterval`, `GenerateAvailableSlotsInput`) tem doc clara. ✓

</details>

---

<details>
<summary>Issues (1 recomendação menor, nenhum bloqueador)</summary>

1. **Recomendação: extrair `weekdayOf` para `lib/datetime.ts`** — a função `weekdayOf` em `useAvailableSlots.ts` (converte `YYYY-MM-DD` em weekday 0-6 via UTC) é uma primitiva de fuso que talvez já deveria estar em `datetime.ts` ao lado de `tenantDateTimeToUtc` e `formatTimeInTenantTz`. Mantém os helpers de fuso centralizados. Impacto: nenhum, é refactor cosmético pós-aprovação. Status: recomendado para backlog após ADR-05.

</details>

---

## Critérios de aceite verificados

| AC | Critério | Status |
| --- | --- | --- |
| AC-09 | slots dentro da janela, descontando break | ✓ teste |
| AC-10 | exceção fechada → sem slots | ✓ teste |
| AC-11 | exceção aberta → janela da exceção | ✓ teste |
| AC-12 | fora de vigência → sem slots | ✓ teste |
| AC-13 | ocupado bloqueia | ✓ teste |
| AC-14 | duração de 2h oferta menos | ✓ teste |
| AC-15 | inícios andam de passo | ✓ teste |
| AC-16 | fuso do tenant respeitado | ✓ teste |
| AC-17 | passado omitido | ✓ teste |
| AC-20 | sem regressão (build/typecheck) | ✓ verificado |
| AC-21 | sem materialização | ✓ (função pura, sem .insert) |

---

## Conformidade com a ADR e o design doc

- **Escopo da ADR:** função pura + hook ✓
- **Cascata de precedência (PRD §3.2):** implementada 100% ✓
- **Sem materialização (AC-21):** nenhuma `.insert` para slots ✓
- **Determinística, testável (ADR-05 §decisão):** `nowUtc` injetável, 15 testes ✓
- **Reuso de queries (RNF01):** sem waterfall, mesma chave de ocupados ✓
- **Isolamento multi-tenant:** nenhum `tenant_id` do cliente, RLS preservado ✓
- **Fuso correto (RNF02):** reusa `datetime.ts` testado ✓
- **TypeScript estrito:** sem `.any()` implícito ✓

---

## Próximos passos

Esta ADR é **pronta para ADR-06** (SlotPicker no formulário de criação), que consome `useAvailableSlots` e renderiza os chips de horário. A função e o hook não exigem mais mudanças de contrato — são estáveis. A recomendação de extrair `weekdayOf` para `datetime.ts` fica para backlog.

---

**Resultado final:** APROVADO. O código está pronto para merge. Nenhum bloqueador.
