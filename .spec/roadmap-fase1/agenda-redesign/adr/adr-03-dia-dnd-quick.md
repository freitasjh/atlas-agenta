# ADR-03 — Dia 30min + DnD intra-dia + quick actions + duplicar

- **Status:** proposta
- **Depende de:** ADR-02 (filtros definem lista visível do Dia)

## Contexto

UX-SPEC §2.3: grade 30min, linha do agora, fora-expediente rotulado, DnD com fallback teclado + aria-live, conflito com recovery (R5), quick actions 1-clique (F1 confirmar), dropdown vira overflow, Duplicar. Sem DnD inter-dia, sem endpoint batch.

## Decisão

- `AgendaCalendarDay.tsx`: slots 30min, `now-line`, faixa fora-expediente a partir de `working_hours`.
- DnD **intra-dia apenas** (mesmo `professional_id` + mesma data): HTML5 DnD + handler teclado (setas + Enter) + `aria-live` anunciando moves; `onDrop` → update `starts_at/ends_at` existente; conflito → 409 com recovery (mantém bloco na origem + toast com "ver conflito").
- Quick actions no bloco: Confirmar / Iniciar / Concluir / Editar / Pagamento (1 clique cada); "Mudar status" restante vai para overflow menu. Confirmar respeita Q7 (ver ADR-07 para WhatsApp — aqui só muda status).
- Duplicar: clona atendimento (mesmo serviço/profissional, próximo slot livre sugerido), sem copiar pagamento/comprovante.

## Consequências

- Pró: 3→1 clique sem mudar máquina de estados (R4) nem ledger (R3).
- Contra: DnD intra-dia limita UX inter-dia (pós-Fase 1).

## Escopo

- Arquivos afetados: `AgendaCalendarDay.tsx`, `AppointmentBlock.tsx` (quick actions + overflow), `useDayDnD.ts` (novo), `duplicateAppointment.ts` (novo).
- Fora: lote, Semana, Drawer, SlotPicker novo, gating.

## Critérios de aceite (testáveis)

- [ ] Mover bloco 09:00→09:30 persiste e re-renderiza; cross-professional/cross-data recusado no `dragover`.
- [ ] Teclado: foco no bloco + setas move slot, Enter confirma, Esc cancela; `aria-live` anuncia.
- [ ] Confirmar pendente→confirmado em 1 clique; Concluir com `paymentsFeature` abre `PaymentCaptureDialog` existente (sem mudar ledger).
- [ ] Sobreposição → toast 409 + bloco volta à origem (teste com mock 409).
- [ ] Duplicar cria cópia sem `appointment_payments`/`charges`.
