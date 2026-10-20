# ADR-12 — Endurecimento final: segredo/PII, mock intacto, confinamento do diff e dívida aceita

**Status:** proposto

## Contexto

As ADR-09→11 montaram a fundação e as duas operações reais (`pair`, `sendText`). Esta ADR é a
**fatia de fechamento**: verifica as fronteiras invioláveis que atravessam todo o módulo, prova
que o mock permanece como fallback, confirma que o diff ficou confinado ao único arquivo
permitido, e **registra a dívida conhecida** (OQ-01) — sem código de aplicação novo além de
ajustes de endurecimento (ex.: garantir que nenhum `console.*` logue PII/segredo, que nenhum
corpo cru da Evolution seja logado). É a ADR que transforma os requisitos transversais R8, R9,
R10, R12, R14 e a Definition of Done (§11) em verificação explícita.

Promoção a `docs/`: as decisões de arquitetura desta fase (adapter real atrás da porta,
idempotência de `pair` por nome, tratamento de "já conectada" via erro pt-BR, dívida de
reconciliação de `connection_status`) são **duráveis** e podem depois ser promovidas para
`/home/joao/fusionlf/wsProjeto/atlas-agenda/docs/`. **Não** copiar para `docs/` agora — apenas
anotado aqui para a promoção futura.

## Decisão

1. **Auditoria de segredo (R8/AC-08).** Garantir que a API key da Evolution não aparece em
   nenhuma string literal do código, não é logada nem ecoada em resposta, nunca com prefixo
   `VITE_`. `supabase/functions/.env` permanece git-ignored (já confirmado por
   `git check-ignore`). O corpo cru de respostas da Evolution (que inclui `token` por instância
   em `fetchInstances`) **nunca** é logado — logar só status/motivo técnico curto.
2. **Auditoria de PII (R9/AC-09).** Revisar todos os `console.*` adicionados nas ADR-09→11:
   nenhum pode conter `to` (telefone) nem `text` (corpo da mensagem) em claro. Correlação por
   `provider_message_id`/`customer_id`.
3. **Mock intacto (R10/AC-10).** Confirmar que `MockEvolutionAdapter` continua funcional (QR
   fake, id fake, zero rede) e que `createEvolutionAdapter()` seleciona `mock|real` por
   `EVOLUTION_MODE` com default `mock`. A trilha mock não pode ter regredido.
4. **Confinamento do diff (R12/AC-12).** `git diff --name-only` deve listar **somente**
   `supabase/functions/whatsapp/evolution-adapter.ts`. `index.ts`, `schemas.ts`, migrations e UI
   inalterados. Travas negativas (R14/AC-14): nenhum webhook de entrada, nenhuma régua/cron,
   nenhum envio a terceiro no QA automatizado, nenhuma mudança de contrato de fio/UI.
5. **Registro da dívida aceita (OQ-01).** Anotar — nesta ADR e no brain (layer `arquitetura`,
   `project: atlas-agenda`) — que, no fluxo real, o `index.ts` marca
   `connection_status = 'conectado'` logo após `pair()` devolver o QR, enquanto o pareamento real
   é **assíncrono** (depende do scan). O estado fica **otimista/incorreto** até a fase seguinte
   implementar reconciliação (webhook `connection.update` ou polling de
   `GET /instance/connectionState`). Esta tarefa **não** corrige (trava "não tocar `index.ts`";
   webhook/polling são fase seguinte). A anotação aponta a correção para a fase de reconciliação.
6. **Verificação visual de não-regressão (AV-01→AV-04, §8 do PRD).** Via Chrome DevTools MCP,
   **sem** disparar mensagem a terceiro: `/app/config/whatsapp` carrega sem erro de console com
   `EVOLUTION_MODE=real`; o `pair` do admin exibe um QR real legível no `QrCodeDisplay`; badge e
   instruções de pareamento sem alteração de layout/copy; grep por segredo no bundle do cliente
   (`src/`, build) = vazio.
7. **Documentar o teste manual do usuário (§9 do PRD)** no resultado/PR: subir
   `supabase functions serve whatsapp --env-file supabase/functions/.env`; admin parear e
   escanear o QR real; enviar a um cliente com `whatsapp_opt_in = true` e conferir
   `provider_message_id` real; confirmar ausência de PII/segredo nos logs.

## Consequências

- **Escopo:** ambos (verificação de dados/backend + não-regressão de frontend via QA visual).
- **Arquivos afetados:** `supabase/functions/whatsapp/evolution-adapter.ts` (apenas ajustes de
  endurecimento de log/segredo, se a auditoria apontar). Nenhum outro arquivo de aplicação.
  Artefato de registro: nota no brain (não é arquivo de aplicação).
- **Positivo:** fecha a Definition of Done (§11) com todas as fronteiras invioláveis provadas; a
  dívida de `connection_status` fica documentada e endereçada à fase seguinte, sem ser escondida.
- **Negativo/risco:** a divergência de `connection_status` persiste como limitação **aceita**
  desta fase até a reconciliação; o produto mostra "conectado" otimista no fluxo real nesse
  intervalo.
- **Dependência:** **ADR-10 e ADR-11** (o endurecimento e a auditoria incidem sobre o código que
  elas introduzem). É a última ADR da sequência.
- **Promoção futura a `docs/`:** marcar as decisões duráveis acima como candidatas a `docs/`
  (não copiar agora).

### Critérios de aceite testáveis (desta ADR)

1. `grep` pela API key no código-fonte e no diff = **vazio**; `supabase/functions/.env`
   git-ignored; nenhum valor de key/token em log ou resposta (R8/AC-08).
2. Nenhum `console.*` do adapter contém telefone (`to`) ou corpo (`text`) em claro; nenhum corpo
   cru da Evolution logado (R9/AC-09).
3. Com `EVOLUTION_MODE=mock`, `MockEvolutionAdapter` roda com QR/id fake e zero rede;
   `createEvolutionAdapter()` seleciona corretamente por env (R10/AC-10).
4. `git diff --name-only` = **apenas** `supabase/functions/whatsapp/evolution-adapter.ts`
   (R12/AC-12); nenhuma trava negativa violada (R14/AC-14).
5. AV-01→AV-04 verificados via Chrome DevTools MCP sem envio a terceiro (§8 do PRD).
6. Dívida OQ-01 (`connection_status` otimista no fluxo real) **registrada** nesta ADR e no brain
   como limitação aceita, com a correção apontada para a fase de reconciliação (§11, item da
   dívida).
7. O resultado/PR documenta o teste manual do usuário (§9 do PRD).
