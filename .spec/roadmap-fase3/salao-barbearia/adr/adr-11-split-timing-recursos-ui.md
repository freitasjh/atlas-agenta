# ADR-11 — Split-timing & Recursos UI (agenda, SlotPicker, view por recurso)

- Status: proposto

## Contexto

UX-SPEC §6-7: processamento_minutos separado; bloco exibe faixa sólida jade (atendimento) + faixa listrada âmbar (processamento); legenda colapsável; processamento não bloqueia outros agendamentos mas bloqueia recurso vinculado. RecursosPage (nome, tipo, capacidade, ativo, cor); vinculação em ServiceFormDialog (recurso necessário + qtd); Agenda: chip no bloco, filtro Recurso, view opcional "Por recurso"; conflito de recurso → SlotPicker motivo "Recurso ocupado". Base: ADR-06/07, ADR-01.

## Decisão

Frontend:

- ServiceFormDialog: campos processing_minutes (min) e recursos necessários (select + qty).
- Agenda block: renderiza faixa sólida (duration) + faixa listrada (processing) com aria-label incluindo as duas durações; legenda colapsável (reduced-motion respeitado).
- SlotPicker: ao selecionar slot, valida conflito de recurso (RPC `check_resource_conflict`) além de profissional; motivo "Recurso ocupado" quando conflito.
- RecursosPage: CRUD recurso (nome, tipo, capacidade, cor, ativo) padrão ServicosPage; gating por entitlement `estoque`? Recursos não tem entitlement próprio no contrato atual → visível para salão/barbearia via segment `payments`? Decisão: recursos visível quando `payments === true` (segmento salão/barbearia) e não bloqueado por entitlement (sem upsell de plano no MVP, apenas gating de segmento). Documentar.
- Agenda: chip do recurso no bloco; filtro por recurso; view "Por recurso" (RPC list_appointments_by_resource).
- A11y: cor nunca único sinal (tipo+nome), contraste, 44px, foco, reduced-motion, teclado, aria-live para conflito.

## Consequências

- Positivas: visual claro (sólido/listrado); conflito no SlotPicker; view por recurso.
- Negativas/risco: renderização de duas faixas exige cálculo de largura; testes de UI + harness (screenshots).
- Performance: evitar re-render em drag; memoização.

## Escopo

Entra: páginas/componentes/hooks/i18n. Não entra: backend (ADR-06/07).

## Arquivos afetados

- `src/app/agenda/*` (AgendaPage, SlotPicker, bloco)
- `src/app/config/servicos/ServiceFormDialog.tsx`
- `src/app/config/recursos/RecursosPage.tsx` (novo)
- `src/hooks/useResources.ts`
- `src/i18n/messages/pt-BR.ts`, `en-US.ts`
- Rotas.

## Critérios de aceite (testáveis)

1. Bloco exibe faixa sólida + listrada com durações corretas; aria-label inclui ambas.
2. Legenda colapsável funciona por teclado; reduced-motion respeitado.
3. SlotPicker bloqueia slot com recurso ocupado (motivo exibido).
4. RecursosPage CRUD valida zod; capacidade >=1.
5. View "Por recurso" lista appointments do recurso no dia.
6. 375/768/1024/1440 sem scroll-X; Console zero; dark mode; teclado.

## Dependência

ADR-06, ADR-07, ADR-01. (Dados antes das telas.)