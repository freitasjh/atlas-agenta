---
name: atlas-shadcn-specialist
description: Especialista em desenvolvimento greenfield e refatoracao de interfaces para o padrao Atlas Admin Template (perfil shadcn). Use sempre que criar novas telas, modulos financeiros, tabelas, KPIs, PDV, contas bancarias, cartoes, modais, drawers ou quando refatorar/migrar paginas e componentes existentes para seguir rigorosamente o layout, os tokens semanticos e a arquitetura do template Atlas Admin.
---

# Especialista Atlas Admin Template (`shadcn`)

Esta skill transforma o agente no especialista oficial de arquitetura e interface do **Atlas Admin Template (`shadcn`)**. Ela opera em **duas funcionalidades principais**:

1. **Modo 1 — Desenvolvimento (Greenfield)**: Criação de novas páginas, módulos de domínio, tabelas, cards de KPI, formulários, modais e painéis laterais seguindo 100% o contrato visual do sistema.
2. **Modo 2 — Refatoração e Migração (Legacy → Atlas Admin)**: Auditoria e conversão de telas ou componentes existentes/legados para utilizar o `AtlasAdminTemplate`, substituindo estilos avulsos por tokens semânticos e aplicando os arquétipos oficiais.

---

## Leitura Obrigatória de Contexto

Antes de iniciar qualquer implementação ou refatoração, consulte os contratos do repositório:
- Contrato Principal: [`DESIGN.md`](../../../DESIGN.md)
- Regras Modulares: [`.agents/rules/README.md`](../../rules/README.md)
- Playbook de Desenvolvimento (Templates Prontos): [`references/development-playbook.md`](./references/development-playbook.md)
- Playbook de Refatoração (Receitas Antes/Depois): [`references/refactoring-playbook.md`](./references/refactoring-playbook.md)

---

## As 10 Regras de Ouro Inegociáveis (Layout & Tokens)

1. **Shell Oficial (`AtlasAdminTemplate`)**:
   - Toda tela administrativa interna deve ser renderizada dentro de `<AtlasAdminTemplate title="..." activeView="...">` (importado de `@/layouts`).
   - O wrapper interno da view deve usar `className="flex flex-col gap-6 px-4 lg:px-6"` (ou `gap-5`). **Proibido** usar `container mx-auto` ou `max-w-7xl` que quebrem o alinhamento com o `SiteHeader`.
2. **Tokens Semânticos Estritos (Zero Hex / Zero Cores Fixas)**:
   - Use apenas `bg-background`, `text-foreground`, `bg-card`, `text-card-foreground`, `bg-muted/30`, `text-muted-foreground`, `border-border/70`, `bg-primary`, `text-primary-foreground`.
   - **Proibido** usar `bg-white`, `text-black`, `bg-slate-*`, `bg-gray-*` ou cores hexadecimais (`#fff`).
   - Status financeiros usam fundos translúcidos (`10%-15%`) com bordas suaves (`30%-40%`):
     - Positivo/Pago/Conciliado: `border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400`
     - Pendente/Atenção/Fechada: `border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400`
     - Negativo/Vencida/Erro: `border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400`
3. **Tipografia e Precisão Numérica (`font-mono tabular-nums`)**:
   - Títulos de página (`<h1>`): `text-xl font-bold tracking-tight text-foreground sm:text-2xl`.
   - Subtítulos (`<p>`): `text-xs text-muted-foreground`.
   - Todo valor monetário (`R$`), saldo, limite, percentual (`%`), data em tabela, SKU, EAN-13 e número de conta/cartão **DEVE** conter `font-mono tabular-nums`.
4. **Regra da Ação Única em Tabelas**:
   - Se a tela possui uma tabela de dados (`DataTable`, `TransactionTable`), o botão primário de criação (`+ Novo Registro`) fica **exclusivamente na barra `<search>` da tabela** (lado direito, ao lado de `Exportar`), **nunca** duplicado no cabeçalho da página.
