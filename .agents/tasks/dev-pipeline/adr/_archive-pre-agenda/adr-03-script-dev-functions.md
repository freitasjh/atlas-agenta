# ADR-03 — Script de desenvolvimento para subir as Edge Functions localmente

**Status:** proposto

## Contexto

O usuário pediu explicitamente (mensagem 6 do run): *"pode fazer o script que vai rodar as
functions tambem"*. O PRD §7 registra isso como ponto do run fora do núcleo do contrato, com uma
pergunta em aberto ao planejamento: o script entra nesta entrega ou vira item separado. Como a
mensagem verbatim do usuário é autoritativa e o pedido é direto, **decido incluí-lo como ADR
própria, isolada e última** — não bloqueia nenhum AC funcional (ADR-01/02) e pode ser revisada e
testada sozinha.

Hoje não existe `scripts/` nem `.sh` no repositório. O ambiente local sobe manualmente com
`supabase start` + `supabase functions serve whatsapp --env-file supabase/functions/.env` +
`npm run dev` (PRD §7). Os segredos vivem em `supabase/functions/.env` (já presente; há
`.env.example`), lidos via `--env-file` — **nunca** embutidos no script.

## Decisão

Criar um script utilitário de conveniência de dev que encapsule a subida das Edge Functions:

1. **Arquivo:** `scripts/dev-functions.sh` (criar a pasta `scripts/`). Shell `bash`, com
   `set -euo pipefail`.
2. **Conteúdo:** executa
   `supabase functions serve whatsapp --env-file supabase/functions/.env` (o alvo central do run é
   a função `whatsapp`). Pode aceitar, opcionalmente, o nome da função como `$1` com default
   `whatsapp`, mantendo o `--env-file` fixo em `supabase/functions/.env`.
3. **Sem segredos embutidos** (fronteira inegociável — PRD §7, seguranca-multitenant): o script
   **só** referencia o caminho do `--env-file`; nenhum valor de `EVOLUTION_API_KEY`/URL/service
   role aparece no arquivo. Nunca ecoar o conteúdo do `.env`.
4. **Não altera código de aplicação** nem comportamento de produção: é ferramenta de dev local.
5. **Guardas de robustez (opcionais, recomendadas):** mensagem pt-BR clara se
   `supabase/functions/.env` não existir (orientando copiar de `.env.example`); checagem de que o
   CLI `supabase` está disponível. Não tentar iniciar/stopar o `supabase start` do banco (fora do
   escopo; evita blast radius) — o script cobre só o `functions serve`. Documentar no cabeçalho do
   script o fluxo completo (supabase start / functions serve / npm run dev) como comentário.
6. **Permissão de execução:** tornar o script executável (`chmod +x`) ou documentar `bash
   scripts/dev-functions.sh` no cabeçalho.

Opcional e a critério do implementador: adicionar um atalho em `package.json`
(`"dev:functions": "bash scripts/dev-functions.sh"`) — conveniência, não requisito. Se adicionado,
não deve quebrar os scripts existentes (`dev`/`build`/`typecheck`/`preview`).

## Consequências

- **Positivas:** atende o pedido explícito do usuário; padroniza a subida local das functions;
  mantém segredos fora do versionamento (só referencia `--env-file`).
- **Negativas / riscos:** script de ambiente específico (depende do CLI `supabase` instalado e do
  `.env` preenchido). Mitigado pelas guardas e mensagens pt-BR. Não cobre a subida do banco de
  propósito (menor blast radius).
- **Reversível:** é um arquivo novo isolado; remover o script e o atalho opcional reverte tudo.

## Escopo

**ambos** na acepção de infra de dev — na prática **nenhum código de aplicação** (nem `src/**`
nem `supabase/functions/**/*.ts`): só um utilitário em `scripts/` e, opcionalmente, um atalho em
`package.json`.

## Arquivos afetados

- `scripts/dev-functions.sh` — novo (criar a pasta `scripts/`).
- `package.json` — atalho `dev:functions` (opcional).

Nenhuma migration, RLS, schema, Edge Function ou código de aplicação alterado.

## Critérios de aceite testáveis (desta ADR)

- **AC-03-a:** `bash scripts/dev-functions.sh` (ou via atalho) invoca
  `supabase functions serve whatsapp --env-file supabase/functions/.env` — verificável lendo o
  script e, se o CLI estiver disponível no ambiente do run, por uma execução que chega a servir a
  função (ou falha com mensagem pt-BR clara se o `.env` faltar).
- **AC-03-b (sem segredo):** `grep` no script não encontra nenhum valor de chave/token; só o
  caminho do `--env-file`. O `.env` não é versionado nem ecoado.
- **AC-03-c (não quebra scripts):** `npm run build` continua passando; se o atalho for adicionado,
  `npm run dev`/`typecheck`/`preview` seguem funcionando.
- **Verificação:** inspeção do script + `set -euo pipefail` presente; `npm run build` limpo.

## Dependência

**Independente** de ADR-01 e ADR-02 (não toca o código do fix). É a última ADR por ser a de menor
prioridade e não bloquear os ACs funcionais; pode ser cortada do recorte sem afetar o bugfix.
