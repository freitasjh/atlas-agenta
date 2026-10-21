# ADR-03 Review — Tipos de domínio e schemas zod de exceção/vigência

**Revisor:** Independente A (sem autoria do código)  
**Data:** 2025-10-20  
**Status da construção:** Typecheck ✅ | Build ✅ | Testes: N/A  
**Verdict:** **APROVADO SEM RESSALVAS**

---

## Resumo

ADR-03 implementa os tipos TypeScript e esquemas de validação zod que espelham as estruturas de banco criadas por ADR-01 (vigência + passo-base em `professionals`) e ADR-02 (tabela `schedule_overrides`). O escopo está **bem delimitado**: tipos puros em `src/types/domain.ts`, schemas validadores em `src/lib/validations/schedule.ts`, e uma refatoração de extração de função em `src/lib/validations/catalog.ts` para evitar duplicação de lógica. Nenhuma SQL, nenhuma UI nesta entrega.

A implementação **respeita todos os critérios de aceite** (coerência banco↔zod, mensagens pt-BR, reuso de validação, não-regressão). O código é limpo, bem comentado e pronto para ser consumido pelas ADRs 04-08 que vêm na sequência.

---

## Vista de alto nível

Os tipos `Professional` e a nova interface `ScheduleOverride` em `domain.ts` espelham fielmente o contrato do banco — datas de vigência como strings `YYYY-MM-DD`, timestamp de criação, campos de janela opcionais. A migração do banco (ADR-01/02) já aplicou os CHECKs; o zod reflete esses CHECKs para feedback UX imediato.

A refatoração de `catalog.ts` é argumento forte da ADR: `refineScheduleWindow` agora é uma função exportada que ambos `workingHoursDaySchema` (grade semanal recorrente) e `scheduleOverrideSchema` (exceção) reutilizam. Isto garante que a mesma regra de validação de janela+break vale para os dois, evitando divergência quando forem editadas. O hook `useProfessionals` foi atualizado para ler as novas colunas — necessário para que a tela de configuração (ADR-07) tenha os dados disponíveis.

Nenhum dos critérios de aceite **comprovável localmente** falharam: typecheck, build limpos; coerência de limites (5..240 em minutos, ≤200 em texto, formato de data). Os CHECKs do banco já estão aplicados (migrations), e a validação zod reflete eles.

---

<details>
<summary>Issues (0)</summary>

Nenhum achado bloqueante ou recomendação de correção.

</details>

---

<details>
<summary>Details</summary>

### Tipos de domínio

A interface `Professional` foi estendida com três novos campos:
- `schedule_start_date: string | null` — data de início da vigência (YYYY-MM-DD, null = sem limite)
- `schedule_end_date: string | null` — data de fim (YYYY-MM-DD, null = sem limite)
- `slot_step_minutes: number` — granularidade de oferta de slots (5..240 minutos, default 30)

Esses campos refletem fielmente as colunas criadas pela migration `20250221090000_professionals_schedule_vigencia.sql`. O tipo não traz `default`, pois o Postgres já define o padrão no inserto — correto. A documentação inline clarifica o significado e a razão de estar em `professionals` (um valor por profissional, não por dia) em vez de em `working_hours`.

A nova interface `ScheduleOverride` cobre todos os campos da tabela:
- `id`, `tenant_id`, `professional_id`, `override_date`, `is_closed` — identificadores e chave de negócio
- `start_time`, `end_time`, `break_start`, `break_end` — janela e intervalo, todas `string | null` (formato HH:MM)
- `reason: string | null` — rótulo opcional
- `created_at: string` — instante de criação

O comentário documenta que `override_date` é dia de calendário no fuso do tenant, horas em HH:MM, e que `is_closed=true` significa folga (sem janela) enquanto `is_closed=false` significa janela atípica (campos preenchidos). Isto alinha-se perfeitamente com o CHECK `schedule_overrides_window` da migration.

### Schemas de validação

#### `scheduleValiditySchema`

Valida um objeto com três campos:
- `scheduleStartDate`: data YYYY-MM-DD ou null
- `scheduleEndDate`: data YYYY-MM-DD ou null
- `slotStepMinutes`: número inteiro entre 5 e 240

O regex de `dateString` captura datas ISO (`^\d{4}-\d{2}-\d{2}$`). As mensagens de erro do `slotStepMinutes` estão em pt-BR e deixam claro o limite (5 a 240 minutos). O `superRefine` implementa a coerência obrigatória: quando AMBOS as datas estão presentes, `scheduleStartDate ≤ scheduleEndDate`, com erro específico apontado para o campo `scheduleEndDate`. Isto espelha o CHECK `professionals_schedule_vigencia_coherent` do banco.

