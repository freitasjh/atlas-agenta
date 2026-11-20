import { useState } from "react"
import {
  CreditCard,
  Plus,
  Star,
  Trash2,
  Edit2,
  AlertCircle,
  MoreVertical,
} from "lucide-react"
import { Button } from "@/components/shadcn/ui/button"
import { Badge } from "@/components/shadcn/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/shadcn/ui/dropdown-menu"
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
import { toast } from "sonner"
import { InteractiveCreditCard } from "./interactive-credit-card"
import { AddCardDialog } from "./add-card-dialog"
import {
  detectCardBrand,
  type SavedCardItem,
  type CreditCardData,
  MOCK_SAVED_CARDS,
} from "./credit-card-types"

export interface CardsWalletViewProps {
  initialCards?: SavedCardItem[]
  onSetDefault?: (cardId: string) => void
  onDeleteCard?: (cardId: string) => void
  onAddCard?: (card: CreditCardData) => void
}

export function CardsWalletView({
  initialCards = MOCK_SAVED_CARDS,
  onSetDefault,
  onDeleteCard,
  onAddCard,
}: CardsWalletViewProps) {
  const [cards, setCards] = useState<SavedCardItem[]>(initialCards)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [selectedCardForEdit, setSelectedCardForEdit] = useState<SavedCardItem | null>(null)
  const [editNicknameModalOpen, setEditNicknameModalOpen] = useState(false)
  const [newNickname, setNewNickname] = useState("")

  const [cardToDelete, setCardToDelete] = useState<SavedCardItem | null>(null)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)

  // Definir como padrão
  const handleSetDefault = (cardId: string) => {
    const updated = cards.map((c) => ({
      ...c,
      isDefault: c.id === cardId,
    }))
    setCards(updated)
    if (onSetDefault) onSetDefault(cardId)
    toast.success("Cartão definido como preferencial para pagamentos futuros.")
  }

  // Abrir modal de edição de apelido
  const handleOpenEditNickname = (card: SavedCardItem) => {
    setSelectedCardForEdit(card)
    setNewNickname(card.nickname || "")
    setEditNicknameModalOpen(true)
  }

  const handleSaveNickname = () => {
    if (!selectedCardForEdit) return
    const updated = cards.map((c) =>
      c.id === selectedCardForEdit.id ? { ...c, nickname: newNickname.trim() } : c
    )
    setCards(updated)
    setEditNicknameModalOpen(false)
    toast.success("Apelido do cartão atualizado com sucesso!")
  }

  // Abrir confirmação de exclusão
  const handleOpenDelete = (card: SavedCardItem) => {
    setCardToDelete(card)
    setDeleteModalOpen(true)
  }

  const handleConfirmDelete = () => {
    if (!cardToDelete) return
    const updated = cards.filter((c) => c.id !== cardToDelete.id)
    setCards(updated)
    if (onDeleteCard) onDeleteCard(cardToDelete.id)
    setDeleteModalOpen(false)
    toast.success("Cartão removido da sua carteira.")
  }

  // Adicionar novo cartão
  const handleAddNewCard = (cardData: CreditCardData) => {
    const newCard: SavedCardItem = {
      id: `card-${Date.now()}`,
      brand: detectCardBrand(cardData.number),
      last4: cardData.number.slice(-4),
      holderName: cardData.holderName,
      expiryMonth: cardData.expiry.split("/")[0] || "12",
      expiryYear: cardData.expiry.split("/")[1] || "29",
      nickname: cardData.nickname || `Cartão final ${cardData.number.slice(-4)}`,
      isDefault: cardData.isDefault ?? cards.length === 0,
      isExpired: false,
      theme: cardData.theme || "midnight",
      createdAt: "2026-11-12",
    }

    let updatedList = [...cards]
    if (newCard.isDefault) {
      updatedList = updatedList.map((c) => ({ ...c, isDefault: false }))
    }
    updatedList.unshift(newCard)
    setCards(updatedList)

    if (onAddCard) onAddCard(cardData)
    toast.success("Novo cartão adicionado e tokenizado com sucesso!")
  }

  return (
    <div className="w-full space-y-6">
      {/* Cabeçalho da Carteira */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-border/80">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            Meus Cartões de Crédito
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Gerencie suas formas de pagamento seguras, assinaturas e faturas da conta.
          </p>
        </div>

        <Button
          type="button"
          onClick={() => setAddModalOpen(true)}
          className="text-xs font-semibold gap-1.5 shadow-xs h-9"
        >
          <Plus className="h-4 w-4" />
          Adicionar Novo Cartão
        </Button>
      </div>

      {/* Grid de Cartões Cadastrados */}
      {cards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/80 p-12 text-center space-y-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <CreditCard className="h-6 w-6" />
          </div>
          <h3 className="text-base font-bold text-foreground">Nenhum cartão cadastrado</h3>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            Você ainda não possui cartões salvos. Cadastre um cartão de crédito para pagamentos
            rápidos em 1 clique e assinaturas.
          </p>
          <Button
            type="button"
            onClick={() => setAddModalOpen(true)}
            className="mt-2 text-xs font-semibold gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            Cadastrar Primeiro Cartão
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {cards.map((card) => (
            <div
              key={card.id}
              className={`relative flex flex-col justify-between rounded-2xl border p-4 sm:p-5 shadow-xs transition-all ${
                card.isDefault
                  ? "border-primary/50 bg-card shadow-sm ring-1 ring-primary/20"
                  : "border-border/80 bg-card hover:border-border"
              }`}
            >
              {/* Badges superiores e Menu de Ações */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-1.5">
                  {card.isDefault && (
                    <Badge variant="default" className="text-[10px] font-semibold gap-1">
                      <Star className="h-2.5 w-2.5 fill-current" />
                      Principal
                    </Badge>
                  )}
                  {card.isExpired && (
                    <Badge variant="destructive" className="text-[10px] font-semibold gap-1">
                      <AlertCircle className="h-2.5 w-2.5" />
                      Vencido
                    </Badge>
                  )}
                </div>

                {/* Dropdown de Ações */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="text-xs">
                    {!card.isDefault && (
                      <DropdownMenuItem onClick={() => handleSetDefault(card.id)}>
                        <Star className="mr-2 h-3.5 w-3.5 text-primary" />
                        Definir como principal
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => handleOpenEditNickname(card)}>
                      <Edit2 className="mr-2 h-3.5 w-3.5" />
                      Editar apelido
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => handleOpenDelete(card)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-3.5 w-3.5" />
                      Excluir cartão
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Miniatura do Cartão 3D */}
              <div className="py-1">
                <InteractiveCreditCard
                  number={`•••• •••• •••• ${card.last4}`}
                  holderName={card.holderName}
                  expiry={`${card.expiryMonth}/${card.expiryYear}`}
                  cvv="•••"
                  theme={card.theme}
                  brand={card.brand}
                  className="max-w-[280px]"
                />
              </div>

              {/* Informações de Apelido e Status */}
              <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between text-xs">
                <div>
                  <span className="font-bold text-foreground block truncate max-w-[180px]">
                    {card.nickname || `Cartão final ${card.last4}`}
                  </span>
                  <span className="text-[11px] text-muted-foreground font-mono">
                    Terminado em •••• {card.last4}
                  </span>
                </div>

                {!card.isDefault && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleSetDefault(card.id)}
                    className="h-7 text-[11px] font-semibold"
                  >
                    Tornar Padrão
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal para Adicionar Cartão */}
      <AddCardDialog
        open={addModalOpen}
        onOpenChange={setAddModalOpen}
        onAddCard={handleAddNewCard}
      />

      {/* Modal para Editar Apelido */}
      <Dialog open={editNicknameModalOpen} onOpenChange={setEditNicknameModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Editar Apelido do Cartão</DialogTitle>
            <DialogDescription className="text-xs">
              Dê um nome para identificar este cartão facilmente nas suas compras.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-3">
            <Label htmlFor="nickname-input" className="text-xs font-semibold">
              Apelido do Cartão
            </Label>
            <Input
              id="nickname-input"
              value={newNickname}
              onChange={(e) => setNewNickname(e.target.value)}
              placeholder="Ex: Cartão Pessoal Nubank"
              className="text-xs h-10"
              autoFocus
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEditNicknameModalOpen(false)}
              className="text-xs font-semibold"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSaveNickname}
              className="text-xs font-semibold"
            >
              Salvar Alteração
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de Confirmação de Exclusão */}
      <Dialog open={deleteModalOpen} onOpenChange={setDeleteModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              <DialogTitle className="text-base font-bold text-foreground">
                Excluir Cartão de Crédito?
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs pt-1">
              Tem certeza que deseja remover o cartão terminado em{" "}
              <strong>•••• {cardToDelete?.last4}</strong>? Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 sm:gap-3 pt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeleteModalOpen(false)}
              className="text-xs font-semibold"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleConfirmDelete}
              className="text-xs font-semibold gap-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Sim, Excluir Cartão
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
