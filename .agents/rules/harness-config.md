# harness-config — project data for the harness (descriptive policy, not enforcement)

`harness.config.json` is the single source of project data: commands,
paths, ports, risk surfaces, gate modes. Gates read it; rules and
plugins never hardcode its values (SPEC ADR-003). Enforcement lives in
`gate.js` (Batch 4) and the CI job (step 0); this file only describes.

## Key map (every key exists in SPEC §5.1; values reflect THIS repo)

| Key | Value in this repo |
|---|---|
| `version` / `project` | `2` / `"harness"` |
| `targets.frontend` / `targets.backend` | `null` / `"node"` — detected, never chosen in a menu (`scripts/harness-sync.mjs`: `package.json`/`pom.xml`/`Cargo.toml`). `null` means "not present in this repo": no Vue/Vite frontend; the runtime is Node ESM (opencode plugins). No build command from another project was copied here; that was the original sin this config fixes. |
| `moduleMap` | real paths: plugins, rules, schemas |
| `commands.suiteFull` | canonical contraprova command: node tests + static checks |
| `commands.unit` | node tests only |
| `infra` | nulls — no compose file, no local servers in this repo (E2E targets consumers via MCP) |
| `mcp.required` | `["chrome-devtools"]` (SPEC §5.1; RF-06) |
| `protectedPaths` | canonical list, identical to SPEC ADR-007 |
| `gates.*` | informative/audited only: no key changes a gate's effective mode; a per-gate downgrade lives in the host-process env (`HARNESS_GATE_<GATE>` + `_REASON`) — see below. 🟢 runtime: `modeForGate` takes no config (`gate.js:126`); the config is only audited (`gate.js:252`) |
| `riskPaths` / `escalateOnRisk` | identical to SPEC §5.1; declared as escalating `e2eGreenfield` to `enforce` and requiring E2E evidence of the affected flow — declarative: no runtime consumer in `gate.js` (see `docs/FUNCIONAMENTO.md` §10a2) |
| `contraproveTimeoutMs` | identical to SPEC §5.1; re-execution past this timeout is a `contraprove-timeout` deny (ADR-002) |
| `evidence` | `harness/` + report schema path |

> Nota (v2/F1, 2026-11-18): o instalador v1 foi apagado e `stack` virou
> `targets` (`{frontend, backend}`, detectado). `harness.config.json` continua
> sendo um arquivo do PROJETO: o sincronizador só o **cria quando ausente**
> (`init`, ou `update` num alvo sem config), pela mesma via guardada e atômica do
> payload (`assertSafeWrite` + `writeAtomic`), e exige `commands.suiteFull` não
> nulo **na criação do config** (os dois verbos que podem criá-lo recusam com
> exit 1), e **nunca o sobrescreve** — com o config presente, o verbo o reporta
> como `skip` e ele não entra no manifesto (dado preservado, não payload). Config
> **presente** com `commands.suiteFull` nulo não é reescrito: o `update` imprime
> `WARN commands.suiteFull nulo em harness.config.json — o gate negará Completed
> até ser preenchido` e sai 0; corrigir o comando é ato do operador.

## Fail-closed (RF-01/RF-02)

Missing or invalid config ⇒ every gate fails closed with a clear
message (never a crash). Canonical commands resolve from the config,
never from prose. Covered by `config-loader.spec.mjs`.

## Kill-switch (ADR-009)

`gates.*` never switches the whole suite off and never downgrades a gate — it is audited only: one WARN per (key, value) pair whose value is not `"enforce"`, naming the key, its value and whether the key names a registered gate (`auditConfigGates`, `gate.js:252`); a key that names no registered gate is declared inert — 🟢 runtime: the mode resolver takes no config (`modeForGate`, `gate.js:126`).
The suite kill-switch is the host-process env `HARNESS_GATES=off` (`KILL_SWITCH_ENV`/`KILL_SWITCH_OFF`, `gate.js:61-62`; `isKillSwitchOff`, `gate.js:77`; early return before any mode resolution, `gate.js:1366`) — under the cut no MODE is resolved or announced, but the config audit (`gate.js:1358`) runs before the cut and may still warn; `configGatesDisableEnforcement` is always false — 🟢 by construction: the cut is an env read (`gate.js:77`).
A per-gate downgrade is a different channel and lives in the host-process env: `HARNESS_GATE_<GATE>=warn` plus a non-empty `HARNESS_GATE_<GATE>_REASON`, resolved by the pure `resolveGateMode` (`gate.js:98`) and announced once per (gate, motive) (`gate.js:278`) — `warn` turns a `DenyError` into log+allow — 🟢 runtime: pure resolution + one announcement per process; the env belongs to the host operator.

