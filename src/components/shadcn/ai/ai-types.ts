export interface AIModelOption {
  id: string
  name: string
  provider: string
  badge: string
  contextWindow: number
  supportsReasoning: boolean
}

export interface AIAgentPersona {
  id: string
  name: string
  role: string
  description: string
  systemBadge: string
}

export type AIToolStatus =
  | "running"
  | "completed"
  | "awaiting_approval"
  | "rejected"
  | "error"

export interface AIToolCall {
  id: string
  name: string
  label: string
  status: AIToolStatus
  durationMs?: number
  input: Record<string, unknown>
  output?: Record<string, unknown>
  requiresConfirmation?: boolean
  confirmationSummary?: string
  impactAmount?: string
}

export type AIPlanStepStatus = "completed" | "in_progress" | "pending"

export interface AIPlanStep {
  id: string
  label: string
  status: AIPlanStepStatus
  detail?: string
}

export type AISourceType = "database" | "document" | "open_finance" | "fiscal"

export interface AISourceCitation {
  id: string
  index: number
  title: string
  sourceType: AISourceType
  reference: string
  snippet: string
  updatedAt: string
}

export type AIArtifactType =
  | "financial_table"
  | "dre_report"
  | "sql_query"
  | "reconciliation_diff"

export interface AIArtifactMetric {
  label: string
  value: string
  trend?: "up" | "down" | "neutral"
}

export interface AIArtifact {
  id: string
  title: string
  subtitle: string
  type: AIArtifactType
  version: string
  updatedAt: string
  summaryMetrics?: AIArtifactMetric[]
  tableData?: {
    headers: string[]
    rows: string[][]
  }
  codeContent?: string
  language?: string
}

export interface AIMessage {
  id: string
  role: "user" | "assistant"
  content: string
  createdAt: string
  modelId?: string
  tokensUsed?: number
  latencyMs?: number
  contextChips?: string[]
  reasoning?: {
    durationSeconds: number
    steps: string[]
  }
  plan?: {
    title: string
    steps: AIPlanStep[]
  }
  toolCalls?: AIToolCall[]
  sources?: AISourceCitation[]
  artifactId?: string
  isCheckpoint?: boolean
  feedback?: "up" | "down" | null
}

export interface AIConversationThread {
  id: string
  title: string
  personaId: string
  updatedAt: string
  pinned?: boolean
  totalTokens: number
  messages: AIMessage[]
  artifacts: AIArtifact[]
}

export interface AIPromptSuggestion {
  id: string
  title: string
  prompt: string
  category: string
  badge: string
}

export interface AISlashCommand {
  command: string
  label: string
  description: string
  templatePrompt: string
}

export const AI_MODELS: AIModelOption[] = [
  {
    id: "claude-4-5-sonnet",
    name: "Claude 4.5 Sonnet",
    provider: "Anthropic",
    badge: "Precisão",
    contextWindow: 200000,
    supportsReasoning: true,
  },
  {
    id: "gemini-2-5-pro",
    name: "Gemini 2.5 Pro",
    provider: "Google",
    badge: "Contexto 1M",
    contextWindow: 1000000,
    supportsReasoning: true,
  },
  {
    id: "gpt-5-thinking",
    name: "GPT-5 Thinking",
    provider: "OpenAI",
    badge: "Raciocínio",
    contextWindow: 128000,
    supportsReasoning: true,
  },
  {
    id: "atlas-fin-small",
    name: "Atlas Fin-1 Fast",
    provider: "Atlas Core",
    badge: "Rápido",
    contextWindow: 64000,
    supportsReasoning: false,
  },
]

export const AI_PERSONAS: AIAgentPersona[] = [
  {
    id: "financial-copilot",
    name: "Copiloto Financeiro",
    role: "Controladoria & DRE",
    description: "Analisa fluxo de caixa, fechamento contábil e projeções financeiras.",
    systemBadge: "ERP Core",
  },
  {
    id: "tax-auditor",
    name: "Auditor Fiscal & NFC-e",
    role: "Compliance Tributário",
    description: "Inspeciona rejeições SEFAZ, CFOP/NCM, alíquotas e documentos fiscais.",
    systemBadge: "SEFAZ / Fiscal",
  },
  {
    id: "treasury-analyst",
    name: "Analista de Tesouraria",
    role: "Bancos & Open Finance",
    description: "Monitora saldos em tempo real, rendimentos CDI e transferências.",
    systemBadge: "Open Finance",
  },
  {
    id: "reconciliation-agent",
    name: "Agente de Conciliação",
    role: "OFX & Cartões",
    description: "Cruza extratos bancários com faturas e lança baixas sob aprovação.",
    systemBadge: "Conciliador",
  },
]

