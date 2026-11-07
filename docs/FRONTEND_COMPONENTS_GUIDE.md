# Guia Canônico de Componentes Frontend — Atlas Agenda

> **Status:** Ativo / Fonte da Verdade  
> **Stack:** React 18+ · TypeScript · Tailwind CSS · shadcn/ui (Radix UI) · Lucide React  
> **Conformidade:** WCAG 2.1 AA · Mobile-First Responsive · Zero Vuetify/PrimeVue

---

## 1. Visão Geral & Princípios Arquiteturais

Este documento define os padrões oficiais de engenharia de interface e design system para o frontend do **Atlas Agenda**. Toda nova tela, refatoração ou adição de componente deve seguir rigorosamente as especificações aqui estabelecidas.

### 🏛️ Princípios Inegociáveis

1. **Composição sobre Configuração (Compound Components):**
   Priorize subcomponentes modulares (`Card`, `CardHeader`, `CardContent`, etc.) em vez de componentes monolíticos com dezenas de propriedades booleanas.
2. **Propriedade Local do Código (shadcn/ui Philosophy):**
   Os componentes primitivos residem em `src/components/ui/` sob controle direto da base de código. Modificações globais são feitas no arquivo primitivo; variações de domínio usam especializações em `src/components/` ou nos próprios módulos (`src/app/`, `src/modules/`).
3. **Acessibilidade por Padrão (WCAG 2.1 AA):**
   Todo componente interativo deve ser operável via teclado (`Tab`, `Enter`, `Space`, `Esc`), possuir indicadores visíveis de foco (`focus-visible:ring-2`), rótulos semânticos (`aria-label`, `aria-labelledby`, `role`) em português (`pt-BR`) e taxas de contraste mínimas de 4.5:1 para texto normal.
4. **Semântica e Proteção de Contraste:**
   Números e textos informativos principais devem usar `text-foreground`. Cores primárias de destaque (ex.: o verde jade `--primary`) nunca devem ser usadas como cor de texto sobre fundos claros quando o contraste for limítrofe.
5. **Tipografia Disciplinada:**
   * Textos estruturais, rótulos e controles utilizam a fonte padrão (`font-sans`).
   * Títulos de destaque, métricas principais e valores numéricos em cards de dashboard utilizam `font-display font-semibold tracking-tight`.
   * Números, percentuais e valores monetários utilizam obrigatoriamente `tabular-nums` para evitar oscilações visuais de layout.

---

## 2. Mapa do Design System & Roadmap de Elementos

| Elemento | Primitiva Base (`src/components/ui/`) | Status da Documentação | Responsabilidade Principal |
| :--- | :--- | :--- | :--- |
| **Card** | `card.tsx` | 🟢 **Padronizado (Seção 4)** | Agrupamento de conteúdo, KPIs, formulários e blocos de ação |
| **Input** | `input.tsx`, `form.tsx` | 🟢 **Padronizado (Seção 5)** | Entrada de texto, máscaras (telefone, CPF, moeda) e validação |
| **Modal (Dialog)** | `dialog.tsx` | 🟢 **Padronizado (Seção 6)** | Confirmações críticas, fluxos de passo único e interrupções focadas |
| **Drawer (Sheet)** | `sheet.tsx` | 🟢 **Padronizado (Seção 7)** | Painéis laterais deslizantes, menus móveis e formulários secundários |
| **Button** | `button.tsx` | 🟢 **Padronizado (Seção 8)** | Ações principais, secundárias, destrutivas e estados de loading |
| **Select** | `select.tsx` | 🟢 **Padronizado (Seção 9)** | Seleção única e múltipla com suporte a busca e teclado |
| **Table** | `table.tsx` | 🟢 **Padronizado (Seção 10)** | Listagens tabulares densas com ordenação e paginação |
| **Tabs** | `tabs.tsx` | 🟢 **Padronizado (Seção 11)** | Alternância contextual sem recarregar a rota |
| **Sonner / Toast** | `sonner.tsx` | 🟢 **Padronizado (Seção 12)** | Notificações assíncronas temporárias (sucesso/erro/info) |
| **Badge / StatusBadge** | `badge.tsx`, `StatusBadge.tsx` | 🟢 **Padronizado (Seção 13)** | Indicadores de status semânticos (pendente, confirmado, etc.) |
| **Tooltip** | `tooltip.tsx` | 🟢 **Padronizado (Seção 14)** | Informações contextuais no hover e teclado |
| **DropdownMenu** | `dropdown-menu.tsx` | 🟢 **Padronizado (Seção 15)** | Menus contextuais de ações de linha de tabela e usuário |
| **Switch & Checkbox** | `switch.tsx`, `checkbox.tsx` | 🟢 **Padronizado (Seção 16)** | Controles booleanos e consentimentos LGPD |
| **Avatar** | `avatar.tsx` | 🟢 **Padronizado (Seção 17)** | Representação gráfica de usuários e profissionais |

---

## 3. Matriz de Design Tokens do Sistema

Os tokens são alimentados via CSS Variables com compatibilidade automática entre temas Claro e Escuro (`.dark`):

```css
/* Paleta de Cores Semânticas */
--background / --foreground      /* Base da página e tipografia primária */
--card / --card-foreground          /* Superfície de cartões e texto interno */
--muted / --muted-foreground        /* Textos secundários, legendas e fundos atenuados */
--primary / --primary-foreground    /* Cor de marca (Jade) e texto sobre a marca */
--destructive / --destructive-fg   /* Ações perigosas, erros e alertas críticos */
--border / --input / --ring         /* Delimitação física de contornos e anéis de foco */
```

---

## 4. PADRONIZAÇÃO CANÔNICA: ELEMENTO CARD

O **Card** é o elemento de superfície fundamental do Atlas Agenda. Ele cria delimitação visual e hierárquica entre blocos independentes de informação ou controle.

### 4.1 Objetivo & Diretrizes de Uso

#### ✅ Quando Usar
* Para apresentar métricas e indicadores de desempenho (KPIs).
* Para agrupar formulários autônomos ou etapas de autenticação (Login, Cadastro).
* Para delimitar configurações funcionais ou seções de um hub operacional.
* Para exibir opções de escolha de planos ou serviços em páginas comerciais/públicas.
* Para listas de itens heterogêneos onde cada item contém múltiplas informações e ações associadas.

#### ❌ Quando NÃO Usar
* Para embrulhar uma tela inteira sem necessidade de superfície elevada (use layouts semânticos padrão: `<main>`, `<section>`).
* Para itens tabulares homogêneos de alta densidade (use `Table`).
* Para simples caixas de mensagem ou alertas inline (use componentes de aviso ou `Alert` sem estrutura de cabeçalho/rodapé pesada).
* Para aninhar múltiplos cards recursivamente (Card dentro de Card), o que gera ruído visual e excesso de bordas.

---

### 4.2 Anatomia Canônica do Componente

A estrutura canônica é baseada em [`src/components/ui/card.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/components/ui/card.tsx):

```tsx
<Card>
  <CardHeader>
    <CardTitle>Título da Seção ou Métrica</CardTitle>
    <CardDescription>Texto auxiliar ou contexto explicativo</CardDescription>
  </CardHeader>
  <CardContent>
    {/* Conteúdo principal: métrica, formulário, inputs ou lista */}
  </CardContent>
  <CardFooter>
    {/* Ações, botões de submissão, links secundários ou legendas */}
  </CardFooter>
</Card>
```

#### Regras dos Subcomponentes:
1. **`Card`:** Container raiz (`rounded-lg border bg-card text-card-foreground shadow-sm`). Deve carregar `role="group"` ou `<article>` caso represente um bloco autônomo, além de `aria-label` quando necessário.
2. **`CardHeader`:** Contém o título e a descrição. Espaçamento padrão `p-6` (ou `p-4 sm:p-6` em layouts responsivos densos) com `space-y-1.5`.
3. **`CardTitle`:** Renderizado por padrão como `<h3>` com estilo `font-display text-lg font-semibold leading-none tracking-tight`. Ajuste o nível semântico do cabeçalho (`asChild` ou tags semânticas) conforme a hierarquia do documento (nunca pule níveis semânticos `h1` → `h3`).
4. **`CardDescription`:** Tipografia em `text-sm text-muted-foreground`. Utilizado para subtítulos rápidos ou instruções.
5. **`CardContent`:** Espaçamento padrão `p-6 pt-0`. Toda a área útil do card reside aqui.
6. **`CardFooter`:** Espaçamento padrão `flex items-center p-6 pt-0`. Reservado para ações (`Button`), paginações ou metadados de rodapé.

---

### 4.3 Padrões Especializados (Arquétipos de Card no Sistema)

No Atlas Agenda, identificamos 4 arquétipos principais de Card. Todo novo card deve se encaixar em um destes formatos:

```
┌────────────────────────────────────────────────────────────────────────┐
│                      ARQUÉTIPOS DE CARDS                               │
├─────────────────┬──────────────────┬─────────────────┬─────────────────┤
│  1. KPI / METRIC│ 2. CONTENT/HUB   │ 3. FORM / AUTH  │ 4. INTERATIVO   │
│  Métricas,      │ Seções de tela,  │ Formulários     │ Seleção, planos,│
│  no-show,       │ integrações e    │ isolados, login │ cartões clicados│
│  totais, deltas │ configurações    │ e cadastros     │ com ação total  │
└─────────────────┴──────────────────┴─────────────────┴─────────────────┘
```

---

#### 📊 Arquétipo A: KPI / Metric Card

Utilizado no painel do operador e dashboard de métricas (ex.: [`KpiCard.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/app/dashboard/KpiCard.tsx), [`HeroNoShowCard.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/app/dashboard/HeroNoShowCard.tsx)).

* **Semântica:** `role="group"` ou `<article>` com `aria-label` completo em pt-BR (ex.: *"Taxa de no-show: 12,5%, 3 faltas em 24 agendamentos"*).
* **Tipografia:**
  * Rótulo: `text-sm font-medium text-muted-foreground`.
  * Valor Numérico: `font-display text-3xl font-semibold tabular-nums tracking-tight text-foreground`.
  * Apoio / Denominador: `text-xs text-muted-foreground`.
* **Zero Division & Dados Vazios:** **NUNCA** renderize `NaN`, `undefined` ou `0%` falso. Se não houver dados no período, use `"—"` e apoie com texto explícito (ex.: *"Sem agendamentos no período"*).
* **Slots Opcionais:** Slot superior/inferior para badges de tendência/delta (`DeltaBadge`).

##### Exemplo de Implementação:
```tsx
import { Card, CardContent } from "@/components/ui/card";

interface MetricCardProps {
  rotulo: string;
  valorFormatado: string;
  apoio?: string;
  children?: React.ReactNode;
}

export function MetricCard({ rotulo, valorFormatado, apoio, children }: MetricCardProps) {
  return (
    <Card role="group" aria-label={`${rotulo}: ${valorFormatado}`}>
      <CardContent className="space-y-2 p-5">
        <p className="text-sm font-medium text-muted-foreground">{rotulo}</p>
        <p className="font-display text-3xl font-semibold tabular-nums tracking-tight text-foreground">
          {valorFormatado}
        </p>
        {apoio && (
          <p className="text-xs text-muted-foreground">{apoio}</p>
        )}
        {children && <div className="pt-1">{children}</div>}
      </CardContent>
    </Card>
  );
}
```

---

#### ⚙️ Arquétipo B: Content / Configuration Card

Utilizado em páginas de configuração, integrações de WhatsApp e relatórios (ex.: [`ConnectionCard.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/app/config/whatsapp/ConnectionCard.tsx)).

