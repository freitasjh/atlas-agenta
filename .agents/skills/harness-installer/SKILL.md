# harness-installer — instalar a governança Harness v7 em outro repo

> Você NÃO precisa ler o SPEC. Este documento é auto-suficiente: siga o
> quickstart e pronto. (Detalhe de desenho vive em
> `.spec/governance/harness-installer/SPEC.md`, só se quiser o porquê.)

## 1. O que o instalador faz

Copia as camadas do harness (`.agents/`, `.opencode/plugins/`, skill) para o
repo de destino, **gera** o `harness.config.json` a partir de respostas suas
(nunca copia config de outro projeto), e valida tudo com checks. Ordem fixa:

```
inventário → backup → Q&A → geração → merge → manifesto → checks
```

Nada é escrito antes do backup existir e verificado (falha no backup = aborta).

## 2. Pré-requisitos

- Node >= 20 no destino. Verifique: `node --version`.
- Rode como seu usuário. Como root, só com `--allow-root` explícito.
- Nunca use `pkill -f` para nada neste fluxo.

## 3. Quickstart

```sh
# 1. Só relata o plano, não escreve nada (comece sempre por aqui):
node installer/install.mjs --target /caminho/do/destino --dry-run

# 2. Execução real (interativa, confirma por camada):
node installer/install.mjs --target /caminho/do/destino

# 3. Não-interativo (CI/agente sem tty):
node installer/install.mjs --target /caminho/do/destino --answers-file respostas.json --yes
```

Flags reais: `--target <dir>` (obrigatório), `--dry-run` (zero writes —
nem backup cria; só imprime plano + relatório), `--answers-file <json>`
(pula o Q&A; chaves = `project`, `stack`, `suiteCommand`, `pluginsDir`,
`deployToken` opcional), `--yes`/`-y` (aprova todas as camadas sem
perguntar), `--backup-dir <dir>`, `--allow-root`, `--help`.

Sem `--answers-file`, o Q&A pergunta no stdin (interativo ou pipado:
`printf ... | node installer/install.mjs --target X`). Com stdin fechado
(`< /dev/null`, sem tty e sem pipe) o CLI **aborta com instrução e sem
escrever nada** — nunca trava esperando tecla.

Antes de aplicar, o CLI imprime o plano (`create`/`merge`/`flag` por path)
e pede confirmação **por camada** (RF-10); `--yes` aprova tudo de uma vez.
`--dry-run` dispensa a confirmação (nada será aplicado).

Via API (para agentes):

```js
import { main } from './installer/install.mjs';
const out = main({
  target: '/caminho/do/destino',
  scriptedAnswers: {
    project: 'nome-do-projeto',          // obrigatório, não-vazio
    stack: 'node',                       // node | node-esm | java+vue | java+react | rust | nestjs | node+react | nestjs+react | rust+react | outra | flutter | dart
    suiteCommand: 'node --test',         // precisa resolver (PATH ou arquivo)
    pluginsDir: '/caminho/do/destino',   // precisa existir dentro do target
    // deployToken: '...'                // sensível: só memória, nunca em disco
  },
  incomingFiles: {
    'opencode.json': JSON.stringify({ plugin: ['harness'], instructions: ['...'] }),
    '.agents/rules/exemplo.md': '# regra\n',
  },
  options: { allowRoot: false, dryRun: false },
});
console.log(out.checks); // { passed: true, failed: [] } = instalado OK
```

## 4. Q&A — o que responder

| Pergunta (`key`) | Validação | Segredo? |
|---|---|---|
| `project` | não-vazio | não |
| `stack` | `node` \| `node-esm` \| `java+vue` \| `java+react` \| `rust` \| `nestjs` \| `node+react` \| `nestjs+react` \| `rust+react` \| `outra` \| `flutter` \| `dart` | não |
| `suiteCommand` | precisa resolver via `PATH` ou existir como arquivo | não |
| `pluginsDir` | precisa existir **dentro** do `--target` | não |
| `deployToken` | livre, opcional | **SIM — só memória** |

