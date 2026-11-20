# SPEC Validation Gate (Asserts)

Toda especificação (SPEC) deve ser validada contra os seguintes critérios antes de
prosseguir para a fase de planejamento.

> **Layout v2 (por ADR):** a SPEC validada aqui é a do ADR — `spec-from-adr` gera
> `ADRs/ADR-00N-{slug}/SPEC.md`. Cada `RF`/`NFR` é rastreável à decisão/interface
> congelada do `ADR.md` e os critérios de aceite são executáveis (comando/asserção).
> O mérito dos critérios abaixo não muda; ciclos `unit: legacy` continuam aceitos.

## 1. Integridade Arquitetural
- [ ] **ADRs**: Contém registros de decisão (ADRs) explicando o "Porquê" das escolhas críticas.
- [ ] **DDD Modular**: Separação clara entre camadas api/impl/public respeitada.
- [ ] **Segurança/IAM**: Modelo de autenticação do destino e `@HasPermission` definidos.

## 2. Modelo de Dados e Eventos
- [ ] **ERD**: Diagrama de Entidade-Relacionamento incluído (se aplicável).
- [ ] **Event Registry**: Lista de eventos com Produtor, Consumidor, Payload (se aplicável).
- [ ] **Migrations**: se Java — Arquivos Flyway ou Liquibase planejados com `V{YYYYMMDD}{NNN}`.

## 3. Qualidade e Testabilidade
- [ ] **Invariantes de Entidade**: Propriedades que devem ser sempre verdadeiras para cada entidade principal.
- [ ] **Invariantes de Workflow**: Regras de transição de estado definidas.
- [ ] **Test Strategy**: Estratégia de testes (unitários + integração) definida.

## 4. Estrutura e Escopo
- [ ] **Single File**: O documento é coeso e está em um único arquivo.
- [ ] **Domínio claro**: Domínio afetado identificado (user/employee/project/team/task/workflow/kanban).

## 5. Score do Portão (número reportado no portão P1→P2)

O score é calculado **exclusivamente sobre os itens de checkbox das seções 1–4 deste
arquivo** (hoje 11) — nenhum outro insumo, nenhum peso por categoria:

```
score = (itens atendidos / itens aplicáveis) × 100     # arredondado ao inteiro
```

- `itens aplicáveis` = todos os itens das seções 1–4 **menos** os marcados `N/A`.
- `N/A` só vale com motivo escrito no próprio item (`N/A — <motivo>`); item `N/A` sem
  motivo conta como `❌` e permanece no denominador.
- `itens atendidos` = itens aplicáveis marcados `✅`.
- Itens que dizem "(se aplicável)" só viram `N/A` quando o motivo mostra que a
  condição não ocorre nesta SPEC (ex.: `N/A — sem entidade nova neste ciclo`).
- O relatório do portão lista item → `✅`/`❌`/`N/A` junto do valor, para o número ser
  auditável; cada `❌` é um gap com severidade `🔴`/`🟠`/`🟡`/`🟢`.
- Guarda: `itens aplicáveis = 0` ⇒ relatório reporta `score: N/A` (nem 0, nem 100) e o
  portão trata como FAIL — as seções 1–4 não podem ser dispensadas em bloco.
- O score **reporta**; não substitui o critério de avanço: `P1→P2` só prossegue com
  zero gaps `🔴` e zero gaps `🟠 alta prioridade` abertos (`orchestrator/AGENT.md`,
  Fase 1, passo 13). `100%` = pronto; `<100%` = gaps listados e classificados.