* **Estrutura:** Usa `CardHeader` completo (título + descrição contextual) + `CardContent` + `CardFooter` para ações.
* **Máquina de Estados:** Estados visuais claros (ex.: conectado, desconectado, carregando) anunciados via `aria-live="polite"` para tecnologias assistivas.
* **Segurança de Ações:** Botões de mutação ou configuração avançada no footer devem verificar permissões do usuário (`canManage` ou role).

##### Exemplo de Implementação:
```tsx
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface ConfigSectionCardProps {
  titulo: string;
  descricao: string;
  children: React.ReactNode;
  onSalvar?: () => void;
  salvando?: boolean;
}

export function ConfigSectionCard({
  titulo,
  descricao,
  children,
  onSalvar,
  salvando,
}: ConfigSectionCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{titulo}</CardTitle>
        <CardDescription>{descricao}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {children}
      </CardContent>
      {onSalvar && (
        <CardFooter className="flex justify-end border-t bg-muted/20 px-6 py-4">
          <Button onClick={onSalvar} disabled={salvando}>
            {salvando ? "Salvando..." : "Salvar alterações"}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
```

---

#### 📝 Arquétipo C: Form / Auth Card

Utilizado em fluxos de autenticação, recuperação de senha e cadastros focados (ex.: [`LoginPage.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/auth/LoginPage.tsx)).

* **Layout:** Container com largura máxima controlada (`w-full max-w-md mx-auto`).
* **Mensagens de Feedback:** Alerta de erro ou status posicionado no topo do conteúdo, com `role="alert"` para foco acessível e anti-enumeração de dados.
* **Ações no Rodapé:** O botão de submit reside no `CardFooter`, com indicação visual de progresso (`Loader2` animado com rotação) e desativação de interação dupla durante a requisição.

##### Exemplo de Implementação:
```tsx
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export function FormCard({ title, subtitle, error, loading, onSubmit, children }) {
  return (
    <Card className="w-full max-w-md mx-auto shadow-md">
      <CardHeader className="space-y-1 text-center">
        <CardTitle className="text-2xl">{title}</CardTitle>
        {subtitle && <CardDescription>{subtitle}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div role="alert" className="rounded-md bg-destructive/15 p-3 text-sm text-destructive font-medium">
            {error}
          </div>
        )}
        {children}
      </CardContent>
      <CardFooter className="flex flex-col gap-3">
        <Button className="w-full" disabled={loading} onClick={onSubmit}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Confirmar
        </Button>
      </CardFooter>
    </Card>
  );
}
```

---

#### 👆 Arquétipo D: Interactive / Clickable Card

Utilizado para seleção de planos, cartões de agendamento ou navegação de catálogo (ex.: [`PlanCard.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/marketing/PlanCard.tsx)).

* **Estados de Interação:** Deve reagir visualmente ao cursor e ao teclado:
  * `hover:border-primary/50 hover:shadow-md`
  * `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`
  * `cursor-pointer transition-all duration-200`
* **Destaque Semântico:** Variação de card "Recomendado" ou "Ativo" deve usar borda de destaque (`border-primary` ou `ring-1 ring-primary`) acompanhado de um indicador textual ou badge (não confiar unicamente na cor para transmitir a informação).
* **Teclado:** Se não for embrulhado em `<Link>` ou `<button>`, deve receber `tabIndex={0}`, `role="button"` e tratadores de evento `onKeyDown` para teclas `Enter` e `Space`.

##### Exemplo de Implementação:
```tsx
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface SelectableCardProps {
  title: string;
  description: string;
  selected?: boolean;
  onSelect: () => void;
}

export function SelectableCard({
  title,
  description,
  selected = false,
  onSelect,
}: SelectableCardProps) {
  return (
    <Card
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "cursor-pointer transition-all duration-200 hover:shadow-md",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : "border-border hover:border-primary/40"
      )}
    >
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}
```

---

### 4.4 Checklist de Qualidade para Novos Cards

Antes de aprovar a implementação de qualquer novo Card, verifique:

- [ ] O componente estende e compõe as primitivas de `src/components/ui/card.tsx`?
- [ ] O espaçamento interno (`padding`) respeita os padrões (`p-5` para KPIs compactos; `p-6` para formulários e conteúdos padrão)?
- [ ] O contraste de texto passa no teste WCAG 2.1 AA (números e dados vitais em `text-foreground`, nunca em cores de baixo contraste)?
- [ ] Caso exiba métricas, possui `font-display tabular-nums`?
- [ ] O leitor de tela consegue ler o card com sentido (`role="group"` ou `aria-label` descritivo em pt-BR)?
- [ ] Se houver estado de carregamento ou dados vazios, o card lida graciosamente sem quebrar layout ou exibir `NaN`?
- [ ] Se o card for interativo/clicável, possui `focus-visible:ring-2`, navegação por teclado (`Enter`/`Space`) e cursor pointer?

---

### 4.5 Anti-Patterns Catalogados (O que NUNCA fazer)

1. ❌ **Card Aninhado Sem Propósito:** Colocar um `<Card>` dentro de outro `<Card>` criando bordas duplas e ruído visual. Use divisores (`Separator`) ou fundos atenuados (`bg-muted/40 p-4 rounded-lg`) para sub-blocos.
2. ❌ **Números com a Cor Primária em Fundo Claro:** Colorir métricas grandes com a cor `primary` jade sobre fundo branco. Causa fadiga visual e risco de reprovação no Lighthouse a11y. Use sempre `text-foreground`.
3. ❌ **Div Clicável Sem Acessibilidade:** Adicionar `onClick` numa `div` ou `Card` sem `tabIndex={0}`, sem `onKeyDown` e sem anel de foco visível.
4. ❌ **Ignorar Estados de Falha / Zero Division:** Exibir `0%` quando o denominador é zero, ou deixar o card em branco enquanto a requisição assíncrona falha.
5. ❌ **Classes de Estilo Hardcoded:** Usar cores hexadecimais como `bg-[#ffffff]` ou `border-[#e2e8f0]` em vez dos tokens semânticos (`bg-card`, `border-border`).

---

## 5. PADRONIZAÇÃO CANÔNICA: INPUT & FORM CONTROLS

Os formulários representam o ponto crítico de conversão e entrada de dados no **Atlas Agenda** (agendamentos, cadastro de empresa, configurações e precificação de serviços). A padronização de campos de entrada garante precisão dos dados, experiência sem atritos em dispositivos móveis e acessibilidade universal.

### 5.1 Objetivo & Diretrizes de Uso

#### ✅ Quando Usar `Input`
* Para entrada de texto curto de linha única (nomes, e-mails, títulos, códigos).
* Para campos numéricos formatados (telefones, CPF/CNPJ, CEP).
* Para valores monetários usando o componente especializado `MoneyInput`.
* Para busca textual rápida com ícone decorativo.

#### ❌ Quando NÃO Usar `Input`
* Para textos longos ou descrições multilinha (use `Textarea`).
* Para seleção de opções pré-definidas com mais de 3 itens (use `Select` ou `Combobox`).
* Para valores booleanos de liga/desliga (use `Switch` ou `Checkbox`).
* Para entrada de senhas sem controle de visibilidade quando o fluxo exigir confirmação visual.

---

### 5.2 Anatomia Canônica do Form (React Hook Form + Zod)

No Atlas Agenda, nenhum `<input>` deve ser instanciado "solto" em formulários operacionais. Todos devem ser envolvidos pelo conjunto semântico de formulário de [`src/components/ui/form.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/components/ui/form.tsx), que integra nativamente o `react-hook-form` e o `zod`:

```tsx
<Form {...form}>
  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
    <FormField
      control={form.control}
      name="campo"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Rótulo do Campo</FormLabel>
          <FormControl>
            <Input placeholder="Exemplo..." {...field} />
          </FormControl>
          <FormDescription>Texto auxiliar opcional abaixo do campo.</FormDescription>
          <FormMessage /> {/* Exibição automática do erro Zod em pt-BR */}
        </FormItem>
      )}
    />
  </form>
</Form>
```

#### Regras dos Subcomponentes:
1. **`FormField`:** Conecta o campo ao estado do `react-hook-form` através de uma render prop segura (`field`).
2. **`FormItem`:** Wrapper contextual que gera IDs únicos (`id`, `aria-describedby`, `aria-labelledby`) compartilhados entre label, controle e mensagens.
3. **`FormLabel`:** `<label>` acessível vinculado ao `<input>`. Exibe indicador visual de obrigatoriedade caso necessário.
4. **`FormControl`:** Injeta `id`, `aria-describedby` e `aria-invalid` diretamente no elemento filho via `@radix-ui/react-slot`.
5. **`FormDescription`:** Texto discreto em `text-xs text-muted-foreground` para orientar o formato esperado.
6. **`FormMessage`:** Exibe a mensagem de validação retornada pelo schema Zod (`text-sm font-medium text-destructive`). É omitido quando o campo não possui erros.

---

### 5.3 Regra Inegociável: Máscara Visual vs Valor Canônico

> [!IMPORTANT]
> **Máscara é puramente cosmética. O modelo de dados (state/banco) sempre armazena o valor puro.**

No Atlas Agenda seguimos estritamente a convenção estabelecida em [`src/lib/mask.ts`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/lib/mask.ts) e [`src/components/MoneyInput.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/components/MoneyInput.tsx):

| Dado | Formato de Apresentação (UI) | Formato Canônico (Store / API / DB) | Utilitário Obrigatório |
| :--- | :--- | :--- | :--- |
| **CPF** | `000.000.000-00` | `"12345678901"` (11 dígitos) | `maskDocument(val)` / `stripDigits(val)` |
| **CNPJ** | `00.000.000/0000-00` | `"12345678000195"` (14 dígitos) | `maskDocument(val)` / `stripDigits(val)` |
| **Telefone** | `(11) 98765-4321` | `"11987654321"` (10 ou 11 dígitos) | `maskPhone(val)` / `stripDigits(val)` |
| **CEP** | `01234-567` | `"01234567"` (8 dígitos) | `maskCep(val)` / `stripDigits(val)` |
| **Moeda (BRL)** | `R$ 150,00` | `15000` (**centavos inteiros**, `number`) | [`MoneyInput`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/components/MoneyInput.tsx) |

#### Regras de Sanitização:
* Utilize `stripDigits` (`value.replace(/[^0-9]/g, "")`) antes de persistir ou enviar para a API.
* **Proibição Absoluta de Float para Dinheiro:** Valores monetários **nunca** trafegam ou são salvos como float (`150.50`). São sempre manipulados em **centavos inteiros** (`15050`) para eliminar imprecisões de ponto flutuante do JavaScript. O componente `MoneyInput` faz a ponte automática.

