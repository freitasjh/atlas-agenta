# ADR-10 — UI da agenda por unidade, agregada e conflito cross-unit

- **Status**: Aceito (design congelado)
- **PRD**: §6.3 RF-15..RF-21, §12 D3/D12, W6
- **UX-SPEC**: §5 agenda (grade por unidade, sumário agregado), §11 asserções
- **Depende de**: ADR-03 (conflito/RLS), ADR-04 (`unitId` nas chaves), ADR-05 (transferência), ADR-09 (switcher)
- **Bloqueia**: ADR-13 (agenda mobile do dia reusa bloco/cartão)
- **Escopo de escrita**: `src/app/agenda/`, `src/hooks/useAppointments.ts`, `src/hooks/useAvailableSlots.ts`

## Contexto

A agenda é o ativo mais escasso. No modo unidade, a grade atual continua válida e ganha
dimensão: campo "Unidade" no drawer, chip no bloco quando multi. No agregado, grade lado a
lado produz leitura falsa (W6) — deve virar **sumário por unidade**. O conflito precisa
bloquear por profissional entre unidades, citando a unidade ocupada, e o `SlotPicker` precisa
sinalizar antes do submit. PDV/estoque/recursos/lista de espera são classe B: exigem unidade
(interstitial), sem escolha automática.

## Decisão

### D1 — Agenda em unidade (grade preservada)

`AgendaPage` continua a mesma em `mode="single"`, com:

- `unitId` em todas as chaves de query (`useAppointments`, `useAvailableSlots`,
  `useAgendaPaymentFlags`, `usePendingConfirmations`).
- Bloco de atendimento mostra chip com `short_name` da unidade **somente** quando `isMulti`.
- `AppointmentDrawer`/`AppointmentFormDialog` mostram "Unidade" como campo informativo (não
  editável após criação, exceto transferência explícita) e primeiro campo obrigatório na
  criação.
- Criação usa `requireUnitId()`; em agregado, interstitial de escolha (D3 do UX-SPEC), sem
  FAB (D4).

### D2 — Agenda agregada = sumário por unidade (nunca grade)

Rota agregada (`mode="all"`) renderiza `agenda_units_summary` (ADR-06) como **cards por
unidade**: contadores (total, confirmados, pendentes, em atendimento, conflitos), badge de
conflito/pendente e CTA secundário "Abrir agenda" (navega para `?unidade=<id>` preservando
data/filtros). Zero bloco de grade, zero CTA primário de escrita, zero drag-and-drop.

### D3 — Conflito cross-unit

- **Banco**: constraint existente por profissional × tempo (sem `unit_id`) — ADR-03.
- **Pré-checagem**: `check_professional_conflict` ao montar slots e ao submeter; a mensagem
  nomeia a unidade ocupada apenas se o usuário pode lê-la.
- **`SlotPicker`**: slot indisponível por conflito em outra unidade recebe estado visual e
  texto ("Profissional ocupado em {unidade}"), nunca some sem explicação.
- **Erro `23P01`** no submit é mapeado para a mesma mensagem (defesa em profundidade), com
  foco no campo de horário.

### D4 — Transferência de atendimento entre unidades

Ação explícita no drawer (admin/recepção, nunca automática): escolhe unidade destino,
revalida conflito no intervalo do atendimento **excluindo o próprio atendimento**, e então
move. Histórico financeiro não é reescrito (ADR-07 D3). Transferência cancelada em conflito
mantém o atendimento na origem e exibe a unidade ocupada. Auditada (`appointment.transferred`).

### D5 — Classe B: horários, PDV, estoque, recursos, lista de espera

- **Horários** (`/app/config/profissionais/:id/horarios`): grade por unidade (Q4), com
  "copiar de"; em agregado a edição é bloqueada.
- **PDV**: em agregado abre interstitial com cards de caixa por unidade; fechamento sempre
  com `unit_id` derivado das linhas do ledger.
- **Estoque**: movimento exige unidade; agregado é read-only com coluna Unidade; produto
  continua tenant-level.
- **Recursos**: anti-sobreposição por recurso+unidade; copiar da matriz.
- **Lista de espera**: entradas escopadas à unidade; agregado lê, não escreve.

### D6 — Estados e responsividade