Resposta inválida = rejeitada, repete a pergunta. Campos sensíveis nunca vão
para manifesto, config ou log (são filtrados na serialização).

`flutter`/`dart` (perfil mobile — §9) exigem `pubspec.yaml` no target e usam o
discriminador `sdk: flutter`: pubspec declara `sdk: flutter` (ou uma dep/plugin
`flutter:`) ⇒ `flutter`; caso contrário ⇒ `dart`. Mismatch (`flutter` sem o
discriminador, ou `dart` com ele) = `BAD_ANSWER` (fail-closed).

## 5. Regras de merge (o que acontece com arquivo que já existe)

| Camada | Existe diferente → |
|---|---|
| `opencode.json` | merge **v2-only**: `agent`/`permission` são o bloco do harness ⇒ **substituídos** pelo incoming; `plugin`/`plugins` são a lista de **pacotes npm** do destino ⇒ preservados (união) e só perdem entradas sob `.opencode/plugins/` (o plugin local é auto-carregado); chave v1/dual (`agents`/`system`/`permissions`/`server`) removida **por forma**; `instructions` append; conflito real = flag |
| `.agents/agents/*` | anexa seção `Harness v7` se ausente; senão flag |
| `.agents/rules/*`, `.agents/skills/*`, `.opencode/plugins/*` | **flag** (nunca auto-merge de prosa/código) |
| `harness.config.json` | **sempre gerado** do Q&A (com backup do anterior) |
| `opencode.json` corrompido (JSON inválido) | **aborta**, nunca tenta merge |
| Flag pendente | checks = **FAIL** até humano resolver |

## 6. Backup — retenção e descarte (Y3)

- Onde fica: ao lado do destino, `.harness-backup-<nome>-<data>` (ou o que
  passar em `options.backupRoot`). **Exceção documentada:** o backup vive
  fora do `--target` por desenho — a trava de escrita cobre só arquivos
  instalados/mergeados, nunca o backup.
- O que contém: `opencode.json`, `harness.config.json`, `.agents/`,
  `.opencode/`, manifesto anterior. É arquivo do destino — nunca é enviado a
  lugar algum pelo instalador. Avise o humano onde ficou (`backupDir` no
  manifesto `.harness-install.json`).
- **Retenção:** guarde o backup até (a) todos os `flagged[]` resolvidos **e**
  (b) uma suite verde no destino. Só então pode descartar.
- **Descarte:** `rm -rf <backupDir>` (o path exato está em
  `.harness-install.json` → `backupDir`). Descarte antes disso = sem rede de
  volta; o instalador não apaga backup sozinho.
- **Rollback:** copie de volta os arquivos do `backupDir` para o target e
  apague `.harness-install.json`. O procedimento de rollback acima é completo:
  backup + manifesto bastam, nenhum outro estado existe. Re-instalação com
  manifesto presente aborta com instrução (apague ou siga o caminho de upgrade futuro).

## 7. Checks — como saber que deu certo

`out.checks.passed === true` (ou veredito PASS) significa: JSONs parseiam,
`harness.config.json` existe, nenhum flag pendente, zero **adoção** de stack
alheia nos arquivos instalados (`DENYLIST` publicada em `installer/install.mjs`).
FAIL lista o motivo acionável em `failed[]`.

Em `--dry-run` os checks **não rodam** (zero writes): `out.checks` volta
`{ passed: null, failed: [], ran: false, skipped: true, reason: 'dry-run: ...' }`
— `passed: null` é **desconhecido**, nunca leia como PASS (FU-28).

Todo erro do wizard/Q&A/checks usa o bloco padrão de 4 linhas
(installer-melhoria, ADRs 012):

```
[ERRO] <o quê — ex: opção '7' inválida>
  porquê: <código + motivo — ex: BAD_ANSWER: fora de [1,5]>
  como corrigir: <howToFix>
  onde ver: <arquivo:linha ou doc>
```