---

### 5.4 Otimização para Mobile & Teclados Virtuais

Todo input deve declarar explicitamente o teclado móvel correto via atributos `type`, `inputMode` e `autoComplete`:

```tsx
/* CEP / Código de Confirmação (OTP) */
<Input inputMode="numeric" autoComplete="postal-code" placeholder="00000-000" />

/* Telefone / WhatsApp */
<Input type="tel" inputMode="tel" autoComplete="tel" placeholder="(00) 00000-0000" />

/* E-mail */
<Input type="email" inputMode="email" autoComplete="email" autoCapitalize="none" />

/* Dinheiro / Preço */
<MoneyInput placeholder="R$ 0,00" /> {/* Já possui inputMode="decimal" embutido */}
```

---

### 5.5 Estados do Input & Feedback Visual

O componente [`Input`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/components/ui/input.tsx) reage aos seguintes estados:

1. **Padrão (Default):**
   `border-input bg-background placeholder:text-muted-foreground`
2. **Foco Ativo (Focus Visible):**
   `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`
   *O anel de foco respeita o offset do tema para contraste máximo.*
3. **Inválido / Erro (Error State):**
   Quando `aria-invalid="true"` é acionado pelo `FormControl`:
   * Borda realçada em tom destrutivo (`border-destructive focus-visible:ring-destructive`).
   * `FormMessage` renderizado com `role="alert"` logo abaixo do campo.
4. **Desabilitado (Disabled):**
   `disabled:cursor-not-allowed disabled:opacity-50`
   *Interações de clique e digitação bloqueadas pelo navegador.*
5. **Somente Leitura (ReadOnly):**
   Para valores que não podem ser alterados mas precisam ser selecionáveis/copiáveis, use `readOnly className="bg-muted/50 cursor-default"`.

---

### 5.6 Acessibilidade (WCAG 2.1 AA) em Formulários

* **Labels Obrigatórios:** Todo `<input>` deve possuir um `<FormLabel>` associado. Se o design exigir que o rótulo não apareça visualmente, ele deve ser incluído com a classe `.sr-only` (visível para leitores de tela).
* **Associação Automática via Radix:** O `FormItem` cria automaticamente `id="campo-form-item"` e vincula o `htmlFor` do label e o `aria-describedby` das mensagens de erro ou descrição.
* **Mensagens de Erro Descritivas:** Erros de validação Zod devem ser redigidos em português claro, instruindo o usuário sobre como corrigir (ex.: *"Informe um telefone celular válido com DDD (11 dígitos)"* em vez de *"Formato inválido"*).

---

### 5.7 Exemplo Completo de Referência (Formulário com Validação Zod)

```tsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/MoneyInput";
import { Button } from "@/components/ui/button";
import { maskPhone, stripDigits } from "@/lib/mask";

const servicoSchema = z.object({
  nome: z.string().min(2, "O nome do serviço deve ter pelo menos 2 caracteres."),
  precoCentavos: z.number().min(100, "O valor mínimo de serviço é R$ 1,00."),
  telefoneContato: z
    .string()
    .transform((val) => stripDigits(val))
    .refine((val) => val.length === 10 || val.length === 11, "Telefone inválido com DDD."),
});

type ServicoFormData = z.infer<typeof servicoSchema>;

export function CadastroServicoForm({ onSucesso }: { onSucesso: (data: ServicoFormData) => void }) {
  const form = useForm<ServicoFormData>({
    resolver: zodResolver(servicoSchema),
    defaultValues: {
      nome: "",
      precoCentavos: 0,
      telefoneContato: "",
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSucesso)} className="space-y-5">
        {/* Campo de Texto Simples */}
        <FormField
          control={form.control}
          name="nome"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nome do Serviço</FormLabel>
              <FormControl>
                <Input placeholder="Ex.: Corte de Cabelo Masculino" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Campo com Máscara Monetária em Centavos */}
        <FormField
          control={form.control}
          name="precoCentavos"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Preço do Serviço</FormLabel>
              <FormControl>
                <MoneyInput
                  placeholder="R$ 0,00"
                  value={field.value}
                  onChange={field.onChange}
                />
              </FormControl>
              <FormDescription>Valor cobrado do cliente no agendamento.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Campo com Máscara de Telefone e Teclado Mobile */}
        <FormField
          control={form.control}
          name="telefoneContato"
          render={({ field }) => (
            <FormItem>
              <FormLabel>WhatsApp para Notificação</FormLabel>
              <FormControl>
                <Input
                  type="tel"
                  inputMode="tel"
                  placeholder="(00) 00000-0000"
                  value={maskPhone(field.value)}
                  onChange={(e) => field.onChange(stripDigits(e.target.value))}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-full">
          Salvar Serviço
        </Button>
      </form>
    </Form>
  );
}
```

---

### 5.8 Anti-Patterns Catalogados em Inputs

1. ❌ **Armazenar Máscaras no Estado/Banco:** Salvar strings como `"(11) 98765-4321"` ou `"12.345.678/0001-90"` diretamente na base. A máscara deve ser aplicada apenas no renderizador de entrada ou visualizador (`maskPhone`, `maskDocument`).
2. ❌ **Uso de Float para Dinheiro:** Salvar preços como `99.9` no form. Causa desvios de centavos em cálculos. Use sempre centavos inteiros via `MoneyInput`.
3. ❌ **Placeholder como Substituto de Label:** Usar apenas `placeholder="Nome"` sem `<FormLabel>`. O placeholder desaparece ao digitar e leitores de tela perdem o contexto.
4. ❌ **Ignorar `inputMode` em Mobile:** Deixar o usuário em um dispositivo touch abrir o teclado alfanumérico padrão para digitar um CEP ou telefone.
5. ❌ **Remover o Anel de Foco:** Usar `outline-none` sem repor o anel de foco acessível (`focus-visible:ring-2`).

---

## 6. PADRONIZAÇÃO CANÔNICA: MODAL (DIALOG)

O **Modal (Dialog)** é o mecanismo de interrupção focada do Atlas Agenda. Ele suspende o fluxo de trabalho atual da página para exigir uma decisão consciente do usuário ou permitir uma entrada de dados rápida sem navegar para outra rota.

### 6.1 Objetivo & Diretrizes de Uso

#### ✅ Quando Usar `Dialog`
* **Confirmação de Ações Críticas / Destrutivas:** Mudança de status irreversível (ex.: cancelar agendamento, desativar empresa, revogar convite).
* **Formulários Modais Curtos de Passo Único:** Criação ou edição rápida de registros (ex.: novo cliente, novo serviço, bloqueio de horário).
* **Feedback Bloqueante:** Avisos que exigem ciência explícita antes de qualquer outra interação.

#### ❌ Quando NÃO Usar `Dialog`
* Para formulários longos com mais de 6 campos (use `Sheet` lateral ou uma página dedicada).
* Para mensagens efêmeras de sucesso ou erro assíncrono (use `toast` via `sonner`).
* Para menus contextuais de ações rápidas (use `DropdownMenu`).
* Para visualização aprofundada de histórico com tabelas densas (use `Sheet` ou página inteira).

---

### 6.2 Anatomia Canônica do Dialog

Utiliza as primitivas de [`src/components/ui/dialog.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/components/ui/dialog.tsx) baseadas no Radix UI:

```tsx
<Dialog open={open} onOpenChange={onOpenChange}>
  <DialogTrigger asChild>
    <Button>Abrir</Button>
  </DialogTrigger>
  <DialogContent className="sm:max-w-lg">
    <DialogHeader>
      <DialogTitle>Título Claro e Direto</DialogTitle>
      <DialogDescription>
        Explicação objetiva da consequência ou objetivo do modal.
      </DialogDescription>
    </DialogHeader>

    {/* Corpo: Confirmação ou Formulário */}
    <div className="py-4">
      {children}
    </div>

    <DialogFooter className="gap-2 sm:gap-0">
      <DialogClose asChild>
        <Button variant="outline">Cancelar</Button>
      </DialogClose>
      <Button onClick={onConfirmar}>Confirmar</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

---

### 6.3 Padrões Especializados de Modal no Sistema

#### ⚠️ Padrão 1: Confirmação Destrutiva / Transição Sensível

Inspirado em [`StatusChangeConfirm.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/app/agenda/StatusChangeConfirm.tsx) e [`MudarStatusDialog.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/admin/empresas/MudarStatusDialog.tsx):

* **Copy Transparente:** O texto em `DialogDescription` deve descrever **exatamente** o impacto prático (ex.: *"Esta é uma etapa final e liberará o horário do profissional"*).
* **Ação Negativa com Destaque:** O botão destrutivo utiliza `variant="destructive"`.
* **Botão Neutro de Saída:** Sempre disponibilizar um botão "Cancelar" ou "Voltar" com `variant="outline"` ou `variant="ghost"`.
* **Prevenção de Clique Duplo:** Todos os botões do footer ficam desabilitados enquanto a requisição assíncrona está em trânsito, com `Loader2` animado.

##### Exemplo de Implementação:
```tsx
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemNome: string;
  onConfirm: () => Promise<void>;
  loading: boolean;
}

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  itemNome,
  onConfirm,
  loading,
}: DeleteConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Excluir {itemNome}?</DialogTitle>
          <DialogDescription>
            Esta ação é irreversível. Todos os dados associados a este registro serão permanentemente removidos.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-4 gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={loading}
            onClick={onConfirm}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirmar Exclusão
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

---

#### 📝 Padrão 2: Formulário Modal de Criação / Edição

Inspirado em [`CustomerFormDialog.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/app/clientes/CustomerFormDialog.tsx):

* **Estado Controlado:** O modal recebe `open` e `onOpenChange`.
* **Reset de Estado:** Ao abrir ou trocar de registro editado, o formulário deve ser reinicializado (`form.reset()`).
* **Scroll Interno Protegido:** Se o formulário contiver vários campos, o container interno deve possuir `max-h-[80vh] overflow-y-auto pr-1` para evitar que o modal transborde a tela em telas pequenas.

---

### 6.4 Acessibilidade & Comportamentos Obrigatórios (WCAG 2.1 AA)

* **Focus Trap Nativo:** O foco do teclado fica confinado dentro do modal enquanto ele estiver aberto. Pressionar `Tab` cicla apenas entre os controles do diálogo.
* **Restauração de Foco:** Ao fechar (seja por `Escape`, pelo botão `X` ou por ação), o foco retorna automaticamente para o elemento que acionou o modal.
* **Títulos e Descrições Obrigatórios:** O Radix exige `DialogTitle` e `DialogDescription` para conformidade com leitores de tela. Caso o design dispense a descrição visual, utilize a classe `.sr-only` no `DialogDescription` em vez de omiti-lo.

---

### 6.5 Anti-Patterns Catalogados em Modais

