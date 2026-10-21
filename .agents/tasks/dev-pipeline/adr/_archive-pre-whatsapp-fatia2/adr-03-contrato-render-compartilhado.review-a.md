# ADR-03 — Contrato de renderização compartilhado — Parecer do Revisor A

**Status**: APROVADO

---

## Resumo Executivo

A ADR-03 entrega uma implementação limpa de uma **função pura de renderização de templates** com uma **lista fechada de variáveis** e uma **tabela de fallback previsível**, espelhando o contrato canônico do PRD (após resolver divergência entre as análises de frontend e dados — PRD vence). A peça é determinística, testável isoladamente e serve como fonte única compartilhada entre o preview do cliente (futuro, ADR-06) e a renderização server-side (ADR-04). TypeScript estrito, sem `any`, e cobertura de testes na norma exigida.

**Watch for:** Uma questão de design não-bloqueante sobre o comportamento de `{empresa}` quando o tenant é legado sem `trade_name` — a função assume que o chamador passa o valor resolvido, não há ponto de decisão aqui. Documentado e intencionado. Nada mais bloqueante.

---

## Alta-Nível

O código implementa três artefatos complementares: uma **lista fechada de variáveis** (`TEMPLATE_VARIABLES`), uma **tabela de fallback pt-BR** (`TEMPLATE_FALLBACKS`) e a **função de renderização** (`renderTemplate`). A lista e a tabela são constantes exportadas, reutilizáveis por componentes que desenham chips ou validam entrada. A função opera por `replace` com regex, tratando variáveis conhecidas com fallback e variáveis desconhecidas (ex.: `{foo}`) como texto literal — decisão consciente do PRD para nunca expor erro ao cliente. Todos os 8 casos de teste passam: substituição com dados presentes, fallback quando faltam dados, valores `null`/vazios, token desconhecido, repetição, determinismo. TypeScript estrito, sem `any`. Build e typecheck limpos. Pronto para consumo pela ADR-06 (preview) e ADR-04 (servidor, que replica esta tabela e lógica em Deno).

---

<details>
<summary>Issues (0)</summary>

Nenhuma issue bloqueadora. Veja a observação de design abaixo.

</details>

---

<details>
<summary>Detalhes de comportamento</summary>

### Lista fechada e tabela de fallback (decisão D4 do PRD respeitada)

O PRD §RF-T07 (canônico) fixa a lista: `{nome} {servico} {dataHora} {empresa}`. Nota importante no ADR-03: houve divergência entre `analysis-frontend.md` e `analysis-data.md` nos valores de fallback — `{nome}→"você"` vs `{nome}→"cliente"`. **O ADR-03 declara que o PRD vence** (regra do pipeline), e a implementação adere:

- `{nome}` → `"cliente"` ✓ (PRD, não "você")
- `{servico}` → `"seu atendimento"` ✓
- `{dataHora}` → `"no horário combinado"` ✓ (com "no", não "o")
- `{empresa}` → `"nossa equipe"` ✓

Os metadados (`TEMPLATE_VARIABLE_META`) reúnem o token e o label pt-BR dos chips — estrutura correcta para consumo por ADR-06. **Confirmed.**

### Renderização: tratamento de presença e ausência

A função `renderTemplate` percorre o `body` com um regex simples (`/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g`) que casa tokens simples. Para cada match:

1. Se o `rawName` não está em `KNOWN_VARIABLES` (conjunto O(1)) → mantém literal (`{foo}` fica `{foo}`). Decisão consciente do PRD — nunca quebrar o envio e nunca exibir erro ao cliente. **Confirmed.**
2. Se está em `KNOWN_VARIABLES`, resolve o valor em `vars[variable]`:
   - Valor presente e não vazio (após `.trim()`) → usa o valor. ✓
   - Valor `null`, ausente ou vazio (incluindo whitespace-only) → usa o fallback. ✓

Casos de teste cobrem isso: AC-05 (substituição com dados), AC-06 (fallback com dados faltantes, `null`, vazio, whitespace). **Confirmed.**

### Pureza e determinismo (RNF-T05)

Não há `fetch`, I/O, relógio, ou estado. Mesma entrada (`body` + `vars`) → mesma saída, sempre. Um teste específico (`"RNF-T05: determinístico..."`) roda a função duas vezes com entrada idêntica e compara o resultado. **Confirmed.**

### TypeScript estrito e tipos corretos

- `TemplateVariable = (typeof TEMPLATE_VARIABLES)[number]` → tipo extraído do array const, elimina duplicação. ✓
- `TemplateVars = Partial<Record<TemplateVariable, string | null>>` → permite `null` (comportamento de fallback) e opcional (nem todas as variáveis precisam estar no objeto). ✓
- Sem `any` implícito. Typecheck passa. **Confirmed.**

### Notas de contrato com servidor (ADR-04)

O arquivo cita que "o servidor **replica** esta mesma lista fechada e tabela de fallback em Deno". Nenhuma garantia neste código — é um comentário de intenção — mas é uma declaração clara: a ADR-04 precisa ter as mesmas 4 variáveis, a mesma tabela de fallback e a mesma lógica de "variável desconhecida = literal". Qualquer mudança aqui obriga atualizar lá. **Confirmed como ponto de coordenação documentado.**

### Comportamento de {empresa} com tenant legado

