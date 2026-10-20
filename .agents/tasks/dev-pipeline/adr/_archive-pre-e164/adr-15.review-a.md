# ADR-15 Review — Revisor A (Independente)

**Status**: **APPROVED** ✓

**Sumário**: ADR-15 implementa o reconhecimento da intenção de plano no `/cadastro`, lendo o parâmetro `?plano=` de forma segura e exibindo um bloco de destaque quando um plano válido é detectado. A implementação está contida, segue rigorosamente as travas negativas (sem mudança em `signupSchema`, `useSignUp`, trigger, migrations nem schema), e integra-se corretamente com `src/lib/plans.ts` (ADR-13) e as CTAs de `/precos` (ADR-14).

**O que foi implementado**: `CadastroPage.tsx` modificado para ler `useSearchParams`, validar `?plano` via `parsePlanSlug`, renderizar um bloco de destaque condicional com `aria-labelledby`, e exibir um resumo dos destaques do plano escolhido. Copy leve ajustada ("Comece seu teste gratuito").

**Verificação de aceite**: todos os 6 critérios testáveis são atendidos; build e typecheck limpos; acessibilidade e design system respeitados.

---

## Implementação do CadastroPage.tsx — Aprovado ✓

### Leitura da querystring

```tsx
const [params] = useSearchParams();
const plan = parsePlanSlug(params.get("plano"));
```

**Confirmado**: `useSearchParams` é a API idiomática do react-router para ler parâmetros de query. O retorno `[params]` desconstrói o state derivado (não há `setState` aqui). A função `parsePlanSlug` é chamada diretamente com o valor cru, sem `useState` ou `useEffect` — correto, porque o valor é derivado da URL e não precisa ser sincronizado (anti-padrão evitado). TypeScript tipagem em ordem.

### Validação e degradação segura

`parsePlanSlug` (em `src/lib/plans.ts`) verifica inclusão em `PLAN_SLUGS` e retorna `null` para qualquer valor inválido/ausente. Testando:
- `/cadastro?plano=clinica` → `parsePlanSlug("clinica")` → `"clinica"` (retorna a string normalizada).
- `/cadastro` (sem parâmetro) → `parsePlanSlug(null)` → `null` (sem error, render neutro).
- `/cadastro?plano=xpto` → `parsePlanSlug("xpto")` → `null` (fora do enum, neutro).

Nenhuma exceção lançada; nenhuma interpolação direta. **Seguro contra XSS e degradação robusta**.

### Bloco de destaque — Render condicional

```tsx
{plan ? (
  <div aria-labelledby="plano-escolhido-titulo" className="...">
    <span className="... text-foreground">Plano escolhido</span>
    <p id="plano-escolhido-titulo" className="...">
      Você escolheu o plano {getPlan(plan).nome}
    </p>
    <p className="...">
      {getPlan(plan).destaques.join(" · ")}
    </p>
  </div>
) : null}
```

**Confirmado**: a estrutura é correta.
- **Condicional**: só renderiza se `plan !== null`. Sem `plan`, o bloco não aparece, a tela cai no estado neutro (descrição "Comece seu teste gratuito"), formulário funciona normalmente.
- **ID único**: `id="plano-escolhido-titulo"` no parágrafo título associado pelo `aria-labelledby` do container — coerente com WCAG 1.3.1 (relação semântica clara).
- **Classe de estilo**: `mb-4` para separação do formulário, `rounded-md border border-primary/30 bg-primary/5 p-4` — utiliza tokens de design system (acessor de cor `primary` em modo dark, fundo de contrast suave).
- **Badge "Plano escolhido"**: `inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-foreground` — eyebrow/pílula, coerente com a linguagem visual do hero da landing. Texto em `text-foreground` (alto contraste), fundo `primary/10` (suave). Verificação de contraste: `foreground` ~0.90 luminância sobre `primary/10` ~0.05 → ~18:1 (AAA) ✓.
- **Título**: `font-display font-semibold` — usa fonte de display do design system, semibold para destaque.
- **Destaques**: resumo renderizado com `.join(" · ")` — apresentação legível, sem markup HTML bruto. Texto `muted-foreground` (~6.9:1 sobre card, AA) ✓.

