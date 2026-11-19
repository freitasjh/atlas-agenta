# ADR-14 — Campanhas (C): UI

- Status: proposto

## Contexto

Capacidade C exige `/app/campanhas` com presets, segmentação, preview, métricas e reuso de TemplatesMensagemPage (RF-12..RF-14, UX-SPEC C). Gating por entitlement `campanhas`.

## Decisão

1. CampanhasPage (admin): lista de campanhas por status; criação com preset (win-back, aniversário, rebooking, custom), segmentação (tags, última visita, no-show, serviço), agendamento de envio, seleção de template.
2. Biblioteca de templates reutiliza TemplatesMensagemPage; variáveis e preview.
3. Preview mostra contagem e excluídos por opt-in.
4. Métricas por campanha: enviadas, entregues, lidas, respostas, conversões.
5. Estados loading/empty/error; gating sem entitlement mostra upsell.
6. Acessibilidade/responsividade conforme PRD §9.

## Consequências

- Positivas: reativação operável; reuso de templates.
- Negativas/risco: risco de spam se limites não claros (backend ADR-05).
- Defaults PRD §9.

## Escopo

Entra: páginas/componentes/testes. Não entra: backend (ADR-05).

## Arquivos afetados

- `src/app/campanhas/CampanhasPage.tsx`
- `src/app/.../TemplatesMensagemPage.tsx` (reuso)
- Componentes de preview/métricas
- Testes `*.test.tsx`

## Critérios de aceite (testáveis)

1. CRUD de campanha em rascunho/agendada.
2. Preview retorna contagem e excluídos.
3. Métricas exibidas por campanha.
4. Sem entitlement, upsell e nenhum request sensível.
5. Console zero erros; breakpoints ok.

## Dependência

- ADR-01 (gating `campanhas`)
- ADR-05 (backend)
- ADR-08 (segmentação/opt-in)
