---
name: template-best-practices
description: Boas práticas para templates de componentes: a11y WCAG 2.1 AA, performance, testabilidade, versionamento e deprecação. Exemplos Vue 3 e React 18.
license: MIT
---

# Template Best Practices — Boas Práticas de Templates

Skill com boas práticas para templates de componentes reutilizáveis. Aplicável a qualquer framework (Vue 3, React 18).

## 1. Acessibilidade (WCAG 2.1 AA)

- Contraste: texto 4.5:1, UI não-textual 3:1.
- Foco visível em todos os interativos (Pulse: ring âmbar).
- Navegação por teclado completa; sem armadilhas de foco.
- Semântica correta (`button` para ação, `a` para navegação, landmarks).
- ARIA apenas quando semântica nativa não basta; preferir HTML nativo.
- Suporte a leitores de tela: labels, live regions para atualizações dinâmicas.
- `prefers-reduced-motion`: desabilitar animações não essenciais.
- `prefers-color-scheme`: dark mode (Pulse inverte neutros, mantém acento).

## 2. Performance

- Evitar re-renders desnecessários (Vue: `computed`/`shallowRef`; React: `memo`/`useMemo`).
- Lazy load de componentes pesados (modais, tabelas grandes).
- Virtualização para listas > 100 itens.
- Debounce em inputs de busca (≥300ms).
- Imagens com lazy loading e dimensões explícitas.
- Bundle: code-split por rota; tree-shake imports (lucide individual).
- Evitar inline objects/functions em props (causa re-render).

## 3. Testabilidade

- Props previsíveis e estáveis; evitar side effects em render.
- Expor `data-testid` / `aria` para seletores de teste.
- Testes de componente: render, interação, estados, a11y (axe).
- Cobertura mínima 70% em componentes novos (Vitest happy-dom).
- Testes de regressão visual quando aplicável.

## 4. Versionamento

- Semver para o design system: MAJOR (breaking), MINOR (feature), PATCH (fix).
- Template spec versionada (campo `version` no contrato).
- Changelog por componente (o que mudou, migração).
- Breaking changes requerem deprecação prévia (≥1 minor).

## 5. Deprecação

- Marcar componente/prop como `@deprecated` com alternativa e versão de remoção.
- Manter compatibilidade por ≥1 minor.
- Emitir warning em dev (console) quando usado.
- Documentar migração no changelog.
- Remover apenas em major.

## 6. Anti-Padrões

- Componente monolítico com 20+ props → quebrar em composição.
- Estilo inline para tokens → usar classes/CSS vars do Pulse.
- Lógica de negócio dentro de componente de UI → extrair para composable/hook.
- Props booleanas combinatórias (`isPrimary`, `isLarge`, `isDisabled`) → variantes nomeadas.
- Mutação de props (Vue/React) → emitir evento.

## 7. Checklist de Review

- [ ] A11y: contraste, foco, teclado, ARIA
- [ ] Performance: sem re-render desnecessário, lazy quando pesado
- [ ] Testes: cobertura ≥70%, estados cobertos
- [ ] Versionamento: versão atualizada se contrato mudou
- [ ] Deprecação: marcada quando aplicável
- [ ] i18n: sem literais
- [ ] Tokens Pulse: sem valores ad-hoc