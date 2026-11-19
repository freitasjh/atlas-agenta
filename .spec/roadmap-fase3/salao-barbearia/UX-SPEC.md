# UX-SPEC — Fase 3 (Salão/Barbearia) — G12/G13/G15

Fonte da verdade visual: DS real (jade + shadcn/ui + Space Grotesk, dark-first). Pulse não usado como tokens.

## Propostas
### 3. Estoque backbar+varejo
3.1 ProdutosPage (CRUD, padrão ServicosPage, tabela desktop/cards mobile, gating plano+segmento, RBAC). 3.2 EstoquePage (painel: KPIs alertas, lista com status OK/Baixo/Crítico, ações por linha). 3.3 Baixa por atendimento (Dialog, pré-selecionados, pode pular → pendência). 3.4 Reposição (form Card: produto, lote, validade, qtd, custo, fornecedor). 3.5 Inventário (wizard 2 etapas: escopo + contagem com diff âmbar, ajuste com motivo).

### 4. Varejo no PDV
Segmented control Serviço | Produto (varejo) | Combo. Produto: select com estoque, stepper qty, preço read-only, total calculado, comissão preview (se canViewCommission). Esgotado desabilitado + alerta inline. Checkout PaymentCaptureDialog (reuso). RBAC: receptionist registra sem ver comissão/total? PDV exibe total da venda (necessário para cobrança).

### 5. Comissão fórmula + produto
Config: tipo de comissão serviço (% ou (preço−backbar)×%), % comissão, comissão por produto (%), backbar por serviço (opcional, fallback). Preview em tempo real.
Relatório: coluna Origem (Serviço|Produto|Combo), breakdown por profissional, filtro Origem, tooltip fórmula.

### 6. Split-timing (coloração)
processamento_minutos separado de duracao_minutos. Bloco exibe faixa sólida jade (atendimento) + faixa listrada âmbar (processamento). Legenda colapsável. Processamento não bloqueia outros agendamentos mas bloqueia recurso vinculado. aria-label inclui as duas durações.

### 7. Recursos agendáveis
RecursosPage (nome, tipo Sala/Equipamento/Cadeira, capacidade, ativo, cor). Vinculação em ServiceFormDialog (recurso necessário + qtd). Agenda: chip no bloco, filtro Recurso, view opcional "Por recurso". Conflito de recurso → SlotPicker motivo "Recurso ocupado".

## A11y AA: contraste, 44px, foco, aria-live, reduced-motion, teclado. Estados: loading/erro/empty/sucesso/gating/segmento. QA: 375/768/1024/1440, Console zero, Network sem duplicados, RBAC por papel, gating, dark mode, reduced motion, teclado.
