# Roteamento de Demandas pelo dev-pipeline — Atlas Agenda

Fonte: `.kiro/steering/workflow-routing.md`. Regra descritiva.

## Regra
- Mudança de código (feature, bugfix, refactor, melhoria que edita arquivos de aplicação) → sempre rodar workflow `.kiro/workflows/dev-pipeline.workflow.json` via run_workflow, inputs.task = demanda, inputs.workdir = /home/joao/fusionlf/wsProjeto/atlas-agenda.
- Consulta de leitura (pergunta, explicação, status, leitura de arquivo) → responder direto, sem workflow.
- Edições mecânicas de infra do próprio Kiro (steering, hook, config de workflow, mcp.json) → orquestrador pode fazer inline; não são código de aplicação e não passam pelo pipeline.

## Por que
Dev-pipeline encadeia análise paralela (PO/Arquiteto backend, Designer frontend) → síntese PRD → gate humano de aprovação → planejamento em ADRs numeradas → loop codificação+review (dois revisores)+QA por ADR → branch nova + PR. Editar código fora do pipeline pula análise de fronteira (isolamento admin↔tenant, multi-tenant/RLS), checkpoint humano, quebra em ADRs, verificação do sistema rodando e code review.

## Encadeamento com prompt-optimizer
Ordem: mensagem do usuário → prompt-optimizer (entende/re-encoda, Rota A ou B) → se mudança, rotear para dev-pipeline carregando bloco PICCO re-encoded como inputs.task. Prompt-optimizer decide o que é a demanda; esta regra decide como ela é executada.

## Exceção explícita
Se o usuário pedir explicitamente para editar código fora do pipeline (ex.: "corrija esse typo agora, sem workflow"), é override consciente: orquestrador atende, mas nomeia que está saindo do pipeline a pedido do usuário.