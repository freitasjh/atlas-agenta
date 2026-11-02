// seal.mjs — command seal for the contraprova (SPEC ADR-002, U6=b).
// Standalone sha256 + seal/verify helpers. Consumed by gate.js in
// Batch 4 (GATE-01/GATE-03): the gate embeds the seal published with a
// trusted config and compares it at runtime against the value read from
// harness.config.json. Divergence => DenyError `sealed-command-mismatch`.
// This module never touches the network, MCP, or the filesystem.
import { createHash } from "node:crypto";

export function sha256(text) {
  if (typeof text !== "string") throw new TypeError("sha256 expects a string");
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function sealCommands(commands) {
  const seal = {};
  for (const key of Object.keys(commands).sort()) seal[key] = sha256(commands[key]);
  return seal;
}

export function verifySeal(commands, seal) {
  const mismatches = [];
  for (const key of Object.keys(seal).sort()) {
    if (!(key in commands) || sha256(commands[key]) !== seal[key]) mismatches.push(key);
  }
  for (const key of Object.keys(commands).sort()) {
    if (!(key in seal)) mismatches.push(key);
  }
  return { ok: mismatches.length === 0, mismatches };
}
