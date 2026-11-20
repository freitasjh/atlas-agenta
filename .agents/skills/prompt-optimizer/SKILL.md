---
name: prompt-optimizer
description: Gate de entrada de demandas de mudança — Stage 0 (brain literal + probe do repo), contagem de E1..E6, Rota A/Rota B, ledger de premissas e bloco PICCO com contexto citado.
---

# Prompt Optimizer v3

Portão de entrada de toda demanda de **mudança**. Consulta factual ao repo pula o gate. O default escolhido pelo modelo não é o default do usuário — lacuna preenchida em silêncio é requisito inventado.

## Stage 0 — contexto antes do score

Antes de contar E1..E6, nesta ordem:

1. **Brain literal:** `brain_search(query=<prompt do usuário, literal>, top_k=3)`. Paráfrase já é interpretação — não reescreva a query.
2. **Probe do repo (somente leitura):** `AGENTS.md` (stack/comandos), `harness.config.json` (`targets.*`, `commands.*`), globs de alto nível (`*.md` na raiz, `.agents/rules/*.md`) e o eixo detectado em `harness.config.json.targets`.

Saída do Stage 0: fatos citáveis (`arquivo:linha` ou brain path) para o `<context>`. O probe **nunca** preenche lacuna do usuário — só diz onde a demanda cai. Nada é escrito.

## Os 6 elementos

Score = elementos **afirmados** / 6.

| # | Elemento | Checagem | Ausente = |
|---|----------|----------|-----------|
| E1 | Objetivo | O que muda no mundo quando estiver pronto? | crítico |
| E2 | Escopo | O que entra e o que NÃO entra? | crítico |
| E3 | Contexto | Módulo/domínio/tela/endpoint afetado | alto |
| E4 | Restrições | O que não pode quebrar? | alto |
| E5 | Critério de aceite | Como se sabe que ficou pronto? | médio |
| E6 | Intenção de rota | Feature / Bugfix / Refactor / Melhoria? | médio |

**Presente = o usuário AFIRMOU.** O que a IA deduziu conta como ausente. E1 ou E2 ausentes = gate fechado.

## Rotas

**Rota A (score < 6/6).** PARAR. Nenhuma outra skill, subagente ou artefato — nada é criado. Máximo 3 perguntas, ordenadas E1 > E2 > E3 > E4 > E5 > E6, na [forma canônica](references/clarifying-questions.md#formato-de-saida-da-rota-a). Máximo 2 rodadas; na 2ª sem fechamento, 2 interpretações com o que muda no resultado e pedido de desempate.

**Rota B (score = 6/6).** Re-encoding em bloco PICCO ([template](references/picco-template.md)) com 1 confirmação antes de executar. Bloco efêmero: chat + prompt de delegação, nunca arquivo.

**Conflito de regra primeiro.** Violar regra do projeto é contradição, não ambiguidade: nomear a regra com caminho, oferecer o caminho permitido mais próximo, perguntar sobre exceção explícita em `workflow-state.json.overrides`. Violador **e** incompleto: conflito primeiro, Rota A depois.

**Exceção — consulta.** `show status`, `onde paramos?`, `o que Y faz?`, leitura de `workflow-state.json`: pulam Stage 0, score e confirmação. `add feature X`, `skip X` não pulam.

## Ledger de premissas

Premissa não confirmada que sobreviveu ao estoque (inferência marcada "parcial" na Rota A, ou premissa da 1ª rodada não respondida na 2ª) **não** vira fato e **não** entra no PICCO. Vai para o estado:

```json
"prompt_assumptions": [
  { "texto": "...", "elemento": "E3", "at": "<ISO-8601>" }
]
```

Append-only; um item por premissa, com o elemento que a originou. Confirmação do usuário remove o item e promove o texto para `<context>` com citação. Ledger é rastro, não autorização para executar.

## Bloco PICCO (Rota B)

```xml
<role>[critério de comportamento + o que conta como defeito — nunca persona]</role>
<task>Entregar [E1] em [E3].</task>
<context>[E2 + E3 + E6; cada afirmação de contexto cita arquivo:linha ou brain path]</context>
<constraints>Sempre: [E4 positivas] · Nunca: [violações concretas]</constraints>
<acceptance>[E5 — comando/verificação observável, não adjetivo]</acceptance>
<open_questions><!-- Rota B: vazio --></open_questions>
```

Quatro regras: **≤ 10 constraints**; **role = critério, não persona**; **positivas primeiro**; **nunca escrever nem sugerir "pense passo a passo"** (CoT escrito degrada modelo de raciocínio).

`<context>` DEVE citar `arquivo:linha` ou brain path para toda afirmação que não veio literalmente do prompt. `<acceptance>` DEVE ser executável. Exemplos bons e ruins + contagem de constraints: `references/picco-template.md`.

## Brain (depois)

Padrão que se repete 2x → `brain_store(layer="regras", path="projeto/prompt-patterns/<elemento>-<padrao>", scope="projetos")` com lacuna, pergunta que resolveu e resposta. 1 ocorrência é coincidência.

## Verificação

| # | Verificação | Critério |
|---|-------------|----------|
| V1 | Prompt vago real | Rota A, ≤3 perguntas, zero artefato |
| V2 | Prompt claro real | Rota B, PICCO válido, 1 confirmação |
| V3 | padrão `Tier <n>` nos 2 call sites | 0 |
| V4 | `prompt-optimizer` em `workflow-rules.md` | ≥ 1 |
| V5 | Constraints por exemplo em `references/picco-template.md` | ≤ 10 |
| V6 | `workflow-state.json` | JSON válido, `type` presente (string não vazia; valor é dado do ciclo, não invariante) |

V1/V2 são comportamentais: sem runner de LLM não são executáveis nesta suíte — ficam **declaradas, não provadas**. V3..V6 são executadas por `.opencode/plugins/__tests__/prompt-optimizer.spec.mjs`.

## Arquivos

`references/picco-template.md` · `references/clarifying-questions.md` · `fixtures/` (10 prompts, 7 Rota B / 3 Rota A).
