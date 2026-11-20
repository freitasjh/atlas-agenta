---
description: Instala o harness no projeto atual
---

Instale o harness neste projeto com `scripts/harness-sync.mjs`. O alvo é
`$ARGUMENTS` quando informado; sem argumento, use o diretório atual.

1. Se existir `.agents/`, `.agents/skills/`, `.opencode/plugins/`,
   `.opencode/commands/` ou `.harness-manifest.json` no alvo, PARE: o projeto já
   carrega estado do harness. Oriente `/harness-update` e não rode nada.
2. Mostre o plano sem escrever:

   ```sh
   node scripts/harness-sync.mjs init --target <dir> --dry-run --suite "<cmd>" \
     [--frontend react|vue] [--backend java|rust|nestjs|node]
   ```

   Cole a saída (`create`/`update`/`skip`; identidade:
   `created|appended|preserved|skip|divergent|malformed` por path, origem e
   `plano …`). `WARN divergência` preserva; `ERROR seção malformada` recusa.
   Sem `commands.suiteFull`, pergunte o comando e repita com `--suite`/`--unit`.
   Sem detecção, exija `--frontend`/`--backend`; sem comando, nada é escrito.
3. Peça confirmação explícita antes de aplicar. Sem "sim", pare.
4. Aplicado o "sim", rode o MESMO comando sem `--dry-run` (se o passo 2 precisou
   de `--suite`/`--unit`, mantenha-os):

   ```sh
   node scripts/harness-sync.mjs init --target <dir>
   ```

5. Valide e cole o resultado:

   ```sh
   node scripts/harness-sync.mjs doctor --target <dir>
   ```

Não edite `targets`/`commands` à mão: o `init` os detecta. Se o `doctor`
reprovar, liste cada FAIL com o path — corrija só o que for do projeto (por
exemplo `--suite <cmd>` num repo sem `scripts.test`) e nunca o payload.
