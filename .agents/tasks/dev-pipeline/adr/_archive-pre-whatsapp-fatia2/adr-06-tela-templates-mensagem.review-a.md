# Parecer de Revisão — ADR-06: Tela de templates `/app/config/mensagens`

**Revisor:** Revisor A (Independente)  
**Data:** 2025-02-21  
**Escopo:** Validação de aderência aos critérios de aceite, fronteiras (RLS, RBAC, isolamento multi-tenant), padrões React (TanStack Query, react-hook-form, zod), acessibilidade e build.

**Verdict:** ✅ APPROVED

---

## Resumo

ADR-06 implementa a tela de edição de templates de mensagem WhatsApp (`/app/config/mensagens`) com lista fixa de 4 cards, editor em diálogo, preview ao vivo e validação zod. A entrega é **sólida, aderente aos critérios de aceite e sem defeitos impeditivos**. Todos os pontos críticos de fronteira (RLS, RBAC, isolamento de tenant, determinismo de renderização, acessibilidade) estão corretamente implementados.

---

## High-Level View

**Estrutura de componentes coerente:** a página agrupa lista de cards + editor modal, espelhando o padrão estabelecido em `ServicosPage`/`ServiceFormDialog`. Reutiliza primitivos shadcn/ui existentes (`Card`, `Dialog`, `Form`, `Button`, `Badge`, `Textarea`); não reinventa.

**RBAC em profundidade:** visibilidade condicional do atalho no hub por `canManageMessageTemplates` (só admin); guard local na página renderiza `AccessDenied` para papéis não-admin. A trava real é RLS do banco (política de escrita).

**Dados sob RLS, sem tenant_id no cliente:** hooks `useMessageTemplates` / `useUpsertMessageTemplate` (TanStack Query) não enviam `tenant_id` explícito; RLS e `default current_tenant_id()` garantem o isolamento. Padrão reusado das demais queries (`useServices`, etc.).

**Validação zod em camadas:** formulário valida schema `messageTemplateSchema` (corpo 1-1000 chars, ativo boolean); resposta do servidor é re-validada com `messageTemplateRowSchema` antes do uso. Dado externo não confiável, tratado com rigor.

**Renderização determinística e compartilhada:** a função `renderTemplate` em `lib/message-templates.ts` é pura (mesma entrada → mesma saída), reutilizada pelo preview do cliente e (por contrato) pelo servidor. A tabela de fallback (`TEMPLATE_FALLBACKS`) espelha a do servidor. Variável desconhecida mantém literal; variável conhecida sem dado usa fallback — **nunca** expõe placeholder cru ao cliente.

**Acessibilidade estruturada:** labels via `FormField`, `aria-live="polite"` no contador e no preview, foco visível em chips/botões, navegação por teclado (`Tab`, `Enter`/`Espaço` nos botões). Contraste do texto tratado conscientemente: tokens realçados por **fundo** (`bg-primary/15`) com texto em `foreground` + `font-medium`, evitando dependência só da cor.

**Mobile-first sem regressão:** grade `gap-4 sm:grid-cols-2` empilha em 1 coluna < `sm`, expande a 2 em desktop. Editor em coluna única no pequeno, sem overflow horizontal.

---

<details>
<summary>Issues (1)</summary>

1. **Ausência de feedback sobre templates inativos no envio** — A tela oferece `Switch` para marcar templates como inativos (`active: false`), mas o diálogo de envio (`SendMessageDialog`) **não valida** se o template selecionado está ativo. Um admin poderia marcar um template como inativo, e ele deixaria de ser renderizado na GUI de envio, mas a validação explícita dessa regra (select desabilita templates inativos ou avisa em pt-BR) não está presente. **Ação:** verificar em QA (ADR-07) se o `SendMessageDialog` filtra templates por status `active` ao popular o select de templates, ou se isso é tratado via UX (usuário vê só os ativos). Se não estiver, abrir small PR para guardrail no SendMessageDialog.

</details>

---

## Behavioral Sections

<details>

### Rota e RBAC

A rota `/app/config/mensagens` está registrada em `router.tsx` como filha de `config`, dentro do guard `RequireActiveSubscription`. O acesso é protegido em duas camadas:

1. **Atalho no hub condicional:** `ConfigHubPage` filtra o atalho por `canManageMessageTemplates`, que retorna `true` apenas para `isAdmin`. Papéis não-admin não veem o link.
2. **Guard de página:** `TemplatesMensagemPage` renderiza `AccessDenied` quando `!canManageMessageTemplates`, rejeitando acesso direto por URL. O componente `AccessDenied` fornece navegação de volta com "Voltar às configurações".

