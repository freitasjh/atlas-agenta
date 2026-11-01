# Enriquecer o aside do AuthLayout com ilustração e lista de funcionalidades (ADR-07)

Revisor independente B. O commit `b497a68` reescreve só o `aside` de `src/auth/AuthLayout.tsx`: insere `BrandIllustration variant="aside"` abaixo do `Logo`, troca o parágrafo único por uma `<ul>` de quatro funcionalidades em pt-BR com marcador de check `aria-hidden`, e mantém o `h2` da marca. Nenhuma página de formulário de auth é tocada, nenhuma lógica de dados/Supabase/sessão entra no diff. A mudança é puramente apresentacional e só afeta telas `lg:`.

Watch for: nada bloqueante. Único ponto de atenção é visual e já delegado ao QA (altura do `aside` em telas `lg` baixas) — não é defeito de código. (confirmed)

**Verdict**: APPROVED

## High-level view

A decisão da ADR foi implementada ao pé da letra: um único arquivo modificado (`git show --stat` confirma `1 file changed, 31 insertions(+), 6 deletions(-)`), reuso do `BrandIllustration` da ADR-02 via a prop `variant="aside"` que o componente de fato expõe, e preservação de `hidden flex-col justify-between ... lg:flex` mais a grade `lg:grid-cols-2`. O formulário (`Outlet`), o header mobile e o `ThemeToggle` ficam intactos, então o comportamento em `<1024px` (RF15) não muda.

A copy pt-BR bate verbatim com a fonte única (`analysis-frontend.md §2.4`): o `h2` "Agenda e cobrança, sem no-show." é mantido e as quatro funcionalidades são exatamente "Agenda sem conflito por profissional", "Confirmação automática 24h antes", "Cobrança por PIX ao fim do atendimento" e "Baixa automática do pagamento". A lista é semântica (`<ul>`/`<li>`), e o chip de check leva `aria-hidden="true"` — o texto carrega o significado, o ícone é decorativo, como manda CA10/CA11.

Fronteiras de segurança não se aplicam a este diff: não há `tenant_id`, RLS, RBAC, webhook/idempotência, segredo ou PII em jogo — é layout estático. O `BrandIllustration` já é `aria-hidden` na raiz e não introduz `<img src>` externo (CA11 satisfeito pela ADR-02, reusada aqui sem alteração). Nenhuma dependência nova: `Check` vem do `lucide-react` já fixado no `package.json` (0.456.0).

Contraprova: `npm run build` (tsc -b + vite) sem erro, `npm run test` com 95/95 passando. Não há script de lint no projeto.

<details>
<summary>Issues (0)</summary>

Nenhuma issue acionável. A única observação da própria ADR (risco de o `aside` estourar verticalmente em telas `lg` baixas) é verificação visual atribuída ao QA (ADR-08), não um defeito de código.

</details>

<details>
<summary>Details</summary>

### Aderência à ADR e consumo do BrandIllustration

A ADR exige inserir `<BrandIllustration variant="aside" />` abaixo do `Logo`, em tamanho reduzido. O código agrupa `Logo` + ilustração num bloco `space-y-8` com `className="max-w-xs"` para conter a largura. O componente `src/marketing/BrandIllustration.tsx` declara `variant?: "hero" | "aside"` e `className?: string`, e a variante `aside` reduz anel/padding/texto via `VARIANT_STYLES` — o contrato consumido existe, sem prop inventada e sem alteração no componente da ADR-02. A raiz do `BrandIllustration` carrega `aria-hidden="true"`, então o conteúdo informativo do `aside` vive inteiramente no `h2` + `<ul>` (CA11).

### Lista de funcionalidades e acessibilidade

As quatro strings vivem numa const `AUTH_HIGHLIGHTS` tipada `as const`, renderizada em `<ul>` com `key={highlight}`. Cada `<li>` usa `flex items-start` e um `<span aria-hidden="true">` envolvendo `<Check>` do `lucide-react` — o marcador é decorativo e não polui o leitor de tela, o texto do item é lido como conteúdo. Tokens usados (`text-muted-foreground`, `bg-primary/10`, `text-primary`, `bg-card`) são os existentes; nenhum token novo, coerente com dark mode. Isso satisfaz CA10/RF14.

### Preservação do RF15 (mobile intacto)

O `aside` permanece `hidden flex-col justify-between bg-card p-10 lg:flex`, e o container raiz mantém `lg:grid lg:grid-cols-2`. A coluna do formulário (`flex min-h-screen flex-col lg:min-h-0` → header mobile + `Outlet`) não foi tocada. Em `<1024px` o `aside` continua oculto e o formulário ocupa a tela, exatamente como RF15 pede. Como o diff não altera nenhuma `*Page.tsx` de auth (`git show --stat` lista só `AuthLayout.tsx`), login/cadastro/recuperar-senha seguem funcionando sem mudança de formulário.

### Fronteiras de segurança / multi-tenant

Não há superfície de risco neste diff. Zero acesso a Supabase, zero `tenant_id`, nenhuma política RLS, nenhum caminho de RBAC, nenhum webhook ou lógica de idempotência, nenhum segredo e nenhuma PII. A mudança é markup estático de apresentação. As regras de isolamento multi-tenant e manejo de segredos simplesmente não são exercidas aqui — registro isso explicitamente porque o critério pede que áreas de segurança sejam avaliadas, e a avaliação é que o diff não as toca.

### Dependências e verificação

Nenhuma dependência adicionada: `Check` é export válido do `lucide-react@0.456.0` já presente no `package.json` (versão fixa, sem range). Contraprova executada: `npm run build` conclui sem erro de tipo ou de bundle; `npm run test` roda 11 arquivos / 95 testes, todos passando. O projeto não define script de lint, então não há etapa de lint a rodar. Não subi dev server — verificação visual é do QA (ADR-08).

</details>

<details>
<summary>Arquivos alterados</summary>

- `src/auth/AuthLayout.tsx` — `aside` enriquecido: import de `Check` e `BrandIllustration`, const `AUTH_HIGHLIGHTS`, ilustração + `<ul>` de 4 itens no lugar do parágrafo único; grade, header mobile e `Outlet` inalterados.

Diff completo: `git show b497a68`.

</details>
