---
name: deepsearch
description: Detalhe operacional de busca com fonte — quando buscar, hierarquia de fontes, uso de websearch/webfetch/Context7 e template de citação (afirmação — URL — data). O contrato always-on vive em .agents/rules/deepsearch.md.
---

Contrato obrigatório em `.agents/rules/deepsearch.md`; este arquivo é detalhe operacional.

## Quando buscar

Antes de recomendar biblioteca, API, configuração, versão ou padrão que dependa de assinatura, depreciação ou boa prática corrente. Se a afirmação pode ter mudado desde o cutoff do modelo, ela precisa de fonte. Buscar também quando a resposta anterior veio só de memória.

Não buscar para: conceito estável do domínio, decisão já registrada em ADR, ou conteúdo puramente local do repo (nesse caso cite `arquivo:linha`).

## Hierarquia de fonte

1. **Documentação oficial** — site/manual da versão instalada, especificação, referência de API do mantenedor.
2. **Changelog / RFC / issue / release notes** — o "por quê", a depreciação e a data de validade da afirmação.
3. **Artigo técnico identificável** — last resort; nunca sustenta sozinho assinatura de API.
4. **Inferência** — só quando 1–3 não existirem; rotule explicitamente e proponha como verificar.

Conflito entre fontes: a oficial da versão em uso vence; registre a divergência em vez de escolher em silêncio.

## Como buscar (ferramentas confirmadas)

- `websearch(query)` — **descobrir**. Query curta e específica: nome da lib + versão + assunto. Serviços de busca selecionados pelo host; não é fonte por si só, é índice.
- `webfetch(url, format="markdown", timeout≤120)` — **ler**. Abrir a URL encontrada e conferir a assinatura na íntegra antes de escrever código. Markdown é o default; `text`/`html` quando o markdown perder informação.
- `context7_resolve-library-id` → `context7_query-docs` (MCP Context7, quando disponível) — documentação versionada. Alternativa CLI: `ctx7 library` / `ctx7 docs`. Se o servidor não estiver configurado, siga com `websearch` + `webfetch`; nunca finja que consultou.

Nunca aceitar assinatura de API de memória. A fonte consultada é a única autoridade para nomes de método, parâmetros e defaults.

## Template de citação mínimo

`Afirmação — URL — data da consulta (YYYY-MM-DD)`

Exemplo real desta sessão:

> `webfetch` aceita `markdown|text|html` e `timeout` até 120 s — https://opencode.ai/docs/tools — 2026-11-18.

Uma afirmação por citação. Se a frase juntar três fatos de três URLs, escreva três citações.

**Sem fonte = inferência explícita.** Escreva: "inferência (sem fonte consultada); verificar em `<alvo>`". Nunca apresente chute como fato, nunca omita o rótulo.

## Exemplos

**BOM 1 — assinatura verificada antes de recomendar**

> `webfetch` tem parâmetro `format` (`markdown` default) e `timeout` até 120 s; use `markdown` para docs — https://opencode.ai/docs/tools — 2026-11-18.

**BOM 2 — sem fonte disponível, inferência rotulada**

> Inferência (sem fonte consultada): o proxy Vite precisa de `changeOrigin: true` neste cenário; verificar em https://vite.dev/config/server-options antes de aplicar. Não tratar como fato.

**RUIM — memória disfarçada de citação**

> "O método `findMany` recebe `include` e isso always funciona." Sem URL, sem data, sem versão, e a assinatura nunca foi aberta. É o que a rule proíbe: não é citação, é palpite com tom de certeza.

## Referência

As 6 regras do protocolo estão em `.agents/rules/deepsearch.md` (rule always-on, 🟡 processo — a cobrança é revisão de código, nenhum gate negocia por isto). Não as copie para cá nem para prompts de agente: rule é contrato curto, skill é detalhe.
