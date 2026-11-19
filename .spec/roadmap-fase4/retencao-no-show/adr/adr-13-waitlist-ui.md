# ADR-13 — Waitlist (B): UI

- Status: proposto

## Contexto

Capacidade B exige `/app/lista-espera`, CTA na agenda ao slot ocupado, oferta automática com countdown e Confirmar/Recusar (RF-07..RF-10, UX-SPEC B). Gating por entitlement `waitlist`.

## Decisão

1. ListaEsperaPage (admin/recepção): tabela/cards de entradas por serviço/profissional, filtros, prioridade, validade, ações reordenar/remover/marcar atendida/expirada.
2. CTA na agenda: ao tentar agendar slot ocupado, oferecer "Entrar na lista de espera" com formulário (cliente, serviço, profissional, período, prioridade).
3. Oferta automática: modal/drawer com countdown e ações Confirmar/Recusar; Confirmar cria agendamento; Recusar/expirar passa ao próximo.
4. Estados loading/empty/error; gating sem entitlement mostra upsell e não dispara request sensível.
5. Acessibilidade e responsividade conforme PRD §9.

## Consequências

- Positivas: recuperação de slots; UX operacional.
- Negativas/risco: concorrência na confirmação (tratada no backend); countdown precisa ser claro.
- Defaults PRD §9.

## Escopo

Entra: páginas/componentes/testes. Não entra: backend (ADR-04).

## Arquivos afetados

- `src/app/lista-espera/ListaEsperaPage.tsx`
- `src/app/agenda/AgendaPage.tsx` (CTA)
- Componentes de oferta/countdown
- Testes `*.test.tsx`

## Critérios de aceite (testáveis)

1. Entradas listadas/filtradas/ordenadas.
2. CTA cria entrada idempotente.
3. Oferta exibe countdown e Confirmar/Recusar funciona.
4. Gestão manual atualiza estado.
5. Sem entitlement, upsell e nenhum request sensível.
6. Console zero erros; breakpoints ok.

## Dependência

- ADR-01 (gating `waitlist`)
- ADR-04 (backend)
