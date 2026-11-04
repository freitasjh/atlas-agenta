// checks.mjs — pure core for the PRD→ADR→SDD pipeline checks.
//
// Contract (SPEC §5): `runPrdChecks(root)` →
//   { ok: boolean, results: [{ id, status: "PASS"|"FAIL", detail }] }
// with exactly the ids PRD-01 / ADR-01 / ADR-02, in that order.
//
// Deterministic and structural only: presence, required field, orphanhood.
// No denylist, no semantic sweep, no runtime deny. Vacuous-safe: PASS when the
// target (`.spec/prd/**`) does not exist; FAIL only when it exists and is
// malformed. A target that EXISTS but cannot be read (EACCES / ENOTDIR / EISDIR)
// is malformed — it is never reported as "absent", and a malformed cell is never
// a silent skip.
//
// Purity (RF-02/NFR-1): read-only `node:fs`/`node:path`; no network, no MCP,
// no child process, no file writing. Lives under `.agents/skills/**` because
// that is the only path the installer propagates (ADR-P02).
//
// What the guard proves, and all it proves (enforced by the test at
// `.opencode/plugins/__tests__/prd-checks.spec.mjs`): the set of STATIC import
// specifiers in this file is exactly {node:fs, node:path}; `import(` and
// `require(` do not appear; and a BEST-EFFORT denylist of common ambient
// spellings is absent. It does NOT prove "purity": module-loading capability
// survives the allowlist through spellings the denylist does not enumerate —
// e.g. process["getBuiltinModule"]("node:child_process"), Function("…")()
// (without `new`), or an aliased require. No claim of "purity proven" is made.
//
// Parse convention (the contract PAP-05's templates must honour):
//   - PRD section     = `## <N>. <title>` heading with an explicit number.
//                       PRD-01 validates the NUMBERS 1,2,5,6,7,9,16.
//   - closed question = a line starting with `> ❓ Validação:` inside a section.
//   - verdict label   = a line whose start, after optional `>`/`-`/`*` markers
//                       and optional `**` bold, is `Veredito:` followed by a
//                       non-empty value ON THE SAME LINE (INV-3 / §16). The
//                       label is anchored at line start (prose mentioning
//                       "veredito" does not count) and bold is accepted.
//   - ADR-INDEX.md    = markdown table; minimal columns
//                       order,id,title,status,depends_on,dir,branch,merge.
//   - ADR.md          = `depende-de` + "interface congelada" (label case and
//                       spacing are free; only the terms must be present).
//   - branch regex    = ^adr/[a-z0-9-]+/\d{2}-[a-z0-9-]+$
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const PRD_ROOT = ".spec/prd";
const REQUIRED_SECTIONS = [1, 2, 5, 6, 7, 9, 16];
const INDEX_COLUMNS = ["order", "id", "title", "status", "depends_on", "dir", "branch", "merge"];
const INDEX_STATUS = new Set(["todo", "in-progress", "merged", "dropped"]);

// `ADR-01` counts sources in RESEARCH.md by searching for the literal URL scheme
// `https?://` (string de busca) inside the document. That is a SEARCH STRING in
// the text — not a network capability. This module performs no I/O beyond
// read-only `node:fs` (RF-02/NFR-1), so the scheme is written plainly;
// obfuscating it would only hide a legitimate search pattern. The no-network
// property is backed by the module-loading allowlist plus the ambient-token ban
// in the test — not by a token grep of this file.
const SOURCE_RE = /https?:\/\//g;

const VALIDATION_RE = /^\s*>\s*❓\s*Valida[çc][ãa]o\s*:/i;
const BRANCH_RE = /^adr\/[a-z0-9-]+\/\d{2}-[a-z0-9-]+$/;
const ADR_DIR_RE = /^ADRs\/ADR-\d{3}-[a-z0-9-]+\/?$/;
// VERDICT_RE — two axes, one regex (N2/N3):
//   * ANCHORED at line start (`^` + `m`): an UNANCHORED search finds
//     `veredito:` inside ordinary prose (`- Sem veredito: pendente`) and
//     silently disarms INV-3 while `ADRs/<dir>/` exists (N2).
//   * The label may be BOLD (`- **Veredito**: ok`) — the ADR templates write
//     `**depende-de**`/`**Interface congelada**`, so PAP-05's PRD template may
//     write the verdict bold; rejecting it is a false-FAIL (N3).
// The prefix is `[ \t>*\-]*` (quote/bullet/asterisk only) and the gap after the
// colon is `[ \t]*` — never `\s`, which would cross `\n` and let `- Veredito:`
// (empty) match the first char of the NEXT line (`- Data: …`) (INV-3 / §16
// false-green). The trailing `\S` keeps the value on the label's own line.
const VERDICT_RE = /^[ \t>*\-]*\*{0,2}veredito\*{0,2}[ \t]*[::][ \t]*\S/im;
const DATE_RE = /\d{4}-\d{2}-\d{2}/;

