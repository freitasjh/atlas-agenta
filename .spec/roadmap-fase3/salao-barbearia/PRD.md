# PRD — Fase 3 (Salão/Barbearia) — Estoque / Varejo / Comissão / Split-timing / Recursos

> Status: proposta — aguarda aprovação do fundador. Fonte UX vinculante: UX-SPEC.md.

## 1. Problema e valor
Salão/barbearia não tem estoque nem varejo no produto: custo por atendimento invisível, sem comissão por produto, sem split-timing (coloração) nem recurso agendável (sala/cadeira). Pronto: estoque backbar+varejo com baixa por atendimento, varejo no PDV, comissão por produto + fórmula (preço−backbar)×%, split-timing, recursos agendáveis, gating por plano/segmento. Caixa rastreável no ledger único, sem segundo financeiro.

## 2. Escopo
Entra: G12 estoque (produtos + backbar/varejo, baixa por atendimento, reposição, inventário, alertas), G13 comissão por produto + fórmula, G15 split-timing + recursos, varejo no PDV, gating T1.2/T1.3 (estoque/comissão-produto por plano+segmento). NÃO entra: motor entitlements novo, multi-unidade, app, autoagendamento/taxa/métricas consolidadas (Fase 3 produto), financeiro completo (NFCe/membership), financeiro novo.

## 3. Requisitos (RF-01..RF-25)
- Produtos: CRUD (nome, SKU, categoria backbar/varejo/ambos, unidade, custo, preço venda, mínimo, ativo, profissionais N:N), RBAC admin, gating segmento+plano.
- Estoque: listagem com status OK/Baixo/Crítico, KPIs de alerta, movimentações (baixa por atendimento, reposição, ajuste inventário), reposição (lote/validade/fornecedor), inventário (wizard 2 etapas, divergência com motivo).
- Varejo PDV: segmented Serviço|Produto|Combo, venda produto (select estoque, stepper qty, preço read-only, total, comissão preview), esgotado desabilitado, estoque insuficiente bloqueia, baixa automática + comissão por produto.
- Comissão: tipo (% sobre preço ou (preço−backbar)×%), % comissão, comissão por produto (%), backbar por serviço; preview real-time; relatório com coluna Origem + breakdown + filtro; tooltip fórmula.
- Split-timing: processamento_minutos separado de duracao_minutos; bloco com faixa sólida (atendimento) + listrada (processamento); legenda; processamento não bloqueia cadeira mas bloqueia recurso vinculado.
- Recursos: CRUD (nome, tipo Sala/Equipamento/Cadeira, capacidade, ativo, cor); vinculação a serviço e agendamento; conflito de recurso no SlotPicker; view "Por recurso".

## 4. Fronteiras: RLS tenant_id do JWT; RBAC (receptionist sem financeiro); ledger append-only RF-24; *_cents/UTC; anti-sobreposição; bloqueado/cancelado; segredos só Edge/env; cor nunca único sinal.

## 5. Perfis: matriz admin/professional/receptionist (recepção registra venda/baixa operacional sem financeiro).

## 6. Enquadramento: Fase 1 (agenda/PDV) → Fase 3 (estoque/varejo/comissão-produto/split/recursos). Backend novo: tabelas produtos/estoque/movimentações/recursos + RPCs.

## 7. Aceite QA: 375/768/1024/1440 sem scroll-X, Console zero, Network sem duplicados, RBAC por papel, gating, dark mode, reduced motion, teclado, estados, screenshots harness/.

## 8. Perguntas (travam PLAN): 1. backbar obrigatório ou opcional por serviço? 2. inventário: divergência acima de X% bloqueia finalização? 3. recurso: capacidade >1 no MVP? 4. split-timing: processamento bloqueia recurso de cadeira? 5. comissão por produto: % sobre preço de venda ou custo? 6. varejo: bloquear venda com estoque 0 ou permitir negativo? 7. receptionist vê total da venda atual no PDV? 8. gating: estoque/comissão-produto por qual plano?