Dry-run declara `dry-run: NÃO EXECUTADO — nenhum write (plano + relatório
apenas)`. Sucesso imprime marcador pico-fim por etapa
(`[OK] <etapa>: pico-fim`).

O scan do canário (**R3**) é por **ESCOPO** (FU-32): a `DENYLIST` é procurada
como **substring** amplo, case-insensitive, mas **só em arquivos de
código/config** (`.js .mjs .cjs .ts .tsx .vue .svelte .java .kt .kts .gradle
.groovy .dart .cs .py .rb .go .rs .php .xml .json .yaml .yml .toml .properties
.lock .html .css .sh` + `Dockerfile`). `pubspec.yaml`/`package.json`/
`pom.xml`/`build.gradle` entram pela **extensão** (`.yaml`/`.json`/`.xml`/
`.gradle`) — nenhuma lista de basenames além de `Dockerfile` (sem extensão).
Prosa (`.md`, `.txt`) e binários **nunca** são escaneados; `.csv`, sem
extensão (exceto `Dockerfile`) também ficam **fora** — buraco declarado.
`scripts/` e `__tests__/` (tooling/testes do próprio harness) também ficam
fora do scan.

Por isso rules/skills do harness, que citam Vuetify/Lombok/... para bani-los,
instalam em destino limpo **sem falso-positivo** — e a **adoção real** em
código reprova: `require('vuetify/lib')`, `new Vuetify()`, `Vue.use(Vuetify)`,
dependência em `package.json`, coordenada Maven/Gradle `grupo:artifact[:versão]`,
`<artifactId>lombok</artifactId>`, etc.

## 8. Dogfood / teste em cópia (nunca no repo real)

```sh
node installer/dogfood.mjs --source /caminho/do/repo-real
```

- Copia a origem para `/tmp/harness-dogfood-<data>` (origem só leitura).
- Alvo fora de `/tmp` sem `--target` explícito + confirmação = **aborta**.
- **Trava destrutiva (C2):** `--target` igual à origem, ancestral ou
  descendente dela **aborta** antes de qualquer cópia/remoção.
- Ao final, a cópia é removida — também no caminho de falha (`try/finally`);
  falha de remoção vira `cleanup.error` e **não** some silenciosamente. A
  evidência fica em
  `.spec/governance/harness-installer/harness/<data>.json`.

Para um projeto **mobile (Flutter/Dart)**, use `installer/dogfood-mobile.mjs` —
ver §9.4.

## 9. Perfis de stack — registry único (e o que cada preset gera)

`STACK_PROFILES` (`installer/install.mjs`) é o **registry único** das capacidades por
preset: `axes` (`AXIS_IDS`: IDs de eixo `backend`/`frontend`), `backend`/`frontend`
(rótulos **literais**, nunca concatenados), `commands`, `mcp`, `moduleMap` e `stacks`.
Os **12 presets** são `node`, `node-esm`, `java+vue`, `java+react`, `rust`, `nestjs`,
`node+react`, `nestjs+react`, `rust+react`, `outra`, `flutter`, `dart` — `stacks` **não** é campo
independente: deriva do eixo por
`stacksFor(axes)` (+ tabela de exceções declarada `STACKS_FOR_EXCEPTIONS`).

