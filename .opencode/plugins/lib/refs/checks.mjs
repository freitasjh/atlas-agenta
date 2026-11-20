// checks.mjs — prosa órfã (ADR-005): a rubric de 6 classes como mecanismo.
//
// Contract (SPEC RF-01/RF-03): `runRefsChecks(root)` →
//   { ok: boolean, results: [{ id, status: "PASS"|"FAIL", detail, counters? }] }
// com os ids `missing-and-unclassified`, `stale-baseline-entry`,
// `baseline-entry-incomplete`, `nondefect-entry-incomplete`,
// `stale-nondefect-entry` e `link-ref-citation-form` (RC6/N30). `counters` é
// aditivo e carrega os números que o
// `detail` narra — `stale-baseline-entry` publica `{ vendorOnly }` para que o
// adapter emita a dívida vendorizada também em PASS (ADR-005 §8-N18).
//
// A decisão que este arquivo executa é a régua, não a lista de casos: cada
// referência ausente cai numa classe por predicado de PATH, nunca por conteúdo
// nem por data (SPEC I3). As 6 classes da ADR-005 §2.3:
//
//   C1 live-orphan          alvo ausente, citante vivo, sem supressão
//                           → BASELINE (dívida com dono) ou FAIL
//   C2 foreign-baseline     C1 cujo assunto declara, NA ENTRADA DA BASELINE,
//                           um eixo ausente (dono + motivo + reativação). A
//                           classe é do registro, não um predicado sobre o
//                           config: o check nunca lê `targets.*` para decidir
//                           se a dívida existe — ele confia na entrada e
//                           expira quando a citação desaparece.
//                           → BASELINE (dívida com dono + reativação)
//   C3 declared-non-defect  citação em NON_DEFECT (reason + proof) → suprimida
//   C4 vendor-internal      todos os citantes em skill do `.vendor-lock.json`
//                           → suprimida (derivada do lock, nunca do prefixo)
//   C5 dated-record         citante fora do corpus vivo → não varrido
//   C6 live-conflict        duas fontes vivas divergem sobre o mesmo sujeito
//                           → NÃO é detectável por esta gramática (declarado
//                           na ADR-005 §2.5: resolve-se na tabela §3-C e na
//                           revisão, não por token)
//
// Gramática do detector — escopo DECLARADO, não implícito (ADR-005 §2.5):
// casa exatamente o predicado do RF-03, `rules/[a-z0-9-]+\.md`. Consequência
// declarada: os 13 paths da tabela A ficam cobertos; os 8 da tabela B
// (`.doc/**`, `.doc/`, `frontend/DESIGN.md`, `AGENTS.md`) ficam classificados
// na ADR e SEM detecção automática até o PRD 2 declarar um segundo regex.
//
// Escopo por PATH DO CITANTE (SPEC RF-04 / I3): vivo = `^(\.agents/|opencode\.json$)`.
// `docs/`, `harness/` e `.spec/` são registro datado — o walker os percorre de
// propósito e o predicado os descarta, para que a exclusão seja provada e não
// apenas presumida por não olhar.
//
// Limite declarado na BASELINE (ADR-005 §8-N13): uma entrada cuja ÚNICA citação
// viva está numa skill do `.vendor-lock.json` nunca expira pelo modo (b) — a
// citação existe, o lock só a suprime em C4. Não é classe nova nem FAIL: o
// número sai no detalhe de `stale-baseline-entry` (`sustentadas só por citação
// vendorizada=N`) para a dívida não ficar silenciosa.
//
// Purity (SPEC I1): `node:fs`/`node:path` read-only; sem rede, sem MCP, sem
// child process, sem gravação. Vive em `.opencode/plugins/lib/**`, caminho que
// `scripts/harness-sync.mjs` copia para o destino — o destino herda o check,
// não o vermelho (ADR-005 §5-C7).
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, sep } from "node:path";

// --- Gramática ------------------------------------------------------------
// O mesmo predicado do RF-03. `g` é obrigatório: uma linha pode citar N paths.
export const REF_RE = /rules\/[a-z0-9-]+\.md/g;

// RC6 / N30 (ADR-004 §2.4): definição de link-ref markdown. `citesToken` do
// V19 casa o rótulo entre parênteses e compraria `consumer` falso. O detector
// reprova a FORMA, não o token em prosa normal (predicado restrito ao link-ref).
export const LINK_REF_RE = /^\[\/\/\]: # \(([^)]*)\)/;

// Prefixo do corpus vivo — a fronteira é path, não conteúdo (SPEC I3).
export const LIVE_CITER_RE = /^(\.agents\/|opencode\.json$)/;

