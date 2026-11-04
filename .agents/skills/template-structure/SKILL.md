---
name: template-structure
description: Estrutura de templates de componentes reutilizáveis: anatomia, props/slots, estados, variantes, tamanhos, composição, i18n e a11y. Contrato framework-agnostic com exemplos Vue 3 e React 18.
license: MIT
---

# Template Structure — Estrutura de Templates de Componentes

Skill para definir a **estrutura** de um componente reutilizável do design system. O contrato é framework-agnostic; exemplos em Vue 3 e React 18 são ilustrativos.

## 1. Anatomia de um Template

Todo template de componente DEVE documentar:

| Bloco | Conteúdo |
|-------|----------|
| **Identidade** | nome (PascalCase), categoria (primitive/composite/layout), versão |
| **Props** | nome, tipo, default, required, descrição |
| **Slots** | default + named (com escopo quando aplicável) |
| **Events** | nome, payload, quando dispara |
| **States** | default, hover, focus, active, disabled, loading, error, empty, success |
| **Variants** | visual (primary/secondary/ghost/danger) e funcional (size sm/md/lg) |
| **Composition** | subcomponentes, compound pattern, regras de aninhamento |
| **A11y** | role, aria-*, keyboard, focus management |
| **i18n** | chaves de label/aria (sem literais) |

## 2. Props & Slots — Contrato

### Props
- Tipos explícitos (TS). Evitar `any`.
- Defaults sensatos; required apenas o essencial.
- Controlled vs uncontrolled: documentar quando a prop controla estado interno (ex.: `value` + `onChange`) e quando é uncontrolled (`defaultValue`).
- Variantes nomeadas > booleanos: prefira `variant: 'primary' | 'secondary'` a `isPrimary`.

### Slots
- Default slot para conteúdo principal.
- Named slots para regiões (header, footer, icon, actions).
- Scoped slots quando o filho precisa de dados do pai (ex.: item de lista).

### Exemplo (framework-agnostic — interface TS)
```ts
export interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  loading?: boolean
  type?: 'button' | 'submit' | 'reset'
  ariaLabel?: string
}
export interface ButtonSlots {
  default?: () => unknown   // label
  iconLeft?: () => unknown
  iconRight?: () => unknown
}
export type ButtonEvents = {
  click: (e: MouseEvent) => void
}
```

### Adapter Vue 3
```vue
<script setup lang="ts">
defineProps<ButtonProps>()
defineEmits<ButtonEvents>()
</script>
<template>
  <button :class="classes" :disabled="disabled || loading" @click="$emit('click', $event)">
    <slot name="iconLeft" />
    <slot />
    <slot name="iconRight" />
  </button>
</template>
```

### Adapter React 18
```tsx
export function Button({ variant='primary', size='md', disabled, loading, children, ...rest }: ButtonProps & { children?: React.ReactNode }) {
  return (
    <button className={cn(variant, size)} disabled={disabled || loading} {...rest}>
      {children}
    </button>
  )
}
```

## 3. Estados Obrigatórios

Todo componente interativo DEVE cobrir:

| Estado | Requisito |
|--------|-----------|
| default | aparência base |
| hover | feedback visual (cursor, elevação) |
| focus | ring de foco visível (Pulse: âmbar 3px a 12%) |
| active | pressed |
| disabled | não-interativo, contraste reduzido, `aria-disabled` |
| loading | spinner/skeleton, `aria-busy` |
| error | borda vermelha, mensagem, `aria-invalid` |
| empty | placeholder/CTA |
| success | confirmação visual |

Estados são **parte do contrato** — não opcionais.

## 4. Variantes & Tamanhos

- Variantes visuais limitadas (4–6). Cada uma com propósito claro.
- Tamanhos via token de escala (sm/md/lg), não valores ad-hoc.
- Composição de variantes via CVA (class-variance-authority) ou equivalente; manter consistência.

## 5. Composição

- Preferir compound components para estruturas complexas (Card = CardHeader/CardBody/CardFooter).
- Evitar prop drilling profundo; usar context/provider quando necessário.
- Documentar regras de aninhamento (ex.: Button não pode conter Button).

## 6. i18n

- Nenhum literal em template/script. Chaves via vue-i18n / react-i18next.
- Labels/aria via props `labelKey` ou slot; resolver com `t()`.
- Formato de data/número via locale.

## 7. Acessibilidade (a11y) — Mínimo

- Roles corretos (button, dialog, etc.).
- aria-label/aria-labelledby quando não há texto visível.
- Navegação por teclado (Tab, Enter, Space, Esc, setas).
- Focus trap em modais; retorno de foco ao fechar.
- Contraste WCAG 2.1 AA (4.5:1 texto, 3:1 UI).
- `prefers-reduced-motion` respeitado.

## 8. Checklist de Template

- [ ] Props tipadas (TS)
- [ ] Slots documentados
- [ ] Events documentados
- [ ] Estados completos
- [ ] Variantes + tamanhos
- [ ] Tokens Pulse mapeados
- [ ] A11y (role, aria, keyboard)
- [ ] i18n (sem literais)
- [ ] Notas de adapter Vue/React