Loading (Skeleton/`aria-busy`), vazio (StatePanel + CTA contextual), erro (retry), gate OFF
(EntitlementGate, zero request), limite (só cadastro), offline (ADR-13). Cabeçalho com
`PageHeader`; filtros existentes preservados; `scrollWidth <= innerWidth` em 375/768/1280/1440.

## Interface congelada

| Símbolo | Contrato |
|---|---|
| Rotas | `/app/agenda` (unidade) e `/app/agenda?unidade=all` (sumário) — mesma rota, comportamento por `mode` |
| Chaves | `useAppointments`/`useAvailableSlots` recebem `unitId` explícito (null = agregado, sem request de grade) |
| Sumário | consome `agenda_units_summary(p_day)`; cards, nunca grade |
| Conflito | RPC `check_professional_conflict` + mapeamento `23P01` |
| Transferência | RPC `transfer_appointment(p_appointment_id, p_to_unit_id)` — revalida conflito, audita |
| Classe B | escrita exige `unitId` não nulo; agregado desabilita CTA |

## Consequências

**Positivas**
- Zero double-booking cross-unit visível e bloqueado.
- Agregado honesto (contadores), sem leitura falsa de grade.
- Classe B não "adivinha" unidade.

**Negativas / custos**
- Toda a agenda precisa passar por chaves com `unitId` — regressão ampla.
- Transferência adiciona fluxo e auditoria.

**Riscos e mitigação**
- *Risco*: pré-checagem divergir da constraint (corrida). *Mitigação*: constraint é a trava;
  pré-checagem é UX; teste de corrida com duas submissões.
- *Risco*: sumário agregado parecer grade. *Mitigação*: asserção QA de ausência de blocos.
- *Risco*: transferência mover receita. *Mitigação*: ADR-07 D3 + teste de recebimento antes/depois.
- *Risco*: chip de unidade poluir single-unit. *Mitigação*: só renderiza com `isMulti`.

## Escopo

**Entra**
- Agenda por unidade, sumário agregado, conflito cross-unit, transferência, classe B,
  estados/a11y, testes de chave e de conflito.

**Não entra**
- Grade lado a lado, drag-and-drop cross-unit, escrita em agregado, sincronização offline
  (ADR-13), redesenho visual da grade.

## Arquivos afetados

| Arquivo | Ação |
|---|---|
| `src/app/agenda/AgendaPage.tsx` | `mode`, sumário vs grade |
| `src/app/agenda/AgendaCalendarWeek.tsx`, `AgendaCalendarDay.tsx` | chip/unidade |
| `src/app/agenda/AppointmentDrawer.tsx`, `AppointmentFormDialog.tsx` | campo Unidade + transferência |
| `src/app/agenda/SlotPicker.tsx` | conflito cross-unit |
| `src/app/agenda/AgendaUnitsSummary.tsx` (novo) + test | cards agregados |
| `src/hooks/useAppointments.ts` | `unitId` + transfer mutation |
| `src/hooks/useAvailableSlots.ts` | pré-checagem por unidade |
| `src/app/pdv/`, `src/app/estoque/`, `src/config/recursos/`, `src/app/lista-espera/` | classe B |
| `src/config/profissionais/horarios/` | grade por unidade |

## Critérios de aceite (testáveis)

- [ ] Em unidade: grade atual funciona; chip aparece só com `isMulti`; drawer mostra unidade.
- [ ] Em agregado: **zero** blocos de grade; cards por unidade com contadores e "Abrir agenda".
- [ ] Agregado não tem CTA primário de escrita nem FAB.
- [ ] Dois atendimentos sobrepostos do mesmo profissional em unidades diferentes: o segundo
      é bloqueado com mensagem citando a unidade ocupada.
- [ ] `SlotPicker` sinaliza slot conflitante com texto, não apenas cor.
- [ ] Transferência com conflito não move; sem conflito move e audita.
- [ ] Recebimento antes da transferência permanece na unidade de origem.
- [ ] PDV/estoque/recursos/lista de espera em agregado não permitem escrita; interstitial
      aparece antes do form.
- [ ] Trocar de unidade refaz requests e não exibe dados da unidade anterior.

## Dependência / ordem

Depois de ADR-09 (switcher/navegação) e ADR-05/06. Antes de ADR-13 (cartão mobile).
