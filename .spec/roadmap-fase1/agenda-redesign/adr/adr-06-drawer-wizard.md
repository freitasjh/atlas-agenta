# ADR-06 — Drawer + abas + wizard + SlotPicker por turnos

- **Status:** proposta
- **Depende de:** ADR-03 (ações do bloco abrem o Drawer)

## Contexto

`AppointmentFormDialog` tem 789 linhas densas; Guide manda Sheet para 6+ campos (UX-SPEC §2.5). Wizard 3 passos: Quem/O quê → Quando → Revisar. Rascunho localStorage. SlotPicker radiogroup existente vira por turnos. Sem mudança de schema.

## Decisão

- `AppointmentDrawer.tsx` (Sheet `side=right`, mobile `bottom`): abas Dados / Pagamento / Histórico (Histórico read-only de transições).
- Wizard de criação em 3 passos dentro da aba Dados (stepper + validação por passo com zod existente; ends_at/price derivados mantidos); rascunho em `localStorage` com chave por tenant+data, limpar ao salvar/descartar.
- `SlotPicker.tsx`: agrupar slots por turnos (Manhã/Tarde/Noite) mantendo radiogroup + `aria-checked`; conflito local + banco mantidos (R5).
- Edição abre na aba Dados; pagamento delega à aba Pagamento (componentes existentes, sem lógica nova).

## Consequências

- Pró: modal 789 linhas vira fluxo guiado sem reescrever validação.
- Contra: dois modos (criar wizard / editar abas) no mesmo Sheet — rotas de estado documentadas no código.

## Escopo

- Arquivos afetados: `AppointmentDrawer.tsx` (novo, substitui uso do Dialog), `AppointmentFormDialog.tsx` (vira conteúdo da aba Dados / deprecar após migração), `SlotPicker.tsx`, `useAppointmentDraft.ts` (novo).
- Fora: lógica de pagamento, gating, lote.

## Critérios de aceite (testáveis)

- [ ] Criar via wizard 3 passos persiste; rascunho sobrevive a reload e limpa após save.
- [ ] SlotPicker agrupa por turno; teclado + leitor anunciam turno + horário.
- [ ] Clique-em-vazio pré-preenche data/hora como hoje.
- [ ] Drawer mobile = bottom sheet, foco preso, Esc fecha, retorno de foco ao bloco.
