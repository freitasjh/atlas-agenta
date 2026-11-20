---
description: Atualiza o payload do harness no projeto atual, com backup fora do alvo
---

Atualize este projeto com `scripts/harness-sync.mjs`. O alvo é `$ARGUMENTS`
quando informado; sem argumento, use o diretório atual.

Avise antes de tudo: o backup obrigatório vai para
`<parent do alvo>/.harness-backup/<nome-do-alvo>-<timestamp>/` — FORA do alvo.
Nada é apagado; path do manifesto que o payload não publica mais aparece como
`orphan <path> (não removido)`. Se o run recusar o backup por symlink no
caminho, peça ao operador um diretório FORA do alvo e repita com
`--backup-dir <dir>` (vale no `--dry-run` e no apply).

1. Mostre o plano sem escrever:

   ```sh
   node scripts/harness-sync.mjs update --target <dir> --dry-run
   ```

   Cole a saída: linhas `create`/`update`/`skip` e cada `orphan`.
   Se o plano recusar com `commands.suiteFull não detectado`, pergunte ao
   operador o comando de teste e repita com `--suite "<cmd>"`.
2. Peça confirmação explícita. Sem "sim", pare aqui.
3. Aplique o MESMO comando sem `--dry-run` (mantenha `--suite`/`--backup-dir`
   se o passo 1 precisou deles):

   ```sh
   node scripts/harness-sync.mjs update --target <dir>
   ```

   Reporte o número de writes e o caminho do backup.
4. Valide:

   ```sh
   node scripts/harness-sync.mjs doctor --target <dir>
   ```

   Se reprovar, liste cada FAIL com o path e pare. Não corrija sozinho nem
   remova órfão: podar a entrada do manifesto é decisão humana.
