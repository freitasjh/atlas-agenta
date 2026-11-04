# Aprendizado no Brain (via MCP) — Atlas Agenda

Fonte: `.kiro/steering/brain-learning.md`. Regra descritiva.

## Por que MCP e não CLI
Binário CLI apenas faz spool num arquivo e não cria nota pesquisável. Hook de command não chama ferramenta MCP. Registro é sempre o agente chamando brain_store (MCP).

## Antes de qualquer mudança de código (obrigatório)
Rodar brain_search com project "atlas-agenda" para recuperar contexto e evitar reinventar decisões. Buscar pelo assunto da demanda.

## Depois de cada demanda que gerou aprendizado (obrigatório)
Gravar com brain_store (MCP) quando a execução produziu algo durável: decisão de arquitetura/design (e porquê/alternativas descartadas); bug resolvido com causa raiz; convenção/padrão novo; armadilha evitada (isolamento multi-tenant por RLS, RBAC, idempotência de webhook); mudança de contrato (endpoint/Edge Function, env var, migration Supabase). Não gravar quando foi só leitura, pergunta respondida ou mudança trivial.

## Onde gravar
Sempre project "atlas-agenda" e scope "projetos". brain_store já prefixa layer/scope automaticamente no caminho final; path deve ser relativo, começando direto no projeto (não repetir layer nem scope).
- Diário de desenvolvimento → layer sessoes, path atlas-agenda/<AAAA-MM-DD>-<assunto-curto>.
- Decisão de arquitetura durável → layer arquitetura, path atlas-agenda/<assunto>.
- Regra/convenção nova → layer regras, path atlas-agenda/<assunto>.
Conteúdo conciso e específico: o que foi decidido/descoberto e por quê. Preferir atualizar nota existente do mesmo assunto a criar duplicatas.

## Encadeamento com dev-pipeline
Mudança de código roda pelo dev-pipeline. Quando run termina, aprendizado relevante deve ser gravado no brain pela orquestração — mesma regra de layer/path/scope.