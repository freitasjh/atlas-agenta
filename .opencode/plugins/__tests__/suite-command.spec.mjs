// suite-command.spec.mjs — regression guard for commands.suiteFull / commands.unit.
//
// Bug it pins (QA): harness.config.json pointed suiteFull at `npm run test:run`,
// a script that never existed in package.json. The sealed contraprova (ADR-002)
// then re-executed a command that always failed with "Missing script", so the
// canonical suite was never actually proven. Root cause was a config value that
// was never resolved against the project's script map.
//
// Fail-open it pins (I1, code review): segments that begin with `npm` but do not
// match the strict `npm [run] <script>` shape (flags/args, or a stray `;`) were
// dropped from the result, so `npm run test:run -- --reporter=dot` and
// `npm test; npm run test:run` both produced `missing: []` — a false green.
// They now FAIL the guard: an unparsable `npm` segment is never skipped.
//
// Contract checked here: every `npm`/`npm run <script>` segment of a canonical
// command must name a script declared in package.json. Non-npm segments
// (`node --test ...`) are out of this guard's scope by design.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadHarnessConfig, resolveCommand } from "../lib/config.mjs";
import { sealCommands, sha256, verifySeal } from "../lib/seal.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const packageScripts = () =>
  JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).scripts ?? {};

/**
 * Splits a shell command on `&&`, `||` and `;`, ignoring separators inside
 * single or double quotes. Anything else stays glued to its segment.
 */
export function splitShellSegments(command) {
  const segments = [];
  let current = "";
  let quote = null;

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];

    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === ";") {
      segments.push(current);
      current = "";
      continue;
    }
    const pair = command.slice(i, i + 2);
    if (pair === "&&" || pair === "||") {
      segments.push(current);
      current = "";
      i += 1;
      continue;
    }
    current += char;
  }
  segments.push(current);

  return segments.map((segment) => segment.trim()).filter((segment) => segment.length > 0);
}

/**
 * Returns every segment of `command` that invokes npm, with the script name it
 * resolves to. `script: null` means the segment does not name a declared
 * script — either it is bare `npm`, or it is unparsable (flags/args). The guard
 * treats both as failures; only non-npm segments are out of scope.
 */
export function npmScriptRefs(command) {
  return splitShellSegments(command)
    .filter((segment) => /^npm(\s|$)/.test(segment))
    .map((segment) => {
      const match = /^npm(?:\s+run)?(?:\s+([\w:.-]+))?$/.exec(segment);
      return match ? { segment, script: match[1] ?? null } : { segment, script: null };
    });
}

function missingScriptRefs(command, scripts) {
  return npmScriptRefs(command)
    .filter(({ script }) => script === null || !(script in scripts))
    .map(({ segment }) => segment);
}

test("canonical commands only reference scripts declared in package.json", () => {
  const scripts = packageScripts();
  const config = loadHarnessConfig();

  for (const key of ["suiteFull", "unit"]) {
    const command = resolveCommand(config, key);
    assert.deepEqual(
      missingScriptRefs(command, scripts),
      [],
      `commands.${key} references a script package.json does not declare: ${command}`,
    );
  }
});

test("suiteFull starts with the project test suite and adds the gate suite", () => {
  const config = loadHarnessConfig();
  const [first, second] = splitShellSegments(resolveCommand(config, "suiteFull"));

  assert.equal(first, resolveCommand(config, "unit"));
  assert.match(second ?? "", /^node --test\s/, "suiteFull must also run the plugin suite");
});

test("npm segments that name a declared script pass the guard", () => {
  const scripts = packageScripts();

  assert.deepEqual(missingScriptRefs("npm test && npm run build", scripts), []);
  assert.deepEqual(missingScriptRefs("node --test \"x/*.spec.mjs\" && npm test", scripts), []);
});

test("npm segment with flags is a failure, never a silent skip", () => {
  const scripts = packageScripts();

  assert.deepEqual(
    missingScriptRefs("npm run test:run -- --reporter=dot", scripts),
    ["npm run test:run -- --reporter=dot"],
  );
});

test("`;` separates segments, so the undeclared script after it is not dropped", () => {
  const scripts = packageScripts();

  assert.deepEqual(
    missingScriptRefs("npm test; npm run test:run", scripts),
    ["npm run test:run"],
  );
});

test("splitShellSegments splits on &&, || and ; and keeps quoted separators", () => {
  assert.deepEqual(splitShellSegments("npm test; npm run build"), ["npm test", "npm run build"]);
  assert.deepEqual(splitShellSegments("npm test || npm test"), ["npm test", "npm test"]);
  assert.deepEqual(splitShellSegments('node --test "a;b" && npm test'), [
    'node --test "a;b"',
    "npm test",
  ]);
});

test("loadHarnessConfig fails closed on a missing command key", () => {
  const config = loadHarnessConfig();
  assert.throws(() => resolveCommand(config, "doesNotExist"), /fail-closed/);
});

test("seal round-trips the current commands and rejects a changed command", () => {
  const { commands } = loadHarnessConfig();
  const seal = sealCommands(commands);

  assert.deepEqual(Object.keys(seal).sort(), Object.keys(commands).sort());
  assert.deepEqual(verifySeal(commands, seal), { ok: true, mismatches: [] });

  const tampered = { ...commands, suiteFull: `${commands.suiteFull} ` };
  assert.deepEqual(verifySeal(tampered, seal), { ok: false, mismatches: ["suiteFull"] });
});

test("seal hashes are stable sha256 of the command string", () => {
  const { commands } = loadHarnessConfig();
  assert.equal(sealCommands(commands).suiteFull, sha256(commands.suiteFull));
});
