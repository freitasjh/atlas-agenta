# Regras: Drawers e Sheets Laterais (drawers-and-sheets.md)

Este documento dita o uso e a implementação de **Sheets Laterais** (`Sheet`) e **Gavetas Móveis** (`Drawer`) no template Atlas.

---

## 1. Quando Usar Sheet vs Dialog vs Drawer

| Componente | Mecanismo | Melhor Cenário de Uso |
| :--- | :--- | :--- |
| **`Dialog` (Modal)** | Sobreposição centralizada que interrompe a navegação | Formulários de cadastro simétricos, mensagens de confirmação e alertas críticos. |
| **`Sheet` (Lateral)** | Painel deslizante lateral (`side="right"`) | Cadastros rápidos enquanto o usuário mantém visibilidade da tela de fundo (ex: `CreateEntrySheet` na barra superior), filtros complexos ou detalhes do registro. |
| **`Drawer` (Inferior)** | Gaveta de rolagem móvel (`bottom-sheet`) | Telas de smartphone onde menus laterais ou modais centrais seriam difíceis de operar com o polegar. |

---

## 2. Anatomia de um Sheet Lateral (`side="right"`)

O padrão visual do template utiliza o painel deslizando pela borda direita:

```tsx
"use client"

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/shadcn/ui/sheet"
import { Button } from "@/components/shadcn/ui/button"

export function ExemploSheetLateral() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">Abrir Painel Lateral</Button>
      </SheetTrigger>

      <SheetContent
        side="right"
        className="flex w-full flex-col sm:max-w-md p-6"
      >
        <SheetHeader>
          <SheetTitle className="text-lg font-bold text-foreground">
            Novo Lançamento Rápido
          </SheetTitle>
          <SheetDescription className="text-xs text-muted-foreground">
            Adicione um item diretamente à fila de processamento.
          </SheetDescription>
        </SheetHeader>

        {/* Corpo do formulário com scroll próprio */}
        <div className="flex-1 overflow-y-auto py-4">
          {/* Campos aqui */}
        </div>

        <SheetFooter className="gap-2 sm:space-x-0">
          <Button type="button" variant="outline">
            Cancelar
          </Button>
          <Button type="submit">
            Confirmar
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
```

---

## 3. Diretrizes de Layout e Dimensões

- **Largura no Desktop**: `sm:max-w-md` (~448px) para formulários padrão; `sm:max-w-lg` (~512px) apenas para visualizações de auditoria detalhada.
- **Scroll Interno**: O `SheetContent` deve ter `flex flex-col` com o miolo do formulário em `flex-1 overflow-y-auto`, garantindo que o cabeçalho e o rodapé com os botões de ação fiquem sempre visíveis e fixos.
- **Botões do Rodapé**: O `SheetFooter` deve empilhar ou alinhar botões com `gap-2`, mantendo o botão principal em destaque.

---

## 4. Drawers Responsivos (Mobile First com Vaul)

Em interfaces para dispositivos móveis (`< 640px`), o componente `Drawer` abre da borda inferior:

```tsx
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/shadcn/ui/drawer"
import { Button } from "@/components/shadcn/ui/button"

export function MobileDrawer() {
  return (
    <Drawer>
      <DrawerTrigger asChild>
        <Button variant="outline">Ver Opções</Button>
      </DrawerTrigger>
      <DrawerContent className="p-4">
        <DrawerHeader>
          <DrawerTitle>Ações Rápidas</DrawerTitle>
          <DrawerDescription>Selecione uma das ações abaixo.</DrawerDescription>
        </DrawerHeader>
        
        {/* Lista de Ações */}
        <div className="py-2 flex flex-col gap-2">
          {/* Ações */}
        </div>

        <DrawerFooter>
          <DrawerClose asChild>
            <Button variant="outline">Fechar</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
```

---

## 5. Sheets de Inspeção e Detalhes de Arquivos / Ativos

Para painéis de inspeção lateral (como `FileDetailsSheet`):
1. **Estrutura Flex Vertical Completa**:
   - `SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col justify-between overflow-y-auto"`.
2. **Preview com Proporção Controlada**:
   - Para imagens: `img className="w-full h-44 object-cover"`.
   - Para outros arquivos: contêiner com ícone contextual grande e badge de extensão.
3. **Seção de Metadados em Lista Compacta**:
   - `divide-y divide-border/60 text-xs` exibindo tamanho formatado, tipo MIME, localização e data de modificação.
4. **Rodapé Fixo com Ações Cruciais**:
   - Grid de 2 botões para download e cópia de link, com botão de exclusão perigoso em vermelho destacado na base.


