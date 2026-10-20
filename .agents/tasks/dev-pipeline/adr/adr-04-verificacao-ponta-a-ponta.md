# ADR-04 — Verificação ponta-a-ponta em modo real e fechamento do bugfix

**Status:** proposto

## Contexto

As ADR-01 (borda) e ADR-02 (cadastro) entregam a lógica, mas o critério de aceite central do
usuário é **comportamental e ao vivo**: reenviar para o número legado sem DDI (`47992391751`,
`whatsapp_opt_in = true`) em `EVOLUTION_MODE=real` deve resultar em `POST /message/sendText` com
`number = 5547992391751`, a Evolution **não** responder 400, e a função retornar
`{ outcome: "sent", status: "enviado" }` com `provider_message_id` preenchido (AC-01 do PRD e da
análise-data §5). O PRD §8 item 5 também exige a prova visual cruzada no `/app/clientes`.

Nenhuma das ADRs anteriores "fecha" sozinha a prova integrada (origem + borda juntas, sistema
rodando). Esta ADR concentra a **verificação de integração e os critérios de aceite de sistema**
num passo próprio, revisável, para não diluir a prova nas ADRs de código. Não escreve código de
aplicação — é verificação.

Observação operacional (PRD §7): o dev server Vite pode subir em porta alternativa
(5173 → 5174 → 5175) quando há processos antigos; a Evolution real é acessada via ngrok com
credenciais em `supabase/functions/.env`. A ADR-03 fornece o script que sobe as functions.

## Decisão

Executar e registrar a verificação integrada do bugfix, em duas camadas:

1. **Estática (sempre):**
   - `npm run build` (frontend: `tsc -b && vite build`) passa limpo — AC-09 frontend.
   - `deno check supabase/functions/whatsapp/index.ts` passa limpo — AC-09 servidor.
   - Conferência de que **nenhuma migration nova** foi criada e **nenhuma aplicada foi alterada**;
     `supabase db reset`/`supabase start` sobe sem migrations novas — AC-08.
   - Conferência de que não há `tenant_id` vindo do cliente no caminho do fix e que nenhum
     segredo/telefone/texto é logado em claro nos trechos alterados — AC-06/AC-07, RNF-E164-01/02.

2. **Ao vivo em modo real (`EVOLUTION_MODE=real`):**
   - Subir local: `supabase start` + script da ADR-03
     (`supabase functions serve whatsapp --env-file supabase/functions/.env`) + `npm run dev`.
   - **AC-01 (cenário do usuário):** com um `customers.phone = 47992391751`, opt-in `true` e
     instância conectada, reenviar pela Edge Function `whatsapp` e confirmar via QA
     (chrome-devtools MCP, quando disponível, ou leitura do Network/log do functions serve) que o
     envio sai com `number = 5547992391751`, a Evolution não responde 400 e a resposta é
     `outcome: "sent"` com `provider_message_id` preenchido.
   - **PRD §8 (prova visual em `/app/clientes`, papel admin/receptionist):** (1) cadastrar com
     telefone sem DDI grava `+5547992391751`; (2) a lista exibe `+55 (47) 99239-1751`; (3) editar
     um legado e salvar normaliza; (4) telefone inválido (`123`) bloqueia o submit com erro pt-BR
     e foco acessível; (5) reenvio ponta-a-ponta retorna `sent`.
   - **AC-06 (sem PII):** inspecionar os logs do functions serve após sucesso e após falha —
     nenhum telefone/texto em claro, só motivo técnico curto.

3. **Limitação explícita e tratamento:** se a Evolution real (ngrok) ou a ferramenta
   chrome-devtools MCP não estiverem disponíveis nesta sessão, registrar a parte ao vivo como
   **QA pendente** no índice (`qaPending`), como já é prática do projeto (ver histórico de
   `index.json`), tendo executado e aprovado toda a camada estática. A camada estática + os ACs
   unitários determinísticos das ADR-01/02 constituem o piso verificável; a prova ao vivo é
   registrada como pendente de execução humana/ambiente quando o ambiente não a permitir.

4. **Entrega local-only (PRD §7):** branch nova + commit, **sem** push nem PR real neste ambiente.

## Consequências

- **Positivas:** garante que origem + borda juntas resolvem o caso do usuário e não produzem
  `5555...`; separa a prova de sistema da codificação, deixando-a revisável; respeita o padrão de
  `qaPending` do projeto quando o ambiente limita a QA ao vivo.
- **Negativas / riscos:** a prova ao vivo depende de ambiente externo (Evolution/ngrok,
  chrome-devtools). Mitigado pelo registro honesto de `qaPending` e pelo piso estático.
- **Reversível:** é verificação; não altera código.

## Escopo

**ambos** (verificação de sistema cruzando frontend e servidor). Não escreve código de aplicação.

## Arquivos afetados

Nenhum arquivo de aplicação. Pode atualizar artefatos de QA do pipeline
(`.agents/tasks/dev-pipeline/adr/*.qa.json` / `index.json` `qaPending`) conforme o estágio de
entrega — não é código de `src/**` nem `supabase/**`.

## Critérios de aceite testáveis (desta ADR)

- **AC-04-a:** `npm run build` e `deno check supabase/functions/whatsapp/index.ts` passam limpos.
- **AC-04-b:** confirmação de AC-08 (sem migration nova/alterada).
- **AC-04-c:** AC-01 ao vivo (`outcome: "sent"`, `number` com DDI, sem 400) **ou** registro
  fundamentado de `qaPending` quando o ambiente real não estiver disponível, com a camada estática
  aprovada.
- **AC-04-d:** PRD §8 itens 1–4 provados no navegador **ou** registrados como `qaPending` com
  justificativa; AC-06 (sem PII em log) conferido.
- **AC-04-e:** entrega em branch nova + commit, sem push/PR.

## Dependência

**Depende de ADR-01 e ADR-02** (a lógica precisa existir para a prova integrada). Usa o script da
**ADR-03** para subir as functions, mas não depende dele para os ACs estáticos. É a última ADR do
recorte do ponto de vista de fechamento.