const SCANNED_ROOTS = [".agents", "docs", "harness", ".spec"];
const SCANNED_FILES = ["opencode.json"];
const SKIPPED_DIRS = new Set(["node_modules", ".git"]);

// --- Classes (ADR-005 §2.3) -----------------------------------------------
export const CLASS_LABELS = Object.freeze({
  C1: "live-orphan",
  C2: "foreign-baseline",
  C3: "declared-non-defect",
  C4: "vendor-internal",
  C5: "dated-record",
  C6: "live-conflict",
});

// A baseline só admite as classes com AÇÃO de dívida declarada. C3/C4 são
// suprimidas por mecanismo (lista com razão / lock) e não ocupam entrada.
export const BASELINE_CLASSES = new Set(["C1", "C2"]);

const EIXO_NA = "eixo backend sem stack Java declarada (harness.config.json.targets.backend)";

// --- Baseline (dívida declarada, nunca permissão — SPEC I2) ---------------
// ADR-004 removeu 6 das 7 entradas: SSoT reapontada (RC1), regra local já
// viaja (RC4) e 4 rules Java fora de suporte (RC2). Resta 1: a única citação
// viva que mantém `rules/backend-coding-standards.md` referenciada
// (dev-planner/SKILL.md:204). Dívida com dono PRD-4 + reativação.
// O pin de módulo que acompanhava esta nota (`lib/cdl/**`) saiu com o V20 em
// v2/F1 — o módulo foi apagado com o instalador, não é mais restrição. A
// entrada NÃO cita instalador e permanece: é dívida do eixo backend, medida
// pelo próprio `runRefsChecks`.
export const BASELINE = Object.freeze([
  {
    path: "rules/backend-coding-standards.md",
    class: "C2",
    reason: `${EIXO_NA}; ADR-004 §4.1 — dívida com dono PRD-4 (prd-axes-split), reativar quando o eixo backend voltar`,
    owner: "PRD-4",
    prd: "prd-axes-split",
  },
]);

// --- Declared non-defect (C3) --------------------------------------------
// Lista literal com reason + proof: o detector REPORTARIA esta citação, logo
// ela precisa de registro explícito. `AGENTS.md` NÃO entra aqui: está fora da
// gramática acima (é nome de arquivo do repo-destino, sem prefixo de diretório).
//
// v2 (F1): a lista está VAZIA. A única entrada era `rules/exemplo.md`, provada
// por uma string de fixture na skill do instalador v1 (linha 68) — skill
// apagada junto com o instalador. Sem o citante, não há citação a
// suprimir: manter a entrada seria uma prova morta (o próprio check a
// reprovaria). O MECANISMO continua vivo e testado com entradas sintéticas:
// `validateNonDefect` + `validateNonDefectStale` rodam sobre esta lista e o
// `runRefsChecks` aceita `nonDefect` injetado (fixtures de
// `refs.spec.mjs:PO-03/PO-04`). O que a remoção deixa de medir: nada do
// corpus real — não existe mais nenhuma supressão C3 em produção.
export const NON_DEFECT = Object.freeze([]);

// --- Helpers puros --------------------------------------------------------

export function posixPath(p) {
  return String(p).split(sep).join("/");
}

export function isLiveCiter(relPath) {
  return LIVE_CITER_RE.test(posixPath(relPath));
}

// A referência citada é `rules/<slug>.md`; o alvo no disco mora sob `.agents/`
// (mesmo `test -e ".agents/$p"` da ADR-005 §1).
export function diskPathOf(target) {
  const t = posixPath(target);
  return t.startsWith(".agents/") ? t : `.agents/${t}`;
}

// Entrada sem `class` válida, `owner`, `prd` ou `reason` é FAIL do próprio
// check (ADR-005 §4 item 4) — nunca do revisor.
export function validateBaseline(entries) {
  const issues = [];
  for (const [i, e] of entries.entries()) {
    const label = e && e.path ? e.path : `BASELINE[${i}]`;
    if (!e || typeof e.path !== "string" || e.path.trim() === "") {
      issues.push(`${label}: path ausente`);
    }
    if (!e || !BASELINE_CLASSES.has(e.class)) {
      issues.push(`${label}: class fora de {C1, C2} ("${e ? e.class : ""}")`);
    }
    for (const key of ["reason", "owner", "prd"]) {
      if (!e || typeof e[key] !== "string" || e[key].trim() === "") {
        issues.push(`${label}: ${key} ausente`);
      }
    }
  }
  return issues;
}