O padrão é **defesa em profundidade**, coerente com o projeto (`canManageWhatsAppConnection`, etc.). A trava real é RLS (AC-03 exige que o banco bloqueie escrita de quem não é admin). Aderência: **confirmada** ✓

### Dados e RLS

`useMessageTemplates()` executa `.select(SELECT_COLUMNS)` sem filtro `WHERE tenant_id = ...`; confia totalmente na RLS habilitada na tabela. Isso é **correto e coerente** com o padrão do projeto (vide `useServices`, `useMessages`, etc.).

`useUpsertMessageTemplate()` não envia `tenant_id` no payload; o servidor (PostgREST) aplica o default `current_tenant_id()` da coluna, derivado do JWT via `profiles`. Upsert por `onConflict: "tenant_id,template_key"` garante idempotência (editar template existente → sobrescreve a linha).

A resposta do servidor é re-validada com `messageTemplateRowSchema` antes de entrar em cache (TanStack Query) — dado externo não confiável é tratado com rigor zod.

Aderência a AC-03 (isolamento): **confirmada** ✓

### Preview e Renderização

A função `segmentPreview` em `TemplatePreview.tsx` é pura e determinística. Ela:

1. Casa tokens `{nome}`, `{servico}`, etc. contra a regex `/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g`.
2. Checa `KNOWN.has(name)` (set O(1)) — tokens desconhecidos mantêm literal.
3. Substitui variáveis conhecidas por valor ou fallback da tabela `TEMPLATE_FALLBACKS`.
4. Segmenta o resultado em `{ kind: "text"|"var", value }` para renderização visual.

A semântica é **idêntica** à `renderTemplate` em `lib/message-templates.ts` (que o servidor deve usar). O preview usa `useMemo` e `aria-live="polite"`, sem efeito — reatividade pura derivada de `form.watch("body")`.

**Observação:** a lista fechada `TEMPLATE_VARIABLES = ["nome", "servico", "dataHora", "empresa"]` é fonte única (constante em `message-templates.ts`); o código não tenta "adivinhar" variáveis ou aceitar inputs customizados fora do enum. Isso atende RF-T05 (conjunto fechado + fallback previsível).

