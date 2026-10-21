# Parecer Revisor B — ADR-06: Tela de templates `/app/config/mensagens`

Tela de modelos de mensagem com lista fixa de 4 cards + editor em `Dialog`, chips de variável, contador e preview ao vivo, mais rota filha e 4º atalho no hub de Configurações visível só para admin. O escopo entregue (commit `5681f85`) bate exatamente com os 7 arquivos declarados na ADR, nenhum arquivo extra. Build (`tsc -b && vite build`) e `vitest run` passam limpos. O isolamento multi-tenant está correto: nenhuma escrita de `tenant_id` pelo cliente, leitura/escrita sob RLS (herdada da ADR-05), gate de UI (`AccessDenied` + atalho só admin) como defesa em profundidade sobre o RLS. Nenhum log/segredo/PII introduzido (frontend puro, sem `console.*`).

Watch for:
- **Preview reimplementa a lógica de render em vez de reusar `renderTemplate`** (confirmed) — `TemplatePreview.segmentPreview` duplica a semântica de token/fallback da ADR-03; hoje equivalente, mas é exatamente o risco de divergência que a ADR-03 existe para eliminar, sem teste que garanta paridade. A ADR-06 diz textualmente "renderização ao vivo via `renderTemplate`".
- **`maxLength` não barra inserção de chip** (possible) — inserção programática de token pode ultrapassar 1000 chars; `maxLength` só limita digitação. Capturado pelo zod no submit, mas passa silencioso até salvar.

**Verdict**: APPROVED

## Visão geral

A entrega segue fielmente os padrões já estabelecidos (`ServicosPage`, `ServiceFormDialog`, `ConfigHubPage`) e os contratos das ADRs de base. O ponto de atenção real é arquitetural e não bloqueante: o preview do cliente recriou um segmentador de tokens próprio para poder realçar visualmente quais trechos foram substituídos, em vez de chamar a `renderTemplate` canônica. Isso resolve o problema de realce, mas cria uma segunda cópia da tabela de fallback e do padrão de token no cliente — a divergência que a ADR-03 foi desenhada para evitar. As duas implementações estão semanticamente alinhadas neste commit; o risco é drift futuro sem rede de teste.

O RBAC está coerente com a decisão D6/§5 do PRD: a rota `mensagens` segue o mesmo modelo da `whatsapp` (sem `RequireRole` no router, gate dentro da página via `canManageMessageTemplates` + `AccessDenied`), e a trava real continua sendo o RLS no banco. `super_admin` sem tenant cai no `AccessDenied` antes de qualquer fetch, sem caminho cross-tenant pelo cliente.

O merge do fetch com `MESSAGE_TEMPLATES` garante os 4 cards mesmo em tenant legado sem seed, e a UI sinaliza a lacuna ("A configurar") sem inventar a redação padrão — honesto e alinhado à ADR-02 como dona do texto canônico.

<details>
<summary>Issues (2)</summary>

1. **Preview duplica render** — `segmentPreview` em `TemplatePreview.tsx` reimplementa a semântica de `renderTemplate` (ADR-03) em vez de reusá-la; adicionar um teste de paridade preview↔`renderTemplate`, ou refatorar o realce para derivar da função canônica, fechando o risco de divergência. Não bloqueia (equivalente hoje).
2. **Over-limit por chip** — inserir chip com o corpo já em 1000 chars ultrapassa o limite sem feedback imediato (`maxLength` não cobre mudança programática); considerar truncar/bloquear a inserção quando `length >= MAX_BODY`. Menor; o zod rejeita no submit.

</details>

<details>
<summary>Details</summary>

### Preview: segunda cópia da semântica de render

`TemplatePreview.tsx` importa `TEMPLATE_FALLBACKS`, `TEMPLATE_VARIABLES` e `TemplateVars` da fonte canônica (ADR-03), mas em vez de chamar `renderTemplate(body, vars)` ele percorre o corpo com um `TOKEN_PATTERN` próprio e reaplica a mesma regra (valor presente e não vazio → valor; senão → `TEMPLATE_FALLBACKS[variable]`; token desconhecido → literal). A justificativa no comentário é legítima — o preview precisa saber *quais* trechos foram substituídos para aplicar o realce por fundo (`bg-primary/15`), coisa que uma função que devolve `string` pura não entrega.

Verifiquei a equivalência nos casos de borda e ela se sustenta neste commit:
- `TOKEN_PATTERN` é idêntico ao da ADR-03 (`/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g`);
- variável conhecida vazia/`null` → mesmo fallback;
- `{empresa}` nulo → `TEMPLATE_FALLBACKS.empresa` = "nossa equipe", igual ao `renderTemplate`;
- token desconhecido → mantido literal (fica em segmento de texto);
- corpo vazio → ramo de placeholder visual, sem render.