export const AI_AVAILABLE_CONTEXTS: string[] = [
  "@Contas Bancárias",
  "@Cartões Corporativos",
  "@DRE Nov/2026",
  "@Extrato OFX Itaú",
  "@PDV NFC-e Série 001",
  "@Transações Pendentes",
]

export const AI_SLASH_COMMANDS: AISlashCommand[] = [
  {
    command: "/conciliar",
    label: "Conciliar Extrato OFX",
    description: "Cruza lançamentos bancários pendentes com o contas a pagar/receber.",
    templatePrompt: "Execute a conciliação dos lançamentos OFX pendentes em @Contas Bancárias e proponha um lote de baixa para revisão.",
  },
  {
    command: "/dre",
    label: "Gerar DRE Comparativo",
    description: "Monta a Demonstração de Resultado do Exercício por centro de custo.",
    templatePrompt: "Gere um relatório DRE comparativo de Outubro vs. Novembro/2026 destacando receitas, custos variáveis e margem líquida.",
  },
  {
    command: "/auditar-cartoes",
    label: "Auditar Faturas de Cartão",
    description: "Detecta cobranças recorrentes duplicadas e variações atípicas.",
    templatePrompt: "Audite @Cartões Corporativos procurando assinaturas duplicadas, variação cambial e gastos fora da política.",
  },
  {
    command: "/sql",
    label: "Gerar Consulta SQL Segura",
    description: "Cria query analítica read-only para o banco financeiro Atlas.",
    templatePrompt: "Escreva uma consulta SQL read-only para listar os 15 maiores fornecedores por volume liquidado nos últimos 90 dias.",
  },
]

export const MOCK_AI_SUGGESTIONS: AIPromptSuggestion[] = [
  {
    id: "sug-1",
    title: "Conciliar pendências de Novembro",
    prompt: "Compare os lançamentos pendentes do extrato Open Finance com as transações do mês e gere um lote de conciliação para eu aprovar.",
    category: "Tesouraria",
    badge: "Ação + Aprovação",
  },
  {
    id: "sug-2",
    title: "Auditar variações nos cartões PJ",
    prompt: "Analise as faturas de cartões corporativos de Novembro e aponte assinaturas SaaS duplicadas ou taxas de IOF acima da média.",
    category: "Cartões",
    badge: "Auditoria",
  },
  {
    id: "sug-3",
    title: "Diagnóstico de rejeições NFC-e",
    prompt: "Verifique os códigos de rejeição mais recentes no PDV Série 001 e proponha correção nos cadastros fiscais.",
    category: "Fiscal & PDV",
    badge: "SEFAZ",
  },
  {
    id: "sug-4",
    title: "Gerar DRE Executivo em tabela",
    prompt: "Construa a DRE gerencial consolidada do trimestre em artefato tabular com margem EBITDA e variação percentual.",
    category: "Controladoria",
    badge: "Artefato",
  },
]