## Command seal (ADR-002, U6=b)

`suiteFull` is sealed: `.opencode/plugins/lib/seal.mjs` exposes
`sha256` / `sealCommands` / `verifySeal`. `gate.js` (Batch 4, GATE-01)
**reads the published seal from `HARNESS_SEAL_JSON`** (rollout step 1 = the
trust root, *not* the worktree — U6=b; `loadPublishedSeal`, `gate.js:918-929`)
and compares it at runtime against the value read from the config;
divergence ⇒ `DenyError sealed-command-mismatch`; **seal absent ⇒ fail-closed**
(`cause: "empty-seal"`) — never allow. Regenerate with `sealCommands(commands)`
whenever `commands.suiteFull` changes.
Seal behavior is covered by `seal.spec.mjs` (confere/diverge).

## Static checks (TST-02)

Run locally and in CI with the same command:

```sh
node scripts/static-checks.mjs
node --test ".opencode/plugins/__tests__/*.spec.mjs"
```

V2/V3/V7 scan the files owned by Batch 2 and must read zero. Tooling
(`scripts/`, `__tests__/`) is excluded from the scan — it names the
forbidden patterns as test data. Pre-existing hits in the legacy
plugins are reported as INFO with owner DOC-02 (Batch 7), never as
green. V12 reports live-code refs as INFO; the fusion landed in DOC-02 and
is enforced as FAIL (R-V12 in `scripts/sdd-checks.mjs`). V14 FAILs honestly with `REMOTE_URL_PENDING` while no
git remote exists — that is the declared state, not a masked one.

## Sincronizador de payload (v2/F1) — substitui os perfis de stack

O instalador v1 (wizard, `STACK_PROFILES`, eixos, TUI) **não existe mais**: as
árvores `installer`, `installer-rs` e `packaging` foram apagadas. O papel dele é
de `scripts/harness-sync.mjs` — três verbos, zero pergunta, zero rede:

| Verbo | Contrato |
|---|---|
| `init --target <dir>` | exige alvo sem estado do harness (`.agents/`, `.agents/skills/`, `.opencode/plugins/`, `.opencode/commands/` ou `.harness-manifest.json` ⇒ falha mandando usar `update`); **recusa com exit 1 quando `commands.suiteFull` fica nulo** (mensagem pede `--suite <cmd>`), porque um config sem comando canônico faz todo gate que o lê falhar fechado depois; copia o payload e gera `harness.config.json` mínimo (`version`, `project`, `targets`, `commands`, `evidence`, `protectedPaths`). `--suite`/`--unit` sobrepõem a detecção. |
| `update --target <dir>` | backup obrigatório em `<parent do target>/.harness-backup/<nome-do-target>-<timestamp ISO com ms>/` — **nunca dentro do target** (lá seria conteúdo a inspecionar e a enumerar de novo) — antes de qualquer escrita; `--backup-dir <dir>` sobrepõe e um dir dentro do target é recusado. Grava **só** `{p : sha256(destino/p) ≠ sha256(fonte/p)}`; idempotente (2ª execução = 0 writes). Merge de `opencode.json` só nas chaves que a fonte declara. Path do manifesto ausente do payload sai como `orphan <path> (não removido)`: **não existe `--prune` nesta fase**, a remoção é decisão humana. Órfão apagado ou editado à mão ⇒ `doctor` FAIL (`arquivo do manifesto ausente`/`sha256 divergente`); reparo: podar a entrada do manifesto, ou apagar `.harness-manifest.json` e rodar `update` (`manifest rewritten`). |
| `doctor --target <dir>` | somente leitura: camadas do payload (incl. `.opencode/commands/`), JSON válido de `opencode.json`/`harness.config.json`/manifesto, `commands.suiteFull` não nulo, **sha256 de cada arquivo do manifesto recomputado** (1 byte adulterado ⇒ FAIL; entrada que é symlink ⇒ FAIL, nunca re-hash através do link) e WARN sobre o pin do checkout `brain` irmão (divergência ou ausência nunca viram exit 1). Exit 1 nomeando cada falha com o path. |

