# Regras: Formulários, Inputs e Controles de Seleção (forms-and-inputs.md)

Este documento estabelece as regras mandatórias para **construção de formulários, inputs de texto, seletores (`Select`), comboboxes e validação**, em conformidade com as diretrizes do **Modern Web Guidance**.

---

## 1. Regra Fundamental: Largura Integral (`w-full`) em Controles

> [!CAUTION]
> **O Erro do `w-fit`**: Componentes de seleção (`SelectTrigger`, `Combobox`, `DatePicker`) **NUNCA** devem utilizar a classe `w-fit` quando inseridos em um grid ou formulário de cadastro. Se configurados com `w-fit`, eles encolhem até o tamanho exato da palavra selecionada (ex: *"Pix"* ocupando 70px), deixando uma lacuna vazia órfã no resto da coluna.

### O Padrão Correto:
Todo controle de formulário deve preencher **100% da largura da célula**:
```tsx
{/* CORRETO: SelectTrigger e Input com w-full */}
<div className="flex flex-col gap-1.5">
  <Label htmlFor="categoria" className="text-xs font-medium">Categoria *</Label>
  <Select value={categoria} onValueChange={setCategoria}>
    <SelectTrigger id="categoria" className="h-10 w-full">
      <SelectValue placeholder="Selecione a categoria" />
    </SelectTrigger>
    <SelectContent>
      {/* Opções */}
    </SelectContent>
  </Select>
</div>
```

---

## 2. A Lei da Proximidade de Gestalt (Hierarquia Visual de Labels)

Para garantir que o cérebro humano associe instantaneamente o rótulo ao seu respectivo campo:

- **Distância entre Label e Input**: Deve ser de **`6px` (`gap-1.5`)**.
- **Distância entre Grupos de Campos**: Deve ser de **`14px` a `16px` (`gap-3.5` a `gap-4`)**.

```tsx
{/* Estrutura Canônica de Campo */}
<div className="flex flex-col gap-1.5">
  <Label htmlFor="email" className="text-xs font-medium text-foreground">
    E-mail Corporativo *
  </Label>
  <Input
    id="email"
    name="email"
    type="email"
    required
    aria-required="true"
    className="h-10 w-full"
    placeholder="nome@empresa.com.br"
  />
</div>
```

---

## 3. Grid Simétrico e Balanceado de 2 Colunas

A estrutura ideal para formulários em modal ou cartões utiliza **2 colunas perfeitamente simétricas**:

```tsx
<div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
  {/* Linha 1: Campo Amplo de Largura Total (ex: Descrição) */}
  <div className="flex flex-col gap-1.5 sm:col-span-2">
    <Label htmlFor="desc" className="text-xs font-medium">Descrição *</Label>
    <Input id="desc" required className="h-10 w-full" />
  </div>

  {/* Linha 2: 2 Campos Lado a Lado (50% / 50%) */}
  <div className="flex flex-col gap-1.5">
    <Label htmlFor="valor" className="text-xs font-medium">Valor (R$) *</Label>
    <Input id="valor" required className="h-10 w-full" />
  </div>
  <div className="flex flex-col gap-1.5">
    <Label htmlFor="data" className="text-xs font-medium">Data *</Label>
    <Input id="data" type="date" required className="h-10 w-full" />
  </div>

  {/* Linha 3: 2 Combos Lado a Lado (50% / 50%) */}
  <div className="flex flex-col gap-1.5">
    <Label htmlFor="cat" className="text-xs font-medium">Categoria *</Label>
    <Select>
      <SelectTrigger id="cat" className="h-10 w-full">
        <SelectValue placeholder="Selecione..." />
      </SelectTrigger>
      {/* ... */}
    </Select>
  </div>
  <div className="flex flex-col gap-1.5">
    <Label htmlFor="conta" className="text-xs font-medium">Conta *</Label>
    <Select>
      <SelectTrigger id="conta" className="h-10 w-full">
        <SelectValue placeholder="Selecione..." />
      </SelectTrigger>
      {/* ... */}
    </Select>
  </div>
</div>
```

---

## 4. Padrão para Inputs Monetários (Moeda BRL)

Campos de dinheiro devem utilizar o símbolo de moeda fixo e tipografia destacada:

```tsx
<div className="flex flex-col gap-1.5">
  <Label htmlFor="tx-amount" className="text-xs font-medium text-foreground">
    Valor da Transação (R$) *
  </Label>
  <div className="relative w-full">
    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">
      R$
    </span>
    <Input
      id="tx-amount"
      name="amount"
      type="text"
      inputMode="decimal"
      placeholder="0,00"
      className="h-10 w-full pl-10 text-base font-bold"
      required
      aria-required="true"
    />
  </div>
</div>
```

---

## 5. Seleção: Quando Usar Botões Táteis vs `<Select>` vs `<Combobox>`

| Quantidade de Opções | Componente Recomendado | Exemplo Prático |
| :--- | :--- | :--- |
| **2 a 3 Opções Exclusivas** | **Toggle Segmentado / Botões Táteis** | Tipo de Operação: `Receita` vs `Despesa` vs `Transferência`. |
| **4 a 12 Opções Fixas** | **`<Select>` Nativo do Shadcn** | Meio de Pagamento (`Pix`, `Boleto`, `Cartão`), Status da Transação. |
| **Mais de 12 ou Dados Dinâmicos** | **`<Combobox>` com Busca Integrada** | Clientes, Profissionais, Fornecedores, Plano de Contas. |

---

## 6. Campos de Pagamento e Autofill (Modern Web Guidance)

Em formulários de checkout e pagamento com cartão de crédito, cumpra rigorosamente os padrões de autofill dos navegadores para evitar abandono de carrinho:

1. **Número do Cartão**:
   - `autoComplete="cc-number"`
   - `inputMode="numeric"`
   - `maxLength={19}` (com máscara de 4 em 4 dígitos: `0000 0000 0000 0000`)
   - ❌ **NUNCA usar `type="number"`** (pois remove zeros à esquerda e quebra cartões).
2. **Data de Validade**:
   - `autoComplete="cc-exp"`
   - `placeholder="MM/AA"`
   - `maxLength={5}`
3. **Código de Segurança (CVV/CVC)**:
   - `autoComplete="cc-csc"`
   - `inputMode="numeric"`
   - `maxLength={4}`
   - ❌ **NUNCA usar `type="password"`** (para permitir que o usuário verifique o que digitou).
4. **Endereço Brasileiro**:
   - CEP: `autoComplete="postal-code"`
   - Logradouro: `autoComplete="address-line1"`
   - Bairro/Complemento: `autoComplete="address-line2"`
   - Cidade: `autoComplete="address-level2"`
   - Estado/UF: `autoComplete="address-level1"`

---

## 7. Cartão de Crédito Interativo 3D e Gestão de Carteira (Credit Card & Wallet)

Para telas financeiras, cadastros de cobrança e checkout com cartão:

1. **Espelhamento em Tempo Real (*Live Mirroring*)**: Os campos de formulário devem mapear imediatamente no componente visual `InteractiveCreditCard`, preenchendo número, titular e validade conforme a digitação.
2. **Giro 3D Dinâmico (*Flip Mechanism*)**: Ao receber foco no campo CVV/CVC (`onFocus`), o cartão deve girar suavemente 180° no eixo Y (`rotateY(180deg)`) exibindo a tarja magnética e a caixa de segurança no verso.
3. **Detecção Automática de Bandeira**: O sistema deve identificar pelo BIN inicial (Visa, Mastercard, Elo, Amex, Hipercard) e renderizar a logo correspondente no cartão.
4. **Validação com Algoritmo de Luhn**: Números de cartão completos devem ser validados via `validateLuhn()` antes da submissão.
5. **Políticas de Segurança PCI-DSS**:
   - Nunca expor o número completo após o cadastro: mascarar como `•••• •••• •••• 1234`.
   - Nunca persistir ou exibir o CVV em cartões armazenados da carteira.
   - Fornecer opção de "Definir como cartão principal / padrão".

---

## 8. Checklist de Acessibilidade em Formulários

- [ ] Todo controle possui `<Label htmlFor="{id}">` correspondente ao `id` do elemento.
- [ ] Campos obrigatórios possuem `required` e `aria-required="true"`.
- [ ] O primeiro campo editável possui `autoFocus`.
- [ ] Botões secundários possuem `type="button"` explícito para não disparar submissão ao teclar `Enter`.
- [ ] Mensagens de feedback e validação utilizam o componente `toast` do `sonner`.

