# Agentes Especialistas do Atlas Admin Template (`.agents/agent`)

Este diretório contém os **Agentes Autônomos Especialistas** projetados para atuar em plataformas de desenvolvimento baseadas em IA (Google Antigravity, Claude Code, Cursor, Codex, Windsurf, etc.).

---

## 🤖 Agente Disponível

### `atlas-shadcn-specialist`
- **Arquivo**: [`atlas-shadcn-specialist.md`](./atlas-shadcn-specialist.md)
- **Papel**: Guardião da Arquitetura, Desenvolvedor Especialista e Auditor de Qualidade Visual do **Atlas Admin Template** (perfil `shadcn`).
- **Principais Funções**:
  1. **Planejamento Arquitetural**: Define o arquétipo correto antes de escrever código, prevenindo decisões amadoras de layout.
  2. **Desenvolvimento Greenfield**: Cria novas telas, dashboards, módulos financeiros, PDV e copilotos com total aderência ao `DESIGN.md`.
  3. **Auditoria Rigorosa & Code Review**: Inspeciona código e identifica imediatamente os 10 riscos clássicos de quebra de tela (rolagem dupla, corte de rodapé de modais, portais de dialog no desktop, botões perdidos no fim de listas).
  4. **Refatoração Segura**: Migra páginas legadas para a arquitetura Atlas sem quebrar funcionalidades existentes.

---

## 🚀 Como Invocar o Agente

### No Google Antigravity:
O agente pode ser invocado diretamente pelo orquestrador ou pelo usuário através do comando de subagente:
```typescript
invoke_subagent({
  TypeName: "atlas-shadcn-specialist",
  Role: "Atlas Template Architect & Auditor",
  Prompt: "Revise a tela de cartões e garanta conformidade com o Arquétipo 2 e ausência de rolagem dupla."
})
```

### No Claude Code / Cursor / Codex:
O arquivo segue a especificação canônica com frontmatter YAML (`name`, `description`, `subagent: true`, `tools`), sendo automaticamente descoberto pelo motor de agentes ao analisar o repositório.
