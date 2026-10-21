# ADR-06 — Tela de templates `/app/config/mensagens` (lista + editor)

**Status:** proposto

**Escopo:** frontend

**Depende de:** ADR-05 (primitivo `Textarea`, `useMessageTemplates`/`useUpsertMessageTemplate`,
`messageTemplateSchema`, `canManageMessageTemplates`); ADR-03 (`renderTemplate` + lista fechada +
fallback para o preview ao vivo); ADR-01/02 (dados para ler/editar).

## Contexto

O admin precisa editar os textos das 4 mensagens sem depender de deploy. A rota é **`/app/config/
mensagens`** (decisão D1 — sub-rota nova no grupo de Configurações; a tela de WhatsApp é a máquina de
estados da *conexão*, templates são *conteúdo editorial*). A tela é uma **lista fixa de 4 cards**
(domínio fechado, sem "novo"/"excluir") com editor em `Dialog` (decisão D2), robusta a lacuna de seed
(se o fetch vier com < 4, derivar os faltantes de `MESSAGE_TEMPLATES` como cards "a configurar"). Os
padrões a seguir: `ServicosPage.tsx` (lista + `StatePanel` + `Skeleton`), `ServiceFormDialog.tsx`
(rhf + zod + `Dialog` + `Switch` + toast + `Loader2`), `ConfigHubPage.tsx` (grade de cards +
atalho). RBAC é defesa em profundidade; a trava real é RLS (ADR-01).

## Decisão

Diretório novo `src/app/config/mensagens/` com os componentes:

- **`TemplatesMensagemPage.tsx`** — página: `PageHeader` ("Modelos de mensagem" / "Os textos que seus
  clientes recebem no WhatsApp."), grade `grid gap-4 sm:grid-cols-2` com os **4 cards** (rótulo pt-BR
  via `getMessageTemplateLabel`, badge Ativo/Inativo `variant default|secondary`, prévia truncada do
  corpo com `line-clamp`, botão "Editar"). Estados: `Skeleton` no load; `StatePanel` (cópia local,
  como em `ServicosPage`) no erro com "Tentar novamente"; sem estado vazio real (merge do fetch com
  `MESSAGE_TEMPLATES` garante os 4 — faltantes viram card "a configurar" com default honesto).
  Renderiza `AccessDenied` (componente existente) se `!canManageMessageTemplates`.
- **`TemplateEditorDialog.tsx`** — `Dialog` + `Form` (rhf + `zodResolver(messageTemplateSchema)`),
  título "Editar modelo: {rótulo}" (chave read-only, domínio fechado), rodapé Cancelar/Salvar com
  `Loader2` em `isPending`. `onSubmit` chama `useUpsertMessageTemplate`; sucesso → toast "Modelo
  atualizado.", fecha, cache invalidado; erro → toast "Não foi possível salvar o modelo. Tente
  novamente.". Reset do form ao (re)abrir, espelhando `ServiceFormDialog`.
- **`TemplateBodyField.tsx`** — `Textarea` (ADR-05) controlado pelo rhf, acima a barra de chips
  (`VariableChips`), abaixo contador de caracteres (`body.length/1000`, `aria-live="polite"`) e dica
  pt-BR ("Use as variáveis para personalizar. Se um dado faltar, entra um texto padrão no lugar.").
- **`VariableChips.tsx`** — `<button type="button">` por variável da lista fechada da ADR-03
  (`{nome} {servico} {dataHora} {empresa}`), insere o token na posição do cursor (ref do textarea).
  Nome acessível = o próprio token (mono); teclado por `Enter`/`Espaço` (botão nativo).
- **`TemplatePreview.tsx`** — renderização ao vivo via `renderTemplate` (ADR-03) com dados de exemplo
  fixos pt-BR (`{nome}`="Maria Silva", `{servico}`="Consulta", `{dataHora}`="qui, 15/02 às 14:00",
  `{empresa}`= `trade_name` do tenant via `useTenant`), mostrando substituição e fallback. **Nunca**
  exibe `{token}` conhecido cru. Realce de token por **fundo** (`bg-primary/15`), texto em
  `foreground` + `font-medium` (decisão de contraste do §3 de `analysis-frontend.md` — não depender
  só da cor). Deriva de `form.watch("body")` — reatividade pura, sem efeito.

Rota em `src/router.tsx`: adicionar `{ path: "mensagens", element: <TemplatesMensagemPage /> }` como
filha de `config` (ao lado de `whatsapp`). Hub em `src/app/config/ConfigHubPage.tsx`: adicionar um
4º atalho "Modelos de mensagem" (ícone lucide, ex.: `MessageSquareText`) **visível só para admin**
(`usePermissions().canManageMessageTemplates`). A tela herda os guards existentes (`RequireAuth →
RequireActiveSubscription → AppLayout`) — sem lógica de assinatura própria.

Acessibilidade: `Tab` alcança cards → Editar → chips → textarea → Switch → Cancelar/Salvar; foco
visível (herdado); `Esc` fecha o `Dialog` e devolve foco ao gatilho; labels via `FormField`.
Mobile-first: 1 coluna < `sm`, 2 colunas a partir de `sm`; editor em coluna única no pequeno.

## Consequências

- O admin edita os 4 textos; a leitura/escrita é sob RLS do tenant (isolamento garantido no banco).
- A tela é robusta a tenant legado sem seed (cards "a configurar"), mas a baseline (ADR-02) é o
  caminho normal.
- O preview usa a mesma `renderTemplate` do servidor (ADR-03), tornando visível o que o cliente
  receberá antes do envio.

## Arquivos afetados

- `src/app/config/mensagens/TemplatesMensagemPage.tsx` (novo)
- `src/app/config/mensagens/TemplateEditorDialog.tsx` (novo)
- `src/app/config/mensagens/TemplateBodyField.tsx` (novo)
- `src/app/config/mensagens/VariableChips.tsx` (novo)
- `src/app/config/mensagens/TemplatePreview.tsx` (novo)
- `src/router.tsx` (adicionar a rota filha)
- `src/app/config/ConfigHubPage.tsx` (adicionar o 4º atalho, só admin)

## Critérios de aceite (testáveis nesta ADR)

- **Build:** `npm run build` limpo.
- **RF-T03/RF-T04 + §8 visual (QA na ADR-07, observável aqui):**
  - `/app/config` exibe o atalho "Modelos de mensagem" só para admin; leva a `/app/config/mensagens`;
    papel não-admin por URL vê `AccessDenied`.
  - A tela lista 4 cards (Confirmação, Lembrete (24h antes), Cobrança, Comprovante) com rótulo pt-BR,
    badge e prévia truncada; mobile 1 coluna sem overflow, desktop 2 colunas.
  - "Editar" abre o `Dialog` com o corpo atual no `Textarea`, chips e preview ao vivo; clicar um chip
    insere `{token}`; o preview substitui variáveis por dados de exemplo e **nunca** mostra `{token}`
    conhecido cru (fallback visível quando falta dado).
  - Salvar → toast "Modelo atualizado", fecha, a prévia do card reflete o novo texto (cache
    invalidado).
- **RNF-T01 (isolamento, AC-03):** logado no tenant A, a tela mostra só templates de A; editar em A
  não afeta B; não há como enviar `tenant_id` pelo cliente (RLS). Verificável com duas sessões.
- Verificar: `npm run build` exit 0; QA ao vivo (ADR-07) confirma os itens visuais.
