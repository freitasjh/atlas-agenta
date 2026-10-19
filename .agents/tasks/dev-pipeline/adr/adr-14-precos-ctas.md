# ADR-14 — `/precos` acionável: CTA por plano e destaque do plano recomendado

**Status:** proposto

## Contexto

Com a fonte única de planos criada (ADR-13), `/precos` pode deixar de ser vitrine
morta. Hoje `PrecosPage` (em `src/marketing/pages.tsx`) renderiza 3 `div`s de card
a partir do `const PLANOS` local, **sem nenhum CTA**. O PRD (RA-1 a RA-4) e a análise
de frontend decidiram: cada plano ganha um CTA "Começar com o {nome}" que navega para
`/cadastro?plano=<slug>`, e o plano **Clínica** é ancorado visualmente como
recomendado — tudo **sem inventar preço** (o aviso "valores … em breve" permanece).

O design system está travado (ADR-05/06): `Button` do shadcn/ui com `asChild`
(confirmado: usa `Slot`, variantes `default`/`outline`, foco `focus-visible:ring-2`),
`Link` do react-router (já importado em `pages.tsx`), tokens ardósia/jade, dark por
padrão, mobile-first. A landing já usa exatamente o padrão `Button asChild` + `Link`.

## Decisão

Modificar `PrecosPage` em `src/marketing/pages.tsx`:

1. **Consumir `PLANS` de `src/lib/plans.ts`** e **remover** o `const PLANOS` local.
2. **CTA por plano:** ao final de cada card, um `Button asChild` envolvendo um
   `Link to={`/cadastro?plano=${plano.slug}`}` com texto **"Começar com o {nome}"**.
   Variante: `default` (jade sólido) quando `plano.recomendado`, senão `outline`.
   `className="w-full"` (alvo de toque, mobile-first). Nada de `<a>` cru nem
   `onClick` em `div` (RA-3).
3. **Destaque do recomendado (Clínica):** borda de acento `border-primary` (anel
   jade — ecoa a marca) + um **selo textual "Recomendado"** no topo do card. O selo
   é uma pílula `rounded-full px-2.5 py-0.5 text-xs font-medium` com
   `bg-primary/10 text-primary border border-primary/30` (vocabulário do chip
   "eyebrow" do hero). **Não** reusar `StatusBadge` (ele é tipado por status de
   domínio; "recomendado" não é status). A informação do selo é **texto**, não só
   cor (WCAG 1.4.1). Manter a ordem Individual → Clínica → Pro (âncora central em
   desktop); marcar o destaque por cor/borda/selo, **sem** reordenar nem usar
   `scale`/elevação exagerada.
4. **Copy honesta de preço:** manter o cabeçalho sem números fabricados; o aviso
   "Valores e contratação chegam em breve" permanece. CTA muda a promessa de "ver"
   para "começar".
5. **Opcional, se não aumentar o diff de risco:** migrar os cards da `div` manual
   para `Card`/`CardHeader`/`CardContent`/`CardFooter` do shadcn, mantendo o visual.
   Não é obrigatório; priorizar o diff mínimo e o visual correto.

Mobile-first: `grid gap-4 sm:grid-cols-3` (já presente) empilha em 1 coluna no
mobile com CTA `w-full`; 3 colunas em `sm+`. Dark por padrão. Sem dependência nova,
TS estrito, sem `any`.

## Consequências

- O funil marketing → cadastro passa a fechar a partir de `/precos`.
- O `const PLANOS` sai de `pages.tsx`; a página passa a depender de `src/lib/plans.ts`.
- Contraste a conferir no QA: texto do selo `text-primary` sobre `bg-primary/10`
  (estimado ~5:1). Se raspar < 4.5:1, subir para `bg-primary/15` ou `text-foreground`
  (decisão já registrada no PRD §8 e na análise de frontend §3).
- A landing (`LandingPage`) permanece coerente e **não é alterada em comportamento**:
  "Começar agora" → `/cadastro` (neutro), "Ver planos" → `/precos`. A escolha de
  plano é papel de `/precos`.

## Escopo

**frontend** (apresentacional; nenhum dado/backend/rota nova).

## Arquivos afetados

- **Modificar:** `src/marketing/pages.tsx` (apenas `PrecosPage`; `LandingPage`,
  `Feature` e `TermosPage` ficam inalterados em comportamento).
- Consome: `src/lib/plans.ts` (ADR-13), `@/components/ui/button`, `Link` do
  `react-router-dom`.
- Nenhuma mudança em `supabase/**`.

## Critérios de aceite testáveis (desta ADR)

1. `/precos` renderiza 3 cards; cada um exibe um CTA **visível e focável** com texto
   "Começar com o {nome}" (Individual, Clínica, Pro).
2. Acionar o CTA do plano X por clique **e** por `Enter` navega para
   `/cadastro?plano=individual`, `?plano=clinica` ou `?plano=pro`, conforme o plano.
3. O CTA é um `<a href>` real renderizado por `Button asChild` + `Link` (inspeção
   DOM: nenhum `<a href>` manual para rota interna, nenhum `onClick` em `div`),
   navegável por `Tab` com foco visível.
4. O card **Clínica** tem selo textual "Recomendado", borda `border-primary` e CTA
   `variant="default"` (sólido); Individual e Pro usam CTA `variant="outline"`.
   **Nenhum valor monetário fabricado**; o aviso "valores … em breve" permanece.
5. Responsivo: em viewport estreito os cards empilham em 1 coluna com CTA `w-full`,
   sem overflow horizontal; em `sm+`, 3 colunas. Dark por padrão. Console limpo.
6. Contraste dos pares usados ≥ AA (conferir o texto do selo no QA).
7. `npm run build` + typecheck limpos; sem `any`; nenhuma dependência nova.

**Verificação:**
- `npm run build` (= `tsc -b && vite build`) passa limpo.
- QA visual via Chrome DevTools no dev server (`npm run dev`): abrir `/precos`,
  conferir os 3 CTAs, o destaque do Clínica, navegação por clique e por `Tab`+`Enter`
  para os 3 slugs, responsividade mobile/`sm+`, e **console sem erro/warn**.

## Dependência

Depende de **ADR-13** (`src/lib/plans.ts` precisa existir e exportar `PLANS` com
`slug`/`recomendado` para o map e os CTAs). Independente da ADR-15 em código, mas
ordenada antes dela por seguir o sentido do funil.