1. ❌ **Omitir `DialogDescription`:** Deixar o componente sem descrição gera alertas no console do Radix e prejudica usuários de tecnologias assistivas.
2. ❌ **Modais Gigantes com Scroll Infinito:** Colocar páginas inteiras dentro de um Dialog. Para fluxos longos, use `Sheet` ou rota dedicada.
3. ❌ **Abrir Modal sobre Modal (Nested Dialogs):** Evite empilhar dois diálogos simultaneamente. Isso degrada o gerenciamento de foco e desorienta o usuário.
4. ❌ **Confirmar Ações Sem Feedback Visual:** Fechar o modal sem indicar sucesso ou erro na ação executada (use `toast.success` ou `toast.error`).

---

## 7. PADRONIZAÇÃO CANÔNICA: DRAWER (SHEET)

O **Drawer (Sheet)** é um painel lateral deslizante que se sobrepõe à interface preservando a visão de fundo da aplicação. Ele é a solução ideal para navegação responsiva e para inspecionar ou editar detalhes complexos de um registro sem que o usuário perca seu contexto de rolagem ou filtragem na listagem principal.

### 7.1 Objetivo & Diretrizes de Uso

#### ✅ Quando Usar `Sheet`
* **Navegação Principal no Mobile:** O menu lateral (sidebar) colapsa em um `Sheet` acessível via botão hamburguer (ex.: [`DashboardShell.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/components/DashboardShell.tsx)).
* **Painel de Detalhes / Inspeção:** Visualizar o histórico completo de um agendamento, logs de auditoria ou perfil detalhado do cliente ao clicar em uma linha da tabela.
* **Formulários Ricos Multisseção:** Formulários com muitas configurações ou abas que ficariam espremidos em um `Dialog` central.

#### ❌ Quando NÃO Usar `Sheet`
* Para simples confirmações destrutivas com pergunta "Tem certeza?" (use `Dialog`).
* Para menus contextuais flutuantes de poucas opções (use `DropdownMenu`).
* Para alertas ou notificações do sistema (use `toast` ou `Alert`).

---

### 7.2 Anatomia Canônica do Sheet

Utiliza as primitivas de [`src/components/ui/sheet.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/components/ui/sheet.tsx):

```tsx
<Sheet open={open} onOpenChange={onOpenChange}>
  <SheetTrigger asChild>
    <Button variant="outline">Ver Detalhes</Button>
  </SheetTrigger>
  <SheetContent side="right" className="w-full sm:max-w-md md:max-w-lg flex flex-col">
    <SheetHeader>
      <SheetTitle>Título do Painel</SheetTitle>
      <SheetDescription>Subtítulo ou resumo explicativo</SheetDescription>
    </SheetHeader>

    {/* Área de rolagem vertical autônoma */}
    <div className="flex-1 overflow-y-auto py-4">
      {/* Conteúdo denso, abas ou formulário */}
    </div>

    <SheetFooter className="border-t pt-4">
      <Button onClick={onSalvar}>Salvar</Button>
    </SheetFooter>
  </SheetContent>
</Sheet>
```

---

### 7.3 Posicionamento, Largura e Responsividade

O `Sheet` suporta 4 direções via prop `side`:

| Lado (`side`) | Uso Padrão no Atlas Agenda | Comportamento Responsivo |
| :--- | :--- | :--- |
| `side="right"` (Default) | Painéis de detalhes, histórico e formulários laterais | `w-full sm:max-w-md md:max-w-lg` |
| `side="left"` | Menu de navegação mobile ([`DashboardShell.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/components/DashboardShell.tsx)) | `w-3/4 sm:max-w-xs border-r` |
| `side="bottom"` | Ações em lote ou filtros em telas móveis (*Bottom Sheet*) | `inset-x-0 bottom-0 max-h-[85vh]` |

---

### 7.4 Acessibilidade & Comportamentos Obrigatórios

* **Semântica:** O `Sheet` do shadcn é construído sobre o `@radix-ui/react-dialog`. Portanto, todas as garantias de foco, leitura por leitor de tela e tecla `Escape` se aplicam automaticamente.
* **Rolagem Autônoma:** O conteúdo interno deve ter `flex-1 overflow-y-auto` para que o cabeçalho (`SheetHeader`) e o rodapé de ações (`SheetFooter`) permaneçam fixos enquanto o usuário rola o formulário extenso.
* **Fechamento ao Navegar:** Quando o `Sheet` for usado para menus ou links, a navegação de rotas deve fechar automaticamente o painel (conforme implementado via `onNavigate: () => setMobileOpen(false)` no `DashboardShell`).

---

### 7.5 Exemplo Completo de Referência: Painel Lateral de Detalhes

```tsx
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

interface DetalhesAgendamentoSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agendamento: {
    clienteNome: string;
    servico: string;
    horario: string;
    valorFormatado: string;
    status: string;
  } | null;
}

export function DetalhesAgendamentoSheet({
  open,
  onOpenChange,
  agendamento,
}: DetalhesAgendamentoSheetProps) {
  if (!agendamento) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Detalhes do Agendamento</SheetTitle>
          <SheetDescription>
            Informações consolidadas do cliente e serviço.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto py-4">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase">Cliente</p>
            <p className="text-base font-semibold text-foreground">{agendamento.clienteNome}</p>
          </div>

          <Separator />

          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase">Serviço</p>
            <p className="text-sm text-foreground">{agendamento.servico}</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase">Horário</p>
              <p className="text-sm font-medium text-foreground">{agendamento.horario}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase">Valor</p>
              <p className="text-sm font-semibold tabular-nums text-foreground">
                {agendamento.valorFormatado}
              </p>
            </div>
          </div>
        </div>

        <SheetFooter className="border-t pt-4">
          <Button variant="outline" className="w-full" onClick={() => onOpenChange(false)}>
            Fechar Painel
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
```

---

### 7.6 Anti-Patterns Catalogados em Drawers

1. ❌ **Esquecer o Scroll Interno:** Colocar muito conteúdo sem `overflow-y-auto`, fazendo com que os botões de ação do rodapé fiquem inacessíveis em telas verticais menores.
2. ❌ **Drawer que Ocupa Toda a Tela Sem Botão de Fechar:** Não incluir botão de fechar visível ou `DialogClose` no rodapé, dependendo unicamente de clicar no overlay de fundo.
3. ❌ **Manter o Menu Aberto Após Trocar de Rota:** Não disparar o callback de fechamento ao clicar em um link interno no menu mobile.

---

## 8. PADRONIZAÇÃO CANÔNICA: BUTTON

O **Button** é o elemento primário de comando e acionamento de ações no **Atlas Agenda**. Ele expressa intencionalidade, transmite a hierarquia visual da tela e comunica o status de processos assíncronos (como salvamento e submissão).

### 8.1 Hierarquia Visual de Ações na Página

Uma tela bem projetada deve orientar o usuário sem sobrecarga sensorial. Para isso, aplicamos a seguinte hierarquia visual:

| Nível de Ação | Variante do Botão | Finalidade | Regra de Uso |
| :--- | :--- | :--- | :--- |
| **Ação Primária** | `variant="default"` | Ação principal da tela (ex.: "Salvar", "Confirmar Agendamento", "Entrar") | **Máximo de 1 por viewport/seção principal** |
| **Ação Crítica / Destrutiva** | `variant="destructive"` | Ações irreversíveis (ex.: "Excluir Serviço", "Cancelar Assinatura") | Apenas com confirmação via `Dialog` |
| **Ação Secundária** | `variant="outline"` | Ações de suporte ou escape (ex.: "Cancelar", "Filtrar", "Voltar") | Fundo neutro com borda visível |
| **Ação Alternativa** | `variant="secondary"` | Ações paralelas de menor destaque que a primária | Sem a cor forte da marca |
| **Ação Terciária / Discreta** | `variant="ghost"` | Ações contextuais em tabelas, cabeçalhos ou barras de ferramentas | Sem borda ou fundo em repouso |
| **Ação de Navegação Inline** | `variant="link"` | Links que se comportam esteticamente como texto sublinhado | Usado em rodapés de formulários e termos |

---

### 8.2 Anatomia & Variantes do Componente (`buttonVariants`)

Baseado em [`src/components/ui/button.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/components/ui/button.tsx):

```tsx
import { Button } from "@/components/ui/button";

// Tamanhos Padronizados
<Button size="sm">Pequeno (h-9 px-3)</Button>       {/* Tabelas e filtros compactos */}
<Button size="default">Padrão (h-10 px-4)</Button>    {/* Formulários e modais normais */}
<Button size="lg">Grande (h-11 px-8)</Button>        {/* CTAs de Landing Pages e Hero */}
<Button size="icon" aria-label="Ação"><Icon /></Button> {/* Botões de apenas ícone (h-10 w-10) */}
```

---

### 8.3 Polimorfismo com `asChild` (Navegação Segura)

> [!IMPORTANT]
> **Nunca estilize uma tag `<a href="...">` ou `<Link>` manualmente com classes de botão.**
> Utilize a propriedade `asChild` baseada em `@radix-ui/react-slot` para renderizar o componente de rota com os estilos e acessibilidade do botão.

```tsx
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

// Forma Correta: Mantém semântica HTML de link e estética de botão
<Button asChild variant="outline">
  <Link to="/app/config/servicos">Configurar Serviços</Link>
</Button>
```

---

### 8.4 Estados de Carregamento Assíncrono (Prevenção de Layout Shift)

Durante requisições de rede (mutações, logins, salvamentos), o botão deve impedir múltiplos envios e dar feedback visual contínuo.

* **Regra de Ouro:** **NUNCA substitua o texto do botão apenas pelo ícone de loading.** Isso encolhe a largura do botão, causando salto visual brusco (*Content Layout Shift - CLS*).
* **Solução Canônica:** Mantenha o texto descritivo original (ou passe de "Salvar" para "Salvando..."), adicione o spinner `<Loader2 className="mr-2 h-4 w-4 animate-spin" />` e desabilite o botão com `disabled={loading}`.

##### Exemplo de Implementação:
```tsx
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface ActionButtonProps {
  loading: boolean;
  onClick: () => Promise<void>;
  label: string;
  loadingLabel?: string;
}

export function ActionButton({ loading, onClick, label, loadingLabel = "Processando..." }: ActionButtonProps) {
  return (
    <Button disabled={loading} onClick={onClick}>
      {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {loading ? loadingLabel : label}
    </Button>
  );
}
```

---

### 8.5 Acessibilidade (WCAG 2.1 AA) em Botões

1. **Botões de Apenas Ícone (`size="icon"`):**
   Botões sem texto visível são ilegíveis para leitores de tela caso não tenham rótulo acessível. O uso de `aria-label="Descrição da ação em pt-BR"` é **obrigatório por contrato**:
   ```tsx
   <Button variant="ghost" size="icon" aria-label="Excluir agendamento">
     <Trash2 className="h-4 w-4 text-destructive" />
   </Button>
   ```
2. **Indicador de Foco Acessível:**
   Todo botão possui o token `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`. Nunca sobreponha com `outline-none` sem manter o anel visível.
3. **Estado Desabilitado:**
   Botões desabilitados recebem `disabled:pointer-events-none disabled:opacity-50`, bloqueando ativação via mouse e teclado.

---

### 8.6 Anti-Patterns Catalogados em Botões

1. ❌ **Múltiplos Botões Primários na Mesma Visualização:** Ter 3 ou 4 botões verdes `default` na mesma tela. Isso confunde o usuário sobre qual é a ação recomendada. Use 1 primário e os demais em `outline` ou `ghost`.
2. ❌ **Botão de Ícone Sem `aria-label`:** Deixar o leitor de tela anunciar apenas *"button"* sem indicar o que ele faz.
3. ❌ **Ignorar Desativação no Clique:** Não colocar `disabled={loading}` em botões de submit, permitindo que cliques rápidos disparem 2 ou 3 cobranças/agendamentos duplicados.
4. ❌ **Usar `<button>` Dentro de `<button>`:** Criar cliques aninhados ou tags quebradas.
5. ❌ **Hardcoded Colors em Vez de Variantes:** Usar `className="bg-red-500 hover:bg-red-600 text-white"` em vez de `variant="destructive"`.

---

## 9. PADRONIZAÇÃO CANÔNICA: SELECT

O **Select** é o componente oficial de seleção de valor único em um menu suspenso no **Atlas Agenda**. Ele substitui o `<select>` nativo do navegador por um controle estilizado, acessível e consistente entre plataformas e temas.

### 9.1 Objetivo & Diretrizes de Uso

#### ✅ Quando Usar `Select`
* Para escolha de uma opção entre 4 a 15 alternativas previsíveis (ex.: status de agendamento, filtro por filial, categoria de serviço, intervalo de datas).
* Em formulários operacionais onde o espaço horizontal é limitado.
* Em barras de ferramentas e filtros de listagens (ex.: [`EmpresasFilters.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/admin/empresas/EmpresasFilters.tsx)).

#### ❌ Quando NÃO Usar `Select`
* Para escolhas binárias (Sim/Não, Ativo/Inativo) — use `Switch` ou `Checkbox`.
* Para opções mutuamente exclusivas curtas (2 a 3 opções) onde a comparação visual imediata é benéfica — use `Tabs` ou `RadioGroup`.
* Para listas longas com mais de 20 opções ou com necessidade de busca/autocompletar (ex.: selecionar um cliente entre centenas) — use `Combobox` com campo de pesquisa.

---

### 9.2 Anatomia Canônica do Select

Utiliza as primitivas de [`src/components/ui/select.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/components/ui/select.tsx) baseadas no Radix UI:

```tsx
<Select value={valor} onValueChange={setValor}>
  <SelectTrigger className="w-full sm:w-[200px]">
    <SelectValue placeholder="Selecione uma opção..." />
  </SelectTrigger>
  <SelectContent>
    <SelectGroup>
      <SelectLabel>Categoria de Opções</SelectLabel>
      <SelectItem value="opcao_1">Opção 1</SelectItem>
      <SelectItem value="opcao_2">Opção 2</SelectItem>
      <SelectSeparator />
      <SelectItem value="opcao_extra">Opção Extra</SelectItem>
    </SelectGroup>
  </SelectContent>
</Select>
```

#### Regras dos Subcomponentes:
1. **`Select`:** Componente raiz gerenciador de estado (`value` e `onValueChange`).
2. **`SelectTrigger`:** O campo visível na tela que exibe o valor selecionado ou o placeholder, acompanhado de um ícone de chevron para baixo.
3. **`SelectValue`:** Renderiza o texto correspondente ao item selecionado.
4. **`SelectContent`:** O menu flutuante exibido em um `Portal` com animações suaves de abertura/fechamento e prevenção de transbordamento de tela.
5. **`SelectItem`:** Item selecionável com indicador de check (`Check`) alinhado à esquerda.
6. **`SelectLabel` / `SelectSeparator`:** Para estruturar listas em categorias organizadas.

---

### 9.3 Integração Canônica com React Hook Form

Quando utilizado dentro de um formulário Zod, o `Select` é conectado via `FormField` transmitindo o valor diretamente:

```tsx
<FormField
  control={form.control}
  name="categoria"
  render={({ field }) => (
    <FormItem>
      <FormLabel>Categoria do Profissional</FormLabel>
      <Select onValueChange={field.onChange} defaultValue={field.value} value={field.value}>
        <FormControl>
          <SelectTrigger>
            <SelectValue placeholder="Selecione uma categoria" />
          </SelectTrigger>
        </FormControl>
        <SelectContent>
          <SelectItem value="cabelo">Cabelo & Barba</SelectItem>
          <SelectItem value="estetica">Estética Facial</SelectItem>
          <SelectItem value="unhas">Manicure & Pedicure</SelectItem>
        </SelectContent>
      </Select>
      <FormMessage />
    </FormItem>
  )}
/>
```

---

### 9.4 Acessibilidade & Navegação por Teclado (WCAG 2.1 AA)

* **Typeahead Search Nativo:** O Radix Select inclui busca por digitação nativa. Ao abrir o menu, digitar as primeiras letras de uma palavra foca imediatamente o item correspondente.
* **Navegação com Setas e Teclas Padrão:**
  * `Space` ou `Enter` ou `ArrowDown` abre o menu.
  * `ArrowUp` e `ArrowDown` navegam entre os itens.
  * `Escape` fecha o menu sem alterar o valor e restaura o foco no gatilho.
* **Label Obrigatório:** Sempre vincule um label ao gatilho via `id` ou envolva-o no `FormItem`. Em barras de filtro, se o rótulo não for visível, inclua-o com `.sr-only` (conforme padrão em [`EmpresasFilters.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/admin/empresas/EmpresasFilters.tsx)).

---

### 9.5 Anti-Patterns Catalogados em Selects

1. ❌ **Select Sem Placeholder:** Não informar `placeholder="Selecione..."` quando o valor inicial for nulo ou vazio, deixando o gatilho sem altura ou sem texto explicativo.
2. ❌ **Renderizar Valores Não-String em `SelectItem value`:** O Radix Select exige `value: string`. Passar objetos ou números diretamente gera bugs sutis. Se precisar de números (ex.: IDs numéricos), converta para string no Select e converta de volta no `onValueChange` (`Number(val)`).
3. ❌ **Usar Select para Listas de 100+ Itens:** O dropdown ficará excessivamente longo e pesado. Use `Combobox` com campo de busca textual e virtualização.
4. ❌ **Omitir Indicador de Seleção Atual:** Retirar o subcomponente `SelectItem` original que contém o ícone de `Check` de confirmação da opção selecionada.

---

## 10. PADRONIZAÇÃO CANÔNICA: TABLE & LISTAGENS DENSAS

A **Table** é o componente de exibição tabular de dados homogêneos de alta densidade no **Atlas Agenda** (listagem de empresas, clientes, agendamentos, cobranças e logs de auditoria).

### 10.1 Objetivo & Diretrizes de Uso

#### ✅ Quando Usar `Table`
* Para visualização comparativa de registros com 3 ou mais atributos estruturados (ex.: Nome, E-mail, Status, Valor, Ações).
* Para telas administrativas de auditoria, relatórios financeiros e gestão de cadastros.
* Quando o usuário precisa de ordenação por colunas, paginação e seleção rápida.

#### ❌ Quando NÃO Usar `Table`
* Para cartões de métricas individuais ou KPIs de dashboard (use `Card`).
* Diretamente em telas móveis sem adaptação responsiva (veja a regra abaixo).
* Para fluxos de formulários ou configurações passo-a-passo.

---

### 10.2 Regra de Ouro Responsiva: Tabela no Desktop vs Cards no Mobile

> [!IMPORTANT]
> **Proibição de rolagem horizontal forçada no mobile para listagens principais.**
> No Atlas Agenda, adota-se o padrão canônico estabelecido em [`EmpresasTable.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/admin/empresas/EmpresasTable.tsx):
> * **Desktop e Tablets (≥md):** Exibe a tabela tradicional (`Table`).
> * **Smartphones (<md):** O layout é automaticamente substituído por uma lista de Cards semânticos (`<ul className="space-y-3 md:hidden">`), garantindo legibilidade perfeita sem scroll horizontal quebrado.

---

### 10.3 Alinhamentos Semânticos & Tipografia em Tabelas

O alinhamento visual correto reduz a carga cognitiva e acelera a varredura visual dos dados:

| Tipo de Dado | Alinhamento (`TableHead` & `TableCell`) | Formatação Obrigatória |
| :--- | :--- | :--- |
| **Identificadores, Nomes e E-mails** | Esquerda (`text-left`) | `text-sm font-medium text-foreground` |
| **Status / Badges** | Esquerda ou Centro | [`StatusBadge`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/components/StatusBadge.tsx) |
| **Valores Monetários (BRL)** | Direita (`text-right`) | `tabular-nums font-semibold` |
| **Datas e Horários** | Direita (`text-right`) | `tabular-nums text-muted-foreground` |
| **Ações / Menus de Linha** | Direita (`text-right`) | Botões compactos (`size="sm"` ou `size="icon" variant="ghost"`) |

---

### 10.4 Estados de Carregamento & Dados Vazios (Zero CLS)

* **Estado de Carregamento (`loading`):** Utilize linhas com [`Skeleton`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/components/ui/skeleton.tsx) com a mesma quantidade de colunas e altura esperada das linhas reais. Isso elimina saltos visuais durante a requisição assíncrona.
* **Estado Vazio (`empty`):** Quando a query retornar zero registros, renderize uma linha única com `colSpan={totalColunas}` centralizada com mensagem clara em `pt-BR` e, quando apropriado, um botão de CTA para criar o primeiro registro.

---

### 10.5 Exemplo Completo de Referência: Tabela Responsiva com Skeleton

```tsx
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { MoreHorizontal } from "lucide-react";

interface Cliente {
  id: string;
  nome: string;
  telefoneFormatado: string;
  totalAgendamentos: number;
  status: "ativo" | "inativo";
}

interface ClientesTableProps {
  clientes: Cliente[];
  loading?: boolean;
  onEditar: (cliente: Cliente) => void;
}

export function ClientesTable({ clientes, loading, onEditar }: ClientesTableProps) {
  if (loading) {
    return (
      <div className="rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead className="text-right">Agendamentos</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 4 }).map((_, index) => (
              <TableRow key={index}>
                <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                <TableCell className="text-right"><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                <TableCell className="text-right"><Skeleton className="h-8 w-8 ml-auto rounded-full" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <>
      {/* Visualização Desktop (≥md) */}
      <div className="hidden rounded-lg border border-border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead className="text-right">Agendamentos</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clientes.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-32 text-center text-muted-foreground">
                  Nenhum cliente encontrado.
                </TableCell>
              </TableRow>
            ) : (
              clientes.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium text-foreground">{c.nome}</TableCell>
                  <TableCell className="text-muted-foreground">{c.telefoneFormatado}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.totalAgendamentos}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Editar ${c.nome}`}
                      onClick={() => onEditar(c)}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Visualização Mobile (<md): Cards de Lista */}
      <ul className="space-y-3 md:hidden">
        {clientes.length === 0 ? (
          <li className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Nenhum cliente encontrado.
          </li>
        ) : (
          clientes.map((c) => (
            <li key={c.id} className="rounded-lg border border-border bg-card p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground">{c.nome}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEditar(c)}
                >
                  Editar
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">{c.telefoneFormatado}</p>
              <div className="text-xs text-muted-foreground">
                Total de agendamentos: <span className="tabular-nums font-medium text-foreground">{c.totalAgendamentos}</span>
              </div>
            </li>
          ))
        )}
      </ul>
    </>
  );
}
```

---

### 10.6 Anti-Patterns Catalogados em Tabelas

1. ❌ **Números Alinhados à Esquerda:** Alinhar moedas, percentuais ou contagens à esquerda dificulta a comparação vertical de grandezas decimais.
2. ❌ **Omitir `colSpan` no Estado Vazio:** Renderizar `<TableCell>Vazio</TableCell>` sem `colSpan={N}`, encolhendo o texto na primeira coluna e desformatando o grid.
3. ❌ **Botões de Ação Gigantes em Cada Linha:** Inserir botões grandes com fundo colorido em todas as linhas, gerando poluição visual. Use botões `ghost` discretos ou `DropdownMenu`.
4. ❌ **Ignorar `tabular-nums` em Números e Datas:** Números que variam de largura geram desalinhamento sutil entre as linhas.

---

## 11. PADRONIZAÇÃO CANÔNICA: TABS (ABAS CONTEXTUAIS)

O componente **Tabs** permite organizar o conteúdo de uma mesma página em painéis contextuais alternáveis sem necessidade de recarregar a tela ou navegar para uma nova rota do browser.

### 11.1 Objetivo & Diretrizes de Uso

#### ✅ Quando Usar `Tabs`
* Para alternar entre visões complementares de uma mesma entidade (ex.: "Usuários Ativos" vs "Convites Pendentes" em [`AtivosTab.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/app/config/usuarios/AtivosTab.tsx) e [`ConvitesTab.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/app/config/usuarios/ConvitesTab.tsx)).
* Em painéis de configuração para separar categorias temáticas (ex.: "Geral", "Notificações", "Pagamento").
* Em relatórios para alternar entre "Visão Geral" e "Detalhamento por Profissional".

#### ❌ Quando NÃO Usar `Tabs`
* Para fluxos sequenciais passo-a-passo (use um componente de *Stepper* ou *Wizard*).
* Para navegação entre áreas de domínio totalmente distintas (use rotas com o menu lateral/navbar).
* Quando houver mais de 5 abas simultâneas (o layout ficará quebrado no mobile; prefira um Select ou navegação vertical).

---

### 11.2 Anatomia Canônica do Tabs

Baseado em [`src/components/ui/tabs.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/components/ui/tabs.tsx):

