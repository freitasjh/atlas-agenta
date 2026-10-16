# Aprendizado no Brain (via MCP)

Regra sempre ativa. O brain precisa **aprender com o desenvolvimento** do projeto
atlas-agenda. O panorama estático (visão geral, fases) já existe; o que faltava é o
aprendizado contínuo. Esta regra garante que ele seja gravado — como nota real no
brain, via as ferramentas **MCP** `brain_search` / `brain_store`, nunca via o
binário CLI `brain`.

## Por que MCP e não o CLI

O binário CLI (`.../brain hook --event ...`) apenas faz *spool* num arquivo e não
cria nota pesquisável. Além disso, hook de `command` não chama ferramenta MCP, e
hook `agent` só injeta prompt. Quem viveu a sessão e sabe o que virou aprendizado é
o agente — então o registro é sempre o agente chamando `brain_store` (MCP).

## Antes de qualquer mudança de código (obrigatório)

Rodar `brain_search` com `project: "atlas-agenda"` para recuperar contexto e evitar
reinventar decisões já tomadas. Buscar pelo assunto da demanda. Se houver demanda
roteada ao `dev-pipeline`, essa busca também vale como contexto do planejador.

## Depois de cada demanda que gerou aprendizado (obrigatório)

Gravar com `brain_store` (MCP) quando a execução produziu algo durável:

- decisão de arquitetura ou design (e o porquê / alternativas descartadas);
- bug resolvido **com causa raiz**, não só o sintoma;
- convenção ou padrão novo descoberto no código;
- armadilha evitada (ex.: isolamento multi-tenant por RLS, RBAC, idempotência de webhook);
- mudança de contrato: endpoint/Edge Function, variável de ambiente, migration Supabase.

Não gravar quando foi só leitura, pergunta respondida ou mudança trivial.

### Onde gravar (layer / path / scope)

Sempre `project: "atlas-agenda"` e `scope: "projetos"`.

**Importante:** `brain_store` já prefixa `layer/scope/` automaticamente no caminho
final. O parâmetro `path` deve ser **relativo**, começando direto no projeto — não
repita a layer nem o scope (passar `regras/projetos/atlas-agenda/...` duplica o prefixo
e gera `regras/projetos/regras/projetos/atlas-agenda/...`).

- **Diário de desenvolvimento** → `layer: "sessoes"`,
  `path: "atlas-agenda/<AAAA-MM-DD>-<assunto-curto>"`.
- **Decisão de arquitetura durável** → `layer: "arquitetura"`,
  `path: "atlas-agenda/<assunto>"`.
- **Regra / convenção nova** → `layer: "regras"`,
  `path: "atlas-agenda/<assunto>"`.

Conteúdo conciso e específico: **o que** foi decidido/descoberto e **por quê**.
Preferir atualizar uma nota existente do mesmo assunto a criar duplicatas.

## Encadeamento com o dev-pipeline

Mudança de código roda pelo `dev-pipeline` (ver `workflow-routing.md`). Quando um
run termina, o aprendizado relevante do que foi construído deve ser gravado no
brain pela orquestração — mesma regra de layer/path/scope acima.
