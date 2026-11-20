---
description: Gera build estático do Storybook e revisa UI no browser
---

Revise a UI de `$ARGUMENTS` (sem argumento: diretório atual). Nada é editado no
código-fonte; o build escreve apenas em `storybook-static/`. Detecte o comando
de build pelo `package.json` — não pergunte.

1. Gere o build estático e valide:

   ```sh
   npm run -s storybook:build
   node .agents/skills/storybook/scripts/validate.mjs --target <dir>
   ```

2. Abra o build (`storybook-static/`) no browser disponível — `browser` ou
   `chrome-devtools` quando o MCP estiver registrado. Cole o snapshot e confira:

   - console sem `[ERROR]` / `[WARN]`;
   - network sem 4xx/5xx e sem rota duplicada;
   - stories dos 9 estados renderizando (default, active, hover, focus, disabled, loading, error, empty, success);
   - screenshots em 1280×800 e 375×800: sem overflow, foco visível, alvo ≥44px.

3. Reporte por `arquivo:linha`: cada problema de token, estado, i18n ou a11y
   encontrado, com severidade (`P1` quebra UX / `P2` atenção / `P3` sugestão).

4. Feche com: build OK ou FAIL, contagem de problemas por severidade, caminhos dos
   screenshots e os comandos de encerramento de portas (via `lsof -ti :PORTA` + PID,
   nunca por nome). Se o MCP de browser não estiver disponível, declare "revisão
   visual indisponível" — build estático + validate seguem como evidência.
