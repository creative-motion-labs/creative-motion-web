import type { RemoteUpperLimbBatteryTestId } from "@/app/lib/remote-upper-limb-battery/types";

export const MOVEMENT_FOCUS_ANATOMY_SRC = "/images/rasq/upper-limb-muscle-focus.png";

const MOVEMENT_FOCUS_ANATOMY_ALT =
  "Upper-body muscle illustration highlighting the assessed shoulder and arm";

export type MovementFocusInteractiveEducation =
  | "d1-inspired-diagonal-reach"
  | null;

type MovementFocusAnatomyCardProps = {
  activeTestId: RemoteUpperLimbBatteryTestId | null;
  /** When set, mirror the illustration so the teal highlight matches the prescribed side (asset default = anatomical right). */
  prescribedSide?: "left" | "right" | null;
  /** Interactive Shoulder session only — extended education for specific movement blocks. */
  interactiveEducation?: MovementFocusInteractiveEducation;
};

type FocusRegion = "shoulder-upper-arm" | "elbow-upper-arm" | "shoulder-upper-trunk";

function resolveFocusRegion(testId: RemoteUpperLimbBatteryTestId | null): FocusRegion {
  switch (testId) {
    case "elbowFlexion":
      return "elbow-upper-arm";
    case "functionalReach":
      return "shoulder-upper-trunk";
    case "shoulderAbduction":
    case "shoulderFlexion":
    default:
      return "shoulder-upper-arm";
  }
}

const FOCUS_COPY: Record<FocusRegion, { title: string; caption: string }> = {
  "shoulder-upper-arm": {
    title: "Shoulder and upper-arm movement",
    caption: "Illustrative reference only — not a clinical finding.",
  },
  "elbow-upper-arm": {
    title: "Elbow and upper-arm movement",
    caption: "Illustrative reference only — not a clinical finding.",
  },
  "shoulder-upper-trunk": {
    title: "Shoulder, upper arm, and upper trunk",
    caption: "Illustrative reference only — not a clinical finding.",
  },
};

const D1_COPY = {
  title: "Diagonal reach",
  body: "Supports shoulder control and everyday arm use.",
  muscles: "Shoulder, upper arm, and stabilisers.",
  footer: "Illustrative guide — not a clinical finding.",
};

function AnatomyIllustration({
  prescribedSide,
  compact,
}: {
  prescribedSide?: "left" | "right" | null;
  compact?: boolean;
}) {
  const mirrorForLeftSide = prescribedSide === "left";

  return (
    <div
      className={
        compact
          ? "flex h-[min(42vw,200px)] min-h-[140px] w-full items-center justify-center sm:h-[min(36vw,220px)]"
          : "flex min-h-[200px] w-full flex-1 items-center justify-center sm:min-h-[240px] lg:min-h-[280px]"
      }
    >
      <img
        src={MOVEMENT_FOCUS_ANATOMY_SRC}
        alt={MOVEMENT_FOCUS_ANATOMY_ALT}
        width={440}
        height={520}
        decoding="async"
        className="h-full w-full object-contain object-center"
        style={mirrorForLeftSide ? { transform: "scaleX(-1)" } : undefined}
      />
    </div>
  );
}

export function MovementFocusAnatomyCard({
  activeTestId,
  prescribedSide = null,
  interactiveEducation = null,
}: MovementFocusAnatomyCardProps) {
  const region = resolveFocusRegion(activeTestId);
  const copy = FOCUS_COPY[region];
  const showD1Education = interactiveEducation === "d1-inspired-diagonal-reach";

  if (showD1Education) {
    return (
      <div className="flex h-full min-h-0 flex-col rounded-[10px] border border-[#1E2D42] bg-[#0F1825] px-3 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#1D9E75]">Movement focus</p>
        <p className="mt-1 text-[13px] font-semibold leading-snug text-white/90">{D1_COPY.title}</p>
        <p className="mt-0.5 text-[11px] leading-snug text-white/50">{D1_COPY.body}</p>

        <div className="my-2 flex min-h-0 flex-1 justify-center">
          <AnatomyIllustration prescribedSide={prescribedSide} compact />
        </div>

        <p className="text-center text-[10px] leading-snug text-white/45">{D1_COPY.muscles}</p>
        <p className="mt-1.5 text-center text-[10px] leading-snug text-white/40">{D1_COPY.footer}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col rounded-[10px] border border-[#1E2D42] bg-[#0F1825] p-4">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#1D9E75]">Movement focus</p>
      <p className="mt-2 text-sm font-semibold text-white/85">{copy.title}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-white/45">{copy.caption}</p>

      <div className="mt-2 flex min-h-0 flex-1 justify-center overflow-hidden">
        <AnatomyIllustration prescribedSide={prescribedSide} />
      </div>
    </div>
  );
}
