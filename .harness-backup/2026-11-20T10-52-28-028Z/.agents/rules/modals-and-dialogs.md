# Regras: Modais e Dialogs (modals-and-dialogs.md)

Este documento especifica a construção de janelas modais (`Dialog`) para formulários, cadastros e confirmações, em conformidade com as diretrizes do **Modern Web Guidance**.

---

## 1. Largura Recomendada e Prevenção de Espaços Vazios

O dimensionamento da modal deve se adequar à densidade e complexidade da informação:

### Tabela de Largura Recomendada:

| Tipo de Modal | Classe Tailwind Recomendada | Largura em Pixels | Cenário de Uso |
| :--- | :--- | :--- | :--- |
| **Confirmação / Alerta** | `sm:max-w-md` ou `sm:max-w-[440px]` | ~448px | Exclusões, alertas e confirmações rápidas com 2 botões. |
| **Pagamento / Comprovante** | `sm:max-w-[480px]` | ~480px | Pix, boletos, checkout rápido, recibos térmicos. |
| **Formulário de Cadastro Simples** | `sm:max-w-xl` | ~576px | Formulários diretos de 2 colunas simétricas. |
| **Cadastro Financeiro / Complexo** | `sm:max-w-2xl` | **~672px** | Contas bancárias, carrosséis de bancos, múltiplos grupos e dados de integração. |

---

## 2. Anatomia de Modal com Rodapé Fixo (Footer Desacoplado do Scroll)

> [!CAUTION]
> **Anti-Pattern de Scroll Cortando o Rodapé**: Se o formulário inteiro com os botões for colocado dentro de uma div com scroll ou se a modal inteira rolar, os botões de ação ("Cancelar" e "Salvar") podem sumir na dobra inferior (*below the fold*) e a barra de rolagem atravessar o rodapé.

### A Estrutura Canônica Recomendada:
1. `DialogContent`: `className="w-full sm:max-w-2xl max-h-[92vh] flex flex-col p-0 gap-0 overflow-hidden"`
2. `DialogHeader`: `className="p-5 sm:p-6 pb-4 border-b border-border/70 shrink-0"` (fica sempre fixo no topo).
3. `<form>`: `className="flex flex-col flex-1 min-h-0"`
4. Área de Campos (Miolo): `className="flex-1 overflow-y-auto overscroll-contain p-5 sm:p-6 space-y-4"` (apenas os campos rolam).
5. `DialogFooter`: `className="p-4 sm:px-6 border-t border-border/70 bg-muted/20 shrink-0 flex flex-row items-center justify-end gap-3 sm:space-x-0"` (fica sempre visível e destacado na base).

---

## 3. Seletores Horizontais com Carrossel / Navegação

Para seletores com muitas opções ricas (ex: Instituições Financeiras, Bandeiras de Cartão, Portfólios):
- Utilize um carrossel horizontal compacto com botões de avanço/recuo (`ChevronLeft` / `ChevronRight`):
```tsx
<div className="flex items-center gap-2.5 overflow-x-auto pb-1.5 scrollbar-none snap-x">
  {/* Cards com snap-start, logo, compe e status de seleção */}
</div>
```


---

## 3. Espaçamento Inegociável de Rodapé (`gap-3`)

> [!CAUTION]
> **Anti-Pattern de Botões Colados**: O utilitário padrão `DialogFooter` do shadcn costuma aplicar `sm:space-x-2` ou `sm:space-x-0`, fazendo com que botões se toquem ou fiquem colados caso o desenvolvedor utilize flexbox tradicional.

### O Padrão Correto de Rodapé:
```tsx
<DialogFooter className="mt-5 flex flex-row items-center justify-end gap-3 sm:space-x-0">
  <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
    Cancelar
  </Button>
  <Button type="submit">
    Cadastrar Transação
  </Button>
</DialogFooter>
```

---

## 4. Anatomia Completa de um Dialog Padrão

```tsx
import { Button } from "@/components/shadcn/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/ui/dialog"
import { Input } from "@/components/shadcn/ui/input"
import { Label } from "@/components/shadcn/ui/label"

export function ExemploDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto overscroll-contain p-6 sm:max-w-xl sm:p-7">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-foreground">
              Título do Cadastro
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Instrução orientativa para o usuário.
            </DialogDescription>
          </DialogHeader>

          {/* Grid de 2 Colunas */}
          <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="nome" className="text-xs font-medium">Nome Completo *</Label>
              <Input id="nome" required autoFocus className="h-10 w-full" />
            </div>
          </div>

          <DialogFooter className="mt-5 flex flex-row items-center justify-end gap-3 sm:space-x-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" className="font-semibold">
              Salvar Registro
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

---

## 5. Padrão para Modais de Upload e Dropzone de Arquivos

Em modais de upload em lote (como `FileUploadDialog`):
1. **Área de Dropzone Visual**:
   - Borda tracejada (`border-2 border-dashed border-border/80`).
   - Feedback tátil em drag-and-drop: quando `isDragging`, alterne para `border-primary bg-primary/5 scale-[0.99]`.
   - Suporte a clique para abrir seletor nativo (`<input type="file" multiple className="hidden" />`).
2. **Fila de Upload com Scroll Limitado**:
   - Limite a altura da fila (`max-h-48 overflow-y-auto`) para não estourar a altura da viewport.
   - Cada item deve exibir o ícone do formato, nome truncado, tamanho formatado, status e progresso percentual durante o envio.
3. **Bloqueio de Submissão**:
   - O botão principal de upload deve permanecer desabilitado se a fila estiver vazia (`queuedFiles.length === 0 || isUploading`).

---

## 6. Prevenção de Estouro Horizontal em Modais com Códigos Longos (`min-w-0`)

> [!CAUTION]
> **Bug Crítico de Overflow em Flexbox**: Em modais de pagamento (Pix Copia e Cola, Linha Digitável de Boleto, chaves de API, hashes ou URLs longas), uma string contínua de 100+ caracteres sem espaços dentro de um container `flex` força `min-width: auto` a expandir para ~1000px, vazando para fora do `DialogContent` (`sm:max-w-[480px]`).

### Regra Obrigatória para Caixas de Código / Pix / Boleto em Modais:
1. O `DialogContent` deve declarar explicitamente `w-full sm:max-w-[480px] max-h-[92vh] overflow-y-auto overscroll-contain p-5 sm:p-6`.
2. Todo wrapper `flex` ou `grid` interno que contenha strings longas **DEVE** possuir `min-w-0 w-full`.
3. O contêiner do texto deve usar `min-w-0 flex-1 overflow-hidden` e o elemento `<p>` ou `<code>` deve usar `truncate` (para linha única) ou `break-all` (para múltiplas linhas):

```tsx
{/* CORRETO: Nunca vaza da largura da modal */}
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
```