O gating de artefato é **por eixo declarado**, nunca pelo nome do arquivo:
skills vendorizadas por `stacks` do vendor-lock (RF-03); skills **locais**
(sem entrada no lock) por `SKILLS_BY_AXIS` + `SKILLS_COMMON`; e
`.agents/rules/**` por `RULES_BY_AXIS` + `RULES_COMMON` (exclusão por eixo,
`installer/install.mjs`) — eixo decorativo é defeito, não detalhe.
Perfis de backend adicionais (**go**) ainda **não** existem (**rust**/**nestjs**
agora existem); a rota para eixos separados na pergunta está em `ADR-005` do
ciclo `harness-eixos-stack`.

O instalador instala em projetos mobile pela via normal (`--target` + Q&A ou
wizard). Este perfil foi desenhado para um repo Flutter/Dart com opencode.

### 9.0 Presets web (`java+vue` / `java+react`)

| Campo | `java+vue` | `java+react` |
|---|---|---|
| `stack.backend` / `frontend` | `java+vue backend/frontend (declared via Q&A)` | `java+react backend/frontend (declared via Q&A)` |
| `commands` | `{}` (default de suíte no Q&A) | `{}` |
| `mcp.required` | `['chrome-devtools']` | `['chrome-devtools']` |
| `stacks` (derivado) | `[]` | `['react']` |

`defaultSuiteFor('java+react')` e `defaultSuiteFor('java+vue')` sugerem
`npm run test:run` (1º candidato que resolve no `PATH`; se nenhum resolver,
retorna o 1º candidato) — o **eixo web inteiro** tem default de suíte, nunca
vazio (BUG-1 do ciclo `harness-eixos-stack-p2`).

### 9.1 Stacks e o que o perfil mobile gera

`STACK_PROFILES` é a única fonte das capacidades por stack (registry puro,
zero I/O); `generateConfig` resolve por lookup. O `harness.config.json` gerado
para mobile fica assim:

| Campo | `flutter` | `dart` |
|---|---|---|
| `stack.backend` / `frontend` | `flutter/dart mobile (Q&A)` | `dart package (Q&A)` |
| `commands.suiteFull` / `unit` | `flutter test` (default; sobrescrevível no Q&A) | `dart test` |
| `commands.analyze` | `dart analyze` | `dart analyze` |
| `mcp.required` | `['marionette_mcp', 'dart']` | `['dart']` |
| `moduleMap` | `+{lib: 'lib', test: 'test'}` | `+{lib: 'lib', test: 'test'}` |

O `mcp.required` é **declarativo** (nomeia os servers, não os define). O merge
do bloco `mcp` no `opencode.json` do destino é **aditivo** (only-add): host sem
`mcp` adota o do harness; host com `mcp` preserva o server existente, une
`required` e divergência real vira **flag** (nunca remove server).

### 9.2 Wizard W0..W7 (RF-15)

Sem `--answers-file` e com TTY, o CLI entra no wizard (camada de apresentação;
nunca escreve nem gera config sozinho — a aplicação é delegada ao `main`):

```
W0 pre-flight → W1 inventário → W2 detecção pubspec → (W2m menu se sem pubspec)
→ W3 Q&A guiado → W4 resumo+prévia → W5 confirmação por camada → W6 backup+aplicação
→ W7 manifesto+checks
```

- **W2 detecção** (`detect()`, line-based, sem parser YAML): lê `pubspec.yaml`,
  sugere `project`←`name`, `stack`←`sdk: flutter`/deps e `suiteCommand`←
  `flutter test`→`make test`→`dart test` (1ª que resolve). A origem é exibida
  como `(arquivo:linha)`. Sem `pubspec.yaml` ⇒ **W2m** menu em **2 passos**
  (ADR-004; o range é **derivado** de `WIZARD_MENU.length`, nunca literal):
  - **W2m-1** (`[1/2]`, `WIZARD_MENU`) — `1` App Flutter→flutter · `2` Pacote
    Dart→dart · `3` Projeto Node.js→node · `4` **Aplicação web (backend +
    frontend)**→`segue: frontend` · `5` Outro→outra.
  - **W2m-2** (`[2/2]`, `WIZARD_MENU_FRONTEND`, `(default: 1)`) — só no item `4`:
    `1` Vue→`java+vue` (default, reproduz o baseline) · `2` React→`java+react`.
  Todo prompt exibe contador `[i/total]` e `(q cancela)`; o passo inválido repete
  **o mesmo passo** com o bloco 4-linhas (linha 3 em linguagem de produto, linha 4
  com `arquivo:linha` do bloco) e `q` aborta (`USER_ABORT`, 0 writes).
  `node-esm` segue digitável em W3 (sem item próprio).
- **W3** valida cada resposta com `validateAnswer`; inválida = bloco 4-linhas +
  "como corrigir". Todo prompt exibe contador `[i/total]` e hint `(q cancela)`;
  `q`/`quit`/`cancel` aborta. Trocou a stack no W3 ⇒ o default
  de `suiteCommand` é recalculado para ela.
- **W4** imprime o resumo das respostas (segredos omitidos) + prévia do plano
  (`printPlan`). **W5** confirma por camada (`--yes` aprova tudo). Abort até o
  W5 = **0 writes**; de W6 em diante o rollback é via `backupDir`.
- `terminal:true` só em TTY real; pipe/redirect/`--answers-file` seguem o
  caminho v1 (`terminal:false`).

### 9.3 Vendor de skills filtrado por stack

`.agents/skills/.vendor-lock.json` (procedência: source + commit + `treeHash` +
`stacks`) é gerado pelo script **source-side** `scripts/vendor-skills.mjs`
(único ponto com rede; `node scripts/vendor-skills.mjs --check` recomputa o
`treeHash` e falha em drift). `install.mjs` é **rede-zero** (I8, check estático
V15).

No install, `collectIncoming(sourceDir, {stacks, stack})` filtra: skill com `stacks`
entra só se intersecta os stacks pedidos (`flutter` aceita `['flutter','dart']`);
skill sem `stacks` (comum) sempre entra; **sem lock ⇒ nada filtrado**
(retrocompat). O `.vendor-lock.json` **nunca** é copiado ao destino.

**Procedência por origem de licença** (`licenseOrigin`, ADR-003): `upstream-file`
(sha do arquivo de licença **real** do upstream — ex. stitch Apache-2.0) e
`declared-evidence` (o upstream não publica arquivo; sha do **nosso** texto +
`evidence[]` com URL/seção/commit — ex. vercel MIT). `react-components` é skill
**opcional** do preset react (`optional: true`: rede em runtime via
`scripts/fetch-stitch.sh`, `@swc/core` e Stitch MCP) — `optional` é **metadado de
procedência**, não "não instalar"; `react-best-practices` é a padrão do perfil.
O `VENDOR-NOTICE.md` declara a origem por fonte e as divergências conhecidas
(nunca afirma byte-identidade universal ao upstream).

### 9.4 Dogfood mobile (cópia Flutter sob /tmp)

```sh
node installer/dogfood-mobile.mjs --source /caminho/do/projeto-flutter
```

- Copia a origem para `/tmp/harness-dogfood-mobile-<data>` (origem **só
  leitura**; a trava `assertDogfoodTarget` **aborta** alvo fora de `/tmp`).
- **Trava destrutiva (C2):** `--target` igual à origem, **ancestral** ou
  **descendente** dela **aborta antes de qualquer `cp`/remoção**. Sem ela a
  limpeza final apagaria a origem inteira (ou o diretório pai, com os arquivos
  irmãos do usuário) — silenciosamente.
- Sanitiza as camadas que o harness possui na cópia (`.agents`, `.opencode`,
  `opencode.json`, `harness.config.json`, `.harness-install.json`) para simular
  um projeto Flutter **limpo** — a lista removida fica em `sanitized` na
  evidência.
- Dirige o **CLI real** (`runCli`, wizard W0..W7 por stdin TTY-simulado),
  valida o `harness.config.json` mobile (`assertMobileConfig`) + `checks.passed`,
  prova que re-instalação **aborta** e que a origem ficou intocada.
- Grava evidência no schema `harness-report` em
  `.spec/governance/harness-installer-mobile/harness/<data>.json` e remove a
  cópia + backup ao final (salvo `--keep`). A limpeza **nunca lança**: falha de
  remoção (EACCES/EBUSY) vira `cleanup.error`/`cleanupError`, e a nota
  (`cleanup.note`) diz a verdade sobre o que aconteceu. Remoção fora do `/tmp`
  autorizado é **bloqueada**, não executada. Backups órfãos
  (`.harness-backup-<basename da cópia>-*` criados durante a execução, ex.:
  falha entre `backup()` e `applyMerge`) são varridos e removidos.

Flags: `--source <dir>` (obrigatório), `--keep`, `--target <dir>`,
`--evidence-dir <dir>`, `--suite-command <cmd>` (default: detectado),
`--brain-store <path,...>`.

#### 9.4.1 Como o isolamento da origem é provado (FU-34/C1)

O estado da origem (`sourceState`, compartilhado com `dogfood.mjs` via
`installer/dogfood-common.mjs`) é uma **assinatura**, não um status:

| Peça | Papel |
|---|---|
| `git status --porcelain -z -uall` | `-z` = separador NUL, **sem C-quoting**: `café.dart`, `we"ird.dart`, `back\slash.dart`, `a -> b.dart` chegam **literais**. `-uall` = arquivos untracked dentro de diretório untracked entram um a um (sem ele o porcelain resumiria `?? lib/` e o digest ficaria cego). Rename/copy = 2 campos (`to\0from`), ambos hasheados. |
| digest de **conteudo** | mutação de conteúdo em arquivo *já modificado* (mesmo status, mesmo tamanho) muda a assinatura — `git status --short` sozinho nunca provaria isso. |
| `coverage` / `hashLimit` | documentos na evidência: cobertura (`porcelain-entries` no caminho git, `full-tree` sem git) e o teto por arquivo. |

**Limites declarados (A5):**

1. **Teto de 8 MB por arquivo** (`CONTENT_HASH_LIMIT`): acima dele o hash
   carrega `size:mtime`, não o conteúdo — mutação de conteúdo em arquivo
   > 8 MB com mesmo tamanho e mesmo mtime não é detectada.
2. **Cobertura do digest:** no caminho git, somente as entradas do porcelain
   (com `-uall`: modificados, staged, untracked e renames — **arquivos
   ignorados pelo `.gitignore` não entram**); sem git, a árvore inteira
   (excluindo `.git` e `node_modules`).

## 10. `init` greenfield (create-only W0–W7) — installer-melhoria (ADR-013)

```sh
node installer/install.mjs init --target <dir> [--dry-run] [--answers-file <json>] [--yes] [--backup-dir <dir>] [--allow-root]
```

- Executa o wizard W0–W7 (§9.2) com gate create-only: após W4 (prévia via
  `planMerge`), qualquer `merge|flag` no plano **aborta** com bloco 4-linhas
  (`porquê: target não-limpo`, `como corrigir: rode doctor / limpe o destino`).
- Todo prompt W3 exibe `[i/total]` + `(q cancela)`.
- Exit `0` sucesso/help; `1` abort
  (`BAD_TARGET|BAD_ANSWER|BACKUP_FAIL|NO_STDIN|USER_ABORT|flagged-open`).
  Com `--dry-run`: plano + relatório apenas, nem backup cria.

## 11. `doctor` brownfield (read-only D0–D6) — installer-melhoria (ADR-014)

```sh
node installer/install.mjs doctor --target <dir> [--answers-file <json>] [--backup-dir <dir>] [--allow-root]
```

- 7 passos, todos read-only: D0 pre-flight (só leitura) → D1 inventário →
  D2 detecção pubspec (com fontes `arquivo:linha`) → D3 plano seco
  (`planMerge`, sem `apply`) → D4 checks + scan de escopo → D5 manifesto
  existente (lê `.harness-install.json`; nunca escreve) → D6 relatório por
  camada (`create|merge|flag|noop` + `checks.failed[]` em blocos 4-linhas +
  próximos passos).
- Zero writes por construção: o caminho do doctor nunca chama `applyMerge`,
  `writeManifest` nem `apply`. Sem `--fix` (fora de escopo); humano resolve e
  roda o fluxo de escrita. `--dry-run`/`--yes` são ignorados (read-only).

