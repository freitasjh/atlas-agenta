# ADR-05 — Assinaturas UI (tabs, drawer, regularizar, banner inadimplência)

- **Status**: `proposed`
- **Depende de**: ADR-04 (schema + RPCs) + ADR-01 (gating `recorrencia`).
- **RFs**: RF-09, RF-10, RF-11, RF-12.

## Contexto

UX-SPEC B: tabs Ativas/Inadimplentes/Canceladas; card plano; tabela cliente/plano/próxima cobrança/status; drawer (histórico, pausar/retomar, cancelar com motivo, regularizar); banner inadimplência + reenviar WhatsApp. Admin-only.

## Decisão

- Rota `/app/financeiro/assinaturas` (admin-only, `payments===true`, `recorrencia`): tabs 3 estados; drawer por subscription com histórico (charges do ciclo + eventos), ações pausar/retomar/cancelar-com-motivo/regularizar (gera cobrança PIX avulsa do ciclo via ADR-04, nunca duplica pendente); auditoria visível (quem/quando/motivo).
- Banner inadimplência no hub + botão reenviar WhatsApp (opt-in check client-side + server-side; fora janela → template).
- Gating `recorrencia=false/null` → upsell sem request a `membership_*`.

## Consequências

- Positivas: operação completa de recorrência sem tocar ledger/SaaS.
- Negativas: regularizar cria nova cobrança PIX — se cliente já pagou fora, admin registra manual (limitação declarada, sem conciliação automática aqui — ADR-08 cobre banco, não comportamento).

## Escopo

- Entra: page + tabs + table + drawer + banner + hooks + testes gating/RBAC.
- Não entra: schema/RPCs (ADR-04), régua automática (só reenvio manual aqui).

## Arquivos afetados

- `src/app/financeiro/assinaturas/*`
- `src/hooks/useMembership.ts` (TanStack Query leitura RLS)

## Critérios de aceite (testáveis)

1. Tabs filtram corretamente; drawer mostra histórico completo; cancelar exige motivo e grava auditoria.
2. Regularizar inadimplente pago → volta `ativa` sem duplicar pendente do ciclo.
3. Sem opt-in → botão reenviar desabilitado com explicação; com opt-in → mensagem enfileirada (assert fila).
4. Gating + RBAC + DevTools QA (375–1440, Console zero, Network limpo, screenshots).
