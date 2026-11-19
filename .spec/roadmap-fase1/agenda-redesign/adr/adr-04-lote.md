# ADR-04 — Lote sem endpoint batch (N chamadas + undo 5s)

- **Status:** proposta
- **Depende de:** ADR-03 (reusa transição de status/quick action do Dia)

## Contexto

F4: lote sem endpoint batch. Fundador: máximo 50 (Q3), motivo opcional (Q3), desfazer 5s basta (Q4). Sem backend novo; idempotência (R6); janela 24h WhatsApp (R8) tratada no ADR-07.

## Decisão

- Seleção por checkbox nos blocos (máx 50; acima disso bloqueia com mensagem) + barra de lote (Confirmar / Cancelar + motivo opcional via `StatusChangeConfirm` existente).
- Execução = N chamadas à mutação existente em sequência com `Promise.allSettled`; parcial mostra resumo "X ok, Y falharam" + retry só dos falhados; cada chamada carrega idempotency-key própria (R6).
- Undo 5s: toast com "Desfazer" reverte apenas as transições bem-sucedidas dentro da janela (chamada inversa por item).

## Consequências

- Pró: zero backend/migration; erro isolado por item.
- Contra: N requests (até 50) — aceitável na Fase 1; batch endpoint fica pós-Fase 1.

## Escopo

- Arquivos afetados: `useBulkSelection.ts` (novo), `BulkActionBar.tsx` (novo), `useBulkTransition.ts` (novo); `AgendaPage.tsx` (fiação), `StatusChangeConfirm.tsx` (reuso motivo opcional).
- Fora: endpoint batch, DnD inter-dia, WhatsApp.

## Critérios de aceite (testáveis)

- [ ] Selecionar 51º bloqueado com mensagem de limite.
- [ ] Lote 10 itens com 2 falhas → resumo 8/2 + retry só dos 2.
- [ ] Undo dentro de 5s reverte os aplicados; após 5s toast expira sem erro.
- [ ] Motivo vazio aceito; com motivo, repassado a todos os itens.
- [ ] Network: N calls individuais, nenhuma rota `/bulk`/`/batch`.

## Nota de implementação (desvio aprovado no review)
- Undo 5s REMOVIDO: a máquina de estados torna a transição inversa impossível (confirmado→pendente inválido; cancelado final). Lote declara irreversibilidade honesta; sem botão/toast Desfazer; só retry dos falhados.
- Motivo/idempotencyKey REMOVIDOS do contrato: BulkTransitionCall = {id, from, to} (espelha mutateAsync); BulkStatusConfirm é confirmação pura sem textarea.
