---
description: Audita tokens, estados e acessibilidade de UI — somente leitura
---

Audite `$ARGUMENTS` (sem argumento: diretório atual). **Este comando não edita nada.**

1. Rode a auditoria estática:

   ```sh
   node .agents/skills/storybook/scripts/validate.mjs --target <dir>
   ```

2. Confira, apontando `arquivo:linha`:

   - hex/rgb cru em componente (só `tokens/**` e CSS gerado podem ter valores crus);
   - tokens semânticos do destino usados em vez de valores ad-hoc;
   - matriz dos 9 estados nas stories: default, active, hover, focus, disabled, loading, error, empty, success (âncora `export const`, não comentário);
   - literal visível fora do arquivo de locale;
   - foco visível (`:focus-visible`), alvo ≥44px, contraste WCAG 2.1 AA;
   - larguras 375px e 1280px quando houver evidência de screenshot;
   - anti-slop: grid simétrica genérica, gradiente néon, sombra dura.

3. Reporte cada achado como `CAMINHO:LINHA — problema — correção sugerida`.
   Separe `FAIL` (bloqueante) de `WARN` (atenção). Não corrija nada aqui: aponte
   os arquivos e deixe a correção para o `frontend-engineer`.

4. Feche com o exit code do validate e a contagem de `FAIL`/`WARN`.

Se o MCP de browser estiver disponível, use-o apenas para confirmar foco/contraste;
a ausência dele é declarada como "revisão visual indisponível", nunca como falha silenciosa.