```tsx
<Tabs defaultValue="ativos" className="w-full space-y-6">
  <TabsList className="grid w-full grid-cols-2 sm:w-auto sm:inline-flex">
    <TabsTrigger value="ativos">Usuários Ativos (12)</TabsTrigger>
    <TabsTrigger value="convites">Convites Pendentes (3)</TabsTrigger>
  </TabsList>

  <TabsContent value="ativos" className="space-y-4">
    {/* Conteúdo da aba 1 */}
  </TabsContent>

  <TabsContent value="convites" className="space-y-4">
    {/* Conteúdo da aba 2 */}
  </TabsContent>
</Tabs>
```

---

### 11.3 Sincronização com URL (Query Params)

> [!TIP]
> Em telas de configuração ou relatórios onde o usuário compartilha links ou recarrega a página frequentemente, sincronize o estado da aba com a URL (`useSearchParams` do React Router). Isso garante que o usuário retorne exatamente à aba onde estava ao pressionar F5 ou compartilhar o link.

```tsx
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export function ConfigTabs() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get("aba") || "geral";

  return (
    <Tabs
      value={currentTab}
      onValueChange={(novaAba) => {
        setSearchParams((prev) => {
          prev.set("aba", novaAba);
          return prev;
        });
      }}
    >
      <TabsList>
        <TabsTrigger value="geral">Geral</TabsTrigger>
        <TabsTrigger value="horarios">Horários</TabsTrigger>
      </TabsList>
      <TabsContent value="geral">...</TabsContent>
      <TabsContent value="horarios">...</TabsContent>
    </Tabs>
  );
}
```

