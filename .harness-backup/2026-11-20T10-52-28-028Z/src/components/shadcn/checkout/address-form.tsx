"use client"

import { useState } from "react"
import { ArrowRight, MapPin } from "lucide-react"

import { Button } from "@/components/shadcn/ui/button"
import { Checkbox } from "@/components/shadcn/ui/checkbox"
import { Input } from "@/components/shadcn/ui/input"
import { Label } from "@/components/shadcn/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/shadcn/ui/select"
import {
  BRAZILIAN_STATES,
  type ShippingAddress,
} from "./checkout-types"

interface AddressFormProps {
  initialData?: Partial<ShippingAddress>
  onSubmit: (address: ShippingAddress) => void
}

export function AddressForm({ initialData, onSubmit }: AddressFormProps) {
  const [fullName, setFullName] = useState(initialData?.fullName ?? "")
  const [email, setEmail] = useState(initialData?.email ?? "")
  const [phone, setPhone] = useState(initialData?.phone ?? "")
  const [cep, setCep] = useState(initialData?.cep ?? "")
  const [street, setStreet] = useState(initialData?.street ?? "")
  const [number, setNumber] = useState(initialData?.number ?? "")
  const [complement, setComplement] = useState(initialData?.complement ?? "")
  const [neighborhood, setNeighborhood] = useState(initialData?.neighborhood ?? "")
  const [city, setCity] = useState(initialData?.city ?? "")
  const [state, setState] = useState(initialData?.state ?? "SP")
  const [saveAddress, setSaveAddress] = useState(initialData?.saveAddress ?? true)
  const [sameAsBilling, setSameAsBilling] = useState(initialData?.sameAsBilling ?? true)

  // Máscara simples de CEP
  function handleCepChange(val: string) {
    const numeric = val.replace(/\D/g, "").slice(0, 8)
    if (numeric.length > 5) {
      setCep(`${numeric.slice(0, 5)}-${numeric.slice(5)}`)
    } else {
      setCep(numeric)
    }

    // Mock de preenchimento automático para CEPs de teste
    if (numeric.length === 8) {
      if (!street) setStreet("Av. Paulista")
      if (!neighborhood) setNeighborhood("Bela Vista")
      if (!city) setCity("São Paulo")
      if (!state) setState("SP")
    }
  }

  // Máscara simples de Telefone
  function handlePhoneChange(val: string) {
    const numeric = val.replace(/\D/g, "").slice(0, 11)
    if (numeric.length > 6) {
      setPhone(`(${numeric.slice(0, 2)}) ${numeric.slice(2, 7)}-${numeric.slice(7)}`)
    } else if (numeric.length > 2) {
      setPhone(`(${numeric.slice(0, 2)}) ${numeric.slice(2)}`)
    } else {
      setPhone(numeric)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onSubmit({
      fullName: fullName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      cep: cep.trim(),
      street: street.trim(),
      number: number.trim(),
      complement: complement.trim() || undefined,
      neighborhood: neighborhood.trim(),
      city: city.trim(),
      state,
      saveAddress,
      sameAsBilling,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-1 border-b border-border/70 pb-3">
        <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-foreground sm:text-xl">
          <MapPin className="size-5 text-primary" />
          Endereço de Entrega & Faturamento
        </h2>
        <p className="text-xs text-muted-foreground">
          Informe o destinatário e o endereço para entrega e emissão da nota fiscal.
        </p>
      </div>

      {/* Grid de 2 Colunas Simétricas */}
      <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
        {/* Nome Completo (largura total) */}
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="addr-fullname" className="text-xs font-medium text-foreground">
            Nome Completo do Destinatário *
          </Label>
          <Input
            id="addr-fullname"
            name="fullname"
            type="text"
            autoComplete="name"
            placeholder="Ex: Carlos Eduardo Silveira"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="h-10 w-full"
            required
            aria-required="true"
            autoFocus
          />
        </div>

        {/* E-mail */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="addr-email" className="text-xs font-medium text-foreground">
            E-mail para Notificações *
          </Label>
          <Input
            id="addr-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="carlos@empresa.com.br"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-10 w-full"
            required
            aria-required="true"
          />
        </div>

        {/* Telefone */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="addr-phone" className="text-xs font-medium text-foreground">
            Telefone / WhatsApp *
          </Label>
          <Input
            id="addr-phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            placeholder="(11) 98765-4321"
            value={phone}
            onChange={(e) => handlePhoneChange(e.target.value)}
            className="h-10 w-full"
            required
            aria-required="true"
          />
        </div>

        {/* CEP */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="addr-cep" className="text-xs font-medium text-foreground">
            CEP *
          </Label>
          <Input
            id="addr-cep"
            name="postal-code"
            type="text"
            autoComplete="postal-code"
            inputMode="numeric"
            placeholder="00000-000"
            value={cep}
            onChange={(e) => handleCepChange(e.target.value)}
            className="h-10 w-full"
            required
            aria-required="true"
          />
        </div>

        {/* Bairro */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="addr-neighborhood" className="text-xs font-medium text-foreground">
            Bairro *
          </Label>
          <Input
            id="addr-neighborhood"
            name="neighborhood"
            placeholder="Ex: Bela Vista"
            value={neighborhood}
            onChange={(e) => setNeighborhood(e.target.value)}
            className="h-10 w-full"
            required
            aria-required="true"
          />
        </div>

        {/* Logradouro / Rua (largura total ou 50%) */}
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="addr-street" className="text-xs font-medium text-foreground">
            Endereço (Rua / Avenida) *
          </Label>
          <Input
            id="addr-street"
            name="address-line1"
            autoComplete="address-line1"
            placeholder="Ex: Av. Paulista, Alameda Santos..."
            value={street}
            onChange={(e) => setStreet(e.target.value)}
            className="h-10 w-full"
            required
            aria-required="true"
          />
        </div>

        {/* Número */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="addr-number" className="text-xs font-medium text-foreground">
            Número *
          </Label>
          <Input
            id="addr-number"
            name="number"
            placeholder="Ex: 1578"
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            className="h-10 w-full"
            required
            aria-required="true"
          />
        </div>

        {/* Complemento */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="addr-complement" className="text-xs font-medium text-foreground">
            Complemento (opcional)
          </Label>
          <Input
            id="addr-complement"
            name="complement"
            placeholder="Ex: Sala 42, Bloco B"
            value={complement}
            onChange={(e) => setComplement(e.target.value)}
            className="h-10 w-full"
          />
        </div>

        {/* Cidade */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="addr-city" className="text-xs font-medium text-foreground">
            Cidade *
          </Label>
          <Input
            id="addr-city"
            name="address-level2"
            autoComplete="address-level2"
            placeholder="Ex: São Paulo"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="h-10 w-full"
            required
            aria-required="true"
          />
        </div>

        {/* Estado (UF) */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="addr-state" className="text-xs font-medium text-foreground">
            Estado (UF) *
          </Label>
          <Select value={state} onValueChange={setState}>
            <SelectTrigger id="addr-state" className="h-10 w-full">
              <SelectValue placeholder="Selecione o estado" />
            </SelectTrigger>
            <SelectContent>
              {BRAZILIAN_STATES.map((s) => (
                <SelectItem key={s.uf} value={s.uf}>
                  {s.name} ({s.uf})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Checkboxes de Conveniência */}
      <div className="flex flex-col gap-2.5 pt-2">
        <label className="flex items-center gap-2.5 text-xs text-muted-foreground cursor-pointer">
          <Checkbox
            checked={sameAsBilling}
            onCheckedChange={(checked) => setSameAsBilling(Boolean(checked))}
          />
          <span>Usar o mesmo endereço para os dados de cobrança e nota fiscal.</span>
        </label>
        <label className="flex items-center gap-2.5 text-xs text-muted-foreground cursor-pointer">
          <Checkbox
            checked={saveAddress}
            onCheckedChange={(checked) => setSaveAddress(Boolean(checked))}
          />
          <span>Salvar este endereço para agilizar compras e pedidos futuros.</span>
        </label>
      </div>

      {/* Botão de Avanço */}
      <div className="flex justify-end pt-4 border-t border-border/70">
        <Button type="submit" className="gap-2 font-semibold">
          Prosseguir para Pagamento
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </form>
  )
}

