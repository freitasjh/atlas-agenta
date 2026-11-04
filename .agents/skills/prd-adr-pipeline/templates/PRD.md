# PRD — <título curto da feature>

> **prd-id**: `<prd-id>` (kebab-case; casa com `.spec/prd/<prd-id>/`)
> **Dono da aprovação**: <papel/pessoa>
> **Status**: draft | approved | archived
> **Mapa das 16 seções**: §1, §2, §5, §6, §7, §9 e §16 são **obrigatórias**
> (marcadas `[obrigatória]`); §3, §4, §8, §10–§15 são recomendadas.
> Orçamento (NFR-5): PRD ≤120 linhas; nenhuma seção >15 linhas.

## 1. Problema [obrigatória]
<A dor em linguagem de negócio. Sem solução, sem tecnologia.>
> ❓ Validação: a dor existe hoje e dói o bastante para justificar a mudança? (sim/não)

## 2. Objetivo [obrigatória]
<Resultado observável esperado, mensurável, sem descrever solução.>
> ❓ Validação: o objetivo é mensurável e não é uma solução? (sim/não)

## 3. Contexto e evidências
<Dados, links e medições que sustentam o problema.>

## 4. Público e impacto
<Quem é afetado e como.>

## 5. Métricas de sucesso [obrigatória]
| Métrica | Como medir | Meta |
|---|---|---|
| <métrica> | — | <meta> |
> ❓ Validação: ao menos uma métrica tem a coluna "como medir" preenchida? (sim/não)

## 6. Escopo [obrigatória]
<O que ENTRA nesta entrega.>
> ❓ Validação: o escopo é fechado o bastante para caber em um ADR? (sim/não)

## 7. NÃO entra [obrigatória]
- <o que fica FORA, explícito — por construção não-vazio>
> ❓ Validação: o que não entra está declarado, não inferido? (sim/não)

## 8. Riscos e mitigação
<Maior risco e como reduzi-lo.>

## 9. Requisitos funcionais [obrigatória]
<RF numerados, um por linha, cada um verificável.>
> ❓ Validação: cada requisito é verificável por um teste? (sim/não)

## 10. Histórias de usuário
- Dado <contexto>, Quando <ação>, Então <resultado>.

## 11. UX / experiência
<Fluxo principal e estados de erro.>

## 12. Dependências
<O que precisa existir antes.>

## 13. Segurança
<Dado sensível, autenticação, superfície nova.>

## 14. Perguntas abertas
<O que ainda não sabemos.>

## 15. PICCO (prompt da demanda)
<task>tarefa única e verificável</task>
<context>contexto mínimo para executar</context>

## 16. Aprovação [obrigatória]
- **Veredito**:
- **Data**:
- **Portão**:
> ❓ Validação: o owner aprovou (veredito + data) antes de qualquer ADR? (sim/não)
