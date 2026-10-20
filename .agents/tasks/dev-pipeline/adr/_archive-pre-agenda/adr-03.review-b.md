# Parecer do Revisor B — ADR-03 (script de dev para subir as Edge Functions)

Script de conveniência de dev (`scripts/dev-functions.sh`) que encapsula `supabase functions serve whatsapp --env-file supabase/functions/.env`, mais um atalho opcional `dev:functions` no `package.json`. Atende o pedido verbatim do usuário (mensagem 6: *"pode fazer o script que vai rodar as functions tambem"*). Não toca nenhum código de aplicação — nem `src/**` nem `supabase/functions/**/*.ts` — então as fronteiras multi-tenant/RLS/RBAC/idempotência de webhook não são exercidas por este diff. A única fronteira relevante aqui é **segredos**, e ela está respeitada: o script só referencia o caminho do `--env-file`, nunca embute nem ecoa valores.

Watch for: nada bloqueante. Uma observação não-bloqueante sobre tratamento de erro do CLI ao faltar função (possible) e uma sobre portabilidade do shebang (possible).

**Verdict**: APPROVED

## Visão geral

O escopo da ADR-03 é infra de dev, não aplicação. O commit em revisão (`77ee25a`) adiciona exatamente dois arquivos: `scripts/dev-functions.sh` (42 linhas) e uma linha em `package.json`. A contraprova (`npm run build` + `npm run typecheck`) passa limpa; o projeto não tem lint/prettier/test configurados, então essas são as únicas verificações de qualidade existentes.

A fronteira de segredos — a única que esta ADR poderia violar — está sólida. O `.env` real está coberto por `.gitignore` (`.env*` com exceção de `!.env.example`) e não é rastreado; só o `.env.example` (apenas placeholders) está no git. O script não lê o conteúdo do `.env`, apenas passa o caminho para `--env-file`, e nenhuma chave/token aparece no arquivo (grep confirma zero valores de segredo).

Os três critérios de aceite da ADR são satisfeitos: AC-03-a (o script invoca `supabase functions serve whatsapp --env-file supabase/functions/.env`, com default `whatsapp` e `$1` opcional), AC-03-b (sem segredo embutido), AC-03-c (`build`/`typecheck`/`dev`/`preview` intactos; o atalho novo não colide com os existentes). As guardas recomendadas na ADR (checagem do CLI `supabase`, checagem da existência do `.env` com mensagem pt-BR orientando o `cp` do `.env.example`, `set -euo pipefail`, não gerenciar o `supabase start`) foram todas implementadas.

<details>
<summary>Issues (2)</summary>

1. **Função inexistente não tem mensagem própria** (possible) — o script valida CLI e `.env`, mas delega ao `supabase functions serve` o caso de nome de função inválido (ex.: `bash scripts/dev-functions.sh foo`). O erro resultante vem do CLI, não em pt-BR. Não-bloqueante: a ADR fixa o default `whatsapp` como alvo central e trata guardas extras como opcionais. Só considerar se quiser uma mensagem de orientação própria.
2. **Shebang `#!/usr/bin/env bash` vs. chamada explícita** (possible) — o atalho invoca `bash scripts/dev-functions.sh`, o que torna o bit executável e o shebang redundantes para o fluxo documentado, mas corretos para `./scripts/dev-functions.sh`. Sem ação necessária; apenas registro de que ambos os caminhos de invocação funcionam.

</details>

<details>
<summary>Details</summary>

### Aderência à ADR e ao recorte

O diff corresponde 1:1 ao que a ADR-03 decidiu. A decisão §2 pedia `scripts/dev-functions.sh` em `bash` com `set -euo pipefail`, servindo a função `whatsapp` com `--env-file` fixo em `supabase/functions/.env`, aceitando opcionalmente o nome da função como `$1` com default `whatsapp`. O script faz exatamente isso:

```bash
FUNCTION_NAME="${1:-whatsapp}"
ENV_FILE="supabase/functions/.env"
...
exec supabase functions serve "$FUNCTION_NAME" --env-file "$ENV_FILE"
```

