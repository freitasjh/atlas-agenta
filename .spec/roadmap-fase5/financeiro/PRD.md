# PRD — Fase 5 (Financeiro completo)

> **prd-id**: `financeiro` (roadmap Fase 5)
> **Tipo de rota**: Feature (módulo financeiro + back-office T1.4/T1.5)
> **Segmento**: todos os segmentos (salão/barbearia/clínica), com gating por plano/entitlement + segmento `payments`
> **Dono da aprovação**: Product Owner (fundador)
> **Status**: `draft` (aguarda gate humano)
> **Insumo**: UX-SPEC.md (vinculante, 7 rotas + back-office A–H) + roadmap v1.4 Fase 5
> **Base**: agenda, PDV, cobranças/ledger, relatórios, WhatsApp, clientes, backoffice, planos, entitlements, retenção (Fase 4)

## 1. Problema e valor

Hoje o Atlas recebe mas não gerencia dinheiro: sem NFCe, sem recorrência/membership, sem contas a pagar/receber, sem conciliação, sem DRE/fluxo, sem export contador, sem back-office T1.4/T1.5 (MRR/churn/NFCe). Quando pronta: NFCe do atendimento/venda com DANFE; membership com cobrança recorrente e régua WhatsApp; pagar com baixa parcial; receber avulso separado do ledger; conciliação com match auto; DRE + fluxo orientando decisão; export com log; back-office suspende inadimplentes e mede MRR/churn/NFCe.

## 2. Escopo

**Entra (A–H):** A. NFCe (lista, emissão, contingência, cancelamento, carta, DANFE/XML). B. Assinaturas/membership (planos, adesão, tabs, drawer, pausar/retomar/cancelar, regularizar, inadimplência + WhatsApp). C. Pagar (fornecedores, lançamento, KPIs, baixa total/parcial, recorrência). D. Receber (aba Atendimentos readonly ledger + Avulsas PIX, barra pago vs total, cobrar/receber). E. Conciliação (import OFX/CSV, match auto, lote/criar/ignorar, undo 5s). F. DRE + fluxo (competência/caixa, tabela, barras 6m, fluxo 30d, CSV). G. Back-office T1.4/T1.5 (aba Operação, suspender/retomar, MRR/churn/NFCe). H. Export (período + formato + escopo, download + log).

**NÃO entra:** motor entitlements novo (só novas chaves: nfce, recorrencia, contasPagar, conciliacao, dreFluxo, exportContabil, backofficeT14, backofficeT15); multi-unidade; app; fiscal além NFCe; folha; ERP completo; banco automático; alteração do ledger; cross-tenant fora do back-office.

## 3. Objetivo

NFCe com trilha auditável; recorrência com inadimplência controlada; pagar sem atraso surpresa; avulsas cobradas via PIX/WhatsApp; banco conciliado; decisão por DRE/fluxo; contador com export; super admin opera T1.4/T1.5.

## 4. Perfis e impacto

