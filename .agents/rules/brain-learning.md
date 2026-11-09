# Aprendizado no Brain (via MCP) — Atlas Agenda

Fonte: `.kiro/steering/brain-learning.md`. Regra descritiva.

## Por que MCP e não CLI
Binário CLI apenas faz spool num arquivo e não cria nota pesquisável. Hook de command não chama ferramenta MCP. Registro é sempre o agente chamando brain_store (MCP).

## Antes de qualquer mudança de código (obrigatório)
Rodar brain_search em 3 passes (nunca só com project): 1) sem filtro `brain_search("<assunto>", top_k=10)` varredura larga; 2) `scope="global"` para padrões reutilizáveis (micro-saas, backoffice, RLS, Supabase); 3) `project="atlas-agenda"` para contexto específico. Ler integral com `brain_read(path)` nos hits que decidem. Busca vazia não é ausência — tentar sem filtro antes de concluir.

## Depois de cada demanda que gerou aprendizado (obrigatório)
Gravar com brain_store (MCP) quando a execução produziu algo durável: decisão de arquitetura/design (e porquê/alternativas descartadas); bug resolvido com causa raiz; convenção/padrão novo; armadilha evitada (isolamento multi-tenant por RLS, RBAC, idempotência de webhook); mudança de contrato (endpoint/Edge Function, env var, migration Supabase). Não gravar quando foi só leitura, pergunta respondida ou mudança trivial.

## Onde gravar — scope vs project (não confundir)
- `scope` = eixo universal vs específico. `project` = dono + link (owned vs linked).
- Específico atlas-agenda → `scope="projetos"`, `project="atlas-agenda"`, `path="atlas-agenda/<assunto>"`. Ex: regra de negócio do salão, fluxo de agenda.
- Reutilizável micro-saas/backoffice/infra → `scope="global"`, `project` omitido (ou origem para proveniência), `path="<dominio>/<assunto>"` sem prefixo de projeto, `tags` para busca. Ex: RLS multi-tenant, tenant-less JWT, backoffice admin, cents BIGINT, Edge Functions. Depois linkar consumo com `brain_project_link(note_path, "atlas-agenda")` — sem link, `project="atlas-agenda"` não enxerga global de outro projeto.
- Diário de desenvolvimento → layer `sessoes`, sem scope, `project="atlas-agenda"`, `path="atlas-agenda/<AAAA-MM-DD>-<assunto-curto>"`.
- Antes de gravar: `brain_project_list` (evita typo que cria projeto fantasma: `mobile`≠`mobile-erp`≠`mobile_erp`) + `brain_search` (evita duplicata; prefere atualizar nota existente).
- Path nunca repete layer/scope, nunca começa com `/` ou `..`, nunca duplica prefixo (`regras/projetos/regras/...` é bug de remontagem — copiar `path` de `brain_search`, não remontar).

## Piso de densidade (anti-aprendizado-ralo — obrigatório)
Runtime só valida forma (`layer/path/scope/≤256KiB/≤64 chunks` em `brain-mcp/src/lib.rs:122`). Densidade é regra de processo aqui:
- `regras`/`arquitetura`: mínimo 800 chars + seções `## Contexto` + `## Decisão` + `## Motivo` (+ `## Alternativas` quando houve descarte) + ≥1 tag. Sem código ou SQL quando aplicável = ralo.
- `estudos`: mínimo 1500 chars + Resumo + Conceitos + Exemplos Práticos com código real + Armadilhas + Referências + frontmatter `tags/topico/fonte`. Sem código = reprovado, aprofundar e salvar de novo.
- `sessoes`: máximo 1200 chars, só status/próximo/bloqueio. Handoff, não conhecimento. Conhecimento vai para `regras/arquitetura/estudos`.
- Auto-cheque antes de `brain_store`: tem exemplo? tem motivo? cobre caso real? `len> piso`? Se não, não gravar fino — condensar com nota existente do mesmo assunto e sobrescrever.
- Preferir 1 nota densa global linkada (`brain_project_link`) a 5 notas finas `projetos` duplicadas.

## Encadeamento com dev-pipeline
Mudança de código roda pelo dev-pipeline. Quando run termina, aprendizado relevante deve ser gravado no brain pela orquestração — mesma regra de layer/path/scope.