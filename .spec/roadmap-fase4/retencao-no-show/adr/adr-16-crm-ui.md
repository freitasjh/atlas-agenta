# ADR-16 — CRM profundo (E): UI

- Status: proposto

## Contexto

Capacidade E exige drawer "Ficha do cliente" com 6 abas (Resumo/Histórico/Preferências/Notas/Fidelidade/Mensagens), filtros e notas por papel (RF-24..RF-29, UX-SPEC E). Fidelidade consome ADR-15.

## Decisão

1. ClientesPage: drawer com abas; lazy loading por aba; estados loading/empty/error.
2. Resumo: no-show count, última visita, ticket médio (admin only), tags, segmento, opt-in e consentimento LGPD com data.
3. Histórico: lista paginada de atendimentos; valores financeiros apenas admin.
4. Preferências: formulário admin/recepção para profissional preferido, horário, observações, tags, segmento.
5. Notas: criação/leitura conforme papel; profissional vê apenas notas do próprio atendimento.
6. Filtros por tag/segmento/no-show count.
7. Consentimento: UI para registrar/atualizar opt-in e consentimento LGPD.
8. Acessibilidade/responsividade conforme PRD §9.

## Consequências

- Positivas: visão 360°; governança de notas.
- Negativas/risco: risco de vazamento financeiro se RBAC falhar (mitigar testes por papel).
- Defaults PRD §9.

## Escopo

Entra: páginas/componentes/testes. Não entra: backend (ADR-08).

## Arquivos afetados

- `src/app/clientes/ClientesPage.tsx`
- `src/app/clientes/CustomerDrawer.tsx`
- Componentes de abas/filtros
- Testes `*.test.tsx`

## Critérios de aceite (testáveis)

1. Drawer abre com 6 abas e carrega dados por aba.
2. Ticket médio oculto para receptionist/professional.
3. Notas respeitam visibilidade por papel.
4. Filtros funcionam.
5. Consentimento registra data/hora.
6. Console zero erros; breakpoints ok.

## Dependência

- ADR-01 (não direta)
- ADR-08 (backend)
- (ADR-15 consome esta UI para a aba Fidelidade; dependência inversa declarada em ADR-15)
