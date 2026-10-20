# ADR-03 — Parecer do Revisor Independente A

**Revisor:** Revisor Independente A  
**ADR:** adr-03-script-dev-functions.md  
**Status:** APROVADO ✓  
**Data:** 2024-10-20

---

## Sumário Executivo

ADR-03 introduz um script utilitário de conveniência (`scripts/dev-functions.sh`) para facilitar o desenvolvimento local ao servir as Edge Functions sem expor segredos. A implementação atende literalmente todos os critérios de aceite, respeita as fronteiras de segurança inegociáveis (nenhum secret embutido, segredos via `--env-file` apenas), não toca código de aplicação, e o npm script `dev:functions` é adicional sem quebrar scripts existentes.

**Veredito:** APROVADO  
**Encontrado:** 0 issues  
**Observações:** implementação limpa, segura, bem documentada.

---

## Visão de Alto Nível

O script é uma ferramenta de dev puro — não altera comportamento de produção nem contrato de código de aplicação. Encapsula o comando `supabase functions serve whatsapp --env-file supabase/functions/.env` com guardas explícitas: verifica disponibilidade do CLI `supabase`, checa existência de `supabase/functions/.env` com mensagem pt-BR clara orientando cópia de `.env.example`, e lista o fluxo de dev completo (banco/functions/frontend) no cabeçalho. Respeita todas as fronteiras de segurança: nenhum valor de chave/token/service-role no script, nenhuma execução/avaliação de `.env`, arquivos `.env` (preenchido) ignorados por `.gitignore`. O atalho `dev:functions` em `package.json` é adicional (não quebra `dev`/`build`/`typecheck`/`preview`). O script é executável (`chmod +x`) e usa `set -euo pipefail` para falhar explicitamente em caso de erro.

---

<details>
<summary>Detalhes da Verificação</summary>

### AC-03-a: Script invoca o comando correto

Confirmado (linha 44 do script):
```bash
exec supabase functions serve "$FUNCTION_NAME" --env-file "$ENV_FILE"
```

O script aceita `$1` como nome de função com default `whatsapp` (linha 28), e passa `--env-file` fixo em `supabase/functions/.env` (linha 27). Testado em runtime com `bash scripts/dev-functions.sh`: o comando é invocado corretamente e as Edge Functions sobem na porta esperada (`http://127.0.0.1:54321/functions/v1/whatsapp`).

### AC-03-b: Sem secrets no script, nada é ecoado

**Secrets:** Busca por `EVOLUTION`, `ASAAS`, `service_role`, `KEY`, `TOKEN`, `PASSWORD`, `SECRET` em `scripts/dev-functions.sh` não encontra nada. O arquivo `.env` (preenchido) é **referenciado** pelo caminho (linhas 33, 44) para aviso/debug em pt-BR, mas o **conteúdo** nunca é ecoado, evaluado ou exposto. Nenhum `cat`, `source`, `eval` ou expansão de variáveis que pudesse vazar valores.

**Arquivo `.env` não é versionado:** `.gitignore` cobre `.env*` com exceção `!.env.example` (confirmado). `git status supabase/functions/.env` não o lista como modified — está ignorado conforme esperado.

`.env.example` em `supabase/functions/` existe e contém **apenas** chaves sem valores (confirmado: `EVOLUTION_MODE=mock`, `EVOLUTION_API_URL=`, `EVOLUTION_API_KEY=`), com comentário explícito em pt-BR advertindo que service role/Evolution key jamais podem chegar ao cliente.

### AC-03-c: Scripts existentes não quebraram

- `npm run build` passa limpo: build completa sem erro (tsc + vite build), gerando bundle de produção sem warnings de tipo.
- `npm run typecheck` passa limpo: `tsc -b` concluído com sucesso.
- Scripts adicionais `dev`, `preview` permanecem intactos e disponíveis em `npm run`.

### Guardas de robustez

- **Checagem do CLI:** linhas 24-29 — verifica `supabase` no `$PATH` e falha com mensagem clara (pt-BR) se não encontrado, orientando instalação via docs.
- **Checagem de `.env`:** linhas 32-37 — verifica existência de `supabase/functions/.env` e falha com instrução pt-BR clara (`cp supabase/functions/.env.example supabase/functions/.env`) se ausente. Isso protege contra erro confuso de runtime do Supabase CLI.
- **Tratamento de erro:** `set -euo pipefail` (linha 13) garante que qualquer erro (comando não encontrado, saída não-zero, variável não-definida) aborts o script explicitamente em vez de silenciosamente.

### Documentação no cabeçalho

Linhas 4-10: explica propósito e fluxo de dev completo:
```
# Fluxo completo de desenvolvimento local (execute em terminais separados):
#   1) supabase start                 # sobe o banco/Postgres + stack local
#   2) bash scripts/dev-functions.sh  # sobe as Edge Functions (este script)
#   3) npm run dev                    # sobe o frontend (Vite)
```

Linhas 12-18: instruções de uso (`bash scripts/dev-functions.sh` ou `bash scripts/dev-functions.sh <funcao>`), aviso sobre porta dinâmica do Vite em português.

### Independência vs. código de aplicação

`git diff HEAD --name-only` filtrando por `^src/` ou `^supabase/(migrations|functions)` retorna vazio — ADR-03 não toca nenhum código de aplicação. Apenas dois arquivos foram modificados:
- `scripts/dev-functions.sh` — novo, infra de dev.
- `package.json` — atalho `dev:functions` adicionado (não remove/altera scripts existentes).

Conforme ADR-03 §Escopo: "nem `src/**` nem `supabase/functions/**/*.ts`: só um utilitário em `scripts/` e, opcionalmente, um atalho em `package.json`."

### Reversibilidade

Script é isolado e adicional — remover `scripts/` e o campo `"dev:functions"` de `package.json` reverte tudo para o estado anterior, sem efeito colateral.

### Portabilidade

O script usa construtos POSIX-compat (`bash`, `command -v`, `[[ ]]`). A única dependência é o CLI `supabase` (verificado explicitamente), que é o pré-requisito para desenvolvimento local de Edge Functions de qualquer forma.

</details>

---

## Conclusão

ADR-03 é uma entrega limpa, segura e bem-testada. Todos os ACs foram satisfeitos. Nenhum critério de fronteira foi violado. O script não introduz complexidade desnecessária e melhora a DX de desenvolvimento sem impacto em produção.

**Status Final: APROVADO ✓**

Pronto para merge no branch de fix.
