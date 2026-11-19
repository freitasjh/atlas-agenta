# ADR-08 — Conciliação bancária (import + match + ações + undo)

- **Status**: `proposed`
- **Depende de**: ADR-06 + ADR-07 (precisa de payables/receivables para linkar).
- **RFs**: RF-22, RF-23, RF-24, RF-25, RF-26.

## Contexto

Banco conciliado: import OFX/CSV com saldos, match automático (valor + data), estados pendente/conciliado/ignorado, ações em lote/criar lançamento/ignorar com motivo, undo 5s. PRD §10.8 aberta (tolerância, contas por tenant).

## Decisão

- `bank_accounts`: `id, tenant_id, nome, banco, agencia_conta (cripto? não — só últimos 4, LGPD), saldo_inicial_cents`.
- `bank_statements`: `id, tenant_id, account_id, periodo_ini/fim, saldo_ini/fim_cents, arquivo_hash unique (tenant_id, arquivo_hash)` → replay sem duplicar; rejeita inválido com erro legível.
- `bank_lines`: `id, tenant_id, statement_id, data, descricao, valor_cents, status (pendente|conciliado|ignorado)`.
- `reconciliation_links`: `bank_line_id unique, alvo_tipo (payable|receivable|manual), alvo_id, created_by, created_at`; undo 5s = delete link client-side imediato (otimista); depois só admin auditado via evento.
- Match RPC `suggest-matches`: score valor exato + |Δdata| ≤ 2d (tolerância provisória §10.8: exato centavos, janela 2 dias); 1 conta por tenant default, N contas suportadas.
- UI `/app/financeiro/conciliacao` (admin-only, `conciliacao`): conta + período + upload + saldos; split 2-col (extrato vs lançamentos), mobile tabs; lote/criar/ignorar+motivo; undo toast 5s.

## Consequências

- Positivas: fechamento mensal ≥90% mensurável; import replay-safe.
- Negativas: match simples (sem ML); tolerância fixa até calibragem.

## Escopo

- Entra: migrations + parser OFX/CSV Edge ou client-side validado + match RPC + UI + gating.
- Não entra: banco automático/Open Finance (não-escopo PRD).

## Arquivos afetados

- `supabase/migrations/*_conciliacao.sql`
- `supabase/functions/import-statement/index.ts` (+ parser OFX/CSV)
- `src/app/financeiro/conciliacao/*`, `src/hooks/useConciliacao.ts`

## Critérios de aceite (testáveis)

1. Upload mesmo arquivo 2x → 1 statement (hash dedupe); arquivo inválido → erro legível, 0 linhas.
2. Match sugere par valor exato ±2d; conciliar lote linka N linhas; ignorar exige motivo; undo 5s desfaz; após 5s só admin com auditoria.
3. Gating `conciliacao=false/null` → upsell sem request; RLS cross 0; PII: extrato não loga conta completa.
