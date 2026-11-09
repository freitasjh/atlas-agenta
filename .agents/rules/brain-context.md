---
inclusion: always
---

# 🧠 Brain — ponte (dono: repo brain, canônico `BRAIN.MCP.md`)

> Harness=só harness. Regra brain vive no dono: `../brain/.agents/skills/brain/SKILL.md` + `BRAIN.MCP.md` (`../brain/.agents/rules/BRAIN.MCP.md`). Esta ponte nunca re-explica.

- Tools (nomes preservados): `brain_search(query, layer?, scope?, project?, tag?, top_k?)` (busca antes de codificar) · `brain_store(layer, path, content, scope?, project?, tags?)` (registra decisões; `scope` obrigatório em arquitetura/regras/estudos) · `brain_read(path)` (lê nota pelo path completo `layer/scope/path`; sem `layer` separado) · `brain_project_*` (lista/linka notas por projeto).
- Busca-antes: `brain_search` contexto antes de codificar (detalhe no dono).
- Registra-depois: `brain_store` decisões após decidir; resumo sessão ao finalizar (detalhe no dono).
- Evidência: campo `brainStore` em harness report (`.agents/schemas/harness-report.schema.json:16,57`) mantido.
- Fluxo: busca → implementa → registra → finaliza (detalhe no dono).
- Pin G1: ref `../brain/.agents/skills/brain/SKILL.md` esperada em commit `bae4f5752beb020af0958d035b418d07642cb68d` (verificar: `git -C ../brain rev-parse HEAD`); motivo: transporte doc `/sse`→`/mcp` + seção Roteiro deepsearch (5b2260c, 9ec9199); divergência = doctor warn com motivo+caminho, nunca silent/fail.
- Fallback (sem checkout brain / brain ausente): URL canônica `PIN-ME` (resolver: `git -C ../brain remote get-url origin && git -C ../brain rev-parse HEAD`); doctor warn-não-fail (`installer/install.mjs:743-772`); nunca gravar regra alheia.