5. **Padrão Reduzido para Múltiplas Contas ou Cartões (`SelectorBar` + `SummaryHeader`)**:
   - Em módulos de Contas Bancárias (`bank-accounts`) ou Cartões de Crédito (`credit-card`), **nunca** empilhe vários cards grandes acima do extrato.
   - Use: (a) Toggle em pílula no topo (`Extrato` vs `Carteira`), (b) **Barra Horizontal de Seleção (`SelectorBar`)** com chips compactos roláveis (`overflow-x-auto scrollbar-none`), (c) **Card de Veredito em 3 Colunas (`SummaryHeader` — `lg:grid-cols-12`)** (`5 cols` saldo/identidade + `4 cols` métricas/limites + `3 cols` CTAs), seguido da (d) **Tabela de Lançamentos/Conciliação**.
6. **Contenção de Flexbox em Modais e Cards (`min-w-0`)**:
   - Strings longas sem espaços (Pix Copia e Cola, linha digitável de boleto, hashes, tokens, URLs) dentro de containers `flex` **DEVEM** ter `min-w-0 w-full` no elemento pai e `truncate` ou `break-all` no elemento de texto. Caso contrário, o `min-width: auto` do Flexbox estoura a largura da modal.
7. **Anatomia de Modais (`DialogContent`)**:
   - Largura contida: `w-full sm:max-w-[480px]` (pagamentos/alertas) ou `w-full sm:max-w-xl` (formulários de 2 colunas).
   - Scroll seguro: `max-h-[92vh] overflow-y-auto overscroll-contain p-5 sm:p-6`.
   - Rodapé separado: `DialogFooter className="mt-5 flex flex-row items-center justify-end gap-3 sm:space-x-0"`.
8. **Largura Integral em Formulários (`w-full`)**:
   - Todo `<Input>`, `<SelectTrigger>`, `<Combobox>` e `<DatePicker>` dentro de um grid de formulário deve ter `className="h-10 w-full"`. Nunca use `w-fit` em formulários.
9. **Tipagem Estrita em Ícones (`lucide-react`)**:
   - Nunca passe a prop `title="..."` diretamente em um ícone do `lucide-react` (causa erro no `tsc --noEmit`). Envolva sempre em `<span title="..."><Icon className="size-3.5" /></span>`.
10. **Validação Final Obrigatória (`verify.sh`)**:
    - Toda entrega (desenvolvimento ou refatoração) deve terminar executando `bash scripts/verify.sh` (`tokens:build` → `oxlint src` → `tsc --noEmit`).

---

## Funcionalidade 1: Workflow de Desenvolvimento (Greenfield)

Quando o usuário pedir para **criar uma nova tela, módulo ou componente** no padrão Atlas Admin:

### Passo 1: Selecionar o Arquétipo Oficial de Layout
Escolha qual dos **5 Arquétipos do Atlas Admin** melhor atende ao domínio solicitado (detalhes e código base em [`references/development-playbook.md`](./references/development-playbook.md)):
- **Arquétipo 1 — Operacional Analítico (KPIs + Tabela)**: Para listagens CRUD, gestão de transações, clientes, pedidos ou relatórios (`Header` → `SectionCards 4-col` → `Tabela com <search>`).
- **Arquétipo 2 — Carteira & Extrato Reduzido (`SelectorBar` + `SummaryHeader`)**: Para gestão de cartões, contas bancárias, cofres, carteiras ou centros de custo onde o usuário seleciona uma entidade ativa e opera seus lançamentos logo abaixo.
- **Arquétipo 3 — Frente de Caixa Split-Screen (PDV / POS)**: Para operação de balcão de alta velocidade (`h-[calc(100vh-4rem)] overflow-hidden`, split `8/4` colunas, catálogo com leitor de código de barras à esquerda, cupom fiscal ativo à direita e rodapé de atalhos `F2..F10`).
- **Arquétipo 4 — Backoffice & Master-Detail com `Sheet`**: Para filas de compliance, suporte, auditoria ou administração de tenants SaaS (KPIs de SLA no topo + tabela densa + inspeção lateral em `Sheet side="right"` + modal de justificativa `ActionReasonModal`).
- **Arquétipo 5 — Split-Screen Transacional / Onboarding**: Para fluxos de Checkout (`7/5` cols com resumo sticky e `InteractiveCreditCard` 3D) ou Autenticação/Cadastro (`50/50` com micro-onboarding em 3 etapas).