A mesma superfície, pelo agente, no destino: `.opencode/commands/` é **camada do
payload**, então `init` copia `harness-init.md`, `harness-update.md` e
`harness-doctor.md` e o `doctor` valida a camada (ausente/vazia/symlink ⇒ FAIL,
arquivo apagado ⇒ `arquivo do manifesto ausente`). Os três comandos (`/harness-init
[dir]`, `/harness-update [dir]`, `/harness-doctor [dir]`) só orquestram o CLI:
mostram `--dry-run`, pedem confirmação antes de aplicar e fecham com `doctor`;
nenhum pergunta stack/perfil (`targets`/`commands` são detectados). Contrato dos
arquivos medido por `scripts/__tests__/commands.spec.mjs` (frontmatter
`description`, `$ARGUMENTS`, ≤ 40 linhas, sem vocabulário de perfil/wizard).

Toda escrita é atômica (`<arquivo>.tmp-<pid>` + `rename`, o temporário aberto com
`wx`/`O_EXCL` e removido em qualquer erro, então um link plantado no nome
previsível é recusado) e o manifesto é o último write; qualquer symlink em
componente do path de destino, ou `target` igual à fonte, **aborta o run
inteiro** antes do backup.

Identidade de path é decidida por `realpath` quando o path existe (fallback
lexical só para alvo inexistente): `--target` que é symlink para este checkout ⇒
`target é a própria fonte` (o manifesto nunca nasce na fonte) e `--backup-dir`
cujo ancestral symlinkado resolve para dentro do alvo ⇒ `backup dentro do
target`, mesmo com caminho lexical "fora". Link no ancestral existente mais
fundo do backup (ou na folha que `--backup-dir` nomeia) ⇒ `symlink no diretório
de backup`; ancestrais acima dele não são superfície desta run (G6 inalterado).

`--dry-run` imprime o plano (`create`/`update`/`skip` por path) e não escreve nem
cria backup — e roda o MESMO guard de backup do apply, então `--backup-dir`
recusado (dentro do alvo ou sob link) sai 1 antes de o plano ser exibido.
Manifesto = `.harness-manifest.json` (`{version, files:{path: sha256}}`).

Dado do projeto que **nunca** é sobrescrito nem removido: `harness.config.json`,
`workflow-state.json`, `.agents/rules/project-*.md` e `.spec/**`. ADR-001
(fase de implementação): um `project-*.md` **ausente** passa a ser criado pela
allowlist explícita de PRÓPRIOS do plano (`buildIdentityPlan`); um
`project-*.md` **presente** segue `preserved` e não é reescrito — `PRESERVED_RES`
global continua proibindo sobrescrita. `AGENTS.md`/`DESIGN.md` são ANEXADOS:
fora do manifesto (`inManifest: false`) e fora do veredito do `doctor`; a única
mutação é o `BLOCO` delimitado por `<!-- harness:v2:start -->` /
`<!-- harness:v2:end -->`, anexado ao final com o prefixo byte-idêntico.
Divergência do BODY ⇒ `WARN divergência <path>` com exit 0; contagem/ordem
inválida ⇒ `ERROR seção malformada <path>` com exit 1 e zero escrita.

`--frontend react|vue` e `--backend java|rust|nestjs|node` sobrepõem a detecção
(`detectTargets`); sem sinal, `init`/`update` recusam com a mensagem literal de
I5. O relatório (`identityReportLines`) imprime stack, um estado por path
ordenado POSIX e o resumo `plano created=… appended=… preserved=… skip=…
divergent=… malformed=…`; `--dry-run` imprime as mesmas linhas do apply.

O gating de artefato por eixo (`SKILLS_BY_AXIS`/`RULES_BY_AXIS`) saiu com o
instalador: o payload é fixo e o que o destino recebe deixou de depender de um
eixo declarado. O vendor de skills (`scripts/vendor-skills.mjs` + `.vendor-lock.json`)
continua sendo o único ponto source-side; o `--check` roda sem rede.

**Q3=A — React/Vue no core; Dart/Flutter fora.** As 22 skills `dart-*`/`flutter-*`
não fazem mais parte do payload nem do `.vendor-lock.json`: são **vendor sob
demanda**, fora do core. `detectTargets` só produz `frontend: "react" | "vue" |
null` — `pubspec.yaml` não gera alvo de frontend. Quando há frontend, o gate de
`Completed` exige `frontend_evidence` no REPORT (deny `frontend-evidence-missing`).
