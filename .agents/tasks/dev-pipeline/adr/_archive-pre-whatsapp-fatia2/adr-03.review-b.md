# Shared template render contract (`renderTemplate` + closed variable list + fallback) — Review B

**ADR:** adr-03 — Contrato de renderização compartilhado · **Escopo:** frontend (util puro) · **Base:** master
**Revisor:** B (independente, modelo distinto do revisor A; não vi o parecer de A)
**Commit revisado:** `46d9109` — `feat: contrato compartilhado de renderizacao de templates (renderTemplate)`

ADR-03 isola o contrato de renderização de templates numa peça pura e determinística (`src/lib/message-templates.ts`) que o preview do cliente (ADR-06) e o render server-side (ADR-04) vão consumir/espelhar. O diff entrega exatamente dois arquivos — o util e seu teste vitest — sem nenhum vazamento de escopo para schema, Edge Function, telas ou hooks. A implementação segue a lista fechada `{nome} {servico} {dataHora} {empresa}` (sem `{valor}`), a tabela de fallback canônica do PRD §RF-T07, e a regra de token desconhecido mantido literal. Contraprova local verde: `npm run typecheck` (exit 0), `npm run test` (24/24, 8 novos), `npm run build` (exit 0).

Watch for: nada bloqueante (confirmed). Duas observações não-bloqueantes: o campo extra `variable` em `TEMPLATE_VARIABLE_META` além do `{token,label}` sugerido pela ADR (confirmed, aditivo e benéfico), e a dependência de contrato com o render Deno do servidor que a ADR-04 precisa espelhar fielmente (confirmed, é risco da próxima ADR, não deste código).

**Verdict**: APPROVED

## High-level view

A fronteira multi-tenant/RLS/RBAC não é tocada por esta ADR: é uma função pura sem acesso a banco, rede, JWT ou `tenant_id`. O isolamento continua sendo responsabilidade da RLS (ADR-01) e da resolução de tenant no servidor (ADR-04). Aqui não há superfície de vazamento de tenant a avaliar — a única exigência de fronteira relevante é que a tabela de fallback e a lista fechada fiquem idênticas ao que o servidor vai replicar, e o código documenta isso explicitamente no cabeçalho.

A aderência ao PRD é fiel no ponto que a própria ADR sinalizou como risco: havia divergência entre `analysis-frontend.md` (`{nome}→"você"`, `{dataHora}→"o horário combinado"`, token desconhecido removido) e o PRD §RF-T07 (`{nome}→"cliente"`, `{dataHora}→"no horário combinado"`, token desconhecido literal). O código seguiu o PRD em todos os pontos, que é a regra do pipeline. Os textos de fallback batem caractere a caractere com a tabela do PRD.