### Passo 2: Estruturar os Arquivos do Domínio
Crie o módulo em `src/components/shadcn/<nome-do-dominio>/`:
- `<dominio>-types.ts`: Interfaces TypeScript estritas + dados mock realistas em pt-BR (CNPJ, CPF, BRL, bancos brasileiros).
- Subcomponentes modulares (`*-header.tsx`, `*-table.tsx`, `*-modal.tsx`, `*-sheet.tsx`).
- `<dominio>-view.tsx`: Componente orquestrador com estado interativo completo (busca, filtros, criação, conciliação/edição, exclusão com feedback via `toast` do `sonner`).
- `<dominio>.stories.tsx`: Stories do Storybook (`layout: "fullscreen"`).
- `index.ts`: Barrel exportando todos os componentes e tipos.

### Passo 3: Integrar na Navegação e CLI (se aplicável)
1. Adicione o `DashboardViewId` em `src/components/shadcn/navigation/app-sidebar.tsx`.
2. Conecte a view em `src/pages/DashboardPage.tsx` e `src/App.tsx`.
3. Registre o domínio em `scripts/add.mjs` (`DOMAIN_REGISTRY.shadcn` e `TEMPLATE_REGISTRY["atlas-admin"]`).
4. Execute `bash scripts/verify.sh`.

---

## Funcionalidade 2: Workflow de Refatoração e Migração (Legacy → Atlas Admin)

Quando o usuário pedir para **refatorar uma tela existente, padronizar um componente fora do layout ou migrar um projeto para o template Atlas Admin**:

> Consulte o guia completo de transformação Antes/Depois em [`references/refactoring-playbook.md`](./references/refactoring-playbook.md).

### Passo 1: Garantir a Instalação do Template Base (Em Projetos Alvo)
Se o projeto alvo ainda não possui os blocos do Atlas Admin instalados, utilize o CLI do Harness:
```bash
# Instalar o template Atlas Admin completo (ou apenas o domínio necessário)
node scripts/add.mjs --target <diretorio-do-projeto> --template atlas-admin
# Ou instalar domínios específicos:
node scripts/add.mjs --target <diretorio-do-projeto> --domain navigation,dashboard,transactions,cards,accounts,pdv
```

### Passo 2: Executar a Auditoria de 7 Pontos na Tela Alvo
Inspecione o arquivo a ser refatorado buscando:
1. Falta do wrapper `<AtlasAdminTemplate>` ou uso de margens/containers desalinhados (`max-w-7xl`, `mx-auto`, `p-8`).
2. Cores fixas (`bg-white`, `bg-gray-*`, `bg-slate-*`, `text-gray-*`, hexadecimais) que quebram o tema `.dark`.
3. Botões de ação primária duplicados no topo da página e na tabela.
4. Excesso de cards grandes empurrando a tabela principal para fora da visão inicial (converter para `SelectorBar` + `SummaryHeader` reduzido).
5. Valores monetários, datas e códigos sem `font-mono tabular-nums`.
6. Formulários com `SelectTrigger` encolhido (`w-fit`) ou sem proximidade de Gestalt (`gap-1.5`).
7. Modais estourando a largura da tela por falta de `min-w-0` em containers flex com códigos longos (ex: Pix Copia e Cola) ou sem `max-h-[92vh] overflow-y-auto overscroll-contain`.

### Passo 3: Aplicar as Transformações Estruturais e de Tokens
1. **Envelopamento**: Remova cabeçalhos/sidebars avulsos e envolva a página em `<AtlasAdminTemplate>` com `<div className="flex flex-col gap-5 px-4 lg:px-6">`.
2. **Mapeamento de Tokens**: Substitua todas as cores fixas pelos tokens semânticos (`bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border/70`).
3. **Compactação de Densidade**:
   - Reduza paddings exagerados (`p-8` → `p-4 sm:p-5`).
   - Se for tela de Contas ou Cartões com muitos cards, implemente a barra horizontal `SelectorBar` + `SummaryHeader` de 3 colunas (`lg:grid-cols-12`) + toggle de modo (`Extrato` vs `Carteira`).
4. **Blindagem de Modais e Flex**:
   - Aplique `w-full sm:max-w-[480px] max-h-[92vh] overflow-y-auto overscroll-contain p-5 sm:p-6` nas modais.
   - Aplique `min-w-0` e `truncate` em qualquer caixa de código/Pix/URL dentro de Flexbox.
5. **Verificação**: Rode `bash scripts/verify.sh` até obter `verify: OK (tokens, lint, types)`.