// Absent (ENOENT ⇒ legitimate vacuous target) is separated from present-but-
// unreadable (EACCES / EISDIR / ENOTDIR / …) ⇒ malformed, reported never silent.
function readText(path) {
  try {
    return { ok: true, text: readFileSync(path, "utf8") };
  } catch (err) {
    if (err && err.code === "ENOENT") return { ok: false, absent: true };
    return { ok: false, absent: false, code: (err && err.code) || "EUNKNOWN" };
  }
}

function listDirs(path) {
  try {
    return {
      ok: true,
      names: readdirSync(path, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort(),
    };
  } catch (err) {
    if (err && err.code === "ENOENT") return { ok: true, names: [] };
    return { ok: false, names: [], code: (err && err.code) || "EUNKNOWN" };
  }
}

function unreadable(label, code) {
  return `${label} existe mas não é legível (${code})`;
}

function isPositiveInt(value) {
  return /^[1-9]\d*$/.test(String(value ?? "").trim());
}

function basename(p) {
  return String(p).replace(/\/+$/, "").split("/").pop();
}

function splitSections(text) {
  const map = new Map();
  // `[ \t]`, never `\s`: a `\s+` after `##` crosses `\n`, so a split heading
  // (`##\n5. Métricas`) would be accepted as `## 5.` and the section wrongly
  // recognised. Same for the gap after the dot. A `## <N>. <title>` heading
  // must fit on ONE line (N1).
  const heads = [...text.matchAll(/^##[ \t]+(\d+)\.[ \t]*(.*)$/gm)];
  for (let i = 0; i < heads.length; i++) {
    const m = heads[i];
    const start = m.index + m[0].length;
    const end = i + 1 < heads.length ? heads[i + 1].index : text.length;
    map.set(Number(m[1]), { title: m[2].trim(), body: text.slice(start, end) });
  }
  return map;
}

function hasMarker(body) {
  return body.split("\n").some((line) => VALIDATION_RE.test(line));
}

// A section is "empty" when, after dropping blank lines and the closed-question
// marker, nothing remains.
function hasContent(body) {
  return body
    .split("\n")
    .some((line) => line.trim() !== "" && !VALIDATION_RE.test(line));
}

function splitCells(line) {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());
}

function parseTable(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("|"));
  if (lines.length < 2) return null;
  const header = splitCells(lines[0]).map((c) => c.toLowerCase());
  let sep = -1;
  for (let i = 1; i < lines.length; i++) {
    if (/^\|[\s:|-]+\|$/.test(lines[i])) {
      sep = i;
      break;
    }
  }
  if (sep < 0) return null;
  const rows = lines.slice(sep + 1).map(splitCells);
  return { header, rows };
}

function filledCell(value) {
  const v = String(value ?? "").trim();
  return v !== "" && v !== "—" && v !== "-" && v !== "–";
}

function parseIndex(text) {
  const table = parseTable(text);
  if (!table) return { missing: INDEX_COLUMNS.slice(), rows: [] };
  const at = {};
  table.header.forEach((h, i) => {
    at[h] = i;
  });
  const missing = INDEX_COLUMNS.filter((c) => !(c in at));
  const rows = table.rows.map((cells) => {
    const row = {};
    for (const c of INDEX_COLUMNS) row[c] = c in at ? String(cells[at[c]] ?? "").trim() : "";
    return row;
  });
  return { missing, rows };
}

// §4.2 row contract: `order` is an integer ≥1 and `status` is one of the enum.
// A cell that violates this is an ISSUE — it must never silently disarm a
// condition (INV-1 / "merged sem merge" / INV-2). Columns already reported as
// missing are skipped here to avoid duplicate noise.
function indexSchemaIssues(rows, missing = []) {
  const issues = [];
  const hasOrder = !missing.includes("order");
  const hasStatus = !missing.includes("status");
  for (const r of rows) {
    const label = r.id || "(sem id)";
    if (hasOrder && !isPositiveInt(r.order)) {
      issues.push(`order fora do contrato (inteiro ≥1): "${r.order}" (${label})`);
    }
    if (hasStatus && !INDEX_STATUS.has(r.status)) {
      issues.push(`status fora do enum (todo|in-progress|merged|dropped): "${r.status}" (${label})`);
    }
  }
  return issues;
}

// --- PRD-01 ----------------------------------------------------------------
function evalPrd01(prdDir, adrDirNames) {
  const prd = readText(join(prdDir, "PRD.md"));
  if (prd.absent) return ["PRD.md ausente em .spec/prd/<id>/"];
  if (!prd.ok) return [unreadable("PRD.md", prd.code)];

  const text = prd.text;
  const issues = [];
  const sections = splitSections(text);

  const missing = REQUIRED_SECTIONS.filter((n) => !sections.has(n));
  if (missing.length) issues.push(`falta seção obrigatória §${missing.join(", §")}`);

  if (sections.has(7) && !hasContent(sections.get(7).body)) {
    issues.push("§7 (NÃO entra) ausente ou vazia");
  }

  if (sections.has(5)) {
    const table = parseTable(sections.get(5).body);
    const col = table ? table.header.findIndex((h) => /como\s+medir/i.test(h)) : -1;
    const filled = col >= 0 && table.rows.some((r) => filledCell(r[col]));
    if (!filled) issues.push("§5: nenhuma métrica com a coluna 'como medir' preenchida");
  }

  if (sections.has(10)) {
    const stories = sections
      .get(10)
      .body.split("\n")
      .map((l) => l.trim())
      .filter((l) => /^[-*]\s+/.test(l));
    for (const story of stories) {
      if (!(/Dado/i.test(story) && /Quando/i.test(story) && /Ent[ãa]o/i.test(story))) {
        issues.push("§10: story presente sem Dado/Quando/Então");
        break;
      }
    }
  }

  const sec16 = sections.get(16);
  if (sec16) {
    if (!VERDICT_RE.test(sec16.body)) issues.push("§16 sem veredito");
    if (!DATE_RE.test(sec16.body)) issues.push("§16 sem data");
  }

  const noMarker = REQUIRED_SECTIONS.filter((n) => sections.has(n) && !hasMarker(sections.get(n).body));
  if (noMarker.length) {
    issues.push(`seção obrigatória sem a linha '> ❓ Validação:' §${noMarker.join(", §")}`);
  }

  if (sections.has(15)) {
    const body = sections.get(15).body;
    const task = body.match(/<task>([\s\S]*?)<\/task>/i);
    const ctx = body.match(/<context>([\s\S]*?)<\/context>/i);
    if (!task || task[1].trim() === "") issues.push("§15: <task> vazio ou ausente");
    if (!ctx || ctx[1].trim() === "") issues.push("§15: <context> vazio ou ausente");
  }

  // INV-3: no ADRs/** may exist before the approval block is filled.
  if (adrDirNames.length > 0 && !(sec16 && VERDICT_RE.test(sec16.body))) {
    issues.push("INV-3: ADRs/ existe com §16 ainda sem veredito");
  }

  return issues;
}

// --- ADR-01 ----------------------------------------------------------------
function evalAdr01(prdDir) {
  const adrRoot = join(prdDir, "ADRs");
  const indexRes = readText(join(prdDir, "ADR-INDEX.md"));
  const adrRootRes = listDirs(adrRoot);
  const dirs = adrRootRes.ok ? adrRootRes.names : [];

  const issues = [];
  if (!adrRootRes.ok) issues.push(unreadable("ADRs/", adrRootRes.code));
  if (!indexRes.ok && !indexRes.absent) issues.push(unreadable("ADR-INDEX.md", indexRes.code));

  if (indexRes.absent) {
    if (issues.length) return { status: "FAIL", issues };
    if (dirs.length === 0) return { status: "N/A", issues: [] };
    return { status: "FAIL", issues: [`ADRs/ presente sem ADR-INDEX.md (${dirs.length} dir(s))`] };
  }
  if (!indexRes.ok) return { status: "FAIL", issues };

  const { missing, rows } = parseIndex(indexRes.text);
  if (missing.length) issues.push(`ADR-INDEX.md: coluna(s) ausente(s): ${missing.join(", ")}`);

  for (const m of indexSchemaIssues(rows, missing)) issues.push(m);

  const indexNames = new Set(rows.map((r) => basename(r.dir)).filter(Boolean));
  for (const d of dirs) {
    if (!indexNames.has(d)) issues.push(`ADRs/${d}/ órfão (sem linha no índice)`);
  }
  for (const r of rows) {
    const b = basename(r.dir);
    if (b && !dirs.includes(b)) issues.push(`linha do índice sem dir correspondente: ${r.dir}`);
  }

  const counts = new Map();
  for (const r of rows) counts.set(r.id, (counts.get(r.id) ?? 0) + 1);
  for (const [id, n] of counts) if (n > 1) issues.push(`id duplicado no índice: ${id}`);

  // §4.2 normative scope: `dir` must be FILLED. An empty cell in a PRESENT
  // column is an issue on its own — truthiness would make it indistinguishable
  // from an absent column and silently disarm the 1:1 condition.
  const hasDir = !missing.includes("dir");
  for (const r of rows) {
    if (hasDir && !r.dir) issues.push(`linha do índice sem dir preenchido: ${r.id || "(sem id)"}`);
  }

  for (const r of rows) {
    if (r.dir && !ADR_DIR_RE.test(r.dir)) issues.push(`dir fora do padrão ADRs/ADR-00N-{slug}/: ${r.dir}`);
  }

  for (const d of dirs) {
    const mdRes = readText(join(adrRoot, d, "ADR.md"));
    if (mdRes.absent) {
      issues.push(`ADRs/${d}/ADR.md ausente`);
      continue;
    }
    if (!mdRes.ok) {
      issues.push(unreadable(`ADRs/${d}/ADR.md`, mdRes.code));
      continue;
    }
    if (!/depende-de/i.test(mdRes.text)) issues.push(`ADRs/${d}/ADR.md sem campo depende-de`);
    // `[ \t]+`, not `\s+`: the label lives on ONE line, and `\s+` would let
    // `interface` on one line and `congelada` on another pass as the field.
    if (!/interface[ \t]+congelada/i.test(mdRes.text)) {
      issues.push(`ADRs/${d}/ADR.md sem interface congelada`);
    }
  }

  if (dirs.length > 0) {
    const researchRes = readText(join(prdDir, "RESEARCH.md"));
    if (researchRes.absent) {
      issues.push("RESEARCH.md ausente (existem ADRs)");
    } else if (!researchRes.ok) {
      issues.push(unreadable("RESEARCH.md", researchRes.code));
    } else {
      const sources = (researchRes.text.match(SOURCE_RE) ?? []).length;
      if (sources < 2) issues.push(`RESEARCH.md com ${sources} fonte(s) (mínimo 2)`);
    }
  }

  return { status: issues.length ? "FAIL" : "PASS", issues };
}

// --- ADR-02 ----------------------------------------------------------------
function evalAdr02(prdDir) {
  const indexRes = readText(join(prdDir, "ADR-INDEX.md"));
  if (indexRes.absent) return { status: "N/A", issues: [] };
  if (!indexRes.ok) return { status: "FAIL", issues: [unreadable("ADR-INDEX.md", indexRes.code)] };

  const { missing, rows } = parseIndex(indexRes.text);

  // No parsed rows ⇒ nothing was sequenced or branch-checked. Never claim
  // conformity over an empty/unparseable ledger — report it as N/A/malformed.
  if (rows.length === 0) {
    return {
      status: "FAIL",
      issues: ["ADR-INDEX.md sem tabela/linhas de ADR parseáveis (malformado; N/A para sequência e branch)"],
    };
  }

  const issues = [];

  // Mirror ADR-01: an absent COLUMN means its condition was never evaluated, so
  // the detail must never claim "sequência e branch conformes" — a missing
  // `order`/`status`/`branch` silently disarms INV-1/INV-2/the branch regex.
  if (missing.length) issues.push(`ADR-INDEX.md: coluna(s) ausente(s): ${missing.join(", ")}`);

  for (const m of indexSchemaIssues(rows, missing)) issues.push(m);

  const inProgress = rows.filter((r) => r.status === "in-progress");
  if (inProgress.length >= 2) issues.push(`${inProgress.length} linhas in-progress (máximo 1)`);

  for (const r of rows) {
    if (r.status === "merged" && !filledCell(r.merge)) {
      issues.push(`linha merged sem campo merge preenchido: ${r.id}`);
    }
  }

  for (const r of inProgress) {
    if (isPositiveInt(r.order)) {
      const order = Number(r.order);
      const blocker = rows.find(
        (x) => isPositiveInt(x.order) && Number(x.order) < order && x.status !== "merged",
      );
      if (blocker) {
        issues.push(`pulo de sequência: ${r.id} in-progress com order ${blocker.order} ainda não merged`);
      }
    }
    // A malformed order is already an issue via indexSchemaIssues — never a
    // silent skip of the sequence condition.
  }

  // §4.2 normative scope: `branch` must be FILLED and match the regex. An empty
  // cell in a PRESENT column is an issue — truthiness would silently disarm it
  // and let the detail claim "sequência e branch conformes" without checking.
  const hasBranch = !missing.includes("branch");
  for (const r of rows) {
    if (hasBranch && !r.branch) {
      issues.push(`linha do índice sem branch preenchida: ${r.id || "(sem id)"}`);
    } else if (r.branch && !BRANCH_RE.test(r.branch)) {
      issues.push(`branch fora do padrão adr/<prd-id>/<nn>-<slug>: ${r.branch}`);
    }
  }

  return { status: issues.length ? "FAIL" : "PASS", issues };
}

// --- Public API ------------------------------------------------------------
export function runPrdChecks(root) {
  const prdRoot = join(root, PRD_ROOT);
  const prdRootRes = listDirs(prdRoot);

  // The target exists but is not a readable directory: malformed, never "absent".
  if (!prdRootRes.ok) {
    const detail = unreadable(".spec/prd/", prdRootRes.code);
    return {
      ok: false,
      results: [
        { id: "PRD-01", status: "FAIL", detail },
        { id: "ADR-01", status: "FAIL", detail },
        { id: "ADR-02", status: "FAIL", detail },
      ],
    };
  }

  const prdDirs = prdRootRes.names;
  if (prdDirs.length === 0) {
    // `listDirs` returns an empty list for both ENOENT and an empty directory,
    // so the detail must not call an existing-but-empty `.spec/prd/` "ausente"
    // (N5). `existsSync` separates the two cases.
    const na = existsSync(prdRoot)
      ? "N/A — .spec/prd/ existe e está vazio (vacuous-safe)"
      : "N/A — .spec/prd/ ausente (vacuous-safe)";
    return {
      ok: true,
      results: [
        { id: "PRD-01", status: "PASS", detail: na },
        { id: "ADR-01", status: "PASS", detail: na },
        { id: "ADR-02", status: "PASS", detail: na },
      ],
    };
  }

  const prdIssues = [];
  const adr01Issues = [];
  const adr02Issues = [];
  let adr01Target = false;
  let adr02Target = false;

  for (const id of prdDirs) {
    const prdDir = join(prdRoot, id);
    const adrDirsRes = listDirs(join(prdDir, "ADRs"));
    const adrDirs = adrDirsRes.ok ? adrDirsRes.names : [];
    for (const msg of evalPrd01(prdDir, adrDirs)) prdIssues.push(`${id}: ${msg}`);

    const a1 = evalAdr01(prdDir);
    if (a1.status !== "N/A") {
      adr01Target = true;
      for (const msg of a1.issues) adr01Issues.push(`${id}: ${msg}`);
    }

    const a2 = evalAdr02(prdDir);
    if (a2.status !== "N/A") {
      adr02Target = true;
      for (const msg of a2.issues) adr02Issues.push(`${id}: ${msg}`);
    }
  }

  const results = [
    {
      id: "PRD-01",
      status: prdIssues.length ? "FAIL" : "PASS",
      detail: prdIssues.length ? prdIssues.join("; ") : "PRD.md com as 7 seções obrigatórias conformes",
    },
    {
      id: "ADR-01",
      status: adr01Issues.length ? "FAIL" : "PASS",
      detail: adr01Issues.length
        ? adr01Issues.join("; ")
        : adr01Target
          ? "ADR-INDEX.md 1:1 com ADRs/<dir>/ (sem órfãos)"
          : "N/A — sem ADR-INDEX.md nem ADRs/<dir>/ (vacuous-safe)",
    },
    {
      id: "ADR-02",
      status: adr02Issues.length ? "FAIL" : "PASS",
      detail: adr02Issues.length
        ? adr02Issues.join("; ")
        : adr02Target
          ? "ADR-INDEX.md: sequência e branch conformes"
          : "N/A — sem ADR-INDEX.md (vacuous-safe)",
    },
  ];

  return { ok: results.every((r) => r.status === "PASS"), results };
}