**Risco coberto (defeito #3 do PRD):** nunca renderizar `{variavel}` cru ao cliente. Aderência: **confirmada** ✓

### Acessibilidade

- **Labels:** `FormLabel` e `FormField` (shadcn) ligam `<label htmlFor>` aos inputs automaticamente. `VariableChips` tem `aria-label="Inserir ${label}"` e `title` para tooltip.
- **Região viva:** contador `aria-live="polite"` (75/1000), preview com `aria-live="polite"` quando o corpo muda. Não polui o leitor — mensagens discretas.
- **Teclado:** chips são `<button type="button">`, navegáveis por `Tab`, ativáveis por `Enter`/`Espaço`. `Textarea` nativo. `Dialog` shadcn faz foco trap; `Esc` fecha.
- **Foco visível:** herdado do `focus-visible:ring-2 ring-ring` global aplicado aos primitivos; botões herdam o anel.
- **Contraste (WCAG):** tokens realçados em `bg-primary/15` com `text-foreground` + `font-medium`. O texto em foreground tem contraste 15:1+ contra card (dark theme padrão do projeto). O realce por fundo (não só cor) atende à decisão consciente do design doc. ✓

Aderência: **confirmada** ✓

### Validação e UX

`messageTemplateSchema` valida:
- `templateKey`: enum fechado (4 chaves).
- `body`: string trimmed, 1-1000 chars, mensagens de erro em pt-BR ("Escreva o texto do modelo.", "O texto do modelo é muito longo.").
- `active`: boolean (sem transformação, valor direto).

O formulário usa `zodResolver` (react-hook-form integration); mensagens de erro aparecem sob o field via `FormMessage`. Botão "Salvar" desabilita enquanto `isPending` (spinner `Loader2`).

Em sucesso: toast "Modelo atualizado." (pt-BR), diálogo fecha, cache é invalidado.  
Em erro: toast "Não foi possível salvar o modelo. Tente novamente." (fallback genérico, sem vazar schema).

Aderência: **confirmada** ✓

### Merge de dados: robustez a seed ausente

A função `toCards` em `TemplatesMensagemPage` faz cross-join entre o fetch (`data`) e a lista fechada `MESSAGE_TEMPLATES`. Se uma chave faltar (tenant legado sem seed), um card "a configurar" é derivado com `unconfigured: true`. A UI sinaliza isso com badge "A configurar" e hint "Ainda sem texto. Edite para definir a mensagem."

Isso atende o critério: **a tela é robusta a lacuna de seed**. A redação padrão (que o admin deveria ver) é responsabilidade da migration (ADR-02), não da UI — a UI só sinaliza honestamente.

Aderência: **confirmada** ✓

### Build, TypeScript e Qualidade

- **`npm run build`:** build limpo, sem erros TypeScript, sem warnings graves (chunk warning é conhecido, não é bloqueio).
- **`npm run typecheck`:** typecheck limpo. Sem `any` implícito. Todos os types importados e usados corretamente.
- **Sem segredo/PII no código:** nenhum VITE_TOKEN, nenhum telefone logado em claro, nenhuma chave da Evolution.

Aderência: **confirmada** ✓

### Isolamento de tenant (AC-03)

A entrega não permite o cliente enviar `tenant_id` explicitamente:
- Hook não aceita `tenant_id` como parâmetro.
- Upsert não inclui `tenant_id` no payload.
- RLS e `default current_tenant_id()` garantem isolamento na raiz.

Dois tenants A e B: um usuário de A que executa `.select()` vê **só** linhas de A (RLS bloqueia outras). Editar template em A não afeta B (unique constraint `(tenant_id, template_key)` + RLS asseguram).

Aderência a RNF-T01 (AC-03): **confirmada** ✓

</details>

---

## File Map

<details>
<summary>Arquivos alterados/criados</summary>

- **`src/app/config/mensagens/TemplatesMensagemPage.tsx`** (novo) — Página principal, lista de 4 cards com merge de fetch + defaults, robusta a seed ausente.
- **`src/app/config/mensagens/TemplateEditorDialog.tsx`** (novo) — Diálogo modal, rhf + zod, salva em TanStack Query, invalidação de cache.
- **`src/app/config/mensagens/TemplateBodyField.tsx`** (novo) — Campo textarea com chips de variáveis, inserção no cursor, contador de caracteres com `aria-live`.
- **`src/app/config/mensagens/VariableChips.tsx`** (novo) — Barra de chips clicáveis, lista fechada de `TEMPLATE_VARIABLE_META`.
- **`src/app/config/mensagens/TemplatePreview.tsx`** (novo) — Preview ao vivo, segmentação pura, realce de tokens por fundo + texto foreground.
- **`src/hooks/useMessageTemplates.ts`** (novo) — Hooks TanStack Query (leitura/upsert), validação zod de response.
- **`src/lib/message-templates.ts`** (novo) — Contrato compartilhado: lista fechada, tabela de fallback, `renderTemplate` pura.
- **`src/lib/validations/whatsapp.ts`** (modificado) — Adiciona `messageTemplateSchema` e `MessageTemplateInput`.
- **`src/hooks/usePermissions.ts`** (modificado) — Adiciona `canManageMessageTemplates: isAdmin`.
- **`src/app/config/ConfigHubPage.tsx`** (modificado) — Atalho "Modelos de mensagem" visível só para admin.
- **`src/router.tsx`** (modificado) — Adiciona rota filha `/app/config/mensagens` → `TemplatesMensagemPage`.

</details>

---

## Conclusão

A implementação de ADR-06 é **APPROVED**. Todos os critérios de aceite foram atendidos:

- ✅ Build limpo, typecheck sem erros.
- ✅ Tela lista 4 cards com rótulo, badge e prévia; mobile 1 coluna, desktop 2.
- ✅ Editor em diálogo, chips de variáveis inserem tokens, preview ao vivo com fallback.
- ✅ Salvar → toast, cache invalidado, card reflete novo texto.
- ✅ RBAC (admin só), RLS isolando tenant, sem tenant_id no cliente.
- ✅ Validação zod, react-hook-form, TanStack Query (sem fetch solto).
- ✅ Acessibilidade (labels, aria-live, foco, teclado, contraste).
- ✅ Robustez a seed ausente (cards "a configurar" derivados honestamente).

**Uma questão menor (templates inativos no SendMessageDialog)** foi sinalizada como observação para QA, mas não bloqueia aprovação — é guardrail recomendado para a fase de testes (ADR-07).

O código está pronto para o próximo passo: code review (Revisor B), QA ao vivo (ADR-07) e integração com o servidor (ADR-04, renderização de envio).