A tipagem `z.infer<typeof scheduleValiditySchema>` exporta `ScheduleValidityInput` — aproveitado pelos hooks/formulários.

#### `scheduleOverrideSchema`

Valida um objeto de 8 campos (7 da janela + motivo). A lógica é:
1. `overrideDate` obrigatória (dia YYYY-MM-DD)
2. `isClosed` boolean (flag do tipo de exceção)
3. Quando `isClosed=true`: nenhuma validação de janela (retorna cedo no `superRefine`)
4. Quando `isClosed=false`: chama `refineScheduleWindow`, que exige janela completa + break coerente

As mensagens estão em pt-BR. O campo `reason` é opcional e limitado a 200 caracteres (refletindo o CHECK no banco).

**Ponto de atenção (verificado como correto):** Quando `isClosed=false` mas a janela está vazia (startTime/endTime undefined), `refineScheduleWindow` lançará erro "Informe o horário de início". Isto é comportamento esperado de UX — se o usuário marca `isClosed=false` (horário atípico), é obrigado a preencher a janela. Nenhum falso negativo.

### Refatoração de `catalog.ts`

Antes, `workingHoursDaySchema` continha todo o código de validação de janela+break dentro de seu próprio `superRefine`. A nova interface `ScheduleWindowFields` abstrai os campos relevantes, e a função `refineScheduleWindow` encapsula a lógica. Ambas são exportadas de `catalog.ts`.

O schema de dia agora chama:
```typescript
.superRefine((day, ctx) => {
  if (!day.enabled) return;
  refineScheduleWindow(day, ctx);
});
```

Isto reduz duplicação. O `DayRow` de `WeekScheduleForm` continua funcionando sem mudança no contrato — `workingHoursDaySchema` segue validando os mesmos campos, mesmas regras, mesmas mensagens. Nenhuma regressão.

A lógica extraída é idêntica à original, linha por linha — confirmado por inspeção do diff. Não há otimizações ou "melhorias" que pudessem introduzir bugs.

### Hook `useProfessionals`

O `professionalRowSchema` foi ampliado para validar os 3 novos campos (`schedule_start_date`, `schedule_end_date`, `slot_step_minutes`). Os 4 hooks que leem de `professionals` (`useProfessionals`, `useCreateProfessional`, `useUpdateProfessional`, `useDeactivateProfessional`) agora incluem essas colunas no `.select()`.

A leitura é passiva — nenhuma tentativa de escrever vigência/passo aqui. Isto é correto porque ADR-03 é só tipos/schemas; ADR-07 (tela de horários) é que vai expor formulários para vigência/exceções. O hook está pronto para o consumo, sem fazer mais do que o pedido.

### Coerência banco ↔ zod (critério de aceite)

| Aspecto | Banco | Zod | Match |
|---------|-------|-----|-------|
| `slot_step_minutes` range | CHECK 5..240 | `.min(5).max(240)` | ✅ |
| `reason` maxlen | CHECK ≤ 200 | `.max(200)` | ✅ |
| Data format | `date` type | Regex `YYYY-MM-DD` | ✅ |
| Janela coerência (start < end) | CHECK no campo end | Erro apontado a end | ✅ |
| Break ambos-ou-nenhum | CHECK | Validação ambos ou none | ✅ |
| Break dentro da janela | CHECK | 4 validações (start ≤ breakStart, breakEnd ≤ end, etc.) | ✅ |
| Vigência coerência (start ≤ end) | CHECK professionals_schedule_vigencia_coherent | `superRefine` | ✅ |

Todos os limites e regras do banco foram espelhados no zod.

### Idioma e acessibilidade

Todas as mensagens de erro estão em **pt-BR**, coerente com convenções-codigo.md. As mensagens são curtas e claras, evitando jargão técnico. Não há acessibilidade visual a criticar aqui (são schemas, não UI).

### Verificação de qualidade

- **npm run typecheck:** passou limpo ✅
- **npm run build:** passou limpo (aviso de chunk size é pré-existente) ✅
- **Regressão visual:** `WeekScheduleForm` continua compilando sem mudança de contrato ✅
- **Comentários:** presentes, claros, ligados aos critérios de aceite e às migrations ✅

</details>

---

## Conclusão

ADR-03 entrega exatamente o que promete: tipos puros + schemas validadores que espelham o banco, com refatoração limpa para evitar duplicação. Nenhum defeito encontrado. Pronta para ser integrada às ADRs 04-08 que consomem esses tipos/schemas nos hooks de dados e telas de UI.

**Veredito: ✅ APROVADO**