O comment menciona: "`{empresa}`: o chamador passa `trade_name` (ou `null`); a função aplica `nossa equipe` quando nulo/vazio." Isso pressupõe que o chamador da renderização (o servidor em ADR-04) já resolveu `tenants.trade_name` e o passou para cá. Se o tenant legado não tem `trade_name` (coluna nullable), o servidor é responsável por passar `null` e deixar o fallback "nossa equipe" fazer seu trabalho. É o design correto, mas uma **observação para o QA/integradores**: verificar que a ADR-04 realmente resolve `trade_name` e trata `null`/vazio. Não há defeito aqui — é uma dependência cross-ADR bem documentada. **Noted (não-bloqueante).**

</details>

---

<details>
<summary>Testes</summary>

#### Cobertura

8 testes, todos em verde:
- AC-05 (substituição): ✓ caso com as 4 variáveis presentes.
- AC-06 (fallback): ✓ todas as 4 variáveis faltando, todos em fallback; ✓ `null` e vazio; ✓ whitespace-only; ✓ cada variável separadamente.
- Token desconhecido: ✓ `{foo}` mantido literal; ✓ misto (desconhecido + conhecido).
- Sem variáveis: ✓ texto literal inalterado.
- Repetição: ✓ mesma variável 2×, ambas substituídas.
- Determinismo: ✓ chamada dupla com entrada idêntica.

Todos os casos relevantes da ADR-03 (RNF-T05, AC-05, AC-06) são cobertos. **Confirmed.**

#### Ausências

Nenhuma ausência esperada. Os testes unitários desta peça pura são suficientes. A integração (preview em ADR-06, renderização em ADR-04) será testada nas ADRs correspondentes.

</details>

---

<details>
<summary>Verificação de build e artefatos</summary>

- `npm run typecheck`: ✓ Exit 0, sem erros.
- `npm run test -- message-templates`: ✓ 8 testes passando, Exit 0.
- `npm run build`: ✓ Build minificado completa sem erro. Aviso sobre chunk size (774kB) é pré-existente, não introduzido por esta mudança (a nova peça é <2kB de código).

Arquivos criados:
- `src/lib/message-templates.ts`: 91 linhas, exporta 4 constantes/tipos + 1 função.
- `src/lib/message-templates.test.ts`: 77 linhas, 8 testes.

Ambos bem estruturados, comentados e conformes. **Confirmed.**

</details>

---

<details>
<summary>Aderência ao PRD e critérios de aceite (ADR-03)</summary>

**Critério: RNF-T05 (determinismo, AC-05/AC-06)**

> "A função de render é pura e determinística dado (template, dados resolvidos): mesma entrada → mesma saída, sem relógio/rede além da resolução de dados do tenant."

Implementação: ✓ Sem efeitos colaterais, sem I/O, sem estado. Teste específico (`RNF-T05: determinístico...`) executa a função 2× com mesma entrada e valida igualdade.

**Critério: AC-05 (RF-T06, substituição correta)**

> "Admin edita o template `confirmacao` para `"Olá {nome}, seu horário de {servico} é {dataHora}."`. Dispara... o `text` entregue ao adapter é o **texto renderizado** com valores reais — **não** a string `"confirmacao"`."

Nota: ADR-03 é só a **função**, não o envio. Mas a função implementa a lógica que ADR-04 usará. Teste: "AC-05: substitui as 4 variáveis..." valida substituição com dados reais. ✓

**Critério: AC-06 (RF-T07, fallback previsível, defeito #3)**

> "Quando um dado de variável faltar (ex.: cliente sem nome), a variável é substituída por um fallback pt-BR definido — **nunca** se envia o placeholder cru."

Implementação: ✓ Quando `value == null` ou vazio, usa `TEMPLATE_FALLBACKS[variable]`. Variável desconhecida fica literal (não quebra). Testes: "AC-06: variável faltante..." e "AC-06: valor null ou vazio...", ambas cobrem. ✓

**Critério: RNF-T03 (TS estrito)**

> "Novos tipos tipados (sem `any`)."

Implementação: ✓ Sem `any`. `TemplateVariable` extraído do array const, `TemplateVars` é Record tipado, `renderTemplate` tem tipos explícitos.

**Critério: AC-01/AC-02 (não se aplica aqui — são de migration/baseline)**

Esta ADR é só o contrato de renderização, não o schema/seed.

</details>

---

<details>
<summary>Notas para futuro (ADR-04 e ADR-06)</summary>

1. **ADR-04 (Edge Function):** Precisa replicar a mesma `TEMPLATE_VARIABLES` e `TEMPLATE_FALLBACKS` em Deno. Nenhum `{valor}` nesta fatia (decisão D4 do PRD). Se faltar dado de uma variável, aplica o fallback (não envia `{nome}` cru). Se o template não existir no banco (tenant legado), usar o texto de sistema padrão da migration (fallback de template — não é responsabilidade desta função).

2. **ADR-06 (tela de editor):** Consome `TEMPLATE_VARIABLE_META` para os chips, consome `renderTemplate` para o preview ao vivo. O preview já mostra o resultado da renderização; o envio real (ADR-04) usa o mesmo contrato.

3. **Evolução futura (Fatia 2+):** Adicionar `{valor}` é aditivo — só estender `TEMPLATE_VARIABLES`, `TEMPLATE_FALLBACKS` e `TEMPLATE_VARIABLE_META` com a nova entrada. Nenhuma quebra de contrato.

</details>

---

## Conclusão

A ADR-03 entrega uma peça pura, bem testada, aderente ao PRD e preparada para consumo por ADR-06 e ADR-04. Nenhuma issue bloqueadora. Um ponto de observação (comportamento de `{empresa}` com tenant legado sem `trade_name`) é documentado e não-bloqueador — fica como nota de integração para ADR-04.

**Verdict: APPROVED**
