// HITL Guardrail — no-op plugin (FIX-01, Batch 3/7).
//
// FIX-01 removed two dead mechanisms from this module (SPEC §21.1, PLAN GATE-01):
//   1. Prose re-injection via the system-transform hook (G14/N5/H2): assigning
//      the transform output as a scalar never propagated to the caller, so the
//      guardrail text never reached the model. The blocking pause between
//      batches lands in GATE-04 on the confirmed deny primitive instead.
//   2. The bus-event handler filtering a nonexistent event (N7/H3): it never
//      fired, so the delegation audit log it promised never happened.
//
// This module stays a valid no-op plugin until GATE-04 implements the HITL
// pause (with the developer→reviewer loop exemption, I6). No prose, no dead
// handlers.
//
// v2-only (opencode-v2-only, EX2-BE-02): the v1 `server` entry and the
// `Plugin.define` branch were removed (the owner decided v2-only). MEASURED
// contract of the installed runtime (v2.0.32): the module default MUST be an
// object `{ id, setup }`, and `setup(ctx)` MUST return `undefined` — the runtime
// hands the return value to Effect.acquireRelease and CALLS a truthy value.
// The previous `return { … }` here was called as a function, producing the
// `TypeError: t is not a function` that failed the plugin load (58x since
// 2026-10-15) and, in this runtime, took the agent registry down with it.
export const HitlGuardrail = async (_input = {}) => ({});

// V2 entry: no-op registration. Registers zero hooks and returns `undefined`
// (nothing to clean up). Takes any stub ctx, throws never, logs no args.
export async function setup(_ctx = {}) {
  // no-op by design: the HITL pause lands in GATE-04 (I6); this module must
  // never register a dead hook nor return a truthy value.
}

export default { id: "hitl-guardrail", setup };
