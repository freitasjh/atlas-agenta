# Regras: Painel de Configurações (settings-panel.md)

Padrão do domínio `settings` (`src/components/shadcn/settings`), baseado em pesquisa de UX para painéis de configuração SaaS.

## 1. Estrutura (Arquétipo 6 — Painel de Controle)

- Layout `grid lg:grid-cols-[220px_minmax(0,1fr)] gap-6`: **nav lateral sticky** + conteúdo em `max-w-3xl min-w-0`. No mobile a nav vira faixa horizontal rolável.
- Nav agrupada por **objetivo do usuário** (Workspace, Operação, Acesso & Segurança, Plataforma), nunca por tabela do banco. Item ativo: `bg-primary/10 text-primary` + barra lateral de 2px.
- Escopo: configurações **do workspace** ficam aqui; preferências pessoais (perfil, senha) ficam no menu do avatar.

## 2. Busca (Ctrl/⌘ + K)

- Input `<search>` no topo da nav, indexando `label + description + keywords` (sem acento, sem caixa).
- Resultado mostra o **caminho** (`Grupo › Seção`) e navega direto à seção. Todo item novo em `SETTINGS_NAV` deve ter `keywords` com sinônimos.

## 3. Edição e salvamento

- **Um único rascunho** (`draft`) para todas as seções; `saved` é a base. Dirty = diff por chave (`JSON.stringify`).
- **Barra de alterações não salvas** (`SettingsSaveBar`): `fixed bottom-4`, surge só quando há mudanças, contador em `font-mono tabular-nums`, ações `Descartar` (reverte) e `Salvar alterações` (loading + `toast`).
- Trocar de seção **não** perde alterações (rascunho global); fechar a aba com pendências dispara `beforeunload`.

## 4. Anatomia de seção

- `SectionHeading` (`text-lg font-bold`) + 1..n `SettingsCard`; cada linha usa `SettingRow` (rótulo + `hint` à esquerda, controle `sm:w-64` à direita; `stacked` para campos largos).
- Booleanos → `Switch`; 2–3 opções visuais → cards selecionáveis (`aria-pressed`); listas fixas → `Select` com `w-full`; percentuais/números → `font-mono tabular-nums` com sufixo.
- Matrizes (permissões, notificações) usam `<table>` com `<th scope>` e `aria-label` em cada controle.
- Segredos (API key): `min-w-0` + `truncate`, mascarada por padrão, botões mostrar/copiar/rotacionar.

## 5. Zona de perigo

- Sempre na seção **Avançado**, no fim, em card `border-destructive/40 bg-destructive/5`.
- Ação destrutiva **nunca** é inline: abre modal com consequência explícita e **confirmação digitada** (`Confirmar` desabilitado até a frase bater).
- Modal segue `modals-and-dialogs.md` (`sm:max-w-[480px]`, `gap-3` no footer).