---

### 11.4 Acessibilidade & Navegação por Teclado (WCAG 2.1 AA)

* **Navegação com Setas Nativas:** Ao focar em um `TabsTrigger`, pressionar `ArrowLeft` ou `ArrowRight` navega diretamente para as abas adjacentes.
* **Semântica ARIA Automática:** O Radix Tabs injeta automaticamente `role="tablist"`, `role="tab"`, `role="tabpanel"`, além dos atributos `aria-selected` e `aria-controls`.

---

### 11.5 Anti-Patterns Catalogados em Tabs

1. ❌ **Abas Quebradas no Mobile:** Não configurar responsividade no `TabsList`. Use `grid w-full grid-cols-N sm:w-auto sm:inline-flex` para que em telas pequenas as abas se distribuam igualmente.
2. ❌ **Colocar Lógica Pesada que Recarrega Dados sem Cache:** Recarregar todas as queries do backend a cada alternância de aba. Prefira manter o cache via React Query ou gerenciar o estado localmente.
3. ❌ **Rótulos Longos Demais:** Usar frases inteiras no gatilho da aba (ex.: "Aqui você edita os horários dos profissionais"). Use termos concisos (ex.: "Horários").

---

## 12. PADRONIZAÇÃO CANÔNICA: SONNER / TOAST (NOTIFICAÇÕES ASSÍNCRONAS)