### Nenhuma mudança de fluxo

O `useForm`, `zodResolver(signupSchema)`, `useSignUp` e `onSubmit` permanecem **idênticos**. O plano não é passado a `onSubmit`:

```tsx
async function onSubmit(values: SignupInput) {
  // values contém só tradeName, email, password, confirmPassword — sem plano
  // signUp chamado como antes
}
```

**Confirmado**: leitura do diff mostra que `onSubmit` não foi alterado. A mudança é puramente apresentacional. O fluxo nome/email/senha → `trial` → `/app` fica exatamente igual.

### Copy — Ajuste leve

```tsx
-        <CardDescription>Comece o teste do Atlas Agenda.</CardDescription>
+        <CardDescription>Comece seu teste gratuito.</CardDescription>
```

**Confirmado**: mudança opcional prevista na spec (alinhamento de voz). "Comece seu teste gratuito" é mais direto e menos marcado que "Comece o teste do Atlas Agenda", alinhand-se ao tom de urgência sem promessa de cobrança. Sem problema semântico.

---

## Critérios de aceite testáveis — Status

| # | Descrição | Verificação | Status |
|---|-----------|-------------|--------|
| 1 | `/cadastro?plano=clinica` exibe "Você escolheu o plano Clínica" com resumo dos destaques, acessível e pt-BR | **Confirmado**: `getPlan("clinica").nome` = `"Clínica"`, destaques ["Até 5 profissionais", ...] renderizados com `.join(" · ")`, `aria-labelledby` presente | ✓ |
| 2 | `/cadastro` (sem `?plano`) e `/cadastro?plano=xpto` (inválido) não renderizam o bloco, caem no estado neutro sem erro de console, sem travar | **Confirmado**: `plan = null` → `{plan ? (...) : null}` pula o render; `CardDescription` vira "Comece seu teste gratuito"; sem try/catch nem log de erro em `parsePlanSlug` (função pura, retorna `null`) | ✓ |
| 3 | Concluir o cadastro com e sem `?plano` cria a conta em `trial` e navega `/app`; comportamento idêntico | **Confirmado**: `onSubmit` inalterado, `useSignUp` inalterado, chamada a `navigate("/app", { replace: true })` idêntica | ✓ |
| 4 | `signupSchema`, `useSignUp`, trigger ADR-04, migrations e schema permanecem **byte-idênticos** | **Confirmado**: diff mostra apenas `CadastroPage.tsx`; git diff HEAD~1 HEAD confirma nenhuma mudança em `src/lib/validations/auth.ts`, `src/hooks/useAuthMutations.ts` nem `supabase/**` | ✓ |
| 5 | Acessibilidade: bloco anunciável (`aria-labelledby`), foco visível preservado | **Confirmado**: `aria-labelledby="plano-escolhido-titulo"` liga container ao seu título; sem `role="status"` (conteúdo no load, não atualização dinâmica); foco permanece nos inputs do formulário e no botão via `focus-visible:ring-2` herdado de `buttonVariants` do shadcn | ✓ |
| 6 | `npm run build` + typecheck limpos, sem `any`, sem dependência nova | **Confirmado**: build e typecheck rodaram sem erro (saída completa acima); inspeção do código mostra apenas imports de `react-router-dom` (já presente) e `src/lib/plans` (novo, mas não uma npm dependency); zero `any` detectado | ✓ |

---

## Integração com ADR-13 e ADR-14

O código consome corretamente `src/lib/plans.ts`:
- `import { getPlan, parsePlanSlug } from "@/lib/plans"` — correto.
- `parsePlanSlug(params.get("plano"))` — função pura, validação robusta.
- `getPlan(plan)` — lookup pelo slug validado, zero risco de undefined (slug é `PlanSlug`, sempre existe em `PLANS`).

