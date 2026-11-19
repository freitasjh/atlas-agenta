# ADR-08 — Mobile + a11y AA (auditoria final)

- **Status:** proposta
- **Depende de:** ADR-02 a ADR-07 (audita tudo)

## Contexto

E8 transversal: mobile + a11y AA. Base já boa (foco ring, sr-only, tabular-nums, reduced-motion, deep-link ?dia=). Esta ADR é o portão final, não retrabalho de cada tela.

## Decisão

- Auditoria única: bottom sheet em mobile, alvos ≥44pt, estados loading/empty/error/success em cada visão nova, foco gerenciado (Drawer/popover), contraste AA, `prefers-reduced-motion` (DnD sem animação), deep-link `?dia=` preservado nos novos filtros.
- QA DevTools (§5 parecer ux): KPIs, chips, Dia 30min+DnD, Semana ocupação, Drawer+wizard, quick actions+lote, SlotPicker turnos, gating T1.1, Network sem 4xx/5xx, Console zero ERROR/WARN, screenshots 1280+375 arquivados em `harness/`.

## Consequências

- Pró: um portão evita 7 auditorias fragmentadas.
- Contra: acha P1 tarde — mitigar com checklist por ADR já embutido nos aceites anteriores.

## Escopo

- Arquivos afetados: ajustes pontuais de estilo/foco nos componentes das ADRs 02–07; `harness/` screenshots; nenhum componente novo salvo util de a11y.
- Fora: feature nova.

## Critérios de aceite (testáveis)

- [ ] Lighthouse/axe: zero violações críticas nas 3 visões (Lista/Dia/Semana) + Drawer.
- [ ] Teclado puro completa F1 (confirmar), F2 (wizard), F3 (mover), F4 (lote).
- [ ] 375px e 1280px screenshots anexados; Network sem 4xx/5xx; Console zero ERROR/WARN.
