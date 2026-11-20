---
description: Valida o payload do harness no projeto atual (somente leitura)
---

Rode a validação somente leitura. O alvo é `$ARGUMENTS` quando informado; sem
argumento, use o diretório atual.

```sh
node scripts/harness-sync.mjs doctor --target <dir>
```

Reporte:

- o exit code (`0` = OK; `1` = reprovado);
- cada linha `FAIL <o quê>: <path>`, uma por achado, sem resumir;
- cada `WARN` (por exemplo divergência do checkout `brain`) como aviso, não
  como falha.

Nada é escrito por este comando: não edite payload, manifesto, config nem órfão
para "fazer passar". Se o operador quiser atualizar, aponte `/harness-update`.