O **Toast** (implementado através da biblioteca `sonner` com estilização shadcn em [`src/components/ui/sonner.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/components/ui/sonner.tsx)) é o canal oficial de feedback não bloqueante para operações assíncronas no **Atlas Agenda**.

### 12.1 Objetivo & Diretrizes de Uso

#### ✅ Quando Usar `toast`
* **Confirmação de Sucesso em Mutações:** Após salvar, editar, criar ou excluir registros (ex.: `"Serviço criado."`, `"Assinatura atualizada."`).
* **Erros de Requisições Assíncronas:** Falhas de rede, 500s da API ou erros mapeados do domínio (ex.: `mapSchedulingError`, `mapWhatsAppError`).
* **Avisos Preventivos Não-Críticos:** Avisos contextuais (ex.: *"A sessão expirará em 5 minutos"*).
* **Feedback de Ações Rápidas da Área de Transferência:** Ao copiar chaves Pix, links de agendamento ou tokens (ex.: `"Link copiado!"`, `"Código copiado."`).

#### ❌ Quando NÃO Usar `toast`
* Para erros de validação campo-a-campo de formulário (use o `FormMessage` do Zod diretamente abaixo do input).
* Para mensagens críticas que exigem confirmação do usuário antes de continuar (use `Dialog`).
* Para indicar progresso contínuo de tarefas longas de fundo (use `Progress` ou painéis dedicados com `Skeleton`).

---

### 12.2 Configuração Central (`Toaster`)

O componente `<Toaster />` é instanciado uma única vez na raiz da aplicação em [`src/components/RootLayout.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/components/RootLayout.tsx):

* Os estilos herdam nativamente as CSS variables do sistema (`bg-card`, `text-card-foreground`, `border-border`, `shadow-lg`).
* O suporte ao tema claro e escuro é automático através da classe `.dark` no elemento raiz `<html>`.
* A posição canônica no sistema é o canto superior ou inferior direito (`top-right` ou `bottom-right`), evitando sobreposição com elementos vitais de navegação.

---

### 12.3 Padrão Canônico de Mensagens em pt-BR

No Atlas Agenda, aplicamos uma política de redação consistente em todos os módulos:

```tsx
import { toast } from "sonner";
import { mapSchedulingError } from "@/hooks/useAppointments";

// 1. Sucesso: Frase curta, afirmativa e sempre finalizada com ponto final.
toast.success("Agendamento criado.");
toast.success("Cliente salvo.");
toast.success("Link copiado!");

// 2. Erro: Amigável e orientada a ação futura. Integrada aos mappers do domínio.
try {
  await salvarAgendamento(dados);
  toast.success("Agendamento confirmado.");
} catch (error) {
  // Sempre preferir mapper de erro do domínio se existir:
  toast.error(mapSchedulingError(error));
  // Ou fallback amigável:
  // toast.error("Não foi possível salvar o agendamento. Tente novamente.");
}

// 3. Aviso (Warning): Situações parciais ou cuidados.
toast.warning("Alteração salva, mas a sincronização com o WhatsApp está pausada.");

// 4. Informação (Info): Atualizações contextuais de leitura.
toast.info("A grade de horários foi atualizada por outro operador.");
```

---

### 12.4 Toasts com Promessa Assíncrona (`toast.promise`)

Para operações com tempo de resposta perceptível (geração de cobrança PIX, sincronização de mensagens), utilize `toast.promise` para exibir estados concatenados (carregando → sucesso ou erro):

```tsx
import { toast } from "sonner";

toast.promise(gerarCobrancaPix(agendamentoId), {
  loading: "Gerando cobrança PIX...",
  success: "Cobrança gerada com sucesso!",
  error: (err) => err?.message || "Não foi possível gerar a cobrança. Tente novamente.",
});
```

---

### 12.5 Toasts com Ações Interativas (Desfazer / Retry)

Quando a ação do usuário permitir reversão imediata ou retentativa:

```tsx
toast.success("Cliente arquivado.", {
  action: {
    label: "Desfazer",
    onClick: () => desarquivarCliente(clienteId),
  },
});
```

---

### 12.6 Acessibilidade (WCAG 2.1 AA) em Notificações

* **Regiões Vivas (Live Regions):** O Sonner injeta automaticamente regiões com `role="status"` para sucessos/infos (lidos de forma polida `aria-live="polite"`) e `role="alert"` para erros (lidos com prioridade imediata `aria-live="assertive"`).
* **Tempo de Permanência Confortável:** O tempo padrão de exibição (4 segundos) permite leitura sem pressa. Toasts com botão de ação ou textos mais extensos devem receber duração estendida (`duration: 6000`).
* **Redução de Movimento:** As animações de entrada/saída respeitam nativamente a preferência do sistema operacional (`prefers-reduced-motion`).

---

### 12.7 Anti-Patterns Catalogados em Toasts

1. ❌ **Lançar Toast para Cada Campo Inválido:** Disparar 5 toasts seguidos quando o usuário submete um formulário com 5 campos vazios. Use validação inline no formulário (`FormMessage`).
2. ❌ **Mensagens Cruas de Erro do Backend:** Exibir erros como `"Internal Server Error: 500"` ou `"PostgresError: duplicate key value violates unique constraint"`. Sempre trate com mapeadores do domínio (`mapWhatsAppError`, `mapAuthError`).
3. ❌ **Excesso de Texto sem Ponto:** Textos truncados ou longos parágrafos explicativos dentro de um toast. Mantenha o texto com até 2 linhas.
4. ❌ **Toasts sem Limpeza ao Trocar de Tela Crítica:** Não dispensar toasts antigos ao deslogar ou mudar de tenant (`toast.dismiss()`).

---

## 13. PADRONIZAÇÃO CANÔNICA: BADGE & STATUSBADGE

Os **Badges** são indicadores visuais compactos utilizados para categorizar itens, exibir contagens ou comunicar o estado de entidades do negócio (como agendamentos e assinaturas).

### 13.1 Objetivo & Diretrizes de Uso

#### ✅ Quando Usar `Badge` ou `StatusBadge`
* Para comunicar o estado atual de um agendamento (`pendente`, `confirmado`, `em_atendimento`, `concluido`, `cancelado`, `nao_compareceu`).
* Para comunicar a situação cadastral da empresa (`trial`, `ativo`, `bloqueado`, etc.).
* Para indicar tags complementares de serviço (ex.: `"Recomendado"`, `"Pacote/Combo"`).
* Para exibir confirmação de WhatsApp (`ClientConfirmedBadge`).

#### ❌ Quando NÃO Usar `Badge`
* Como botão interativo ou link clicável com estilo de botão (use `Button size="sm"` ou `Button variant="outline"`).
* Para blocos de texto explicativo com mais de 3 palavras.
* Como simples contador em itens de formulário sem papel semântico de status.

---

### 13.2 Badge Genérico (`badgeVariants`)

O componente base [`src/components/ui/badge.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/components/ui/badge.tsx) é utilizado para categorizações gerais e tags de produto:

```tsx
import { Badge } from "@/components/ui/badge";

<Badge variant="default">Padrão Primário</Badge>
<Badge variant="secondary">Secundário Neutro</Badge>
<Badge variant="outline">Contorno Delicado</Badge>
<Badge variant="destructive">Alerta / Crítico</Badge>
```

---

### 13.3 StatusBadge de Domínio (Theme-Aware & Fonte Única)

> [!IMPORTANT]
> **Nunca estilize status de agendamento ou assinatura com cores inline ou ad-hoc.**
> No Atlas Agenda, todo status de agendamento ou assinatura deve consumir obrigatoriamente [`src/components/StatusBadge.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/components/StatusBadge.tsx).

O `StatusBadge` possui tokens CSS dedicados (`--status-*`), garantindo taxas de contraste rigorosas que alternam automaticamente entre os temas Claro e Escuro (`.dark`):

| Estado | Token Tailwind | Rótulo pt-BR Canônico | Significado Operacional |
| :--- | :--- | :--- | :--- |
| **`pendente`** | `bg-status-pendente text-status-pendente-fg` | `"Pendente"` | Aguardando confirmação ou pagamento |
| **`confirmado`** | `bg-status-confirmado text-status-confirmado-fg` | `"Confirmado"` | Agendamento confirmado pelo cliente/sistema |
| **`em_atendimento`** | `bg-status-em-atendimento text-status-em-atendimento-fg` | `"Em atendimento"` | Cliente sendo atendido no momento |
| **`concluido`** | `bg-status-concluido text-status-concluido-fg` | `"Concluído"` | Serviço finalizado com sucesso |
| **`cancelado`** | `bg-status-cancelado text-status-cancelado-fg` | `"Cancelado"` | Cancelado pelo operador ou cliente |
| **`nao_compareceu`** | `bg-status-nao-compareceu text-status-nao-compareceu-fg` | `"Não compareceu"` | No-show registrado |

#### Fonte Única de Rótulos (Single Source of Truth):
Para menus de troca de status, filtros e selects, reutilize sempre as funções exportadas:
```tsx
import { getAppointmentStatusLabel, getSubscriptionStatusLabel } from "@/components/StatusBadge";

// Retorna sempre "Confirmado", "Em atendimento", etc.
const label = getAppointmentStatusLabel("confirmado");
```

---

### 13.4 Acessibilidade (WCAG 2.1 AA) em Badges

1. **A Cor Nunca é o Único Sinalizador (WCAG 1.4.1):**
   Um badge de status **sempre** inclui o texto do estado em português legível dentro dele (nunca use apenas uma bolinha verde ou vermelha sem texto explicativo).
2. **Contraste Mínimo:**
   Os pares de cor `bg-status-*` e `text-status-*-foreground` foram calibrados para garantir contraste superior a 4.5:1 tanto no tema claro quanto no escuro.
3. **Leitores de Tela:**
   Quando um badge complementar possuir apenas ícones ou reforço visual (ex.: trial vencido), inclua `aria-label` descritivo (ex.: `aria-label="Trial vencido"`).

---

### 13.5 Anti-Patterns Catalogados em Badges

1. ❌ **Cores Semânticas Hardcoded:** Usar classes utilitárias genéricas como `bg-green-100 text-green-800` ou `bg-red-500`. Elas quebram no tema escuro e divergem da identidade do sistema. Use os tokens dedicados do `StatusBadge`.
2. ❌ **Duplicar Textos de Status:** Escrever `"Em Atendimento"` em uma tela e `"Atendendo"` em outra. Use sempre `getAppointmentStatusLabel`.
3. ❌ **Tornar o Badge Clicável Sem Papel de Botão:** Adicionar `onClick` no badge sem `role="button"`, sem `tabIndex={0}` e sem anel de foco.

---

## 14. PADRONIZAÇÃO CANÔNICA: TOOLTIP (INFORMAÇÕES CONTEXTUAIS)

O **Tooltip** é um balão de contexto flutuante acionado por foco de teclado ou hover do mouse em [`src/components/ui/tooltip.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/components/ui/tooltip.tsx). Ele provê micro-explicações rápidas sem ocupar espaço permanente na interface.

### 14.1 Objetivo & Diretrizes de Uso

#### ✅ Quando Usar `Tooltip`
* **Botões de Apenas Ícone:** Para rotular a ação de botões compactos na barra de ferramentas ou em linhas de tabela (ex.: botão de lixeira → *"Excluir agendamento"*).
* **Explicação de Termos / Siglas Técnicas:** Para esclarecer termos como *"No-show"*, *"Taxa de ocupação"* ou dados de auditoria.
* **Textos Truncados:** Para exibir o valor completo de um e-mail ou nome longo quando houver reticências (`truncate`).

#### ❌ Quando NÃO Usar `Tooltip`
* Para informações vitais que o usuário precisa obrigatoriamente ler para concluir um formulário (em dispositivos touch não há hover; use `FormDescription` inline).
* Para mensagens de erro de formulário (use `FormMessage`).
* Para conteúdos interativos que contenham links ou botões internos (use `Popover` ou `DropdownMenu`).

---

### 14.2 Anatomia Canônica do Tooltip

```tsx
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { HelpCircle } from "lucide-react";

export function AjudaCampo({ texto }: { texto: string }) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
            aria-label="Mais informações"
          >
            <HelpCircle className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          {texto}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
```

---

### 14.3 Acessibilidade & Critérios de Sucesso (WCAG 2.1 AA)

* **Disparo Duplo (Hover & Focus):** O tooltip é ativado automaticamente tanto ao passar o cursor (`mouseenter`) quanto ao navegar com a tecla `Tab` (`focus`).
* **Tecla `Escape`:** Pressionar `Escape` fecha o tooltip instantaneamente sem mover o foco do elemento.
* **Hoverable Content (WCAG 1.4.13):** O usuário pode mover o ponteiro do mouse sobre o próprio conteúdo do tooltip sem que ele desapareça involuntariamente.
* **Delay Apropriado:** Usamos `delayDuration={300}` (300 milissegundos) para evitar que múltiplos tooltips fiquem piscando enquanto o usuário apenas cruza a tela com o cursor.

---

### 14.4 Anti-Patterns Catalogados em Tooltips

1. ❌ **Esconder Instruções Obrigatórias Dentro de Tooltips:** Colocar regras essenciais de preenchimento de campo que usuários em smartphones não conseguirão acessar por falta de cursor de mouse.
2. ❌ **Colocar Elementos Clicáveis Dentro de `TooltipContent`:** Tooltips fecham ao perder foco/hover; elementos interativos devem residir em `Popover` ou `Dialog`.
3. ❌ **Trigger Não Focável:** Colocar `TooltipTrigger` em uma `<span>` ou `<div>` sem `tabIndex={0}`, impedindo que usuários que navegam por teclado acessem o tooltip. Sempre envolva elementos focáveis (`Button`, `<button>`, `<Link>`).

---

## 15. PADRONIZAÇÃO CANÔNICA: DROPDOWN MENU (AÇÕES CONTEXTUAIS)

O **DropdownMenu** é o componente responsável por exibir um menu flutuante de ações ou comandos disparados por um botão em [`src/components/ui/dropdown-menu.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/components/ui/dropdown-menu.tsx).

### 15.1 Objetivo & Diretrizes de Uso

#### ✅ Quando Usar `DropdownMenu`
* **Ações em Linhas de Tabelas:** O clássico botão "três pontinhos" (`MoreHorizontal`) que agrupa opções como *"Editar"*, *"Visualizar Histórico"*, *"Duplicar"* e *"Excluir"*.
* **Menu de Perfil / Usuário:** No cabeçalho da aplicação para exibir nome do usuário, alternância de tema e botão *"Sair"* (ex.: [`UserMenu.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/components/UserMenu.tsx)).
* **Transições de Status:** Menus de troca de estado de entidades operacionais.

#### ❌ Quando NÃO Usar `DropdownMenu`
* Para seleção de valores em um formulário (use `Select`).
* Para menus de navegação primária com muitas páginas (use a sidebar ou navbar).
* Para confirmações de ações perigosas (o menu dispara o `Dialog` de confirmação, não o substitui).

---

### 15.2 Padrões Oficiais de DropdownMenu no Atlas Agenda

#### 📋 Padrão 1: Ações em Linhas de Tabelas

Utilizado na coluna "Ações" de tabelas administrativas e de agendamento:

```tsx
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { MoreHorizontal, Edit, Eye, Trash2 } from "lucide-react";

export function LinhaAcoesMenu({ onEditar, onVerDetalhes, onExcluir }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Abrir menu de ações">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Ações</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onEditar}>
          <Edit className="mr-2 h-4 w-4" />
          <span>Editar</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onVerDetalhes}>
          <Eye className="mr-2 h-4 w-4" />
          <span>Ver detalhes</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={onExcluir}
          className="text-destructive focus:bg-destructive/10 focus:text-destructive"
        >
          <Trash2 className="mr-2 h-4 w-4" />
          <span>Excluir</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

#### 👤 Padrão 2: Menu da Conta do Usuário (`UserMenu`)

Baseado em [`src/components/UserMenu.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/components/UserMenu.tsx), utilizado no topbar:

* **Exibição do E-mail Autenticado:** Em `DropdownMenuLabel` com `truncate font-normal text-muted-foreground` para comprovação visual imediata de sessão ativa.
* **Ação de Logout Controlada:** `DropdownMenuItem` usando `onSelect` conectado à mutação de saída e estado `disabled={isPending}` durante a requisição.

```tsx
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { LogOut, UserRound } from "lucide-react";

export function AccountMenu({ email, onSignOut, signingOut }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Abrir menu da conta">
          <UserRound className="h-4 w-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
          {email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSignOut} disabled={signingOut}>
          <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
          <span>{signingOut ? "Saindo..." : "Sair"}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

---

### 15.3 Alinhamento, Posição & Acessibilidade (WCAG 2.1 AA)

* **Alinhamento na Tabela (`align="end"`):** Em tabelas ou botões posicionados no canto direito, use sempre `align="end"` para garantir que o menu abra para a esquerda, sem vazar a lateral da tela.
* **Ações Críticas:** Itens que removem registros devem ter classes visuais de alerta (`text-destructive focus:bg-destructive/10 focus:text-destructive`).
* **Navegação com Teclado:**
  * `Space` ou `Enter` abre o menu e foca no primeiro item.
  * Setas para cima e para baixo percorrem os itens.
  * Digitação rápida pula diretamente para o item cuja primeira letra coincide.
  * `Escape` fecha o menu e devolve o foco imediatamente ao botão acionador.

---

### 15.4 Anti-Patterns Catalogados em DropdownMenu

1. ❌ **Usar DropdownMenu como Select:** Tentar salvar um estado de formulário controlando itens do DropdownMenu. Use sempre `Select` para campos de dados.
2. ❌ **Executar Ação Destrutiva Sem Confirmação:** Clicar em "Excluir" no menu e apagar o registro imediatamente. O item do menu deve abrir o `Dialog` de confirmação destrutiva.
3. ❌ **Trigger de Ícone Sem `aria-label`:** Deixar o botão acionador apenas com `<MoreHorizontal />` sem `aria-label="Abrir menu de ações"`.

---

## 16. PADRONIZAÇÃO CANÔNICA: SWITCH & CHECKBOX (CONTROLES BOOLEANOS & LGPD)

Os componentes **Switch** ([`src/components/ui/switch.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/components/ui/switch.tsx)) e **Checkbox** ([`src/components/ui/checkbox.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/components/ui/checkbox.tsx)) representam estados binários (verdadeiro/falso, ativado/desativado).

### 16.1 Diferenciação Arquitetural: Quando Usar Cada Um

| Controle | Comportamento Esperado | Exemplos no Atlas Agenda |
| :--- | :--- | :--- |
| **`Switch`** | **Efeito imediato de liga/desliga** ou preferências autônomas que ativam/desativam uma funcionalidade instantaneamente. | Ativação de canal WhatsApp, modo escuro, opt-in de mensagens LGPD em formulário de cliente. |
| **`Checkbox`** | **Seleção de item em lote** ou confirmação formal necessária para submeter um formulário maior. | Selecionar múltiplos agendamentos em tabela para cancelar em massa, "Li e aceito os termos". |

---

### 16.2 Regra Inegociável: LGPD & Consentimento Ativo

> [!IMPORTANT]
> **Consentimento LGPD nasce SEMPRE desligado (`false`).**
> No Atlas Agenda (conforme arquitetado em [`CustomerFormDialog.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/app/clientes/CustomerFormDialog.tsx)), o consentimento para envio de notificações por WhatsApp (`whatsapp_opt_in`) ou marketing **nunca pode ser presumido** ou nascer pré-marcado.
> * A copy deve ser explícita, transparente e em português claro.
> * O campo deve ser acionado por iniciativa consciente do operador ou cliente.

---

### 16.3 Exemplo Completo de Referência: Switch LGPD em Formulário Zod

```tsx
import { FormField, FormItem, FormLabel, FormControl, FormDescription } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";

<FormField
  control={form.control}
  name="whatsappOptIn"
  render={({ field }) => (
    <FormItem className="flex flex-row items-center justify-between rounded-lg border border-border p-4 shadow-sm">
      <div className="space-y-0.5">
        <FormLabel className="text-base font-medium">
          Receber lembretes por WhatsApp
        </FormLabel>
        <FormDescription>
          O cliente autoriza o envio automático de confirmação e lembretes de horário (LGPD).
        </FormDescription>
      </div>
      <FormControl>
        <Switch
          checked={field.value}
          onCheckedChange={field.onChange}
          aria-label="Autorizar lembretes por WhatsApp"
        />
      </FormControl>
    </FormItem>
  )}
/>
```

---

### 16.4 Acessibilidade & Áreas de Toque (WCAG 2.1 AA)

1. **Target Size Confortável:**
   Em smartphones, controles pequenos podem ser difíceis de acionar. A anatomia recomendada envolve o Switch ou Checkbox em um container flexível com `p-3` ou `p-4`, permitindo que o toque em qualquer parte do bloco acione o controle.
2. **Associação de Label:**
   O texto descritivo deve estar vinculado ao controle via `FormLabel` ou `htmlFor`, garantindo que o leitor de tela anuncie o rótulo ao focar no controle.

---

### 16.5 Anti-Patterns Catalogados

1. ❌ **Consentimento Pré-Marcado:** Iniciar formulários de novos clientes com `whatsappOptIn: true`. Violação das regras de LGPD do sistema.
2. ❌ **Switch Sem Rótulo Acessível:** Instanciar `<Switch />` isolado sem texto associado e sem `aria-label`.
3. ❌ **Usar Switch no Lugar de Checkbox em Tabelas de Ações em Lote:** O Switch transmite a ideia de que a ação ocorre instantaneamente no banco de dados. Para selecionar itens antes de clicar num botão "Excluir Selecionados", use `Checkbox`.

---

## 17. PADRONIZAÇÃO CANÔNICA: AVATAR (REPRESENTAÇÃO DE USUÁRIOS E EMPRESAS)

O **Avatar** é o componente responsável pela identificação visual de profissionais, clientes e tenants em [`src/components/ui/avatar.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/components/ui/avatar.tsx). Ele provê transição transparente e sem falhas entre a imagem fotográfica e as iniciais do nome com alto contraste.

### 17.1 Objetivo & Diretrizes de Uso

#### ✅ Quando Usar `Avatar`
* **Seleção de Profissional no Agendamento:** Em listas e botões de escolha de especialista (ex.: [`AgendarPage.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/public/AgendarPage.tsx)).
* **Identificação de Empresas/Tenants:** No cabeçalho da agenda pública e no painel administrativo.
* **Tabelas de Clientes e Membros:** Para dar identidade visual às linhas de cadastro.
* **Topbar e Menu do Usuário:** Para indicar quem está logado.

#### ❌ Quando NÃO Usar `Avatar`
* Para simples ícones decorativos ou ilustrações conceituais (use ícones diretos de `lucide-react`).
* Como botão interativo sem wrapper acessível (use `<Button asChild>` ou envolva com `<button>` com `aria-label`).

---

### 17.2 Anatomia Canônica do Avatar

Baseado no Radix Avatar:

```tsx
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

<Avatar className="h-10 w-10">
  <AvatarImage src={fotoUrl} alt={nome} />
  <AvatarFallback>{getInitials(nome)}</AvatarFallback>
</Avatar>
```

#### Regras dos Subcomponentes:
1. **`Avatar`:** Container circular com recorte estrito (`relative flex shrink-0 overflow-hidden rounded-full`).
2. **`AvatarImage`:** Imagem do usuário com proporção quadrada (`aspect-square h-full w-full`). O Radix oculta automaticamente a imagem caso o link seja inválido, quebre ou demore a responder.
3. **`AvatarFallback`:** Renderizado instantaneamente caso a imagem não exista ou esteja carregando (`bg-muted text-foreground text-sm font-medium`).

---

### 17.3 Função Canônica de Iniciais (`getInitials`)

> [!IMPORTANT]
> **Nunca pegue apenas a primeira letra isolada.**
> Para evitar ambiguidade visual, extraia a primeira letra do primeiro nome e a primeira letra do último sobrenome (máximo de 2 caracteres maiúsculos).

```typescript
/**
 * Extrai até 2 iniciais do nome para o AvatarFallback.
 * Ex.: "João Silva" → "JS", "Atlas Agenda" → "AA", "Carlos" → "C".
 */
export function getInitials(name?: string | null): string {
  if (!name || !name.trim()) return "—";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  const first = parts[0][0];
  const last = parts[parts.length - 1][0];
  return `${first}${last}`.toUpperCase();
}
```

---

### 17.4 Escala de Tamanhos & Cores Padronizadas

| Tamanho | Classes Tailwind | Uso Recomendado no Atlas Agenda |
| :--- | :--- | :--- |
| **Pequeno (`sm`)** | `h-8 w-8 text-xs` | Células de tabelas densas, comentários e logs de auditoria |
| **Médio (`default`)** | `h-10 w-10 text-sm` | Botões de seleção de profissional em [`AgendarPage.tsx`](file:///home/joao/fusionlf/wsProjeto/atlas-agenda/src/public/AgendarPage.tsx) e listas gerais |
| **Grande (`lg`)** | `h-12 w-12 text-base` | Cabeçalho da página pública do tenant e cards de perfil |
| **Extra Grande (`xl`)** | `h-16 w-16 text-lg` | Telas de edição de perfil e upload de foto da empresa |

#### Cores Semânticas do `AvatarFallback`:
* **Empresa / Tenant:** `bg-primary text-primary-foreground font-semibold` (destaque de marca).
* **Profissionais e Clientes:** `bg-muted text-foreground font-medium` (tom neutro e elegante com alto contraste).

---

### 17.5 Acessibilidade (WCAG 2.1 AA) em Avatares

* **Texto Alternativo (`alt`):** O `<AvatarImage>` deve carregar sempre `alt={nome}`.
* **Prevenção de Leitura Duplicada:** Quando o Avatar for exibido ao lado do nome da pessoa em texto (ex.: botão do profissional ou linha da tabela), adicione `aria-hidden="true"` no `<Avatar>`. Dessa forma, o leitor de tela anuncia apenas *"João Silva"* e não lê *"JS João Silva"*.

---

### 17.6 Anti-Patterns Catalogados em Avatares

1. ❌ **Avatar Quebrado com Ícone de Imagem Quebrada:** Usar tag `<img>` comum sem componente de Fallback. O Radix Avatar garante que o fallback de iniciais apareça sem nenhum flash de imagem quebrada do navegador.
2. ❌ **Iniciais com 3 ou 4 Letras:** Escrever "JMSN" dentro de um círculo pequeno. O texto transborda e fica ilegível. Limite a 2 letras.
3. ❌ **Avatar Clicável Sem Tag Acessível:** Adicionar `onClick` diretamente na `div` do Avatar sem `role="button"`, sem `tabIndex={0}` e sem foco acessível.

---

## 18. Conclusão & Próximas Iterações

Com a padronização do **Avatar**, o guia consolida a anatomia, acessibilidade, tokens e templates dos **14 elementos fundamentais** que compõem o sistema **Atlas Agenda**.

- Elementos utilitários menores para referência rápida:
  - **Separator (`separator.tsx`):** Linhas de divisão semânticas (`role="separator"`, `orientation="horizontal" | "vertical"`).
  - **Skeleton (`skeleton.tsx`):** Blocos pulsantes com animação suave para estados de carregamento assíncrono.