export const MOCK_AI_THREADS: AIConversationThread[] = [
  {
    id: "thread-dre-fechamento",
    title: "Auditoria de Fechamento & Conciliação Out/Nov",
    personaId: "financial-copilot",
    updatedAt: "Agora mesmo",
    pinned: true,
    totalTokens: 18420,
    artifacts: [
      {
        id: "art-dre-nov-2026",
        title: "DRE Gerencial & Fluxo de Caixa Consolidado",
        subtitle: "Competência Out/Nov 2026 • Todas as contas e cartões PJ",
        type: "dre_report",
        version: "v2",
        updatedAt: "16/11/2026 19:58",
        summaryMetrics: [
          { label: "Receita Bruta", value: "R$ 482.910,00", trend: "up" },
          { label: "Margem Líquida", value: "31,4%", trend: "up" },
          { label: "Pendências OFX", value: "R$ 14.850,00", trend: "neutral" },
        ],
        tableData: {
          headers: ["Linha Gerencial", "Out/2026", "Nov/2026 (Prév.)", "Variação"],
          rows: [
            ["Receita Operacional Bruta", "R$ 438.200,00", "R$ 482.910,00", "+10,2%"],
            ["Deduções e Impostos (Simples/ISS)", "- R$ 39.438,00", "- R$ 43.461,90", "+10,2%"],
            ["Custos Diretos & Adquirência", "- R$ 118.400,00", "- R$ 124.180,00", "+4,9%"],
            ["Despesas Cartões Corporativos", "- R$ 42.190,00", "- R$ 38.740,00", "-8,2%"],
            ["Folha e Encargos Operacionais", "- R$ 104.500,00", "- R$ 104.500,00", "0,0%"],
            ["Infraestrutura Cloud & SaaS", "- R$ 18.620,00", "- R$ 20.380,00", "+9,5%"],
            ["Resultado Líquido do Período", "R$ 115.052,00", "R$ 151.648,10", "+31,8%"],
          ],
        },
        codeContent: `-- Consulta consolidada usada para compor a DRE Gerencial v2
SELECT
  date_trunc('month', competence_date) AS competencia,
  account_group AS grupo_contabil,
  COUNT(*) AS qtd_lancamentos,
  SUM(CASE WHEN type = 'credit' THEN amount ELSE -amount END) AS saldo_liquido
FROM ledger_entries
WHERE competence_date >= '2026-10-01'
  AND status IN ('reconciled', 'pending_review')
GROUP BY 1, 2
ORDER BY 1 DESC, ABS(SUM(amount)) DESC;`,
        language: "sql",
      },
    ],
    messages: [
      {
        id: "msg-1",
        role: "user",
        createdAt: "19:56",
        contextChips: ["@Contas Bancárias", "@Cartões Corporativos"],
        content:
          "Preciso fechar a prévia de Novembro. Compare as entradas das contas bancárias com os gastos dos cartões corporativos, identifique lançamentos OFX ainda não conciliados e gere o DRE consolidado.",
      },
      {
        id: "msg-2",
        role: "assistant",
        createdAt: "19:58",
        modelId: "claude-4-5-sonnet",
        tokensUsed: 1842,
        latencyMs: 3840,
        isCheckpoint: true,
        feedback: "up",
        reasoning: {
          durationSeconds: 3.8,
          steps: [
            "Identificado escopo de duas fontes: @Contas Bancárias (Itaú Matriz + BTG Tesouraria) e @Cartões Corporativos.",
            "Consultando saldos e extratos Open Finance de 01/10/2026 até 16/11/2026 para pareamento por data-valor.",
            "Detectados 4 lançamentos OFX no Itaú Matriz (R$ 14.850,00) com correspondência exata no Contas a Receber aguardando baixa.",
            "Por envolver alteração contábil no livro-razão, solicitando confirmação humana antes de aplicar a conciliação em lote.",
          ],
        },
        plan: {
          title: "Plano de Fechamento & Conciliação",
          steps: [
            {
              id: "step-1",
              label: "Extrair movimentações Open Finance (Itaú, BTG, Nubank PJ)",
              status: "completed",
              detail: "184 transações lidas",
            },
            {
              id: "step-2",
              label: "Consolidar faturas abertas dos cartões corporativos",
              status: "completed",
              detail: "3 cartões • R$ 38.740,00",
            },
            {
              id: "step-3",
              label: "Montar artefato DRE Gerencial Out vs. Nov",
              status: "completed",
              detail: "DRE v2 gerada",
            },
            {
              id: "step-4",
              label: "Executar baixa em lote de 4 títulos conciliáveis",
              status: "in_progress",
              detail: "Aguardando aprovação humana",
            },
          ],
        },
        toolCalls: [
          {
            id: "tool-query-bank",
            name: "query_bank_statements",
            label: "Consultar Extratos Open Finance & Faturas",
            status: "completed",
            durationMs: 142,
            input: {
              accounts: ["acc-itau-matriz", "acc-btg-tesouraria", "acc-nubank-pj"],
              period: "2026-10-01..2026-11-16",
              includeCardInvoices: true,
            },
            output: {
              matchedCount: 180,
              unreconciledCount: 4,
              unreconciledTotalBRL: 14850.0,
              cardExpensesNovBRL: 38740.0,
            },
          },
          {
            id: "tool-reconcile-batch",
            name: "reconcile_ofx_batch",
            label: "Aplicar Conciliação em Lote (4 lançamentos)",
            status: "awaiting_approval",
            requiresConfirmation: true,
            impactAmount: "R$ 14.850,00",
            confirmationSummary:
              "Esta ação marcará 4 recebimentos Pix/TED do extrato Itaú Matriz como 'Conciliados' e baixará os títulos correspondentes do Contas a Receber.",
            input: {
              bankAccountId: "acc-itau-matriz",
              transactionIds: ["tx-9041", "tx-9044", "tx-9052", "tx-9060"],
              totalAmountBRL: 14850.0,
              competence: "2026-11",
            },
          },
        ],
        content:
          "Consolidei a prévia de fechamento de **Novembro/2026** cruzando os extratos bancários com as faturas dos cartões corporativos [1]. A receita operacional bruta atingiu **R$ 482.910,00** (+10,2% sobre outubro), enquanto as despesas em cartões recuaram **8,2%** [2].\n\nEncontrei **4 recebimentos via Pix/TED** no Itaú Matriz que totalizam **R$ 14.850,00** com correspondência exata no contas a receber, porém ainda marcados como pendentes de conciliação [3]. Por política de governança, deixei o lote pronto abaixo para sua aprovação antes de gravar a baixa.",
        sources: [
          {
            id: "src-1",
            index: 1,
            title: "Extrato Open Finance — Itaú Operacional Matriz",
            sourceType: "open_finance",
            reference: "Ag 0412 • CC 49821-0",
            snippet: "184 lançamentos sincronizados em 16/11/2026 às 19:55; saldo corrente de R$ 184.520,40 com 4 créditos pendentes de baixa.",
            updatedAt: "16/11 19:55",
          },
          {
            id: "src-2",
            index: 2,
            title: "Faturas Consolidadas — Cartões Corporativos",
            sourceType: "database",
            reference: "cards_invoices • Nov/2026",
            snippet: "Total em aberto nos cartões Black Corporativo, Marketing Cloud e Logística: R$ 38.740,00 (-8,2% vs. Out/2026).",
            updatedAt: "16/11 19:54",
          },
          {
            id: "src-3",
            index: 3,
            title: "Lote de Pendências OFX #2026-11-B",
            sourceType: "document",
            reference: "reconciliation_queue",
            snippet: "Títulos #9041 (R$ 4.200,00), #9044 (R$ 3.150,00), #9052 (R$ 5.000,00) e #9060 (R$ 2.500,00) com hash idêntico ao extrato.",
            updatedAt: "16/11 19:56",
          },
        ],
        artifactId: "art-dre-nov-2026",
      },
    ],
  },
  {
    id: "thread-anomalia-cartoes",
    title: "Análise de Despesas de Cartões & SaaS",
    personaId: "reconciliation-agent",
    updatedAt: "Ontem, 17:42",
    pinned: false,
    totalTokens: 9640,
    artifacts: [
      {
        id: "art-saas-audit",
        title: "Auditoria de Assinaturas SaaS & Variação Cambial",
        subtitle: "Cartões Corporativos • Últimos 60 dias",
        type: "sql_query",
        version: "v1",
        updatedAt: "15/11/2026 17:42",
        summaryMetrics: [
          { label: "Economia Potencial", value: "R$ 2.480,00/mês", trend: "up" },
          { label: "Assinaturas Duplicadas", value: "2 licenças", trend: "down" },
          { label: "IOF em Compras USD", value: "R$ 612,40", trend: "neutral" },
        ],
        tableData: {
          headers: ["Fornecedor", "Cartão", "Valor Mensal", "Achado"],
          rows: [
            ["Figma Organization", "•••• 8821 / •••• 4410", "R$ 1.490,00", "Cobrança duplicada em 2 cartões"],
            ["AWS Cloud Services", "•••• 8821", "R$ 8.940,00", "Variação cambial +6,4% vs. Out"],
            ["Notion Enterprise", "•••• 4410", "R$ 990,00", "3 assentos sem login há 45 dias"],
          ],
        },
        codeContent: `SELECT
  merchant_normalized,
  COUNT(DISTINCT card_id) AS cartoes_distintos,
  SUM(amount_brl) AS total_brl,
  SUM(iof_brl) AS total_iof
FROM card_transactions
WHERE competence_month = '2026-11'
  AND category = 'Software & SaaS'
GROUP BY merchant_normalized
HAVING COUNT(DISTINCT card_id) > 1 OR SUM(iof_brl) > 100
ORDER BY total_brl DESC;`,
        language: "sql",
      },
    ],
    messages: [
      {
        id: "msg-c1",
        role: "user",
        createdAt: "17:40",
        contextChips: ["@Cartões Corporativos"],
        content: "Audite os gastos de Software & SaaS dos cartões neste mês e me diga onde estamos pagando duplicado ou sofrendo com IOF.",
      },
      {
        id: "msg-c2",
        role: "assistant",
        createdAt: "17:42",
        modelId: "gpt-5-thinking",
        tokensUsed: 1210,
        latencyMs: 2450,
        reasoning: {
          durationSeconds: 2.4,
          steps: [
            "Agrupando lançamentos por estabelecimento normalizado nos 3 cartões corporativos ativos.",
            "Identificada cobrança de Figma Organization presente simultaneamente nos finais 8821 e 4410.",
          ],
        },
        toolCalls: [
          {
            id: "tool-sql-cards",
            name: "run_readonly_sql",
            label: "Executar Query de Auditoria SaaS",
            status: "completed",
            durationMs: 88,
            input: { category: "Software & SaaS", month: "2026-11" },
            output: { duplicatesFound: 2, monthlySavingsBRL: 2480.0 },
          },
        ],
        content:
          "Identifiquei **2 oportunidades imediatas de economia** somando **R$ 2.480,00/mês** [1]: há cobrança duplicada do **Figma Organization** nos cartões finais `8821` e `4410`, além de 3 licenças ociosas no Notion Enterprise sem atividade nos últimos 45 dias. Preparei a consulta SQL auditável e a tabela de corte no Canvas ao lado.",
        sources: [
          {
            id: "src-c1",
            index: 1,
            title: "Lançamentos de Cartões — Categoria SaaS",
            sourceType: "database",
            reference: "card_transactions • 2026-11",
            snippet: "2 faturas apresentam cobrança recorrente para o mesmo CNPJ/Merchant Descriptor no mesmo ciclo.",
            updatedAt: "15/11 17:41",
          },
        ],
        artifactId: "art-saas-audit",
      },
    ],
  },
  {
    id: "thread-pdv-nfce",
    title: "Diagnóstico de Rejeição NFC-e Série 001",
    personaId: "tax-auditor",
    updatedAt: "12/11, 11:15",
    pinned: false,
    totalTokens: 5410,
    artifacts: [],
    messages: [
      {
        id: "msg-p1",
        role: "user",
        createdAt: "11:14",
        contextChips: ["@PDV NFC-e Série 001"],
        content: "Duas vendas no Caixa 01 retornaram rejeição 778 da SEFAZ hoje cedo. O que causou e como corrigir?",
      },
      {
        id: "msg-p2",
        role: "assistant",
        createdAt: "11:15",
        modelId: "gemini-2-5-pro",
        tokensUsed: 940,
        latencyMs: 1620,
        plan: {
          title: "Plano de Saneamento Fiscal NFC-e",
          steps: [
            { id: "p-1", label: "Ler XMLs rejeitados na fila de contingência", status: "completed", detail: "2 notas encontradas" },
            { id: "p-2", label: "Validar NCM contra tabela TIPI vigente", status: "completed", detail: "SKU BEV-014 com NCM extinto" },
            { id: "p-3", label: "Atualizar NCM do produto e retransmitir contingência", status: "pending", detail: "Ação manual no cadastro de produtos" },
          ],
        },
        content:
          "A rejeição **778 (Informado NCM inexistente)** ocorreu porque o item **SKU BEV-014** está cadastrado com o código NCM `2202.90.00`, que foi substituído na tabela TIPI vigente pelo `2202.99.00` [1]. Atualize o NCM no cadastro desse produto e reenvie as 2 notas em contingência off-line pelo módulo PDV.",
        sources: [
          {
            id: "src-p1",
            index: 1,
            title: "Log de Retorno SEFAZ — Série 001",
            sourceType: "fiscal",
            reference: "NFC-e #4827 e #4828",
            snippet: "cStat 778: Rejeição: Informado NCM inexistente [nItem:2, cProd:BEV-014, NCM:22029000].",
            updatedAt: "12/11 09:12",
          },
        ],
      },
    ],
  },
]

