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

Rodar `brain_search` em 3 passes (nunca só com project): 1) sem filtro `brain_search("<assunto>", top_k=10)` varredura larga; 2) `scope: "global"` para padrões reutilizáveis (micro-saas, backoffice, RLS, Supabase); 3) `project: "atlas-agenda"` para contexto específico. Ler integral com `brain_read(path)` nos hits. Se houver demanda
roteada ao `dev-pipeline`, essa busca também vale como contexto do planejador.

## Depois de cada demanda que gerou aprendizado (obrigatório)

Gravar com `brain_store` (MCP) quando a execução produziu algo durável:

- decisão de arquitetura ou design (e o porquê / alternativas descartadas);
- bug resolvido **com causa raiz**, não só o sintoma;
- convenção ou padrão novo descoberto no código;
- armadilha evitada (ex.: isolamento multi-tenant por RLS, RBAC, idempotência de webhook);
- mudança de contrato: endpoint/Edge Function, variável de ambiente, migration Supabase.

Não gravar quando foi só leitura, pergunta respondida ou mudança trivial.

### Onde gravar (layer / path / scope vs project)

`scope` = eixo universal vs específico. `project` = dono + link. Não confundir.

- Específico atlas-agenda → `scope: "projetos"`, `project: "atlas-agenda"`, `path: "atlas-agenda/<assunto>"`.
- Reutilizável micro-saas/backoffice/infra → `scope: "global"`, `project` omitido, `path: "<dominio>/<assunto>"` sem prefixo de projeto, `tags` para busca. Depois linkar com `brain_project_link(note_path, "atlas-agenda")` — sem link, filtro `project` não enxerga global de outro projeto.

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

### Piso de densidade (anti-aprendizado-ralo)
Runtime só valida forma (layer/path/scope/≤256KiB/≤64 chunks). Densidade é processo:
- `regras`/`arquitetura`: mínimo 800 chars + `## Contexto` + `## Decisão` + `## Motivo` + ≥1 tag.
- `estudos`: mínimo 1500 chars + Resumo + Conceitos + código real + Armadilhas + Referências + frontmatter `tags/topico/fonte`.
- `sessoes`: máximo 1200 chars, só handoff. Conhecimento vai para `regras/arquitetura/estudos`.
- Preferir 1 nota densa global linkada a 5 finas duplicadas.

## Encadeamento com o dev-pipeline

Mudança de código roda pelo `dev-pipeline` (ver `workflow-routing.md`). Quando um
run termina, o aprendizado relevante do que foi construído deve ser gravado no
brain pela orquestração — mesma regra de layer/path/scope acima.
