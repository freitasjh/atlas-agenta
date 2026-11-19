# ADR-03 — NFCe emissão + UI (Sheet, contingência, DANFE/XML, carta)

- **Status**: `proposed`
- **Depende de**: ADR-02 (schema + RLS).
- **RFs**: RF-01, RF-02, RF-03, RF-04, RF-05, RF-06.

## Contexto

Com schema pronto, falta emitir e exibir. Perguntas PRD §10.1–10.3 (provedor vs SEFAZ direta, contingência, prazo cancelamento) estão abertas; não podem bloquear MVP. UX-SPEC A define: filtros, tabela, Sheet Emitir (origem, CPF/CNPJ mask, itens readonly, pagto readonly), estados contingência/rejeição/cancelamento, DANFE modal QR.

## Decisão

- Emissor via **provedor-abstração**: Edge Function `issue-nfce` com interface `FiscalProvider { authorize, cancel, correct }`; implementação v1 = stub auditado (grava `pendente → autorizada|contingencia|rejeitada` + `fiscal_events`) atrás de feature/env, sem certificado no repo. Troca por SEFAZ/provedor real sem mudar schema/UI.
- Contingência: status `contingencia` exibe motivo legível + botão reemitir (replay idempotente pela unique origem); nunca duplica receita (sem toque no ledger).
- Cancelamento/carta: Edge `cancel-nfce` valida prazo/motivo, grava evento, preserva XML/DANFE; auditoria com `created_by`.
- UI `/app/financeiro/nfce` (admin-only, `payments===true`, entitlement `nfce`): filtros status/período/busca; tabela número/série, cliente, valor, badge, ações; Sheet Emitir; DANFE modal QR + download XML; upsell quando `nfce=false/null` sem request fiscal.

## Consequências

- Positivas: MVP fiscal funcional e auditável; provedor trocável; UI testável sem SEFAZ.
- Negativas: stub não autoriza de verdade — débito explícito registrado (`TODO fiscal provider real`, PRD §10.1).
- Riscos: DANFE provisória em contingência — decisão: exibe marca "contingência, sem valor fiscal" (PRD §10.2 respondida provisoriamente).

## Escopo

- Entra: 2 Edges + UI lista/sheet/modal + máscara CPF/CNPJ + RBAC + gating.
- Não entra: certificado/CSC guarda (env/supabase secrets, fora do código), SPED, multi-documento por origem.

## Arquivos afetados

- `supabase/functions/issue-nfce/index.ts`, `supabase/functions/cancel-nfce/index.ts`
- `supabase/functions/_shared/fiscal.ts` (provider interface + zod)
- `src/app/financeiro/nfce/*` (page, table, sheet, danfe modal, hooks TanStack Query)
- `supabase/migrations/*_fiscal_rpcs.sql` (se RPC leitura for necessária)

## Critérios de aceite (testáveis)

1. Emitir do atendimento → 1 linha `autorizada|contingencia`; replay mesma origem → mesma linha (sem duplicar).
2. Rejeição mostra motivo legível + reemitir funciona; cancelamento exige motivo, preserva XML, grava evento com autor.
3. Gating: `nfce=false/null` → upsell, zero request a `fiscal_*` (Network assert); recepção/profissional → sem rota (403/redirect).
4. QA DevTools: 375/768/1024/1440 sem scroll quebrado; Console zero; DANFE modal com QR; screenshots em `harness/`.
