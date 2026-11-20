---
description: Prepara DESIGN.md, tokens e Storybook num projeto React/Vue
---

Prepare o harness de UI em `$ARGUMENTS` (sem argumento: diretório atual). O
framework é detectado por `package.json` — não pergunte, não escolha.

1. Mostre o plano sem escrever:

   ```sh
   node .agents/skills/storybook/scripts/init.mjs --target <dir> --dry-run
   ```

   Cole a saída (`criados`/`preservado` por arquivo). Nada é escrito neste passo.

2. Peça confirmação explícita. Sem "sim", pare.

3. Com o "sim", rode o MESMO comando sem `--dry-run`:

   ```sh
   node .agents/skills/storybook/scripts/init.mjs --target <dir>
   ```

   Arquivos existentes são preservados — o script nunca sobrescreve.

4. Valide e gere o CSS de tokens:

   ```sh
   node .agents/skills/storybook/scripts/build-tokens.mjs --target <dir>
   node .agents/skills/storybook/scripts/validate.mjs --target <dir>
   ```

5. Reporte: framework detectado, arquivos criados/preservados, saída do validate.

Os scripts são rede-zero: instalação de pacotes fica ao operador (saída do passo 3
lista as dependências sugeridas). Nada é commitado por este comando.
