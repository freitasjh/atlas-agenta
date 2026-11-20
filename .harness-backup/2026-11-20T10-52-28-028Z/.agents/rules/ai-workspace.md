# Regras: AI Copilot & Agentic Workspace (ai-workspace.md)

Este documento estabelece os padrões do domínio `ai` (`src/components/shadcn/ai`) com base nos componentes **shadcn/ui AI Elements** (`Conversation`, `Message`, `PromptInput`, `Reasoning`, `Tool`, `Confirmation`, `Plan`, `Sources`, `InlineCitation`, `Artifact`, `Canvas`, `Suggestions`, `ModelSelector`, `Context`) e nas melhores práticas corporativas de UX para IA.

---

## 1. Arquitetura Split-Screen Travada (Arquétipo 7)

- **Contêiner Raiz**: `flex h-[calc(100vh-4rem)] max-h-[calc(100vh-4rem)] w-full overflow-hidden bg-background`. O scroll global da página é bloqueado para evitar barra de rolagem dupla.
- **Divisão em 3 Painéis (`flex w-full overflow-hidden`)**:
  1. **Sidebar de Threads (`AIThreadsSidebar` — `w-64 shrink-0`, oculta em `< lg` via `Sheet side="left"`)**: Nova conversa, seleção de Persona/Agente, busca `<search>` no histórico e fixação (`pinned`).
  2. **Área Central de Conversa (`flex-1 min-w-0 flex-col`)**: Topbar operacional + `Conversation` (fluxo de mensagens com scroll próprio e botão flutuante *Ir para o final*) + `PromptInput` fixo na base.
  3. **Painel Lateral Direito Canvas / Artefato (`AIArtifactPanel` — `lg:w-[430px] xl:w-[480px]`, `Sheet side="right"` em `< md`)**: Exibição de relatórios, tabelas, queries SQL e códigos versionados com abas *Visualização* vs *Código / JSON* e ações *Copiar*, *Baixar* e *Aplicar no Sistema*.

---

## 2. Anatomia dos Componentes `ai-elements`

| Elemento | Função Obrigatória | Regras Visuais |
| :--- | :--- | :--- |
| **`Conversation` & `ConversationEmptyState`** | Thread principal com `role="log" aria-live="polite"`. | `max-w-3xl` centrado; no estado vazio, exibe seletor de Persona e grid 2×2 de `Suggestions`. |
| **`Message` & `MessageToolbar`** | Turnos de `user` (bolha primária à direita) e `assistant` (à esquerda). | Cabeçalho do modelo com latência e tokens em `font-mono tabular-nums`; barra inferior com Copiar, Regenerar, Feedback (`up`/`down`) e restaurar `Checkpoint`. |
| **`Reasoning`** | Cadeia de pensamento colapsável (`Pensou por X.Xs`). | Fechada por padrão para leitura limpa; trilha vertical guiada (`border-l border-border/80`). |
| **`PlanCard`** | Progresso de execução multi-etapas (`3/4 concluídas`). | Barra de progresso fina no topo + lista de etapas com `CheckCircle2`, `Loader2` ou `Circle`. |
| **`Tool` & `Confirmation`** | Execução visível de ferramentas + aprovação humana. | Status semântico (`Concluído` emerald, `Aguardando Aprovação` amber, `Recusado` rose); `Input/Output` JSON em `font-mono overflow-x-auto`. |
| **`InlineCitation` & `Sources`** | Rastreabilidade anti-alucinação. | Badges `[1]` inline que abrem `Popover` com trecho e referência; pílula expansível `"N fontes consultadas"`. |
| **`PromptInput`, `ModelSelector`, `ContextIndicator`** | Compositor avançado na base do chat. | Pílulas de `@contexto`, menu `/comandos`, switch de *Pensamento Profundo*, janela de contexto em `font-mono tabular-nums` e botão **Parar Geração** sempre acessível durante streaming. |

---

## 3. Governança Human-in-the-Loop e Segurança

1. **Ações Destrutivas ou Contábeis Exigem `Confirmation`**: Ferramentas que alteram dados financeiros (ex.: baixa em lote, conciliação OFX, estorno) devem iniciar em `status: "awaiting_approval"` com resumo explícito do impacto (`impactAmount`) e botões **Recusar Ação** e **Aprovar e Executar**.
2. **Controle de Interrupção (`Parar Geração`)**: Enquanto `isStreaming === true`, o botão primário de envio dá lugar ao botão destrutivo **Parar Geração**.
3. **Prevenção de Overflow em Blocos Técnicos**: Todos os contêineres de `JSON`, `SQL`, URLs de fonte e chips `@contexto` devem usar `min-w-0` e `overflow-x-auto` ou `truncate`.

