---
name: template-deepsearch
description: Busca pelo estado da arte em templates e arquiteturas de componentes (shadcn/Radix, headless UI, design tokens, CVA, etc.) via deepsearch (websearch/webfetch). Exige citação de fonte (URL) + data. Decisões baseadas em evidência.
license: MIT
---

# Template Deepsearch — Estado da Arte em Templates

Skill para pesquisar o estado da arte em templates/arquiteturas de componentes e fundamentar decisões de design system em evidência.

## 1. Quando Usar

- Novo componente sem precedente no Pulse.
- Dúvida sobre padrão (controlled vs uncontrolled, compound vs flat).
- Avaliar bibliotecas (shadcn/ui, Radix, Headless UI, Ariakit, React Aria).
- Decisão de tokenização (design tokens, CVA, tailwind-variants).

## 2. Ferramentas (Deepsearch)

Use as ferramentas de busca disponíveis:
- `websearch` — descoberta de fontes (docs, artigos, RFCs).
- `webfetch` — leitura aprofundada de uma URL.

Não invente resultados. Toda afirmação precisa de fonte verificável.

## 3. Protocolo de Pesquisa

1. **Definir pergunta** clara e delimitada (ex.: "como shadcn/ui estrutura Button com CVA?").
2. **Buscar** com `websearch` (2–4 queries complementares).
3. **Ler** as 3–5 fontes mais relevantes com `webfetch`.
4. **Extrair** padrões recorrentes (convergência entre fontes).
5. **Citar** cada decisão com URL + data de acesso (ISO-8601).
6. **Registrar** no Brain (`brain_store`, scope projetos/global) se for regra reutilizável.

## 4. Formato de Citação (OBRIGATÓRIO)

```markdown
### Decisão: <resumo>
- **Fonte**: <URL>
- **Acessado em**: YYYY-MM-DD
- **Padrão observado**: <descrição>
- **Aplicação no Pulse**: <como adaptar>
```

Decisão sem citação = inválida. Se não houver fonte, marcar como "suposição — validar".

## 5. Temas de Referência (estado da arte)

- **shadcn/ui + Radix**: componentes headless + estilização Tailwind; CVA para variantes.
- **Headless UI (Tailwind Labs)**: comportamento acessível sem estilo.
- **React Aria (Adobe)**: hooks de acessibilidade.
- **Ariakit**: primitivos acessíveis.
- **Design Tokens (W3C)**: formato de tokens, temas, dark mode.
- **CVA / tailwind-variants / clsx**: composição de classes.
- **Compound components**: padrão de composição.
- **Controlled vs uncontrolled**: padrão de estado.

## 6. Critérios de Qualidade da Fonte

- Preferir documentação oficial, RFCs, repositórios oficiais.
- Evitar blogs sem data/autor.
- Convergência: decisão sólida quando ≥2 fontes independentes concordam.
- Recência: preferir fontes dos últimos 2 anos; marcar se mais antigas.

## 7. Entregável

Relatório de pesquisa com:
- Pergunta de pesquisa
- Fontes consultadas (URL + data)
- Padrões convergentes
- Recomendação fundamentada
- Decisões tomadas e suas citações
- Lacunas / pontos a validar

## 8. Anti-Padrões

- Decisão sem citação.
- Copiar implementação de uma lib sem adaptar ao Pulse.
- Ignorar acessibilidade por "padrão da lib".
- Usar fonte única para decisão crítica.