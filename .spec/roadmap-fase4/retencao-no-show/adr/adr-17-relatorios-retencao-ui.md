# ADR-17 — Relatórios de retenção (F): UI

- Status: proposto

## Contexto

Capacidade F exige extensão do RelatoriosHubPage com cards e 3 páginas (`/app/relatorios/retencao`, `/utilizacao`, `/ticket`) com gráficos Recharts + tabela acessível, filtros e export CSV (RF-31..RF-34, UX-SPEC F). Admin only.

## Decisão

1. Hub: cards Rebooking/No-show/Utilização/Ticket médio/Retenção por coorte/WhatsApp com métricas resumo e links.
2. Páginas: filtros por período/profissional/serviço; gráficos (Recharts) + tabela acessível; export CSV client-side.
3. Estados loading/empty/error; permissão negada para não-admin.
4. Acessibilidade: tabela alternativa, headers, foco gerenciado, aria-labels; reduced motion.
5. Responsividade conforme PRD §9.

## Consequências

- Positivas: decisão orientada a dados.
- Negativas/risco: gráficos podem ser pesados (lazy load).
- Defaults PRD §9.

## Escopo

Entra: páginas/componentes/testes. Não entra: backend (ADR-09).

## Arquivos afetados

- `src/app/relatorios/RelatoriosHubPage.tsx`
- `src/app/relatorios/RetencaoPage.tsx`
- `src/app/relatorios/UtilizacaoPage.tsx`
- `src/app/relatorios/TicketPage.tsx`
- Testes `*.test.tsx`

## Critérios de aceite (testáveis)

1. Cards exibem métricas resumo.
2. Páginas renderizam gráfico + tabela.
3. Filtros alteram dados.
4. Export CSV gera arquivo válido.
5. Não-admin bloqueado.
6. Console zero erros; breakpoints ok.

## Dependência

- ADR-01 (não direta)
- ADR-09 (backend)
