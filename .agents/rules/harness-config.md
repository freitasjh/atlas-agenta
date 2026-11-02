# harness-config — project data for the harness (descriptive policy, not enforcement)

`harness.config.json` is the single source of project data: commands,
paths, ports, risk surfaces, gate modes. Gates read it; rules and
plugins never hardcode its values (SPEC ADR-003). Enforcement lives in
`gate.js` (Batch 4) and the CI job (step 0); this file only describes.

## Key map (every key exists in SPEC §5.1; values reflect the origin repo)

| Key | Value in the origin repo |
|---|---|
| `version` / `project` | `1` / `"harness"` |
| `stack.backend` / `stack.frontend` | `N/A` with inline justification — this repo has no Java/Maven backend and no Vue/Vite frontend; the runtime is Node ESM (opencode plugins). No build command from another project was copied here; that was the original sin this config fixes. |
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

> Nota (installer-melhoria, 2026-10-11): menu W2m 5 itens produto→stack,
> entrypoints `init`/`doctor` e padrão de erro 4-linhas **não alteram**
> `harness.config.json` — comandos, portas, `mcp.required` e selo `suiteFull`
> idênticos; `STACK_VALUES`/`STACK_PROFILES` preservados sem nova key.

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

## Perfis de stack do instalador (ADR-008 + harness-eixos-stack, 2026-10-18)

`STACK_PROFILES` (`installer/install.mjs`) é o **registry único** das capacidades por preset:
`axes` (IDs de eixo, `AXIS_IDS`), `backend`/`frontend` (rótulos **literais** — nunca concatenados),
`commands`, `mcp`, `moduleMap` e `stacks`. Presets atuais (**12**): `node`, `node-esm`, `java+vue`,
**`java+react`**, `rust`, `nestjs`, `node+react`, `nestjs+react`, `rust+react`, `outra`, `flutter`, `dart`.
`stacks` **não** é campo independente: deriva do eixo
por `stacksFor(axes)` (+ `STACKS_FOR_EXCEPTIONS` declarada — o par mobile `flutter` → `['flutter','dart']`).

O gating de artefato deriva do **eixo declarado**, NUNCA do nome do arquivo (ADR-002): skills
**vendorizadas** pelo `stacks` do `.vendor-lock.json` (declarado na origem do vendor,
`scripts/vendor-skills.mjs`) e skills **locais** (sem entrada no lock) pelo mapa de **exclusão**
`SKILLS_BY_AXIS` + `SKILLS_COMMON`; `.agents/rules/**` pelo mapa de **exclusão** `RULES_BY_AXIS` +
`RULES_COMMON` (`installer/install.mjs:350-421`, validado na carga contra `AXIS_IDS` — declaração
inválida é falha de carga, nunca no-op silencioso; os dois mapas usam a mesma semântica de exclusão
por par `{eixo,id}` do destino). Perfis de backend **go**/**rust** ainda não existem; a rota para
eixos separados na pergunta está em `ADR-005` do ciclo `harness-eixos-stack`.

O perfil mobile `flutter`/`dart` continua sendo o caso especial declarado: `generateConfig` resolve
por `STACK_PROFILES` (puro). Perfil `flutter` → `mcp.required ['marionette_mcp','dart']`, `commands
{suiteFull:'flutter test', unit, analyze:'dart analyze'}`, `moduleMap {lib,test}`. Vendor de 22 skills
`dart-*`/`flutter-*` (BSD-3-Clause) com `.vendor-lock.json` + `scripts/vendor-skills.mjs --check`
(ADR-009). Wizard interativo W0..W7 + auto-detecção de `pubspec.yaml` (ADR-010); o menu `W2m` é em
**2 passos** (tipo de projeto → frontend, ADR-004) com range derivado de `WIZARD_MENU.length`.
Canário R3 agora por **escopo** (substring só em código/config; pula prosa `.md`).

## Este repo (atlas-agenda) — valores reais e regeneração do selo

> Nota de instalação (2026-11-02): o mapa de cima descreve o repo de origem
> (`harness`). Neste repo os valores reais são:

| Key | Valor real |
|---|---|
| `version` / `project` | `1` / `"atlas-agenda"` |
| `stack.backend` / `stack.frontend` | `node` / `react` (declarado no Q&A do instalador) |
| `commands.suiteFull` | `npm test && node --test ".opencode/plugins/__tests__/*.spec.mjs"` |
| `commands.unit` | `npm test` (`vitest run`) |
| `infra` | nulls — SPA Vite + Supabase via CLI; sem compose/portas no config |
| `scripts/static-checks.mjs` | **não existe neste repo** — não é comando canônico aqui |

Regra de resolução 🟠: todo segmento `npm`/`npm run <script>` de um comando canônico
precisa nomear um script declarado em `package.json`. Segmento que começa com `npm`
e não casa esse formato (flags/args, separador `;`) **falha** o guard — nunca é
ignorado em silêncio. Guard: `.opencode/plugins/__tests__/suite-command.spec.mjs`
(roda dentro do próprio `commands.suiteFull`). Bug que o guard fixa: `suiteFull`
apontava `npm run test:run`, script inexistente (o `package.json` só tem `test`),
logo a contraprova re-executava um comando que sempre falhava.
Nível 🟠 parcial (DOC-01): o guard garante que o comando canônico é **resolvível**,
não que suíte vermelha seja negada — `runContraprova` compara o `exitCode`
**declarado no report** com o observado (`gate.js:777-782`), não com `0`.

> Débito conhecido: `.harness-install.json` (`answers.suiteCommand`) ainda diz
> `npm run test:run`. É manifesto estático do instalador e não há caminho de
> regeneração neste repo — regenerar exige re-executar o instalador na origem.
> Não editar à mão.

### Selo publicado (ADR-002/U6=b)

`gate.js` lê o selo de `HARNESS_SEAL_JSON` (env do processo host —
`loadPublishedSeal`, `gate.js:919`). Neste repo **não há artefato de selo
versionado**: o trust root é o host, por desenho. Selo ausente/vazio ⇒ deny
`sealed-command-mismatch` com `cause: "empty-seal"` (`gate.js:155-157`), nunca
allow.

Gerar, após qualquer mudança em `commands.*`:

```sh
node --input-type=module -e 'import {readFileSync} from "node:fs"; import {sealCommands} from "./.opencode/plugins/lib/seal.mjs"; const {commands} = JSON.parse(readFileSync("harness.config.json","utf8")); console.log(JSON.stringify(sealCommands(commands)))'
```

Publicar no host:

```sh
export HARNESS_SEAL_JSON='{"suiteFull":"<hash>","unit":"<hash>"}'
```

O selo é hash (não segredo), mas não é versionado aqui porque o gate não lê
arquivo: uma cópia no worktree não provaria nada — quem escreve no worktree
escreve no selo.
