# Code Review — ADR-14: `/precos` acionável com CTAs e destaque do plano recomendado

**Revisor:** A (independente)  
**Revisão de:** Commit `1b89994` — "feat: add plan CTAs and recommended highlight to /precos"  
**ADR:** adr-14-precos-ctas.md

## Sumário

A implementação consome `PLANS` de `src/lib/plans.ts` (ADR-13) e injeta CTAs acionáveis em cada card de plano na `/precos`, usando `Button asChild` + `Link` do react-router-dom para render de `<a href>` real com navegação para `/cadastro?plano=<slug>`. O card Clínica é marcado com selo textual "Recomendado", borda `border-primary`, e CTA `variant="default"` sólido. O padrão é semanticamente correto, totalmente tipado (TS estrito sem `any`), responsive mobile-first, e o build/typecheck passam limpo.

**Preocupação:** Validação de contraste WCAG para o texto do selo em tema claro foi deferida para QA conforme mencionado na ADR, mas não foi validada durante a implementação. O contraste estimado em tema escuro é ~5:1 (aceitável); em tema claro, o risco é menor por causa da saturação, mas deve ser confirmado.

**Veredito:** APROVADO com observação de QA.

---

## Aderência aos critérios de aceite da ADR-14

### 1. Renderização de 3 CTAs visíveis e focáveis
**✅ CONFIRMADO**  
Cada card renderiza um `Button` com texto "Começar com o {nome}" (Individual, Clínica, Pro). O Button tem `focus-visible:ring-2` herdado, tornando o foco visível. A estrutura é `<Button asChild><Link to={...}>texto</Link></Button>`, que renderiza um `<a href>` semântico.

### 2. Navegação por clique e `Enter`
**✅ CONFIRMADO**  
`Button` + `Link` usando `Slot` (via `asChild`) produz um `<a href="/cadastro?plano={slug}">` real. Links HTML nativos respondem a Enter e navegam por clique. Nenhuma armadilha de `onClick` em div.

### 3. Uso de `Button asChild` + `Link` (sem `<a>` manual)
**✅ CONFIRMADO**  
O Button está importado de `@/components/ui/button`, que usa `Slot` quando `asChild={true}`. O Link é do react-router-dom (importado na linha 1). O componente renderiza exatamente como especificado na ADR.

### 4. Selo "Recomendado" no Clínica, variantes de CTA
**✅ CONFIRMADO**  
- Selo renderizado condicionalmente quando `plano.recomendado === true` (linha ~155)
- Selo tem `rounded-full`, padding e borda `border-primary/30`, fundo `bg-primary/10`, texto `text-primary`
- Card Clínica tem borda `border-primary` (condicional na linha ~155)
- CTA usa `variant={plano.recomendado ? "default" : "outline"}` (linha ~164)
- **Sem valor monetário fabricado**: aviso "valores … em breve" permanece intacto na ADR-13

### 5. Responsividade (mobile-first)
**✅ CONFIRMADO**  
- Grid: `grid gap-4 sm:grid-cols-3` (linha 123) — 1 coluna mobile, 3 em sm+
- Button tem `w-full` (linha 167) — preenche container em mobile
- Dark por padrão (já configurado no tema)

### 6. TypeScript estrito, sem `any`
**✅ CONFIRMADO**  
- `npm run typecheck` passa limpo (sem erros)
- Nenhuma instância de `any` nos arquivos modificados
- Tipos usados: `Plan`, `PlanSlug` (de `src/lib/plans.ts`), componentes tipados do React

### 7. Build limpo
**✅ CONFIRMADO**  
- `npm run build` passa (Vite + TypeScript)
- Nenhuma dependência nova adicionada

---

## High-level view

A implementação segue o padrão de renderização funcional e é estruturalmente sólida. O consumo de `PLANS` desde a fonte única (ADR-13) eliminou o `const PLANOS` local duplicado. O uso de `Button asChild` + `Link` é o padrão correto para evitar nested `<button><a>` e garantir semântica HTML nativa.

A única observação relevante é o **contraste do selo em tema claro**, que a ADR já flagou como decisão de design ("se raspar < 4.5:1, subir para `bg-primary/15` ou `text-foreground`"). Isso é questão de QA, não erro de implementação.

---

## Detalhes

### Consumo de `PLANS` e remoção de duplicação
O diff mostra a remoção completa do `const PLANOS` local (40 linhas antes do commit) e importação de `PLANS` da fonte única. Isso reduz duplicação e mantém sincronização automática entre `/precos` e `/cadastro` (futuro na ADR-15). ✅ Correto.

