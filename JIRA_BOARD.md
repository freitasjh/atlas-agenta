# JIRA BOARD — Roadmap Fase 1 (Agenda)

## ADR-01 — Núcleo de dados (daySummary/financialMask)
- Status: DONE (approved + higiene aplicada)
- Testes: model 16/16, typecheck limpo

## ADR-02 — ResumoDoDia + filtros
- Status: DONE (approved + fix base cheia re-reviewed)
- Testes: dir 43/43, typecheck limpo

## ADR-03 — Dia 30min + DnD + quick actions + duplicar
- Status: DONE (approved + fix dia-cheio)
- Testes: agenda 189/189, suite 1059+, typecheck limpo

## ADR-04 — Lote sem endpoint batch
- Status: DONE (approved pós-correção; undo removido, contrato {id,from,to})
- Testes: dir 19/19, typecheck limpo

## ADR-05 — Semana com ocupação
- Status: DONE (approved + re-review approved pós-correção: agregado grades + % base cheia)
- Testes: dir 35 files 227/227, tsc limpo

## ADR-06 — Drawer + abas + wizard + SlotPicker
- Status: DONE (approved + 2 fixes rascunho)

## ADR-07 — Gating T1.1 + consumo T2
- Status: DONE (approved + sugestão aplicada)

## ADR-08 — Mobile + a11y (portão final)
- Status: DONE (QA aprovado com ressalvas + D1/D2 corrigidos e re-reviewed)

## Fase 2 — Estética
## ADR-01 — Entitlements T1.2
- Status: DONE (approved)
## ADR-02 — Pacotes backend
- Status: DONE (approved pós 3 iterações; bypass recepção fechado com prova; pgTAP 50 34/34)

## ADR-03 — Aba Prontuário (4ª aba, append-only)
- Status: DONE (approved + correções; upsell alcançável, banner honesto)
## ADR-04 — Wizard de anamnese
- Status: DONE (approved + 3 fixes + re-review approved)
## ADR-05 — Fotos / mapa facial / termo
- Status: DONE (approved pós 2 iterações; mapa UPDATE escopado, setas, Promise.all, conflito termo, typecheck)
## ADR-06 — Pacotes UI (Config, venda, saldo)
- Status: DONE (approved pós-correção; pacote pula PIX — sem dupla cobrança)
## ADR-07 — Checkout clínica (flag aestheticCheckout)
- Status: DONE (approved; reuso 100%, pacote pula cobrança, sem regressão)
## Fase 3 — Salão/Barbearia
## ADR-01 — Entitlements T1.2 (estoque/comissaoProduto)
- Status: DONE (approved)
## ADR-03 — Estoque backend (saldo + movimentações)
- Status: DONE (approved pós 2 iterações; bypass stock_qty fechado)
## ADR-04 — Comissão por produto + fórmula
- Status: DONE (approved; trigger preserva machine/package/G1 snapshot, RF-24)
## ADR-05 — Varejo PDV backend
- Status: DONE (approved pós 1 correção; 7 testes product, 468/468 functions)
## ADR-06 — Split-timing backend
- Status: DONE (approved; 3 sugestoes nao-bloqueantes)
## ADR-07 — Recursos agendáveis backend
- Status: DONE (approved pós 2 iterações; lock + imutabilidade service_id)
## ADR-08 — Produtos & Estoque UI
- Status: DONE (approved pós 1 correção; gating sem request, N:N preservado)
## ADR-09 — Varejo PDV UI
- Status: DONE (approved pós 1 correção)
## ADR-10 — Comissão config & relatório UI
- Status: DONE (approved pós 1 correção)
## ADR-11 — Split-timing & Recursos UI
- Status: DONE (approved pós 1 correção)
## ADR-11 — Split-timing & Recursos UI
- Status: DONE (approved pós 1 correção; H3 E2E aprovado)
## ADR-01 — Entitlements Fase 4
- Status: DONE (approved, 0 corrections)
## ADR-02 — Depósito/sinal schema backend
- Status: DONE (approved, 0 corrections)
## ADR-03 — Depósito fluxo público
- Status: DONE (approved pós 1 correção)
## ADR-04 — Waitlist backend
- Status: DONE (approved pós 1 correção)
## ADR-05 — Campanhas backend
- Status: DONE (approved pós 1 correção)
## ADR-06 — Fidelidade backend
- Status: DONE (approved pós 1 correção)
## ADR-07 — Cupons e gift cards backend + PDV
- Status: DONE (approved, 0 corrections)
## ADR-08 — CRM profundo backend
- Status: DONE (approved, 0 corrections)
## ADR-09 — Relatórios retenção backend
- Status: DONE (approved, 0 corrections)
## ADR-10 — Meu plano + checkout backend
- Status: DONE (approved pós 1 correção)
## ADR-11 — Métricas WhatsApp backend
- Status: DONE (approved, 0 corrections)
## ADR-12 — Depósito UI
- Status: DONE (approved pós 1 correção)
## ADR-13 — Waitlist UI
- Status: DONE (approved, 0 corrections)
## ADR-14 — Campanhas UI
- Status: DONE (approved, 0 corrections)
## ADR-15 — Fidelidade UI
- Status: DONE (approved pós 1 correção)
## ADR-16 — CRM profundo UI
- Status: DONE (approved pós 1 correção)
## ADR-17 — Relatórios retenção UI
- Status: DONE (approved pós 1 correção)
## ADR-18 — Meu plano + WhatsApp métricas UI
- Status: DONE (approved pós 1 correção)
## Fase 4 — Retenção/No-show
- Status: DONE (ADR-01..18 approved; H3 E2E PASS com ressalva)
## ADR-01 — Entitlements T1.4/T1.5
- Status: DONE (approved, 0 corrections)
## ADR-02 — NFCe schema
- Status: DONE (approved, 0 corrections)
## ADR-03 — NFCe emissão + UI
- Status: DONE (approved pós 1 correção)
## ADR-04 — Membership schema + RPCs
- Status: DONE (approved pós 1 correção)
## ADR-05 — Assinaturas UI
- Status: DONE (approved pós 1 correção)
## ADR-06 — Contas a pagar
- Status: DONE (approved pós 1 correção)
## ADR-07 — Receber avulsas
- Status: DONE (approved pós 1 correção)
## ADR-08 — Conciliação bancária
- Status: DONE (approved pós 1 correção)
## ADR-09 — DRE + fluxo de caixa
- Status: DONE (approved pós 1 correção)
## ADR-10 — Export contábil
- Status: DONE (approved pós 1 correção)
## ADR-11 — Back-office T1.4/T1.5
- Status: DONE (approved pós 1 correção; H3 final pendente)
## Fase 5 — Financeiro completo
- Status: DONE (ADR-01..11 approved; H3 E2E aprovado com ressalvas)
## Fix P2 — Overflow conciliação mobile
- Status: DONE (min-w-0 no grid; delta página 0 em 375/1280; scroll interno 118px)
