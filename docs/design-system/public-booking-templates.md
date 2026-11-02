# Design System — Templates Extraídos da Tela de Agendamento Público (ADR-19)

**Fonte de análise:** `src/public/AgendarPage.tsx` (branch `adr/autoagendamento-publico-v2`).
**Design System:** Pulse (shadcn/ui + Tailwind, tokens em `src/index.css` / `tailwind.config.ts`).
**Framework-alvo:** React 18 (adapter primário); anotações Vue 3 quando aplicável.
**Status:** template spec v1.0 — framework-agnostic, sem código de framework.

> Decisões baseadas em evidência (deepsearch). Citações em seção "Referências".

---

## 0. Tokens Pulse utilizados (não inventar novos)

| Token | Valor / CSS var | Uso |
|---|---|---|
| primary | `hsl(var(--primary))` (âmbar #f97316) | selecionado, progresso, CTA |
| primary-foreground | `hsl(var(--primary-foreground))` | texto sobre primary |
| muted / muted-foreground | `hsl(var(--muted))` / `...-foreground` | estados inativos, hints |
| destructive / destructive-foreground | `hsl(var(--destructive))` | erro |
| card / card-foreground | `hsl(var(--card))` | superfície de card |
| border / input / ring | `hsl(var(--border/input/ring))` | bordas, focus ring |
| radius | `--radius` (0.75rem) → `rounded-lg/md/sm` | cantos |
| font sans | Inter | corpo |
| font display | Space Grotesk | títulos |
| spacing | Tailwind scale (p-4, gap-2, etc.) | — |
| focus ring | `focus-visible:ring-2 focus-visible:ring-ring` (Pulse: âmbar 3px a 12%) | foco |
| motion | `motion-reduce:transition-none` / `motion-reduce:animate-none` | reduced motion |

---

## 1. StepProgress (Stepper / Wizard Progress)

### 1.1 Identidade
- **Nome:** `StepProgress`
- **Categoria:** composite (navegação de fluxo)
- **Versão:** 1.0.0
- **Uso:** barra de progresso linear + pills de etapas de um wizard multi-step.

### 1.2 Props
```ts
export interface StepProgressProps {
  steps: StepItem[]
  current: number
  completed?: number[]
  orientation?: 'horizontal' | 'vertical'
  size?: 'sm' | 'md'
  clickable?: 'none' | 'completed' | 'all'
  onStepClick?: (index: number) => void
  ariaLabel?: string
  showBar?: boolean
  loading?: boolean
  className?: string
}
export interface StepItem {
  id: string
  label: string
  description?: string
  icon?: ReactNode
  optional?: boolean
}
```

### 1.3 Slots
- `default` — conteúdo adicional por etapa (raro).
- `indicator` — customização do indicador (número/ícone).
- `label` — label customizada por etapa.

### 1.4 Events
- `stepClick(index)` — ao clicar em etapa clicável.
- Internamente: live region anuncia "Etapa N de M: label" (polite).

### 1.5 Estados
- `default` — etapas futuras muted.
- `hover` — elevação sutil no trigger clicável.
- `focus` — ring `ring-ring`.
- `active` — etapa atual: borda primary, bg primary/10.
- `completed` — bg primary, texto primary-foreground, ícone Check.
- `disabled` — etapas não alcançáveis (sem botão, `aria-disabled`).
- `loading` — spinner no indicador ativo; triggers disabled.
- `error` — (n/a no progresso; erros são do conteúdo).
- `empty` — (n/a).
- `success` — todas concluídas: indicadores com Check.

### 1.6 Variantes
- Visual: `bar` (só barra), `pills` (só pills), `both` (barra + pills) — default `both`.
- Orientação: horizontal/vertical.
- Tamanho: sm/md.

### 1.7 Composição
- Compound: `StepProgress` > `StepProgressList` > `StepProgressItem` > `StepProgressTrigger`/`StepProgressIndicator`/`StepProgressSeparator`/`StepProgressLabel`.
- Alternativa flat (API simples): `StepProgress steps current`.

### 1.8 A11y
- `ol`/`li` com `aria-current="step"` na etapa atual.
- Etapas concluídas anunciadas como "Completed" (texto, não só ícone).
- Roving tabindex: Tab = um stop (etapa atual); setas movem foco; Home/End.
- Enter/Space seleciona.
- Live region polite: "Etapa N de M: label".
- `prefers-reduced-motion`: sem transição.
- Responsivo: barra compacta < sm, stepper completo ≥ sm.

### 1.9 i18n
- Chaves: `stepProgress.stepOf` ("Etapa {n} de {total}"), `stepProgress.completed`, `stepProgress.optional`.
- Sem literais.

### 1.10 Tokens
- primary (selecionado/completo), muted (futuro), border, ring.

### 1.11 Adapter notes
- React: controlled (`value`/`onValueChange`) ou uncontrolled (`defaultValue`).
- Vue: `v-model` (number) + emits `update:modelValue`, `step-click`.
- Compound components via context/provider para evitar prop drilling.

### 1.12 Quando NÃO extrair
- Fluxo linear de 2 etapas → use `Progress` (Radix) simples. StepProgress vale quando há ≥3 etapas com labels.

---

## 2. OptionCard / SelectableCard (ServiceCard, ProfessionalCard)

### 2.1 Identidade
- **Nome:** `OptionCard` (genérico); especializações `ServiceCard`, `ProfessionalCard`.
- **Categoria:** primitive/composite (seleção).
- **Versão:** 1.0.0.

### 2.2 Props
```ts
export interface OptionCardProps {
  id: string
  selected?: boolean
  disabled?: boolean
  variant?: 'outline' | 'filled' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  layout?: 'horizontal' | 'vertical'
  onSelect?: (id: string) => void
  ariaLabel?: string
  className?: string
}
export interface ServiceCardProps extends OptionCardProps {
  name: string
  durationMinutes: number
  priceCents: number
  description?: string
  icon?: ReactNode
}
export interface ProfessionalCardProps extends OptionCardProps {
  name: string
  avatarUrl?: string
  initials?: string
  subtitle?: string
}
```

### 2.3 Slots
- `leading` — avatar/ícone à esquerda.
- `title` — nome.
- `meta` — duração/preço/subtítulo.
- `trailing` — badge de preço, ações.
- `default` — conteúdo extra.

### 2.4 Events
- `select(id)`.
- `keydown`: Enter/Space seleciona.

### 2.5 Estados
- `default` — borda input, bg card.
- `hover` — borda primary/50, elevação.
- `focus` — ring ring.
- `active` — pressed.
- `selected` — borda primary, bg primary/5, ring sutil.
- `disabled` — opacity 50, não-interativo, `aria-disabled`.
- `loading` — skeleton (shimmer) ocupando o card.
- `error` — borda destructive (ex.: serviço indisponível).
- `empty` — (n/a; usar StatePanel).
- `success` — (n/a).

### 2.6 Variantes
- Visual: outline (default), filled, ghost.
- Tamanho: sm/md/lg.
- Layout: horizontal/vertical.

### 2.7 Composição
- `OptionCard` é um `button` (semântica nativa) com `aria-pressed`.
- Compound: `OptionCard` + `OptionCardLeading` + `OptionCardTitle` + `OptionCardMeta` + `OptionCardTrailing`.

### 2.8 A11y
- Renderizar como `<button type="button">` (não div clicável).
- `aria-pressed={selected}`.
- `aria-label` quando não há texto visível suficiente.
- Alvo de toque ≥ 44px (`min-h-11`).
- Contraste AA.

### 2.9 i18n
- Chaves: `optionCard.selected`, `service.durationMinutes` ("{n} min"), `service.price` (formato moeda via locale).

### 2.10 Tokens
- border, input, primary, primary/5, card, muted-foreground, ring.

### 2.11 Performance
- `React.memo` no card (props estáveis).
- Evitar inline objects em props; passar `onSelect` via useCallback.
- Avatar com fallback de iniciais (sem imagem externa).

---

## 3. SlotGrid (Grade de Horários)

### 3.1 Identidade
- **Nome:** `SlotGrid`
- **Categoria:** composite (seleção de horário).
- **Versão:** 1.0.0.

### 3.2 Props
```ts
export interface SlotGridProps {
  slots: Slot[]
  selected?: Slot | null
  onSelect?: (slot: Slot) => void
  loading?: boolean
  groupByPeriod?: boolean
  timeFormat?: '12h' | '24h'
  columns?: { base: number; sm?: number; md?: number }
  className?: string
}
export interface Slot { slot_start: string; slot_end: string; available?: boolean }
```

### 3.3 Slots
- `slot` — render customizado de cada slot (scoped: slot, selected, onSelect).
- `empty` — conteúdo quando vazio.
- `loading` — skeleton customizado.
- `legend` — legenda (disponível/selecionado).

### 3.4 Events
- `select(slot)`.

### 3.5 Estados
- `default` — slots disponíveis outline.
- `hover` — border primary.
- `focus` — ring.
- `active` — pressed.
- `selected` — variant default (bg primary), `aria-pressed=true`.
- `disabled` — slots indisponíveis: dashed, `aria-disabled`, não focáveis.
- `loading` — grid de skeletons (6) com `aria-busy`.
- `error` — mensagem + retry (via StatePanel ou prop).
- `empty` — "Sem horários disponíveis nesta data".
- `success` — (n/a).

### 3.6 Variantes
- Layout: grid (default) | list.
- Agrupamento: por período (Manhã/Tarde/Noite) quando `groupByPeriod`.
- Tamanho de botão: sm/md.

### 3.7 Composição
- `SlotGrid` > `SlotGridGroup` (período) > `SlotButton`.
- `SlotButton` é `button` com `aria-pressed`.

### 3.8 A11y
- Container `role="group"` com `aria-label="Horários disponíveis"`.
- Cada slot: `aria-pressed={selected}`, `aria-label="Horário HH:MM"`.
- Slots indisponíveis: não focáveis (`tabIndex=-1`), `aria-disabled`.
- Live region polite anuncia seleção.
- Grid semântico: não usar `role="grid"` para lista simples (evita complexidade); se agrupado por período, usar `role="group"` por período.
- Alvo de toque ≥ 44px.

### 3.9 i18n
- Chaves: `slotGrid.available`, `slotGrid.selected`, `slotGrid.empty`, `slotGrid.loading`, `slotGrid.period.morning/afternoon/evening`.

### 3.10 Tokens
- primary, border, input, muted, ring.

### 3.11 Performance
- Virtualização se > 60 slots.
- `React.memo` em `SlotButton`.
- Debounce no consumidor (data change) — não no componente.

---

## 4. SummaryList (DataList / dl-dt-dd)

### 4.1 Identidade
- **Nome:** `SummaryList` (alias `DataList`).
- **Categoria:** primitive (exibição de metadados).
- **Versão:** 1.0.0.

### 4.2 Props
```ts
export interface SummaryListProps {
  orientation?: 'horizontal' | 'vertical'
  dividers?: boolean
  labelWidth?: string
  size?: 'sm' | 'md'
  className?: string
}
export interface SummaryItemProps {
  label: ReactNode
  value: ReactNode
  icon?: ReactNode
  hint?: string
  className?: string
}
```

### 4.3 Slots / Composition
- Compound: `SummaryList` > `SummaryItem` > `SummaryLabel` + `SummaryValue`.
- Ou flat: `SummaryList items={[{label, value, icon}]}`.

### 4.4 Estados
- `default`.
- `loading` — skeletons por item.
- `empty` — mensagem.
- (hover/focus/active n/a; é informativo; valores podem ser links/botões com seus próprios estados).

### 4.5 A11y
- Renderiza `<dl>`; item = `<div>` com `<dt>` + `<dd>`.
- Screen readers anunciam label + value pareados.
- Icones decorativos `aria-hidden`.
- Valores interativos (links/botões) mantêm foco próprio.

### 4.6 Variantes
- Orientação horizontal (label ao lado) / vertical (label acima).
- Dividers on/off.
- Tamanho sm/md.

### 4.7 i18n
- Sem literais no componente; labels vêm via props/slots (já traduzidos).

### 4.8 Tokens
- muted-foreground (label), foreground (value), border (dividers).

---

## 5. StatePanel (loading/empty/error/success)

### 5.1 Identidade
- **Nome:** `StatePanel`
- **Categoria:** composite (estados assíncronos).
- **Versão:** 1.0.0.
- **Nota:** shadcn já fornece `Empty`, `Skeleton`, `Spinner`. `StatePanel` é um *wrapper* unificado que escolhe o estado por precedência, evitando reinventar por tela. Considerar se vale extrair ou apenas compor com `Empty`/`Skeleton` existentes. **Recomendação: extrair como componente leve** porque a precedência (loading > error > empty > content) e os test IDs padronizados trazem consistência.

### 5.2 Props
```ts
export interface StatePanelProps {
  loading?: boolean
  error?: string | Error | null
  empty?: boolean
  onRetry?: () => void
  children?: ReactNode
  loadingSkeleton?: ReactNode
  loadingCount?: number
  errorMessage?: string
  emptyMessage?: string
  emptyHint?: string
  emptyAction?: { label: string; onClick: () => void }
  testId?: string
  className?: string
}
```

### 5.3 Precedência
1. `loading` → skeleton block (`aria-busy`, `aria-live="polite"`).
2. `error` → ícone AlertCircle destructive + mensagem + retry (se `onRetry`).
3. `empty` → ícone Inbox muted + mensagem + hint + CTA (se `emptyAction`).
4. senão → `children`.

### 5.4 Estados
- `loading`: skeletons (quantidade configurável, default 3 para listas).
- `error`: AlertCircle destructive, mensagem, retry button.
- `empty`: Inbox muted, mensagem, hint, CTA opcional.
- `success`/`default`: children.

### 5.5 A11y
- `role="status"` / `aria-live="polite"` para loading.
- `role="alert"` para error.
- Ícones decorativos `aria-hidden`.
- Retry é botão real (Enter/Space).

### 5.6 i18n
- Chaves: `statePanel.loading`, `statePanel.error`, `statePanel.retry`, `statePanel.empty`, `statePanel.emptyHint`.

### 5.7 Tokens
- destructive, muted, muted-foreground, card, border.

---

## 6. Decisão: o que NÃO extrair

- **Card genérico** — já existe shadcn `Card`. Não duplicar.
- **Button de voltar/continuar** — já shadcn `Button`.
- **Avatar com iniciais** — já shadcn `Avatar` + fallback; manter helper `initialsOf` local (util, não componente).
- **Formulário de cliente** — usar `react-hook-form` + `zod` + shadcn `Input`/`Label`; não extrair componente específico (anti-pattern: lógica de negócio em UI).
- **Header de tenant** — muito específico da página pública; manter local ou extrair só se reusado em outra rota pública.

---

## 7. Resumo de prioridade de extração

| Componente | Reuso estimado | Esforço | Prioridade |
|---|---|---|---|
| StatePanel | alto (todas as telas async) | baixo | P1 |
| SummaryList | alto (confirmações, detalhes) | baixo | P1 |
| SlotGrid | médio (agendamento, reservas) | médio | P2 |
| OptionCard | alto (listas selecionáveis) | médio | P2 |
| StepProgress | médio (wizards) | médio | P2 |

---

## 8. Referências (deepsearch)

### Decisão: StepProgress como stepper acessível composto
- **Fonte**: https://www.shadcn.io/ui/steps (shadcn Steps, Base UI/Ark UI) — acessado 2026-11-01
- **Padrão observado**: compound components (StepsList/Item/Trigger/Indicator/Separator/Content), roving tabindex, aria-current="step", loading no indicador, controlled/uncontrolled.
- **Aplicação no Pulse**: adotar compound + roving tabindex + live region; manter barra linear (Progress Radix) como alternativa simples.

### Decisão: StepProgress — shadcn onboarding-01 (foco + anúncios)
- **Fonte**: https://github.com/shadcn-ui/ui/pull/11675 — acessado 2026-11-01
- **Padrão observado**: focus move para heading da nova etapa (pulado no primeiro mount), live region polite "Step N of M: Title", stepper como ol com aria-current, etapas não alcançadas disabled, responsivo (barra compacta < sm).
- **Aplicação no Pulse**: replicar foco + anúncios + responsividade.

### Decisão: Progress (Radix) para barra linear
- **Fonte**: https://www.radix-ui.com/primitives/docs/components/progress — acessado 2026-11-01
- **Padrão observado**: role progressbar, value/max, getValueLabel para texto custom ("Etapa 3 de 5"), indeterminate via null.
- **Aplicação no Pulse**: usar Radix Progress para a barra; StepProgress compõe quando há labels.

### Decisão: DataList (Radix Themes) para SummaryList
- **Fonte**: https://www.radix-ui.com/themes/docs/components/data-list — acessado 2026-11-01
- **Padrão observado**: dl/dt/dd, orientation horizontal/vertical, label width, trim, asChild.
- **Aplicação no Pulse**: espelhar API (orientation, dividers, labelWidth) usando Tailwind; sem dependência de Radix Themes (projeto usa shadcn + Tailwind).

### Decisão: shadcn DataList (React Aria) — dl semântico
- **Fonte**: https://www.shadcn.io/ui/aria/data-list — acessado 2026-11-01
- **Padrão observado**: DataList/DataListItem/DataListItemLabel/DataListItemValue, orientation horizontal/vertical, dividers via divide-y, label column com fit-content(40%).
- **Aplicação no Pulse**: adotar compound + orientação + dividers.

### Decisão: SlotGrid como botões com aria-pressed
- **Fonte**: https://docs.thebookingkit.dev/components/time-slot-picker — acessado 2026-11-01
- **Padrão observado**: slots como button, aria-pressed, empty/loading states, agrupamento por período (manhã/tarde/noite), formatTime 12h/24h.
- **Aplicação no Pulse**: adotar props (slots, selectedSlot, onSelect, isLoading, groupByPeriod, timeFormat) + aria-pressed.

### Decisão: SlotGrid acessível (thebookingkit + shadcn blocks)
- **Fonte**: https://www.shadcn.io/blocks/aria/tables-scheduling — acessado 2026-11-01
- **Padrão observado**: apenas slots disponíveis são focáveis (tabIndex -1 nos indisponíveis), aria-label com dia+hora, live region polite, alvo de toque.
- **Aplicação no Pulse**: aplicar tabIndex -1 + aria-disabled nos indisponíveis.

### Decisão: StatePanel — precedência de estados
- **Fonte**: https://codesweep.ai/ui/patterns/ComponentStates.html — acessado 2026-11-01
- **Padrão observado**: AsyncStateProps (loading/error/empty), precedência loading > error > empty > content, test IDs padronizados, skeletons por tipo de container, anti-patterns (spinner vs skeleton).
- **Aplicação no Pulse**: adotar precedência e anti-patterns (skeletons, não spinners, para listas).

### Decisão: shadcn Empty para estado vazio
- **Fonte**: https://ui.shadcn.com/docs/components/base/empty — acessado 2026-11-01
- **Padrão observado**: Empty/EmptyHeader/EmptyMedia/EmptyTitle/EmptyDescription/EmptyContent, variant icon.
- **Aplicação no Pulse**: StatePanel compõe Empty quando empty=true.

### Decisão: OptionCard como button nativo com aria-pressed
- **Fonte**: https://www.shadcn.io/blocks/aria/cta-split-panel-calendar-grid — acessado 2026-11-01
- **Padrão observado**: células como radio/segment group, aria-pressed, alvo de toque, reduced motion.
- **Aplicação no Pulse**: OptionCard renderiza button com aria-pressed (não div clicável).

---

## 9. Notas de adapter

### React 18
- Usar `React.memo`, `useCallback`, `useMemo`.
- Compound components via Context.
- CVA (`class-variance-authority`) para variantes.
- `cn()` (clsx + tailwind-merge) para classes.
- Testes: Vitest + happy-dom, cobertura ≥70%.

### Vue 3
- Props via `defineProps<T>()`, emits via `defineEmits`.
- v-model: `modelValue` + `update:modelValue`.
- Slots: default + named + scoped (`#slot="{ item }"`).
- Composables para lógica (ex.: `useStepProgress`).
- Testes: Vitest + @vue/test-utils.

---

## 10. Lacunas / a validar
- Tokens oficiais do Pulse (DESIGN.md) não localizados no repo; valores inferidos de `tailwind.config.ts` + `src/index.css`. Validar com `ux-designer`/fundadores.
- Decidir se `StatePanel` deve ser componente ou apenas convenção (composição de Empty/Skeleton). Recomendação: componente leve.
- i18n: chaves a serem adicionadas em `src/i18n/messages/pt-BR.ts` e `en-US.ts` (projeto usa react-i18next).