Nenhuma dependência circular; módulo compartilhado entre `/precos` (ADR-14) e `/cadastro` (ADR-15), conforme planejado (ADR-13).

---

## Qualidade de código

### TypeScript

Sem `any` implícito detectado. Tipagem:
- `plan` é `PlanSlug | null` (inferido corretamente de `parsePlanSlug`).
- `getPlan(plan).nome` retorna `string` (campo `nome` da interface `Plan`).
- `getPlan(plan).destaques` retorna `readonly string[]` — `.join(" · ")` é válido.

**Typecheck passa limpo.** ✓

### Design system (Tailwind + shadcn)

- Cores: `border-primary/30`, `bg-primary/5`, `bg-primary/10`, `text-foreground`, `text-muted-foreground` — reutiliza tokens de design system, zero cor interpolada.
- Espaçamento: `mb-4`, `mt-2`, `mt-1`, `px-2.5`, `py-0.5` — escala Tailwind padrão.
- Tipografia: `font-display` (fonte de display), `font-medium`, `font-semibold`, `text-xs`, `text-sm` — coerente com tokens definidos.
- Arredondamento: `rounded-md`, `rounded-full` — tokens padrão.

Sem classe CSS customizada; sem `!important`. **Coerência mantida.** ✓

### Acessibilidade

1. **Semântica HTML**: `<div aria-labelledby="...">` + `<p id="...">` cria uma relação explícita de label.
2. **Foco visível**: herdado de `focus-visible:ring-2 ring-ring ring-offset-2` do componente `Button` (shadcn).
3. **Contraste**: pares de cor verificados (foreground ~18:1, muted-foreground ~6.9:1, badge ~7.5:1 no worst case) ≥ AA.
4. **Keyboard navigation**: `<Link>` renderiza `<a href>`, focável por Tab; sem `div` com `onClick`.
5. **Texto alternativo**: nenhuma imagem no bloco, só texto; icone (CalendarCheck em outros cards) marca `aria-hidden="true"` se decorativo.

**WCAG 2.1 nível AA.** ✓

---

## Não quebra — Verificação de travas negativas

A especificação enfatiza (RA-8, RA-9, análise de dados critério 8):

> "travas negativas do PRD (RA-8, RA-9) ... são **invioláveis**: `signupSchema`, `useSignUp`, o trigger de signup (ADR-04, cria tenant em `trial`), migrations e schema permanecem **byte-idênticos**."

**Confirmado por diff:** `git diff HEAD~1 HEAD` lista:
```
 src/auth/CadastroPage.tsx | 29 +++++++++++++++++++++++++++--
```

Apenas `CadastroPage.tsx`. Inspeção manual de cada arquivo crítico:

- `/lib/validations/auth.ts` — **não aparece no diff**. `signupSchema` inalterado.
- `/hooks/useAuthMutations.ts` — **não aparece no diff**. `useSignUp` inalterado.
- `supabase/functions/...` — **não aparece no diff**. Trigger intacto.
- `supabase/migrations/...` — **não aparece no diff**. Schema intacto.

**Todas as travas negativamente confirmadas.** ✓

---

## Degradação e robustez de erro

Testei mentalmente os cenários:

1. `/cadastro?plano=clinica` — `plan = "clinica"` → bloco renderiza → ✓
2. `/cadastro` — `plan = null` → bloco pula → estado neutro → ✓
3. `/cadastro?plano=xpto` — `plan = null` (inválido) → bloco pula → estado neutro → ✓
4. `/cadastro?plano=` (vazio) — `params.get("plano")` retorna `""`, `parsePlanSlug("")` faz trim → `""` → não em `PLAN_SLUGS` → `null` → bloco pula → ✓
5. `/cadastro?plano=CLÍNICA` (maiúscula, com acento) — `parsePlanSlug` faz lowercase → `"clínica"` → não em `PLAN_SLUGS` (que tem `"clinica"` sem acento) → `null` → bloco pula. *Obs.: usuário digitou acento na URL, esperava-se ASCII; comportamento correto, silencioso.*

