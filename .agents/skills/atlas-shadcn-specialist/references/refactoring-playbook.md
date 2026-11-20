# Playbook de Refatoração e Migração — Legacy para Atlas Admin (`shadcn`)

Este guia contém receitas práticas **Antes vs. Depois** para refatorar telas legadas, componentes desalinhados ou layouts poluídos para o padrão rigoroso do **Atlas Admin Template (`shadcn`)**.

---

## Receita 1: Migração do Wrapper de Página e Eliminação de Cores Fixas

### ❌ ANTES (Página Legada com Cores Fixas e Container Desalinhado)
```tsx
export function LegacyAccountsPage() {
  return (
    <div className="min-h-screen bg-gray-100 p-8 dark:bg-slate-900">
      <div className="container mx-auto max-w-7xl space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white">Contas</h1>
            <p className="text-base text-gray-500">Gerencie suas contas</p>
          </div>
          <button className="rounded-lg bg-blue-600 px-4 py-2 text-white">Nova Conta</button>
        </div>
        <div className="rounded-2xl bg-white p-8 shadow-xl border border-gray-200">
          {/* Conteúdo */}
        </div>
      </div>
    </div>
  )
}
```

### ✅ DEPOIS (Padrão Oficial Atlas Admin Template)
```tsx
import { AtlasAdminTemplate } from "@/layouts"
import { BankAccountsView } from "@/components/shadcn/bank-accounts"

export function RefactoredAccountsPage() {
  return (
    <AtlasAdminTemplate title="Contas & Tesouraria" activeView="accounts">
      {/* Dentro de BankAccountsView: flex flex-col gap-5 px-4 pb-8 lg:px-6 */}
      <BankAccountsView />
    </AtlasAdminTemplate>
  )
}
```

---

## Receita 2: Compactação de Grades Poluídas de Cards (Padrão Reduzido de Contas/Cartões)

### ❌ ANTES (Grade Pesada de Cards Empurrando o Extrato para Baixo)
- Renderizar 4 a 8 cards grandes (`h-56`) no topo da página e colocar a tabela de extrato lá embaixo, forçando o usuário a rolar a tela inteira a cada troca de conta ou cartão.

### ✅ DEPOIS (Seletor Horizontal Compacto + Card de Veredito em 3 Colunas)
1. **Substitua o Grid sempre visível por um Toggle no Cabeçalho**:
   - Modo padrão: `Extrato & Conciliação` (foco operacional).
   - Modo secundário: `Carteira de Contas` (grade completa só quando o usuário quiser gerenciar cadastros).
2. **Adicione a Barra de Seleção em Carrossel com Ação Fixa no Início (`SelectorBar`)**:
   - Botão fixo no início `+ Nova Conta` / `+ Novo Cartão` (`shrink-0`, `h-[52px]`) sempre visível à esquerda para nunca sumir ao rolar.
   - Chip de Visão / Fatura Consolidada (`selectedId === ""`) com total consolidado em `font-mono tabular-nums`.
   - Controles de rolagem por carrossel (`ChevronLeft` / `ChevronRight`) envolvendo o trilho com `overflow-x-auto pb-1 scrollbar-none snap-x`.
   - Chips compactos (`px-3 py-2 h-[52px] snap-start`) com logo/mini cartão, apelido com Star de padrão e valor financeiro tabular.
3. **Adicione o Card de Veredito (`SummaryHeader` — `lg:grid-cols-12`)**:
   - `lg:col-span-5`: Identidade + Agência/Conta copiável + Saldo Disponível (`text-2xl sm:text-3xl font-bold font-mono tabular-nums`).
   - `lg:col-span-4`: Limite / Fluxo do período (`Entradas` vs `Saídas`) + Status Open Finance.
   - `lg:col-span-3`: CTAs rápidos (`Transferir`, `Importar OFX`, `Extrato`).
4. **Posicione a Tabela de Conciliação Imediatamente Abaixo**.

---

## Receita 3: Correção de Modais Estouradas por Códigos Longos (Pix / Boleto / URL)

### ❌ ANTES (Overflow Horizontal no Flexbox da Modal)
```tsx
<DialogContent className="sm:max-w-[500px]">
  <div className="flex items-center gap-2">
    <div className="flex-1 rounded bg-muted p-2 font-mono text-xs">
      {/* String de 140 caracteres sem espaço expande a div para 980px! */}
      {pixCopyPasteCode}
    </div>
    <Button>Copiar</Button>
  </div>
</DialogContent>
```

### ✅ DEPOIS (Blindado com `min-w-0`, `overflow-hidden` e `truncate`)
```tsx
<DialogContent className="w-full sm:max-w-[480px] max-h-[92vh] overflow-y-auto overscroll-contain p-5 sm:p-6">
  <div className="flex min-w-0 w-full items-center gap-2">
    <div className="min-w-0 flex-1 overflow-hidden rounded-lg border border-border/80 bg-muted/40 px-3 py-2.5">
      <p className="truncate font-mono text-xs text-muted-foreground select-all">
        {pixCopyPasteCode}
      </p>
    </div>
    <Button type="button" variant="outline" className="h-9 shrink-0 gap-1.5 px-3 text-xs font-semibold">
      Copiar Código
    </Button>
  </div>
</DialogContent>
```

---

## Receita 4: Unificação de Ações na Tabela e Formatação Tabular

### ❌ ANTES (Botão Duplicado e Números Desalinhados)
- Botão `+ Nova Transação` no topo da página **E** outro botão `+ Adicionar` acima da tabela.
- Coluna de valor com `<td className="font-bold text-green-600">R$ 1.250,00</td>`.

### ✅ DEPOIS (Regra da Ação Única + `font-mono tabular-nums`)
- Remova o botão de criação do cabeçalho da página e mantenha-o **apenas** dentro do `<search>` da tabela (canto direito).
- Formate todas as células monetárias à direita com fonte monoespaçada tabular e cores semânticas:
  ```tsx
  <TableCell className="text-right font-mono text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
    + R$ 1.250,00
  </TableCell>
  ```

---

## Checklist Final Pós-Refatoração

- [ ] A página usa `<AtlasAdminTemplate>` e alinhamento `px-4 lg:px-6`?
- [ ] Zero ocorrências de `bg-white`, `bg-slate-*`, `bg-gray-*` ou `#hex` estrutural?
- [ ] Todos os valores em `R$`, percentuais, datas e códigos possuem `font-mono tabular-nums`?
- [ ] Todos os `<Input>` e `<SelectTrigger>` em formulários possuem `w-full`?
- [ ] Todas as modais possuem `max-h-[92vh] overflow-y-auto overscroll-contain` e containers flex com `min-w-0`?
- [ ] `bash scripts/verify.sh` executou com `verify: OK (tokens, lint, types)`?

