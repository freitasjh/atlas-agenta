---
esperado: rota-b
---

# Rubrica do code-reviewer

Reescrever o formato de relatório de `.agents/agents/code-reviewer/PROMPT.md` para as três seções "Pontos Corretos (Validação Técnica)", "O que Precisa ser Corrigido" (tags `[CRÍTICO]`, `[ARQUITETURA / BOAS PRÁTICAS]`, `[MELHORIA]`, cada item com O QUÊ / POR QUÊ / COMO) e "Próximo Passo de Evolução". Escopo: só esse PROMPT; não tocar `gate.js`, rules nem a permissão de escrita. Manter o papel como parecer — bloqueio real é a âncora B do gate lendo `code_review_status`, conforme `.agents/rules/gate-contract.md` I2. Melhoria. Pronto quando a suíte completa estiver verde e o PROMPT contiver as três seções, as três tags e a frase de zero bajulação.

## Veredito esperado (contrato — não é o prompt)

E1 ✅ · E2 ✅ · E3 ✅ · E4 ✅ · E5 ✅ · E6 ✅ → Rota B.
