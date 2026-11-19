# ADR-10 — Export contábil (formato + log + download)

- **Status**: `proposed`
- **Depende de**: ADR-09 (consome `export_logs`; usa DRE/fluxo como fonte).
- **RFs**: RF-36, RF-37, RF-38.

## Contexto

Contador precisa de arquivo válido: período + formato (CSV/OFX/SPED-resumo) + escopo, download + log, nunca arquivo vazio. PRD §10.11 aberta (layout SPED validado?).

## Decisão

- Edge `export-ledger` (admin-only, service_role lê via RLS admin): gera CSV (ledger+avulsas+payables conciliados), OFX (extrato conciliado), SPED-resumo (blocos E1 simplificados — **resumo gerencial, não SPED fiscal válido**; nome na UI: "SPED-resumo (gerencial)" para não prometer validação).
- Vazio → erro legível "sem movimentos no período", sem arquivo, sem log de sucesso (log só em sucesso + tentativa falha com motivo).
- UI `/app/financeiro/exportar` (admin-only, `exportContabil`): form período + formato + escopo; download direto + tabela log (`export_logs` do ADR-09).
- Decisão §10.11: sem validador SPED neste MVP; débito registrado.

## Consequências

- Positivas: contador atendido em 3 formatos; trilha de downloads.
- Negativas: SPED-resumo não substitui fiscal — comunicado na UI e no aceite.

## Escopo

- Entra: Edge + UI + log + gating.
- Não entra: validador SPED, envio automático ao contador.

## Arquivos afetados

- `supabase/functions/export-ledger/index.ts`
- `src/app/financeiro/exportar/*`

## Critérios de aceite (testáveis)

1. Cada formato com movimentos → download válido (CSV parseável, OFX com saldos, resumo com totais = DRE).
2. Período vazio → mensagem legível, nenhum arquivo, nenhum log de sucesso.
3. Log lista todos os exports com autor/data; RLS cross 0; gating sem request.