O `--env-file` é fixo (não parametrizável pelo cliente), o default é `whatsapp`, e `$1` sobrescreve só o nome da função — nada mais. O `exec` substitui o processo do shell pelo `supabase`, o que é idiomático para um wrapper de execução. A ADR também pediu explicitamente **não** gerenciar o `supabase start` (menor blast radius): o script cobre só o `functions serve`, e o cabeçalho documenta o fluxo completo (supabase start / functions serve / npm run dev) como comentário, como a ADR §5 recomendou.

O atalho opcional `"dev:functions": "bash scripts/dev-functions.sh"` foi adicionado sem quebrar `dev`/`build`/`typecheck`/`preview` — confirmado por `npm run build` e `npm run typecheck` limpos.

### Fronteira de segredos

Esta é a única fronteira que o escopo da ADR toca, e é a que a análise de dados (§7) e a `seguranca-multitenant` marcam como inegociável: service role, chave/URL da Evolution e segredos de webhook nunca podem vazar para versionamento ou para o bundle. Verificações feitas:

- `grep -niE "EVOLUTION_API_KEY|SERVICE_ROLE|SUPABASE_.*KEY|TOKEN|SECRET|BEARER|apikey" scripts/dev-functions.sh` → nenhum valor de segredo no script. O script só menciona o **caminho** `supabase/functions/.env`.
- `.gitignore` cobre `.env*` e só versiona `!.env.example`; `git ls-files` confirma que apenas `supabase/functions/.env.example` está rastreado — o `.env` preenchido não está no git.
- `.env.example` contém só placeholders vazios (`EVOLUTION_API_KEY=`, `EVOLUTION_MODE=mock`), então a instrução do script de `cp supabase/functions/.env.example supabase/functions/.env` não propaga segredo.
- O script não faz `cat`/`echo` do conteúdo do `.env`; a mensagem de erro de ausência do arquivo só imprime o caminho e a orientação de `cp`, nunca valores.

### Robustez e segurança do shell

`set -euo pipefail` presente; variáveis sempre aspeadas (`"$ENV_FILE"`, `"$FUNCTION_NAME"`), evitando word-splitting/glob em caminhos com espaço. As guardas de CLI (`command -v supabase`) e de `.env` (`[[ -f "$ENV_FILE" ]]`) escrevem erro em pt-BR no `stderr` (`>&2`) e saem com `exit 1`. `bash -n` confirma sintaxe válida. `shellcheck` **não** está instalado no ambiente, então a análise estática não pôde ser rodada — a inspeção manual não encontrou problemas, mas isso é verificação parcial, não garantida por ferramenta.

### Contraprova

- `npm run build` → `✓ built in 11.76s`, exit 0. O aviso de chunk > 500 kB é pré-existente e não relacionado (nenhum código de app mudou neste commit).
- `npm run typecheck` (`tsc -b`) → exit 0, sem saída de erro.
- Não há script de lint/test no `package.json` nem config de eslint/prettier no repo — `build` e `typecheck` são a totalidade da suíte de qualidade existente, conforme `convencoes-codigo.md` (não adicionar testes sem pedido).

### Fronteiras não exercidas (registro)

Multi-tenant/RLS, RBAC, idempotência de webhook, PII em log e LGPD não são tocados por este diff — ele não lê/escreve dados, não chama a Evolution, não loga telefone e não altera nenhuma policy ou Edge Function. O design doc de frontend (React) também não se aplica: não há tela, rota, guard, componente nem schema zod neste escopo. A ADR-03 é deliberadamente a última e isolada; cortá-la não afetaria o bugfix E.164 (ADR-01/02).

</details>

<details>
<summary>Mapa de arquivos</summary>

- `scripts/dev-functions.sh` — **novo** (42 linhas). Wrapper `bash` com `set -euo pipefail` que serve a Edge Function `whatsapp` (ou `$1`) via `supabase functions serve --env-file supabase/functions/.env`. Guardas: CLI presente, `.env` presente (mensagem pt-BR). Cabeçalho documenta o fluxo local completo. Sem segredo embutido.
- `package.json` — +1 linha: atalho opcional `"dev:functions": "bash scripts/dev-functions.sh"`. Não altera os scripts existentes.

Diff completo: `git show 77ee25a`.

</details>