// C3: a lista É o registro; entrada sem reason/proof não suprime nada.
export function validateNonDefect(entries) {
  const issues = [];
  for (const [i, e] of entries.entries()) {
    const label = e && e.path ? e.path : `NON_DEFECT[${i}]`;
    if (!e || typeof e.path !== "string" || e.path.trim() === "") {
      issues.push(`${label}: path ausente`);
    }
    for (const key of ["reason", "proof"]) {
      if (!e || typeof e[key] !== "string" || e[key].trim() === "") {
        issues.push(`${label}: ${key} ausente`);
      }
    }
  }
  return issues;
}

// C3 — a supressão apodrece como a baseline (ADR-005 §8-N11/N17). `proof` é
// `arquivo:linha`; a entrada só suprime enquanto o arquivo existir, a linha
// estiver no arquivo, essa linha citar o path **e** a prova for citação viva
// (`isLiveCiter(proof.file)`) de um path que ainda tem ≥1 citação viva. Uma
// prova em `.spec/archive/**` cita o path e não sustenta nada: o registro
// datado não é testemunha do corpus (ADR-005 §2.1). Verificada em TODAS as
// entradas.
export function parseProof(proof) {
  if (typeof proof !== "string") return null;
  const m = /^(.+):(\d+)$/.exec(proof.trim());
  if (!m) return null;
  return { file: m[1], line: Number(m[2]) };
}

export function validateNonDefectStale(entries, root, citations = collectCitations(root)) {
  const issues = [];
  for (const e of entries) {
    // `path` ausente já é issue de `validateNonDefect` — aqui não duplica.
    if (!e || typeof e.path !== "string" || e.path.trim() === "") continue;
    const target = posixPath(e.path);
    if (existsSync(join(root, diskPathOf(target)))) {
      issues.push(`${target} (o arquivo passou a existir no disco)`);
      continue;
    }
    const parsed = parseProof(e.proof);
    if (!parsed) {
      issues.push(`${target} (proof fora do formato arquivo:linha: "${e.proof ?? ""}")`);
      continue;
    }
    // O citante da prova tem de estar no corpus vivo: registro datado cita o
    // path e mesmo assim não é testemunha (ADR-005 §8-N17).
    if (!isLiveCiter(parsed.file)) {
      issues.push(`${target} (proof ${parsed.file} não é citante vivo: registro datado não sustenta a supressão)`);
      continue;
    }
    let lines;
    try {
      lines = readFileSync(join(root, parsed.file), "utf8").split("\n");
    } catch {
      issues.push(`${target} (proof ausente no disco: ${parsed.file})`);
      continue;
    }
    if (parsed.line < 1 || parsed.line > lines.length) {
      issues.push(
        `${target} (proof ${parsed.file}:${parsed.line} fora do arquivo: ${lines.length} linha(s))`,
      );
      continue;
    }
    if (!lines[parsed.line - 1].includes(target)) {
      issues.push(`${target} (proof ${parsed.file}:${parsed.line} não cita o path)`);
      continue;
    }
    // A prova ser viva não basta: o path precisa continuar citado no corpus
    // vivo coletado — senão a supressão sobrevive à citação que a justificava.
    if ((citations.get(target) ?? []).length === 0) {
      issues.push(`${target} (0 citações vivas no corpus: a supressão é órfã)`);
    }
  }
  return issues;
}

// --- Varredura ------------------------------------------------------------

