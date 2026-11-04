# gate-contract — prosa descreve, runtime nega (DOC-01)

> Regra normativa de **descrição**, não de enforcement (mesmo estatuto de
> `.agents/rules/harness-config.md`: SPEC §2, linha "`.agents/rules/*.md` —
> política descritiva — ❌ não bloqueia").
> **Regra do DOC-01:** toda afirmação de gate nesta prosa cita o mecanismo
> que a sustenta (RUNTIME-CONTRACT ou SPEC). Linha de gate sem citação =
> gate órfão = defeito. Nenhuma linha aqui nega tool por si só.

## 1. Onde mora cada negação

> **A coluna "Garantia declarada" descreve o repo de origem (`harness`), onde
> `scripts/static-checks.mjs`, `scripts/sdd-checks.mjs` e o CI `harness-integrity.yml`
> existem.** Neste repo **nenhum dos três existe** (`scripts/` só tem
> `dev-functions.sh`; `.github/workflows/` só tem `release-please.yml`), logo todo
> item cuja garantia depende de CI/static-checks é **🟡 processo** aqui — ou
> **🔴 aberto** quando o runtime também não garante. O mecanismo de runtime citado
> (`gate.js`) continua valendo onde o gate é carregado, inclusive aqui.
> Onde o nível divergir entre origem e este repo, a linha diz os dois.

| # | Afirmação de gate | Mecanismo (citação obrigatória) | Garantia declarada |
|---|---|---|---|
| I1 | `task` sem bloco PICCO válido ⇒ deny; tag `<open_questions>` obrigatória, vazia = válido; E1/E2 ausentes ⇒ deny, E3–E6 ⇒ aviso | `gate.js` no hook v2 `ctx.tool.hook("execute.before", …)` (`V2_TOOL_HOOK` em gate.js; binding `toolHook` em gate.js:1443, chamada em gate.js:1448) — único primitivo de deny é `throw` (SPEC ADR-001); contrato exato da tag (SPEC ADR-004); input `{tool,sessionID,callID}` + `args` (RUNTIME-CONTRACT §4) | 🟢 garantido (SPEC §7.1) |
| I2 | `Completed` exige escrita pela via estruturada + contraprova por re-execução; próximo `task` exige `Completed` + `harness_status` + `code_review_status` do ciclo anterior | `gate.js` âncoras A (path-check em `args.filePath`/`args.patchText`, dois shapes de `write` — RUNTIME-CONTRACT H6) + B (state anterior) + re-execução do comando selado (SPEC ADR-008, ADR-002) | 🟠 origem (CI) · 🟡 aqui — escape por escrita fora da allowlist; a cobertura prometida era o CI (SPEC §7.1), que não existe neste repo |
| I3 | zero path/comando de projeto hardcoded em rules e plugins | check estático V3 — `grep` por literais (SPEC §12 V3); dados vêm de `harness.config.json` (SPEC ADR-003) | 🟡 processo aqui — no repo de origem 🟢 via CI (SPEC §7.1); V3 vive em `scripts/static-checks.mjs`, **que não existe neste repo** |
| I4 | nenhum portão confiável existe apenas como prosa | auditoria manual periódica H7 — invariante **de processo**, não auto-enforçável (SPEC §7.1 I4) | 🟡 processo — declarado como tal, não como garantia (SPEC §7.1) |
| I5 | **6 sem `edit`**: `orchestrator`/`code-reviewer`/`ux-designer`/`codebase-analyzer`/`security-engineer`/`design-system-specialist`. **Com `edit: allow`**: `developer-engineer`, `product-manager`/`architect` (a esteira exige criar `.spec/prd/**` — F1) e `qa-engineer` (o papel exige gravar o REPORT `harness/<demand>.json` — N1). No v2 não existe "escreve mas não edita": `write` **é** a ação `edit` | `opencode.json` (`permission.edit: deny`) — camada nativa, grosseira (SPEC §2, ADR-001). **Nota (medido, `opencode debug config`)**: a chave `write` **não** é recurso independente — o runtime a mapeia para a ação **`edit`**, logo `write: "deny"` é alias redundante, não uma segunda garantia | 🟢 literal · 🟠 intenção — `bash` contorna (SPEC §7.1). **Para o `qa-engineer`, o escopo de escrita é imposto pelo GATE, não pela permissão**: `isHarnessScoped` (`gate.js:565`) + deny em `gate.js:670` ⇒ fora de `harness/` ⇒ deny (por isso o `edit: allow` dele é seguro) |
| I6 | batch concluído não inicia o próximo sem pausa HITL; exceção: loop `developer-engineer → code-reviewer` (2 calls) | GATE-04 `gateHitlBatch` em gate.js:1097 (registro por `registerCoreGate` em gate.js:1179, `gateName` em gate.js:1184) nega o 3º `task` consecutivo da sessão; a fronteira de turno vem do event stream (`V2_TURN_BOUNDARY_TYPES` em gate.js:1271; `noteTurnBoundary` em gate.js:1289-1297; assinatura de `ctx.event.subscribe` em `setup`, gate.js:1452-1474) — `hitl-guardrail.js` é no-op desde FIX-01 e `chat.message` não existe no v2; definição precisa de batch vs loop (SPEC §7.2) | 🟠 parcial (SPEC §7.1) |
| I7 | nunca executar `pkill -f`; `bash` contendo o padrão ⇒ deny | `gate.js` por parse de comando — **evadível** (`bash -c`, `python -c` — SPEC §7.3 fixture de evasão); `permission.bash` casa comando, não alvo (RUNTIME-CONTRACT H4); rede final = CI (SPEC ADR-007) | 🟠 origem (CI) · 🟡 aqui — a "rede final" era o CI, que não existe neste repo; o parse evadível é o único mecanismo presente (SPEC §7.1) |
| I8 | `DenyError` ⇒ deny; qualquer outro erro ⇒ allow + log `error` | contrato tipado do dispatcher: `catch (e) { if (e instanceof DenyError) throw e; … }` (SPEC ADR-006); `throw` propaga sem `catch` no dispatcher (RUNTIME-CONTRACT §2) | 🟢 garantido (SPEC §7.1) |
| I9 | não-orquestrador não escreve em path protegido, por nenhuma via (incl. `bash`) | CI + pre-commit revertem/falham commit sem trailer `Harness-Gate-Change` (SPEC ADR-007); parse no gate é defesa em profundidade, evadível (SPEC §1 ADR-007) | 🔴 não garantido por runtime — **também 🔴 aqui**: o 🟠 de origem dependia de CI + pre-commit **após o passo 0** (`git init` + remote + CI), e neste repo nenhum dos dois existe (SPEC ADR-007, §16) |
| I10 | motivo de negação sem segredo no log | scrub antes do log (SPEC RF-12, §7.1 I10) | 🟢 garantido (SPEC §7.1) |
| I11 | mapa `sessionID → agente` disponível aos gates que precisam | no v2 o agente chega no payload do hook `execute.before` (`recordSessionAgent` em gate.js:419, chamado em gate.js:1347; mapa `sessionAgentMap` em gate.js:410-427); `chat.params`/`chat.message` não são hooks do v2 (tabela v1→v2, `V2_HOOK_TABLE` em gate.js) — SPEC §3 e RUNTIME-CONTRACT §4 descrevem o runtime v1; sem entrada no mapa nem `ctx.sessionAgent`, `resolveSessionAgent` (gate.js:429) devolve `undefined` e as regras por papel falham para allow | 🟢 garantido (SPEC §7.1) |
| I12 | ordem config → schema → gate(warn) → enforce respeitada | checklist de rollout (SPEC §16, ADR-010) — processo | 🟡 processo (SPEC §7.1) |
| RF-01/RF-02 | config ausente/inválido ⇒ fail-closed com mensagem; comandos sempre resolvidos do config; **nenhuma** chave do config altera o modo efetivo de um gate | `gate.js` loader (SPEC §8 RF-01/RF-02); o modo vem do env do processo host — `HARNESS_GATE_<GATE>` = `"enforce"`/`"warn"`, com `_REASON` não vazio obrigatório para rebaixar, e ausente/inválido ⇒ `enforce` (fail-closed) — por função pura (`resolveGateMode`, gate.js:98; `modeForGate`, gate.js:126); o config é auditado: 1 WARN por (chave, valor) quando o valor ≠ `"enforce"`, e a chave que não nomeia gate registrado é declarada inerte (`auditConfigGates`, gate.js:252); rebaixamento e recusa anunciados 1× por (gate, motivo)/(gate, tipo) (`announceGateMode`, gate.js:278); em `warn` o `DenyError` vira log + allow (gate.js:329-330) | 🟢 runtime — resolução pura + auditoria, sem caminho do config até o modo (gate.js:98, :252); o rebaixamento é ato do operador do host, não do worktree (SPEC ADR-009) |
| RF-04 | `Completed` sem `harness/<demand>.json` ⇒ deny; contagens divergentes ⇒ deny | contraprova por re-execução + selo `sha256` do comando (`sealed-command-mismatch` — SPEC ADR-002/U6=b) | 🟢 para evidência ausente (deny em gate.js:946, quando `ctx.report` é nulo; report lido por `readEvidenceReport`, gate.js:1036) · 🟠 para contagens, inalcançáveis no caminho real (`counts: null`; a6 em `docs/FUNCIONAMENTO.md`) — o deny `contraprove-divergent` é `DenyError(DENY_CONTRAPROVE_DIVERGENT)` em `runContraprova` |
| KILL | desligar a suíte de gates = env `HARNESS_GATES=off` no processo host; `harness.config.json` **não** desliga a suíte **nem** rebaixa gate algum (ver row RF-01/RF-02) | (a) corte da suíte: `KILL_SWITCH_ENV`/`KILL_SWITCH_OFF` + `isKillSwitchOff` (gate.js:61-62, :77) e early-return antes de resolver modo e antes do loop de gates (gate.js:1367) — sob o corte não há `resolveGateMode` nem `announceGateMode`; (b) rebaixamento de um gate: canal distinto, env por gate `HARNESS_GATE_<GATE>=warn` + `_REASON` não vazio (gate.js:98), anunciado 1× por (gate, motivo) (gate.js:278); o config é gravável por `bash`, logo não pode ser kill-switch da suíte nem canal de downgrade (SPEC §1 ADR-009) | 🟢 por construção (SPEC §15) |
| TIME | re-execução além de `contraproveTimeoutMs` ⇒ deny `contraprove-timeout` | veredito do gate, não exceção de plugin (SPEC ADR-002) | 🟢 veredito do gate — `DenyError(DENY_CONTRAPROVE_TIMEOUT)` em `runContraprova` (timeout da chamada e `timedOut` observado), não exceção de plugin |
| V15 | nenhuma referencia de rede em `installer/` (builtins, libs HTTP, globais, comandos child_process da classe fechada) | check estatico `checkV15` em `scripts/static-checks.mjs` — ⚠️ **nao existe neste repo** (`scripts/` so tem `dev-functions.sh`; `.github/workflows/` so tem `release-please.yml`), logo V15 **nao roda aqui**: 🟡 processo; no repo de origem varre `installer/`, roda em `commands.suiteFull` via `harness.config.json` + CI `harness-integrity.yml` passo `static-checks` (bounds anti-ReDoS POR FORMA — string-unica {0,4} pares flag+arg antes do subcomando, array {0,200} chars antes do subcomando; teste de tempo <50ms nos dois caminhos) | 🟡 processo neste repo (sem mecanismo) · origem: 🟠 parcial — arestas declaradas: comando em variavel (`--suite-command`/`commands.suiteFull` lido em runtime — E1), alias de global/fetch (E2), specifier construido (E3), builtins internos fora da lista (`node:_http_agent` — E4), array-form com elemento quotado em qualquer posicao (E5), comandos de rede fora da lista fechada (E6), padrao dividido entre linhas (scan linha-a-linha — E7, nao cacado), alias de require (E8, nao cacado), npx so na forma string-unica (E9, nao cacado); FP residual `npx --version`; varredura e linha-inteira — mencao em comentario tambem bate (intencional); limites dos bounds: >4 pares flag+arg (string-unica) ou elemento de array >200 chars antes do subcomando git/pkg nao casa |

## 2. Não-promessas explícitas (o runtime NÃO tem — RUNTIME-CONTRACT §3/H5, §6)

1. **Prosa não é negada.** Nenhum hook bloqueia declaração em linguagem
   natural (RUNTIME-CONTRACT H5). "Declarou pronto em prosa e parou" é
   fuga de processo, coberta por regra de processo + âncora B no
   encadeamento (SPEC ADR-008) — nunca afirmar bloqueio de prosa.
2. **`permission.ask` não existe.** 0 call sites no binário
   (RUNTIME-CONTRACT §2, H1). Nenhum gate o usa; asserção de contrato
   `permission-ask-absent` (SPEC §7.3).
3. **`output.system = string` não propaga** (RUNTIME-CONTRACT H2);
   nenhum plugin re-injeta regra por esse hook (SPEC §6).
4. **Não existe evento de bus `tool.execute.after`** (RUNTIME-CONTRACT H3);
   handlers que filtram esse nome de evento **nunca disparam** (SPEC §7.3
   `bus-event-dead-handler`). Observação usa o hook confirmado
   `tool.execute.after` (7 call sites — RUNTIME-CONTRACT §2).
5. **Contraprova = consistência, não cobertura.** Cobertura de cenário de
   risco vem de `escalateOnRisk` (SPEC §5.1, §14): mudança em `riskPaths`
   exige evidência E2E do fluxo afetado. Suite verde + bug P0 = lacuna de
   cobertura, não falha da contraprova (RUNTIME-CONTRACT §6, caso ACL/ECM).

## 3. Higiene de prosa (vale para rules, skills e AGENT.md)

- Afirmar "bloqueia/nega/impede/garante" só com citação da linha da §1.
- Nível de garantia sempre explícito: 🟢 runtime · 🟠 parcial/CI-dependente · 🟡 processo · 🔴 declarado-aberto.
- `code-reviewer` (nome desde o RENAME, Batch 7 — SPEC §23/U11):
  veredito dele é parecer; o bloqueio é a
  âncora B lendo `code_review_status` (SPEC ADR-008, §5.3).