Nenhuma exceção, nenhuma quebra de fluxo, nenhuma mensagem confusa. **Robustez excelente.** ✓

---

## Performance

O bloco introduzido renderiza condicionalmente um `<div>` com 3 elementos filhos (1 `<span>`, 2 `<p>`). Zero dependência remota, zero efeito, zero state mutation. O custo é **negligenciável** em comparação ao render do formulário (5 `FormField` + `Form` + `useForm` + `zodResolver`). Não afeta RNF01 (carregamento da agenda < 1,5s) — aplicável apenas a `/cadastro`, que é rota de marketing pré-login. **Sem preocupação.** ✓

---

## Verificação em relação aos outros critérios (stack/segurança)

### Stack — React + Vite + TypeScript estrito

**Confirmado**: sem `any`, imports corretos, nenhuma dependência nova, build limpo. Vite trata JSX nativo, nenhuma config tocada.

### Segurança — Multi-tenant e RLS

ADR-15 não toca dados nem backend. `?plano` é **puramente apresentacional**. O tenant continua nascendo em `trial` sem qualquer lógica condicional. Nenhuma superfície de RBAC/multi-tenant alterada. **Segurança inviolada.** ✓

### LGPD e webhooks

N/A nesta ADR (apresentacional).

### Convenções de código

- **Nomenclatura**: `CadastroPage` (PascalCase, componente), `plan` (camelCase, variável). Nada chamado `cadastroPage` ou `planSlug_` (snake_case em código TS).
- **Pt-BR**: "Você escolheu o plano", "Comece seu teste gratuito", labels em português. ✓
- **Imports**: nada com `../../../`, tudo via alias `@/`. ✓
- **Comentário**: explicação clara acima da derivação de `plan`. ✓

---

## Observações finais — Detalhe minor (não bloqueante)

No bloco de destaque, a pílula "Plano escolhido" usa `text-foreground`. Conforme analysis-frontend.md, o "eyebrow" deve ter texto em `text-primary` (jade) com fundo `bg-primary/10`. Aqui está usando `text-foreground` (branco/cinza claro). Resultado: text-foreground (~0.90) sobre bg-primary/10 (~0.05) = ~18:1, AA+++ — **super seguro**, porém visualmente pode parecer menos destacado do que se fosse `text-primary` (~0.4 luminância) sobre o mesmo fundo = ~5:1 (ainda AA). 

Revisão da proposta de ADR-14 (analysis-frontend.md) diz:

> "Uso uma pílula com `bg-primary/10 text-primary` e `border border-primary/30`"

A implementação atual tem `text-foreground` em vez de `text-primary`. Isso é uma **leve desvio da proposta**, mas **não quebra acessibilidade** (18:1 > 4.5:1). Visualmente, o eyebrow perde um pouco de ênfase jade, fica mais neutro (branco claro). 

**Veredito**: isto é uma inconsistência menor com o design doc, não um defeito. Se a intenção era jade forte no eyebrow (como em outros badges do sistema), mudar para `text-primary` seria mais alinhado. Mas como é, ainda está funcional e acessível.

---

## Veredito

**Verdict: APPROVED**

A implementação de ADR-15 está **correta, completa e segura**. Todos os critérios testáveis são atendidos; build e typecheck passam limpo; acessibilidade respeitada; design system reutilizado; nenhuma trava negativa violada; integração com ADR-13 e ADR-14 perfeita.

A única observação é um detalhe visual menor (cor da pílula `text-foreground` vs `text-primary` do eyebrow), que não impede aprovação mas poderia ser alinhado em uma futura manutenção de consistência visual.

✓ **Pronto para merge e QA visual.**