| Perfil | Impacto |
|---|---|
| Admin (dono) | Único em /app/financeiro/* (payments===true); tudo financeiro. |
| Recepção | Sem Financeiro; só recebimento operacional do atendimento. |
| Profissional | Sem Financeiro; só próprios recebimentos operacionais. |
| Cliente | DANFE, cobrança recorrente/avulsa PIX/WhatsApp, aviso inadimplência. |
| Super admin | T1.4/T1.5 em internal-admin (inadimplência, suspender/retomar, MRR/churn/NFCe). |

## 5. Métricas de sucesso

Adoção ≥50% em 60d; NFCe autorizadas ≥95%; inadimplência membership ≤8% em 90d; regularização WhatsApp ≥30%; vencidos pagos em dia ≥85%; conciliação ≥90% ao fechar mês; fechamento ≤5d; export válido ≥98%; MRR/churn 100% meses; vazamento financeiro 0.

## 6. Requisitos funcionais (RF-01..40)

### 6.1 NFCe (A)
- RF-01 Lista fiscal (filtros, tabela, loading/empty/error).
- RF-02 Emissão (Sheet por atendimento/venda, idempotente, vincula origem).
- RF-03 Contingência/rejeição (motivo legível, reemissão, sem duplicar receita).
- RF-04 Cancelamento e carta (prazo, motivo, auditoria, XML/DANFE preservados).
- RF-05 DANFE/XML (modal QR, download, admin-only).
- RF-06 Gating nfce (upsell, sem request fiscal).

### 6.2 Assinaturas (B)
- RF-07 Planos recorrentes por tenant.
- RF-08 Adesão e cobrança (ativa, 1 pendente por ciclo).
- RF-09 Tabs e tabela (Ativas/Inadimplentes/Canceladas).
- RF-10 Drawer (histórico, pausar/retomar, cancelar com motivo, regularizar, auditoria).
- RF-11 Inadimplência (banner + reenvio WhatsApp opt-in; volta a ativa sem duplicar).
- RF-12 Gating recorrencia.

### 6.3 Pagar (C)
- RF-13 Fornecedores por tenant.
- RF-14 Lançamento (vencimento/valor/recorrência sem duplicar).
- RF-15 Lista e KPIs (vencido + 7d).
- RF-16 Baixa total/parcial (resto pendente, anexo storage privado).
- RF-17 Gating contasPagar.

### 6.4 Receber (D)
- RF-18 Aba Atendimentos readonly (ledger SSoT, sem CRUD).
- RF-19 Cobrança avulsa PIX (categoria própria DRE).
- RF-20 Tabela + barra pago vs total.
- RF-21 Cobrar WhatsApp (opt-in, template fora janela) / registrar recebimento (auditoria, nunca no ledger).

### 6.5 Conciliação (E)
- RF-22 Importação OFX/CSV (saldos, rejeita inválido, replay sem duplicar).
- RF-23 Match (valor + data, estados pendente/conciliado/ignorado).
- RF-24 Ações (lote, criar lançamento, ignorar com motivo, auditoria).
- RF-25 Undo 5s (depois só admin auditado).
- RF-26 Gating conciliacao.

### 6.6 DRE + fluxo (F)
- RF-27 DRE (Receitas − Custos = Margem − Despesas = Resultado; avulsas categoria própria; gorjeta fora).
- RF-28 Gráficos 6m + tabela alternativa.
- RF-29 Fluxo 30d + saldo acumulado.
- RF-30 Export CSV + log.
- RF-31 Gating dreFluxo.

### 6.7 Back-office (G)
- RF-32 Aba Operação (assinaturas, inadimplência, auditoria).
- RF-33 Suspender/retomar (bloqueado → quitação, auditado).
- RF-34 Métricas MRR/churn/NFCe (RPC admin-only).
- RF-35 Gating backofficeT14/T15.

### 6.8 Export (H)
- RF-36 Formato e escopo (CSV/OFX/SPED-resumo).
- RF-37 Log e empty (sem arquivo vazio).
- RF-38 Gating exportContabil.

### 6.9 Transversais
- RF-39 Gating nulo (legível, sem crash, sem request sensível).
- RF-40 Idempotência (efeito único em replay).

## 7. Regras de fronteira

RLS tenant_id do JWT em tudo novo; RBAC admin-only Financeiro (403 + RLS); segmento payments===true; ledger SSoT (avulsas fora, categoria própria DRE); *_cents; timestamptz UTC; bloqueado→quitação; cancelado arquiva; NFCe idempotente por origem; opt-in WhatsApp; janela 24h template; webhooks por chave; segredos só Edge; 1 pendente por ciclo/atendimento.

## 8. Enquadramento

Fase 1 → Fase 2 → Fase 3 → Fase 4 → **Fase 5 (este PRD)**. Backend mínimo: fiscal_documents/fiscal_events, membership_plans/subscriptions/charges, suppliers/payables/settlements, receivables/settlements, bank_accounts/statements/lines/reconciliation_links/export_logs + RPCs (DRE, fluxo, MRR/churn, match). Entitlements novos sem motor novo. Integra T1.4/T1.5.

## 9. Aceite QA (DevTools)

375/768/1024/1440 sem scroll; touch 44px; Console zero; Network sem duplicados e sem 4xx/5xx feliz; RBAC validado; gating sem request; dark AA; reduced motion; foco; aria; headers; labels; loading/empty/error; RLS zero cross; idempotência por replay; screenshots em .spec/roadmap-fase5/financeiro/harness/.

## 10. Perguntas em aberto

1. Emissor fiscal: SEFAZ direta ou provedor? Guarda CSC/certificado?
2. Contingência: DANFE provisória vale como comprovante?
3. Prazo/autor do cancelamento fiscal?
4. Membership vs pacotes/cupons: acumula?
5. Dias p/ pausa automática inadimplente; bloqueia agendamento?
6. Resto baixa parcial: nova cobrança ou saldo?
7. Retenção/limites de anexos?
8. Tolerância match; conta por tenant?
9. Competência receita (starts_at vs received_at); grupo avulsas?
10. Datas recorrência no DRE competência?
11. Layout SPED validado?
12. Entitlements por plano?
13. Suspensão T1.4 automática ou manual?
14. MRR/churn (SaaS vs membership)?

## 12. Aprovação humana

> Nenhum `ADRs/**` nasce antes deste bloco estar preenchido pelo humano.

- **Veredito**: `pending`
- **Data**: (a preencher)
- **Aprovador**: Product Owner (fundador)
- **Portão**: P0→P1 (PRD aprovado libera RESEARCH e ADRs)

Checklist:
- [ ] Problema/valor ok.
- [ ] Escopo A–H é MVP correto.
- [ ] Métricas aceitáveis.
- [ ] Não-escopo correto.
- [ ] RBAC admin-only + gating corretos.
- [ ] Fronteiras suficientes.
- [ ] Perguntas respondidas ou delegadas.
- [ ] Autorizo ADRs.
