# ADR-12 — Depósito/sinal (A): UI

- Status: proposto

## Contexto

Capacidade A exige config em ServiceFormDialog, passo "Depósito" no AgendarPage público, badge "Aguardando depósito", drawer com charge e ações (RF-01/RF-02/RF-06, UX-SPEC A). Gating por entitlement `deposito`.

## Decisão

1. ServiceFormDialog (admin): seção de depósito visível apenas com entitlement `deposito`; toggle, tipo %/fixo, valor, prazo, política de reembolso; validação zod; upsell quando sem entitlement.
2. AgendarPage público: quando serviço com depósito, exibir passo "Depósito" com valor e PIX (QR + copia-e-cola), prazo e aviso de reembolso; polling/webhook status; estados loading/success/error.
3. Agenda: badge "Aguardando depósito" no bloco do appointment; drawer exibe charge e ações (reenviar QR, cancelar) conforme RBAC.
4. Gating: sem entitlement, seção/CTA invisíveis + upsell; nenhum request sensível.
5. i18n pt-BR; a11y AA; responsivo 375/768/1024/1440.

## Consequências

- Positivas: UX clara; reduz no-show.
- Negativas/risco: dependência de status em tempo real; polling pode gerar requests (mitigar intervalo).
- Defaults PRD §9: QA DevTools.

## Escopo

Entra: componentes/páginas/testes de gating. Não entra: backend (ADR-02/03), campanhas/fidelidade.

## Arquivos afetados

- `src/app/config/servicos/ServiceFormDialog.tsx` (ou equivalente)
- `src/app/agenda/AgendarPage.tsx`
- `src/app/agenda/AppointmentDrawer.tsx`
- `src/components/...` (badge/upsell)
- Testes `*.test.tsx`

## Critérios de aceite (testáveis)

1. Sem entitlement, seção invisível e upsell; com entitlement, config persiste.
2. Agendamento público cria appointment `aguardando_deposito` e exibe PIX.
3. Badge/drawer refletem status e charge.
4. Ações de drawer respeitam RBAC.
5. Console zero erros; sem rotas duplicadas; breakpoints ok.

## Dependência

- ADR-01 (gating `deposito`)
- ADR-02/ADR-03 (schema/fluxo)