O problema é de manutenção, não de correção: a ADR-03 declara a lista fechada e a tabela de fallback como "fonte única" justamente para que preview (cliente) e envio (servidor) nunca divirjam, e aqui nasce um terceiro ponto que replica a lógica no próprio cliente — sem teste guardando a paridade com `renderTemplate` (o `message-templates.test.ts` cobre `renderTemplate`, não `segmentPreview`). Uma mudança futura na regra de render (ex.: trim diferente, nova variável) pode atualizar `renderTemplate` e esquecer `segmentPreview`. O caminho mais limpo é derivar os segmentos de uma função que compartilhe o núcleo com `renderTemplate` (ou adicionar um teste de paridade). Não bloqueia a ADR.

### `maxLength` vs. inserção de chip

`TemplateBodyField` aplica `maxLength={1000}` no `Textarea` e espelha o contador. Mas `insertToken` escreve via `field.onChange(next)` (mudança programática), e `maxLength` do elemento nativo só limita entrada do usuário, não `setState`. Com o corpo em 1000 chars, clicar um chip gera um `body` > 1000; o contador mostra, por exemplo, `1012/1000`, e o zod `max(1000)` rejeita só no submit com "O texto do modelo é muito longo." Comportamento recuperável e validado, mas a inserção deveria idealmente ser no-op (ou truncar) quando já no limite. Menor.

### RBAC e isolamento — corretos

A rota `mensagens` fica sob `RequireAuth → RequireActiveSubscription → AppLayout`, sem `RequireRole`, exatamente como `whatsapp`. O gate de papel é a checagem `!canManageMessageTemplates → <AccessDenied>` dentro da página, e o atalho no hub é filtrado por `visible: canManageMessageTemplates` com a regra `visible !== false` (atalhos sem `visible` seguem sempre visíveis — correto para os 3 existentes). Isso é defesa em profundidade; a trava real é o RLS da ADR-01 (fora do escopo deste commit, já aprovado). Nenhuma leitura/escrita envia `tenant_id` pelo cliente: `useMessageTemplates`/`useUpsertMessageTemplate` (ADR-05) dependem do `default current_tenant_id()` + RLS. `useTenant` para `{empresa}` também não passa `tenant_id`. Sem vazamento cross-tenant pelo cliente.

### Acessibilidade

Chips são `<button type="button">` com `aria-label` e realce de foco; o preview realça variável por **fundo** + `font-medium` em `text-foreground` (não só cor), atendendo a decisão de contraste do PRD §8.7. `aria-live="polite"` no contador e no preview. `AccessDenied` move foco para o `<h1>`. A devolução de foco ao gatilho no `Esc` depende do comportamento padrão do Radix (o `Dialog` é controlado e montado condicionalmente, sem `DialogTrigger`); funciona na prática porque o Radix captura o elemento previamente focado, mas o QA ao vivo (ADR-07) deve confirmar visualmente. Validação WCAG completa exige teste manual — fora do escopo desta verificação.

### Contraprova

- `npm run build` → exit 0 (tsc -b + vite build limpos; aviso de chunk > 500 kB é pré-existente, não introduzido aqui).
- `vitest run` → 24/24 passam (`message-templates.test.ts` 8, `scheduling-slots.test.ts` 16).
- Não há script de lint no `package.json` (apenas `dev`, `build`, `typecheck`, `test`, `preview`); typecheck coberto pelo `build`.
- Dev server / QA visual Chrome DevTools: **não executados aqui por decisão de escopo** — são do step de QA (ADR-07).

</details>

<details>
<summary>Arquivos no escopo (commit 5681f85)</summary>

- `src/app/config/ConfigHubPage.tsx` — 4º atalho "Modelos de mensagem", visível só para admin via `visible`/filtro; `SHORTCUTS` const vira lista derivada de `usePermissions`.
- `src/app/config/mensagens/TemplatesMensagemPage.tsx` (novo) — página: 4 cards, estados load/erro, `AccessDenied` para não-admin, abre o editor.
- `src/app/config/mensagens/TemplateEditorDialog.tsx` (novo) — `Dialog` + rhf/zod, Switch ativo, preview, toast, reset ao reabrir.
- `src/app/config/mensagens/TemplateBodyField.tsx` (novo) — `Textarea` controlado + chips + contador `aria-live`.
- `src/app/config/mensagens/VariableChips.tsx` (novo) — chips da lista fechada (ADR-03) que inserem `{token}` no cursor.
- `src/app/config/mensagens/TemplatePreview.tsx` (novo) — preview ao vivo com realce por fundo; **reimplementa** a semântica de render (ver Issues #1).
- `src/router.tsx` — rota filha `mensagens` sob `config`.

Diff completo: `git show 5681f85`.

</details>
