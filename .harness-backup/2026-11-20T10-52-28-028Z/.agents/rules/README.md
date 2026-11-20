# Regras de Desenvolvimento e Refatoração (.agents/rules)

Este diretório contém os contratos mandatórios, padrões arquiteturais e regras de implementação de interface para desenvolvedores e agentes de IA trabalhando no ecossistema do **Atlas Admin Template (`shadcn`)** e **Harness**.

---

## 📚 Mapa de Regras

| Documento | Foco | Tópicos Principais |
| :--- | :--- | :--- |
| **[`shadcn-design.md`](./shadcn-design.md)** | Design System Central (`DESIGN.md`) | Tokens semânticos `--background`, `--foreground`, `--card`, os 5 Arquétipos do Atlas Admin, tipografia financeira `font-mono tabular-nums`, catálogo dos 12 domínios e gate de qualidade. |
| **[`screens-and-layouts.md`](./screens-and-layouts.md)** | Desenvolvimento de Telas (Greenfield) | Padrão `AtlasAdminTemplate`, padding `px-4 lg:px-6`, layout reduzido de Carteira & Extrato (`SelectorBar` + `SummaryHeader`), PDV Split-Screen com atalhos `F1..F12`, Backoffice, Internal Admin e Checkout. |
| **[`refactoring-to-atlas.md`](./refactoring-to-atlas.md)** | Refatoração e Migração | Diagnóstico dos 7 desvios clássicos, tabela de conversão de classes legadas para tokens semânticos Atlas, conversão estrutural para os 5 Arquétipos e blindagem de modais/formulários. |
| **[`cards-and-metrics.md`](./cards-and-metrics.md)** | Cards e Indicadores (KPIs) | Grid de 4 colunas (`SectionCards`, `TreasuryMetricsHeader`), semântica de cores com opacidade `10%-15%`, bordas `border-border/70` e elevação `shadow-xs`. |
| **[`tables-and-data.md`](./tables-and-data.md)** | Tabelas e Conciliação | Envoltório semântico `<search>`, Regra da Ação Única (sem botões duplicados), alinhamento de valores à direita com `font-mono tabular-nums` e rodapé contador. |
| **[`settings-panel.md`](./settings-panel.md)** | Painel de Configurações | Nav lateral agrupada com busca Ctrl+K, rascunho global + barra de alterações não salvas, `SettingRow`, matrizes de permissão/notificação e zona de perigo com confirmação digitada. |
| **[`ai-workspace.md`](./ai-workspace.md)** | IA & AI Elements | Padrão `shadcn/ui ai-elements`: `Conversation`, `Message`, `PromptInput` com `@contexto` e `/comandos`, `Reasoning`, `Tool` com aprovação Human-in-the-Loop, `InlineCitation`, `Sources` e painel Canvas/Artifact. |
| **[`modals-and-dialogs.md`](./modals-and-dialogs.md)** | Modais e Dialogs | Largura contida (`sm:max-w-[480px]` / `sm:max-w-xl`), `overscroll-contain`, prevenção de estouro horizontal em Flexbox (`min-w-0` + `truncate` para Pix/hashes) e rodapé com `gap-3`. |
| **[`drawers-and-sheets.md`](./drawers-and-sheets.md)** | Sheets e Drawers Laterais | `Sheet` lateral direito (`side="right"`) para inspeção profunda (`CaseInspectorSheet`, `TenantDetailsSheet`, `FileDetailsSheet`) e `Drawer` mobile. |
| **[`forms-and-inputs.md`](./forms-and-inputs.md)** | Formulários, Inputs e Cartão 3D | Regra de `w-full` obrigatório em `SelectTrigger`/`Input`, proximidade de Gestalt (`gap-1.5`), autofill de pagamento, validação de Luhn e `InteractiveCreditCard` 3D. |
| **[`mfa-and-security.md`](./mfa-and-security.md)** | MFA / 2FA e Segurança | Input OTP com pillbox pattern, suporte a paste, auto-submit, setup TOTP acessível com chave manual e códigos de recuperação obrigatórios. |
| **[`claude-design.md`](./claude-design.md)** | Perfil Claude (Editorial) | Superfícies editoriais, duplo bisel (`double-bezel`), paleta de papel térmico e temas (`claude`, `enterprise`, `liquid`). |

---

## ⚡ Os 10 Mandamentos Inegociáveis do Atlas Admin (`shadcn`)

1. **Shell Oficial**: Toda tela interna administrativa deve ser envolvida pelo `<AtlasAdminTemplate>` com alinhamento horizontal `px-4 lg:px-6` e ritmo vertical `flex flex-col gap-5` ou `gap-6`.
2. **Tokens Semânticos Estritos**: Nunca use cores hexadecimais (`#fff`) ou paletas fixas (`bg-slate-900`, `bg-gray-100`, `bg-white`). Use exclusivamente `bg-background`, `text-foreground`, `bg-card`, `bg-muted/30`, `border-border/70`.
3. **Precisão Numérica (`font-mono tabular-nums`)**: Valores monetários (`R$`), saldos, limites, percentuais, datas, SKUs, códigos EAN e números de conta/cartão devem sempre usar `font-mono tabular-nums`.
4. **Regra da Ação Única em Tabelas**: Telas com tabelas de dados devem concentrar o botão primário de criação (`+ Novo Registro`) **exclusivamente na barra `<search>` da tabela**, nunca duplicado no cabeçalho da página.
5. **Layout Reduzido para Contas e Cartões**: Módulos com múltiplas contas bancárias ou cartões devem usar a **Barra Horizontal de Seleção (`SelectorBar`)** + **Card de Veredito em 3 Colunas (`SummaryHeader`)** acima do extrato, com toggle em pílula para alternar para a carteira completa.
6. **Contenção de Flexbox (`min-w-0`)**: Qualquer container flex que exiba códigos longos (Pix Copia e Cola, linha digitável, URLs, hashes) deve possuir `min-w-0 w-full` e texto com `truncate` ou `break-all` para nunca estourar a largura da modal ou do card.
7. **Largura Integral em Controles (`w-full`)**: Em formulários em grid, todo `Input`, `SelectTrigger`, `Combobox` e `DatePicker` deve ter `w-full` (proibido `w-fit`).
8. **Modais Contidas e Sem Scroll Encadeado**: `DialogContent` deve usar `w-full sm:max-w-[480px]` (ou `sm:max-w-xl`), `max-h-[92vh] overflow-y-auto overscroll-contain` e `DialogFooter` com `gap-3 sm:space-x-0`.
9. **Tipagem Estrita em Ícones Lucide**: Nunca passe a prop `title` diretamente em ícones do `lucide-react`; envolva em `<span title="...">`.
10. **Gate de Verificação Obrigatório**: Toda criação ou refatoração deve passar com zero erros em `bash scripts/verify.sh` (`tokens` → `oxlint` → `tsc`).
