# Roteamento de Demandas pelo dev-pipeline

Regra de roteamento sempre ativa. Toda demanda de **mudança de código** no projeto
atlas-agenda é executada pelo workflow `dev-pipeline`, não implementada direto pelo
orquestrador. Consulta de leitura é isenta.

## A regra

- **Mudança de código** (feature, bugfix, refactor, melhoria que edita arquivos de
  aplicação no backend `atlas-agenda-backend/` ou nas apps frontend
  `atlas-app-web/` / `atlas-admin-web/` / `atlas-landing/`) → **sempre** rodar o
  workflow `.kiro/workflows/dev-pipeline.workflow.json` via `run_workflow`, passando
  `inputs.task` = a demanda e `inputs.workdir` = `/home/joao/fusionlf/wsProjeto/atlas-agenda`.
- **Consulta de leitura** (pergunta, explicação, "onde está X?", "o que Y faz?",
  status, leitura de arquivo) → responder direto, **sem** workflow.
- **Edições mecânicas de infra do próprio Kiro** (steering, hook, config de
  workflow, `mcp.json`) → o orquestrador pode fazer inline; não são código de
  aplicação e não passam pelo pipeline.

## Por que

O `dev-pipeline` encadeia: análise em paralelo (skills PO/Arquiteto no backend,
Designer no frontend) → síntese de um PRD → **gate humano de aprovação do PRD** →
planejamento que quebra a demanda em ADRs numeradas → loop de codificação + review
(dois revisores) + QA (Chrome DevTools MCP) **por ADR** → branch nova + PR. Editar
código de aplicação fora dele pula a análise de fronteira (isolamento admin↔tenant,
multi-tenant/RLS), o checkpoint humano no PRD, a quebra em ADRs codificáveis uma a
uma, a verificação do sistema rodando e o code review. Isso é defeito.


## Encadeamento com o prompt-optimizer

A ordem é: mensagem do usuário → `prompt-optimizer` (entende/re-encoda, Rota A ou
B) → se a demanda for de mudança, rotear para o `dev-pipeline` carregando o bloco
PICCO re-encoded como `inputs.task`. O prompt-optimizer decide *o que* é a demanda;
esta regra decide *como* ela é executada.

## Exceção explícita

Se o usuário pedir explicitamente para editar código fora do pipeline (ex.: "corrija
esse typo agora, sem workflow"), isso é um override consciente: o orquestrador
atende, mas nomeia que está saindo do pipeline a pedido do usuário.