A segurança do contra-ataque a "variável crua vazar ao cliente" (defeito #3 do PRD) está coberta: nenhuma variável *conhecida* sai crua (vai valor ou fallback), e o único resíduo possível de chaves no texto é um token *desconhecido* mantido literal — decisão consciente e testada. A função nunca lança, é determinística e não depende de relógio/estado, atendendo RNF-T05.

O design doc React é respeitado na parte que cabe a esta peça (util compartilhado, TS estrito, enum fechado, sem `any`). As partes de UI do design doc (chips, preview, contraste) são das ADRs 05/06 e não aparecem — corretamente fora de escopo.

<details>
<summary>Issues (2)</summary>

1. **Contrato Deno espelhado (ADR-04)** — a paridade da tabela de fallback/lista fechada com o render server-side em Deno é só documental hoje (comentário no cabeçalho); não há teste cruzado que falhe se divergirem. Ação: a ADR-04 deve garantir paridade e, idealmente, um teste de regressão contra os mesmos casos. Não-bloqueante para ADR-03.
2. **Token com espaços internos não casa** — `TOKEN_PATTERN` não reconhece `{ nome }` (espaços dentro das chaves), ficando literal. Alinhado ao contrato (chips inserem `{nome}` sem espaço) e sem fallback cru de variável conhecida, então é correto-por-contrato, não bug. Ação: nenhuma; registrar como premissa.

</details>

<details>
<summary>Details</summary>

### Aderência à ADR e ao PRD

A decisão da ADR pede três exports: a lista fechada (`TEMPLATE_VARIABLES` + `type TemplateVariable`), a tabela de fallback pt-BR e `renderTemplate`. Todos estão presentes com as assinaturas pedidas. A ADR previa `TemplateVars` como `Partial<Record<TemplateVariable, string | null>>` e o código entrega exatamente isso. A exclusão de `{valor}` (D4 do PRD) é respeitada tanto na lista quanto nos metadados dos chips.

O ponto que a ADR marcou como armadilha — a divergência de fallback entre as duas análises — foi resolvido a favor do PRD. Verifiquei linha a linha: `nome→"cliente"`, `servico→"seu atendimento"`, `dataHora→"no horário combinado"`, `empresa→"nossa equipe"`. Nenhum resquício dos textos de `analysis-frontend.md` (`"você"`, `"o horário combinado"`). Token desconhecido literal, não removido. Correto.

`TEMPLATE_VARIABLE_META` acrescenta um campo `variable` ao `{token,label}` que a ADR descreveu como opcional. É aditivo e útil para o ADR-06 (mapear chip → variável sem reparsear o token), com tipagem `token: ` + template-literal `` `{${TemplateVariable}}` `` que amarra o token à variável em tempo de compilação. Boa escolha, não extrapola escopo.

### Fronteiras (multi-tenant / RLS / RBAC / idempotência / segredos / LGPD)

Esta ADR é uma função pura: não lê banco, não resolve `tenant_id`, não toca JWT, não emite log, não acessa segredo. Logo as fronteiras de RLS/RBAC/idempotência/segredo **não são exercidas aqui** e permanecem intactas nas ADRs que as detêm (01 schema/RLS, 04 server-side). A única fronteira relevante nesta peça é de *contrato*: a tabela precisa ser idêntica à cópia Deno do servidor. O código assume isso no cabeçalho e no JSDoc, mas a garantia é só documental — por isso o item 1 dos issues aponta a ADR-04 como o lugar onde essa paridade tem de virar verificação real. É risco da próxima ADR, não deste commit.

Sobre LGPD/PII: a função apenas substitui placeholders; não loga nada. O chamador (servidor) é quem precisa não logar o texto renderizado em claro (RNF-T02) — fora do escopo desta peça.

### Robustez da renderização

Potencial armadilha verificada: regex global module-level com `lastIndex` mutável. Não há bug de estado porque `String.prototype.replace` reinicia a varredura a cada chamada (confirmed), e o teste de determinismo guarda contra regressão. A checagem de vazio trata `null`, `undefined` (via `!= null`) e string só com espaços (`value.trim() !== ""`) como "sem dado" → fallback (AC-06); variável repetida substitui todas as ocorrências (testado); nenhum caminho lança.

### Cobertura de testes

8 casos cobrem: substituição das 4 variáveis (AC-05), fallback quando faltam dados com asserção de que nenhuma variável conhecida sai crua (AC-06), `null`/vazio/espaços → fallback, `{empresa}` nula → "nossa equipe", token desconhecido literal, texto sem variáveis intacto (inclui o caso `1 confirmar / 2 reagendar` do RF-T09), repetição, e determinismo (RNF-T05). A cobertura é proporcional ao contrato.

Não testado (aceitável nesta ADR): paridade com a implementação Deno do servidor (não existe ainda — ADR-04); token com espaços internos (`{ nome }`), que fica literal por contrato. Nenhum dos dois é gap desta peça.

</details>

<details>
<summary>File map</summary>

- `src/lib/message-templates.ts` (novo) — lista fechada `TEMPLATE_VARIABLES`, metadados de chip `TEMPLATE_VARIABLE_META`, tabela `TEMPLATE_FALLBACKS`, tipo `TemplateVars` e `renderTemplate` puro.
- `src/lib/message-templates.test.ts` (novo) — 8 testes vitest cobrindo AC-05/AC-06/RNF-T05 e token desconhecido literal.

Diff completo do escopo: `git show 46d9109`.
</details>
