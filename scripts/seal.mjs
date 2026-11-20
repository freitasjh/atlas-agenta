#!/usr/bin/env node
// seal.mjs — publishes the command seal for the contraprova (SPEC ADR-002, U6=b).
//
//   node scripts/seal.mjs [--config <path>] [--env]
//
// Reads `harness.config.json` and prints the seal for `commands` as JSON.
// `--env` prints it as the assignment the host operator exports:
//
//   eval "$(node scripts/seal.mjs --env)"
//
// The hash is NOT reimplemented here: `.opencode/plugins/lib/seal.mjs` owns
// `sha256`/`sealCommands` and `gate.js` verifies with the same module, so the
// publisher and the verifier cannot drift.
//
// Scope note: the seal covers EVERY key of `commands`, not just `suiteFull`.
// `verifySealOrDeny` (gate.js:157-159) reports any command key absent from the
// seal as a mismatch — a seal holding only `suiteFull` would deny on `unit`.
// `suiteFull` is always present because the config requires it.
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sealCommands } from "../.opencode/plugins/lib/seal.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_CONFIG = join(ROOT, "harness.config.json");

function parseArgs(argv) {
  const opts = { config: DEFAULT_CONFIG, env: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--env") opts.env = true;
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--config") opts.config = resolve(argv[++i] ?? opts.config);
  }
  return opts;
}

export function buildSeal(configPath = DEFAULT_CONFIG) {
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const commands = config?.commands;
  if (!commands || typeof commands !== "object" || Array.isArray(commands)) {
    throw new Error(`harness.config.json: commands ausente em ${configPath}`);
  }
  if (typeof commands.suiteFull !== "string" || commands.suiteFull.length === 0) {
    throw new Error(`harness.config.json: commands.suiteFull ausente em ${configPath}`);
  }
  return sealCommands(commands);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const opts = parseArgs(process.argv.slice(2));
  // Same drain rule as the other launchers (F3a review, item 16): the seal is
  // printed on the LAST line, and `process.exit` could drop it on a pipe.
  if (opts.help) {
    console.log("uso: node scripts/seal.mjs [--config <path>] [--env]");
  } else {
    let seal;
    try {
      seal = buildSeal(opts.config);
    } catch (error) {
      console.error(`seal: ${error.message}`);
      process.exitCode = 1;
    }
    if (seal) {
      const json = JSON.stringify(seal);
      console.log(opts.env ? `HARNESS_SEAL_JSON=${json}` : json);
    }
  }
}
