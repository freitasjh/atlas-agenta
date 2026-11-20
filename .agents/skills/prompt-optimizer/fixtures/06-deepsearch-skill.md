---
esperado: rota-b
---

# Skill operacional de deepsearch

Criar `.agents/skills/deepsearch/SKILL.md` com detalhe operacional de busca (hierarquia de fonte, como usar `websearch`/`webfetch`, template de citação), sem copiar as regras de `.agents/rules/deepsearch.md`. Escopo: só esse SKILL e seus exemplos; não editar a rule, agentes nem `gate.js`. A rule continua o contrato always-on — a skill só detalha. Melhoria de processo; cada afirmação sobre API de ferramenta deve citar URL oficial e data da consulta. Pronto quando `node scripts/static-checks.mjs` e `node scripts/vendor-skills.mjs --check` saírem 0 e o SKILL não contiver "Tier 1/2/3".

## Veredito esperado (contrato — não é o prompt)

E1 ✅ · E2 ✅ · E3 ✅ · E4 ✅ · E5 ✅ · E6 ✅ → Rota B.
