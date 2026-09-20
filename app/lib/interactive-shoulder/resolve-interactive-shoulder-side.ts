import { parseClinicalPrescribedSide } from "@/app/lib/clinical/clinical-prescribed-side";
import type { ShoulderAbductionReachSide } from "@/app/lib/shoulder-rehabilitation";
import type { MovementBlock, MovementBlockSide } from "@/app/lib/session-orchestrator/types";

/**
 * Temporary product fallback when neither a prescribed exercise side nor a
 * movement-block side is available. Bilateral block configuration also falls
 * back here until bilateral target layouts are supported.
 */
export const INTERACTIVE_SHOULDER_DEFAULT_SIDE: ShoulderAbductionReachSide = "right";

export type InteractiveShoulderSideSource = "prescribed" | "block" | "fallback";

export type ResolvedInteractiveShoulderSide = {
  side: ShoulderAbductionReachSide;
  source: InteractiveShoulderSideSource;
  /** True when the named default constant was used (block/prescribed unavailable or non-unilateral). */
  usedFallback: boolean;
};

function normalizeUnilateralSide(
  value: string | MovementBlockSide | null | undefined,
): ShoulderAbductionReachSide | null {
  if (value === "left" || value === "right") return value;
  return null;
}

/**
 * Resolves the therapeutic reach side for interactive shoulder sessions.
 *
 * Priority:
 * 1. `prescribedSide` when it is a supported left/right value (future-safe —
 *    callers may pass an existing session field when one becomes available).
 * 2. First valid unilateral `side` on any movement block in the session
 *    (see `resolveBlockSideFromSessionDefinition`).
 * 3. `INTERACTIVE_SHOULDER_DEFAULT_SIDE` (documented temporary limitation).
 */
export function resolveBlockSideFromSessionDefinition(
  blocks: readonly Pick<MovementBlock, "side">[],
): ShoulderAbductionReachSide | null {
  for (const block of blocks) {
    const side = normalizeUnilateralSide(block.side);
    if (side) return side;
  }
  return null;
}

export type ClinicalPrescribedSideRuntimeFailureReason = "missing" | "invalid";

export type ClinicalPrescribedSideRuntimeResult =
  | { ok: true; side: ShoulderAbductionReachSide; source: "prescribed" }
  | { ok: false; reason: ClinicalPrescribedSideRuntimeFailureReason };

/**
 * Server-authoritative clinical laterality for patient-portal Interactive Shoulder.
 * Accepts only exact stored `left`/`right` values — never block side or RIGHT fallback.
 */
export function resolveClinicalPrescribedSideForRuntime(
  prescribedSide: string | null | undefined,
): ClinicalPrescribedSideRuntimeResult {
  const parsed = parseClinicalPrescribedSide(prescribedSide);
  if (!parsed.ok) {
    return { ok: false, reason: "invalid" };
  }
  if (parsed.value === null) {
    return { ok: false, reason: "missing" };
  }
  return { ok: true, side: parsed.value, source: "prescribed" };
}

/**
 * Orchestrator runtime laterality. In strict clinical mode, missing or invalid
 * prescribed side yields null — no legacy RIGHT fallback. Non-clinical flows
 * keep the documented block/prescribed/fallback resolution.
 */
export function resolveOrchestratorTherapeuticSide(input: {
  prescribedSide?: string | null;
  clinicalPrescribedSideRequired?: boolean;
  blocks: readonly Pick<MovementBlock, "side">[];
}): ResolvedInteractiveShoulderSide | null {
  if (input.clinicalPrescribedSideRequired) {
    const clinical = resolveClinicalPrescribedSideForRuntime(input.prescribedSide);
    if (!clinical.ok) {
      return null;
    }
    return {
      side: clinical.side,
      source: clinical.source,
      usedFallback: false,
    };
  }

  return resolveInteractiveShoulderSide({
    prescribedSide: input.prescribedSide,
    blockSide: resolveBlockSideFromSessionDefinition(input.blocks),
  });
}

export function resolveInteractiveShoulderSide(input: {
  prescribedSide?: string | null;
  blockSide?: MovementBlockSide | null;
}): ResolvedInteractiveShoulderSide {
  const fromPrescribed = normalizeUnilateralSide(input.prescribedSide);
  if (fromPrescribed) {
    return { side: fromPrescribed, source: "prescribed", usedFallback: false };
  }

  const fromBlock = normalizeUnilateralSide(input.blockSide ?? undefined);
  if (fromBlock) {
    return { side: fromBlock, source: "block", usedFallback: false };
  }

  return {
    side: INTERACTIVE_SHOULDER_DEFAULT_SIDE,
    source: "fallback",
    usedFallback: true,
  };
}