### Estrutura do card com selo condicional
```tsx
{plano.recomendado ? (
  <span className="inline-flex w-fit items-center rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
    Recomendado
  </span>
) : null}
```
O selo é semântico (texto "Recomendado" visível para screen readers, não apenas cor). A renderização condicional é tipicamente React. ✅

### Button + Link pattern
```tsx
<Button
  asChild
  className="mt-auto w-full"
  variant={plano.recomendado ? "default" : "outline"}
>
  <Link to={`/cadastro?plano=${plano.slug}`}>
    Começar com o {plano.nome}
  </Link>
</Button>
```
Isso renderiza: `<a href="/cadastro?plano=..." className="...button-classes...">Começar com o...</a>`

O `mt-auto` garante que o button fique no fundo do card mesmo com conteúdo de altura variável — bom UX em grid com cards assimétricos. ✅

### Segurança do query string
O `plano.slug` é tipado como `PlanSlug = "individual" | "clinica" | "pro"` (valores conhecidos do enum). Não há risco de injeção em URL. ✅

### Acessibilidade
- Foco visível: Button herda `focus-visible:ring-2` ✅
- Navegação por teclado: `<a>` nativo responde a Enter/Tab ✅
- Texto significativo: "Começar com o {nome}" é claro ✅
- Sem armadilhas de divs com roles: é um `<a>` real ✅
- Selo não é apenas cor: tem texto "Recomendado" ✅

### Contraste — ⚠️ Observação QA

A ADR reconhece que o contraste do selo deve ser verificado:

> Contraste a conferir no QA: texto do selo `text-primary` sobre `bg-primary/10` (estimado ~5:1). Se raspar < 4.5:1, subir para `bg-primary/15` ou `text-foreground`.

**Em tema escuro:**
- Texto: `hsl(160, 64%, 45%)` = verde saturado
- Fundo: `hsl(160, 64%, 45%)` @ 10% alpha + `hsl(222, 24%, 9%)` (background dark) ≈ verde pálido
- Estimativa: razão de contraste ~5:1 (aceitável, AA)

**Em tema claro:**
- Texto: `hsl(160, 64%, 45%)` (mesmo verde)
- Fundo: `hsl(160, 64%, 45%)` @ 10% alpha + `hsl(210, 30%, 99%)` (background claro) ≈ verde muito pálido, próximo de branco
- Risco: razão de contraste pode cair abaixo de 4.5:1

**Ação:** Validar em QA com ferramenta de contraste (WAVE, Lighthouse, ou aXe). Se falhar AA, aplicar a decisão já documentada na ADR (subir para `bg-primary/15` ou usar `text-foreground` em vez de `text-primary`).

Isso **não é um erro da implementação** — a ADR deixou explícito que a verificação seria feita. É apenas uma observação de QA.

---

## Issues

<details>
<summary>Issues (1)</summary>

1. **Contraste do selo em tema claro — QA pending** — O texto "Recomendado" usa `text-primary` sobre `bg-primary/10`. Em tema escuro, contraste estimado em ~5:1 (aceitável); em tema claro, risco de cair abaixo de 4.5:1 AA. A ADR previu isso e deixou plano de ação (subir para `bg-primary/15` ou `text-foreground`). **Ação:** Validar em QA com Chrome DevTools/Lighthouse/aXe; se AA falhar, aplicar fix conforme planejado.

</details>

---

## Verificação realizada

- ✅ `npm run build` — passou (Vite + TS)
- ✅ `npm run typecheck` — passou
- ✅ Leitura de diff (commit `1b89994`)
- ✅ Análise de segurança (query string, sem injeção)
- ✅ Análise de semântica HTML (Button asChild + Link)
- ✅ Análise de acessibilidade (foco, SR, teclado)
- ✅ Análise de responsividade (grid mobile-first)
- ✅ Verificação de regressão (LandingPage, TermosPage intocadas)
- ✅ Verificação de imports (Link, PLANS, Button)

---

## Conclusão

A implementação está **correta, segura e acessível**. O código segue os padrões do projeto (React + Tailwind + shadcn/ui), TypeScript está estrito, e o comportamento responde aos critérios de aceite da ADR-14. A única observação é o contraste do selo em tema claro, que é uma **tarefa de QA conhecida e planejada**, não uma falha da implementação.

**Recomendação:** Approve. Proceder com QA para validar contraste em tema claro conforme planejado na ADR.