function collectCandidateFiles(root) {
  const out = [];
  for (const rel of SCANNED_FILES) {
    try {
      if (statSync(join(root, rel)).isFile()) out.push(rel);
    } catch {
      // ausente: nada a varrer
    }
  }
  const walk = (relDir) => {
    let entries;
    try {
      entries = readdirSync(join(root, relDir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const rel = `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) walk(rel);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  };
  for (const rel of SCANNED_ROOTS) walk(rel);
  return out;
}

// Citações dos citantes VIVOS. O registro é varrido e descartado de propósito:
// a exclusão é o predicado (isLiveCiter), provada por fixture.
function collectCitations(root) {
  const byTarget = new Map();
  for (const rel of collectCandidateFiles(root)) {
    if (!isLiveCiter(rel)) continue;
    let text;
    try {
      text = readFileSync(join(root, rel), "utf8");
    } catch {
      continue;
    }
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const hits = lines[i].match(REF_RE) ?? [];
      for (const target of new Set(hits)) {
        if (!byTarget.has(target)) byTarget.set(target, []);
        byTarget.get(target).push({ citer: rel, line: i + 1 });
      }
    }
  }
  return byTarget;
}

// C4 derivada do lock, NUNCA do prefixo do nome (ADR-002/ADR-005 §6).
function readLockSkills(root) {
  try {
    const parsed = JSON.parse(readFileSync(join(root, ".agents", "skills", ".vendor-lock.json"), "utf8"));
    const skills = parsed && parsed.skills;
    return skills && typeof skills === "object" && !Array.isArray(skills)
      ? new Set(Object.keys(skills))
      : new Set();
  } catch {
    // Fail-closed: sem lock não há supressão derivável — a citação vira C1.
    return new Set();
  }
}

const VENDOR_CITER_RE = /^\.agents\/skills\/([^/]+)\//;

function isVendorCiter(citer, lockSkills) {
  const m = VENDOR_CITER_RE.exec(citer);
  return Boolean(m) && lockSkills.has(m[1]);
}

function citeList(cites, limit = 3) {
  const shown = cites.slice(0, limit).map((c) => `${c.citer}:${c.line}`).join(", ");
  return cites.length > limit ? `${shown} (+${cites.length - limit})` : shown;
}

// Skills conhecidas = diretórios vivos em `.agents/skills/**` ∪ chaves do lock.
// Nenhuma toolchain nova: é o mesmo read-only fs já usado pelo walker.
function readSkillNames(root) {
  const names = new Set(readLockSkills(root));
  try {
    for (const entry of readdirSync(join(root, ".agents", "skills"), { withFileTypes: true })) {
      if (entry.isDirectory()) names.add(entry.name);
    }
  } catch {
    // sem diretório de skills, vale o lock (fixture mínima)
  }
  return names;
}

// Mesma fronteira de token de `citesToken` (inventário): `-`/`_` no alfabeto,
// para não confundir `security-review` com `security-review-extra`.
function hasTokenBoundary(text, token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`).test(text);
}

function collectLinkRefCitations(root, skillNames) {
  const found = [];
  for (const rel of collectCandidateFiles(root)) {
    if (!isLiveCiter(rel)) continue;
    let text;
    try {
      text = readFileSync(join(root, rel), "utf8");
    } catch {
      continue;
    }
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = LINK_REF_RE.exec(lines[i].trim());
      if (!m) continue;
      for (const skill of skillNames) {
        if (hasTokenBoundary(m[1], skill)) {
          found.push({ citer: rel, line: i + 1, label: m[1], skill });
        }
      }
    }
  }
  return found;
}

function linkRefDetail(hits) {
  return hits.length
    ? `${hits.length} link-ref(s) com nome de skill: `
      + hits.slice(0, 3).map((h) => `${h.citer}:${h.line} → "${h.skill}"`).join("; ")
    : "link-ref que compra consumer=0 (skills conhecidas por diretório/lock)";
}

function vacuous(detail) {
  return {
    ok: true,
    results: [
      { id: "missing-and-unclassified", status: "PASS", detail },
      { id: "stale-baseline-entry", status: "PASS", detail },
      { id: "baseline-entry-incomplete", status: "PASS", detail },
      { id: "nondefect-entry-incomplete", status: "PASS", detail },
      { id: "stale-nondefect-entry", status: "PASS", detail },
      { id: "link-ref-citation-form", status: "PASS", detail },
    ],
  };
}

// --- API ------------------------------------------------------------------

export function runRefsChecks(root = process.cwd(), opts = {}) {
  // `nonDefect` injetável: a lista de produção está vazia em v2 (o citante que
  // a justificava foi apagado com o instalador) e o MECANISMO C3 continua
  // coberto por fixtures que passam entradas sintéticas — sem isso o caminho
  // de supressão viraria código morto não testado.
  const nonDefect = Array.isArray(opts.nonDefect) ? opts.nonDefect : NON_DEFECT;
  if (!existsSync(join(root, ".agents"))) {
    return vacuous("N/A — .agents/ ausente (vacuous-safe)");
  }

  const lockSkills = readLockSkills(root);
  const citations = collectCitations(root);
  const baselineByPath = new Map(BASELINE.map((e) => [posixPath(e.path), e]));
  const nonDefectPaths = new Set(nonDefect.map((e) => posixPath(e.path)));

  // Modo (a): referência viva a path ausente FORA da baseline.
  const missing = [];
  for (const [target, cites] of citations) {
    if (existsSync(join(root, diskPathOf(target)))) continue;
    if (baselineByPath.has(target)) continue; // dívida declarada, com dono
    if (nonDefectPaths.has(target)) continue; // C3
    if (cites.every((c) => isVendorCiter(c.citer, lockSkills))) continue; // C4
    missing.push({ target, cites });
  }
  missing.sort((a, b) => a.target.localeCompare(b.target));

  // Modo (b): a classificação apodreceu — o path passou a existir ou perdeu
  // toda citação viva. Baseline que não encolhe nunca é dívida (SPEC E4).
  // Limite declarado (N13): entrada sustentada SÓ por citação vendorizada não
  // expira aqui — é contada e nomeada no detalhe, nunca escondida.
  const stale = [];
  const vendorOnly = [];
  for (const entry of BASELINE) {
    const target = posixPath(entry.path);
    if (existsSync(join(root, diskPathOf(target)))) {
      stale.push(`${target} (o arquivo passou a existir no disco)`);
      continue;
    }
    const cites = citations.get(target) ?? [];
    if (cites.length === 0) {
      stale.push(`${target} (0 citações vivas)`);
    } else if (cites.every((c) => isVendorCiter(c.citer, lockSkills))) {
      vendorOnly.push(`${target} ← ${citeList(cites)}`);
    }
  }
  const vendorNote =
    `sustentadas só por citação vendorizada=${vendorOnly.length}`
    + (vendorOnly.length ? ` (${vendorOnly.join("; ")})` : "");

  const baselineIssues = validateBaseline(BASELINE);
  const nonDefectIssues = validateNonDefect(nonDefect);
  // Modo (c): a supressão de C3 apodreceu (ADR-005 §8-N11/N17). Reaproveita as
  // citações já coletadas — a régua é a mesma, sem segunda varredura.
  const nonDefectStale = validateNonDefectStale(nonDefect, root, citations);
  // RC6 / N30: forma de citação que o V19 ainda casa como `consumer`.
  const linkRefHits = collectLinkRefCitations(root, readSkillNames(root));

  const results = [
    {
      id: "missing-and-unclassified",
      status: missing.length ? "FAIL" : "PASS",
      detail: missing.length
        ? `${missing.length} path(s) ausente(s) citado(s) por prosa viva fora da BASELINE: `
          + missing.map((m) => `${m.target} ← ${citeList(m.cites)}`).join("; ")
        : `órfãs vivas não classificadas=0 (baseline=${BASELINE.length}, non-defect=${nonDefect.length}, skill(s) no lock=${lockSkills.size})`,
    },
    {
      id: "stale-baseline-entry",
      status: stale.length ? "FAIL" : "PASS",
      detail: stale.length
        ? `BASELINE com ${stale.length} entrada(s) obsoleta(s): ${stale.join("; ")}; ${vendorNote}`
        : `BASELINE com ${BASELINE.length} entrada(s) ainda ausente(s) e citada(s); ${vendorNote}`,
      // Estruturado para o adapter: dívida vendorizada não pode depender de o
      // check estar vermelho para ser lida (ADR-005 §8-N18).
      counters: { vendorOnly: vendorOnly.length },
    },
    {
      id: "baseline-entry-incomplete",
      status: baselineIssues.length ? "FAIL" : "PASS",
      detail: baselineIssues.length
        ? `BASELINE inválida: ${baselineIssues.join("; ")}`
        : `BASELINE com ${BASELINE.length} entradas, todas com class/owner/prd/reason`,
    },
    {
      id: "nondefect-entry-incomplete",
      status: nonDefectIssues.length ? "FAIL" : "PASS",
      detail: nonDefectIssues.length
        ? `NON_DEFECT inválida: ${nonDefectIssues.join("; ")}`
        : `NON_DEFECT com ${nonDefect.length} entrada(s), com reason/proof`,
    },
    {
      id: "stale-nondefect-entry",
      status: nonDefectStale.length ? "FAIL" : "PASS",
      detail: nonDefectStale.length
        ? `NON_DEFECT com ${nonDefectStale.length} entrada(s) obsoleta(s): ${nonDefectStale.join("; ")}`
        : `NON_DEFECT com ${nonDefect.length} entrada(s), todas com proof vivo (arquivo:linha cita o path)`,
    },
    {
      id: "link-ref-citation-form",
      status: linkRefHits.length ? "FAIL" : "PASS",
      detail: linkRefDetail(linkRefHits),
      counters: { linkRefs: linkRefHits.length },
    },
  ];

  return { ok: results.every((r) => r.status === "PASS"), results };
}

// A ADR-005 §4 item 2 nomeia `runRefChecks`; a SPEC RF-01 nomeia
// `runRefsChecks`. Um alias, uma implementação — nenhuma divergência de contrato.
export function runRefChecks(root = process.cwd(), opts = {}) {
  return runRefsChecks(root, opts);
}
