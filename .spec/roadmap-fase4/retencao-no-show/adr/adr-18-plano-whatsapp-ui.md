# ADR-18 — Meu plano + métricas WhatsApp (G/H): UI

- Status: proposto

## Contexto

Capacidade G exige evolução da PlanoPage com estados completos e checkout self-service; capacidade H exige WhatsAppPage com tabs Conexão/Mensagens/Métricas (RF-35..RF-41, UX-SPEC G/H). Gating por `checkoutSelfService`; métricas admin only.

## Decisão

1. PlanoPage: plano atual, uso vs quota, fatura, histórico, opções de upgrade/downgrade, checkout self-service; estados loading, bloqueado, cancelado, upgrade confirm, pagamento pendente, sucesso, erro.
2. Checkout inicia apenas com entitlement `checkoutSelfService`; sem entitlement mostra upsell; polling de status.
3. WhatsAppPage: tabs Conexão/Mensagens/Métricas; métricas exibem KPIs (enviadas, entregues, lidas, confirmadas, respostas, falhas, ban risk) e log filtrável.
4. Métricas apenas admin; receptionist/professional sem acesso.
5. Acessibilidade/responsividade conforme PRD §9.

## Consequências

- Positivas: autoatendimento e operação do canal.
- Negativas/risco: dependência de webhook/polling; risco de confusão de estados.
- Defaults PRD §9.

## Escopo

Entra: páginas/componentes/testes. Não entra: backend (ADR-10/11).

## Arquivos afetados

- `src/app/config/plano/PlanoPage.tsx`
- `src/app/whatsapp/WhatsAppPage.tsx`
- Componentes de estados/métricas
- Testes `*.test.tsx`

## Critérios de aceite (testáveis)

1. PlanoPage renderiza estados conforme status.
2. Checkout inicia e reflete sucesso/erro.
3. WhatsApp tabs funcionam; métricas exibem KPIs/log.
4. Não-admin bloqueado nas métricas.
5. Console zero erros; breakpoints ok.

## Dependência

- ADR-01 (gating `checkoutSelfService`)
- ADR-10 (checkout backend)
- ADR-11 (métricas backend)
