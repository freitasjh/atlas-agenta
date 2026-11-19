# PRD — Fase 1: Reestruturação da Agenda (/app/agenda)

> Status: rascunho para aprovação do fundador. Fonte visual: .spec/roadmap-fase1/agenda-redesign/UX-SPEC.md (DS real jade + shadcn/ui + Space Grotesk, dark-first).

## 1. Problema / valor
Agenda funciona mas cobra imposto cognitivo alto: sem resumo do dia (ocupação/R$/a confirmar/no-show), filtros sem hierarquia, ações a 2+ cliques, criação densa (789 linhas), semana sem ocupação, sem gating visível (T1.1).
Valor: confirmação 1-clique + lote + DnD (tempo por operação 3→1 clique), wizard 3 passos (menos erro), KPIs visíveis (menos no-show), gating visível (monetização).

## 2. Escopo (entra)
E1 ResumoDoDia 4 KPIs clicáveis (receptionist sem R$); E2 chips + popover; E3 Dia 30min + DnD intra-dia + quick actions + duplicar + lote; E4 Semana grade/cards + ocupação; E5 Drawer Sheet + abas + wizard + SlotPicker turnos; E6 gating T1.1 leitura + CTA; E7 T2.0/T2.1/T2.2 consome fluxos existentes; E8 mobile + a11y AA.
NÃO entra: backend novo, DnD inter-dia, motor entitlements novo, autoagendamento/taxa/métricas consolidadas, mudança ledger, i18n nova, mudança schema agenda.

## 3. Requisitos por fluxo (F1 confirmar 1-clique, F2 wizard 3 passos, F3 DnD intra-dia, F4 lote sem endpoint batch) — critérios BDD no parecer do product-manager.

## 4. Regras de fronteira
R1 RLS + tenant_id do JWT; R2 RBAC financeiro (receptionist sem R$); R3 ledger append-only (concluir não cria cobrança); R4 máquina de estados; R5 anti-sobreposição (409 com recovery); R6 idempotência; R7 LGPD opt-in; R8 janela 24h WhatsApp; R9 rate limit; R10 bloqueado/cancelado; R11 comissão snapshot (estorno não altera, RF-24).

## 5. Perfis
Admin tudo; professional só própria (com R$ próprio); receptionist sem financeiro (cards sem valores).

## 6. Enquadramento
Fase 1 = agenda + T1.1 leitura + T2.0/T2.1/T2.2 consumo. Pré-requisito T1.0 assumido (badge degrada sem travar). Pós: DnD inter-dia, batch endpoint, autoagendamento, taxa, consolidado, scheduler plano.

## 7. Aceite visual QA
KPIs, chips, Dia 30min+DnD, Semana ocupação, Drawer+wizard, quick actions+lote, SlotPicker turnos, gating T1.1, a11y AA, Network sem 4xx/5xx, Console zero ERROR/WARN, screenshots 1280+375.

## 8. Perguntas em aberto (travam o PLAN)
1. Risco no-show: fórmula simples? 2. Previsto R$: soma quais status? 3. Lote máximo 50? motivo obrigatório? 4. Desfazer 5s basta? 5. Badge números exatos ou faixas? CTA para onde? 6. Receptionist: cards sem R$? 7. Confirmar dispara WhatsApp sempre ou com toggle? 8. Comissão no bloco: só concluído?
