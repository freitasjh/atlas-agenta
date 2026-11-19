# UX-SPEC — Fase 5 (Financeiro completo)

Fonte da verdade visual: DS real (jade + shadcn/ui + Space Grotesk, dark-first). Pulse não usado.

## Propostas (7 capacidades + back-office, mobile-first 375px, pt-BR)
Nova seção sidebar **Financeiro** (admin-only, payments===true), 7 rotas sob /app/financeiro/*: hub, nfce, assinaturas, pagar, receber, conciliacao, dre, exportar. Back-office T1.4/T1.5 em internal-admin existente (sem rota tenant nova).

A. NFCe: filtros status/período/busca; tabela número/série, cliente, valor, badge, ações (DANFE, XML, cancelar, carta); Sheet Emitir (origem, CPF/CNPJ mask, itens readonly, pagto readonly); estados contingência/rejeição/cancelamento; DANFE modal QR.
B. Assinaturas: tabs Ativas/Inadimplentes/Canceladas; card plano; tabela cliente/plano/próxima cobrança/status; drawer (histórico, pausar/retomar, cancelar com motivo, regularizar); banner inadimplência + reenviar WhatsApp.
C. A pagar: filtros status/fornecedor/vencimento; KPI vencido + 7d; tabela fornecedor/descrição/vencimento/valor/status; Dialog baixa (valor/data/conta/anexo, parcial com resto); recorrência Switch; fornecedor Dialog curto.
D. A receber: tabs Atendimentos (ledger readonly) + Avulsas; criar cobrança (cliente, valor, vencimento, PIX); tabela status + barra pago vs total; ações Cobrar WhatsApp / Registrar recebimento. Receita SSoT = ledger; avulsa categoria própria DRE.
E. Conciliação: conta + período + upload OFX/CSV + saldos; split 2-col (extrato vs lançamentos), match auto; conciliar lote / criar lançamento / ignorar + motivo; mobile tabs; undo 5s.
F. DRE + fluxo: Segmented competência/caixa + PeriodFilter; DRE tabela (Receitas − Custos = Margem − Despesas = Resultado); barras 6m + linha saldo + tabela alternativa; fluxo 30d + saldo acumulado; export CSV.
G. Back-office T1.4/T1.5: internal-admin/empresas aba Operação; assinaturas colunas inadimplência + suspender/retomar + auditoria; metricas MRR/churn/NFCe.
H. Export: form período + formato (CSV/OFX/SPED-resumo) + escopo; download + log; empty sem movimentos.

## Entitlements (T1.4/T1.5): nfce, recorrencia, contasPagar, conciliacao, dreFluxo, exportContabil, backofficeT14, backofficeT15 (default false, null degrada).

## Adesão DS + a11y AA + QA DevTools: 375/768/1024/1440, Console zero, Network sem duplicados, touch 44px, foco, aria-labels, tabelas headers, formulários labels, dark contraste, reduced motion, RBAC, gating sem request sensível, screenshots harness/.
