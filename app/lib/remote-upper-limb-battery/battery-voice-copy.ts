/**
 * Remote Upper-Limb Assessment — patient voice and on-screen guidance copy.
 * Prescribed-side aware; no clinical correctness claims.
 */

import type { RemoteUpperLimbBatterySide, RemoteUpperLimbBatteryTestId } from "./types";
import { formatBatteryArmLabel } from "./types";

export type BatteryVoiceLang = "en" | "ar";

export function formatBatterySideAdjective(
  side: RemoteUpperLimbBatterySide,
  lang: BatteryVoiceLang,
): string {
  if (lang === "ar") {
    return side === "right" ? "اليمنى" : "اليسرى";
  }
  return side === "right" ? "right" : "left";
}

export function getBatteryArmInViewCopy(lang: BatteryVoiceLang): string {
  return getBatteryFaceCameraSetupCopy(lang);
}

/** Front-view setup (shoulder abduction): face the camera with the arm visible. */
export function getBatteryFaceCameraSetupCopy(lang: BatteryVoiceLang): string {
  if (lang === "ar") {
    return "واجه الكاميرا وضَع ذراعك في مجال الرؤية.";
  }
  return "Face the camera. Place your arm in view of the camera.";
}

/** Side-view setup: body orientation and prescribed arm toward the camera. */
export function getBatterySideViewSetupCopy(
  side: RemoteUpperLimbBatterySide,
  lang: BatteryVoiceLang,
): string {
  const adj = formatBatterySideAdjective(side, lang);
  if (lang === "ar") {
    return side === "right"
      ? "استدر جانبياً بحيث يكون جانبك الأيمن باتجاه الكاميرا. أبقِ ذراعك اليمنى مرئية ومتجهة نحو الكاميرا."
      : "استدر جانبياً بحيث يكون جانبك الأيسر باتجاه الكاميرا. أبقِ ذراعك اليسرى مرئية ومتجهة نحو الكاميرا.";
  }
  return `Turn sideways so your ${adj} side faces the camera. Keep your ${adj} arm visible and pointed toward the camera.`;
}

export function getBatteryTrackingLostCopy(lang: BatteryVoiceLang): string {
  if (lang === "ar") {
    return "لا أستطيع رؤية ذراعك بوضوح. يرجى تعديل وضعيتك.";
  }
  return "I can't see your arm clearly. Please adjust your position.";
}

export function getBatteryMovementSmoothCopy(lang: BatteryVoiceLang): string {
  if (lang === "ar") {
    return "حافظ على حركة سلسة ومريحة.";
  }
  return "Keep your movement smooth and comfortable.";
}

export function getBatteryReturnToStartCopy(lang: BatteryVoiceLang): string {
  if (lang === "ar") {
    return "جيد. ارجع إلى وضع البداية.";
  }
  return "Good. Move back to the starting position.";
}

export function getBatteryRestBeforeNextCopy(lang: BatteryVoiceLang): string {
  if (lang === "ar") {
    return "خذ استراحة قصيرة قبل الحركة التالية.";
  }
  return "Take a short rest before the next movement.";
}

export function getBatteryAbductionRaiseCopy(
  side: RemoteUpperLimbBatterySide,
  lang: BatteryVoiceLang,
): string {
  const adj = formatBatterySideAdjective(side, lang);
  if (lang === "ar") {
    return `ارفع ذراعك ${adj} ببطء إلى الجانب.`;
  }
  return `Raise your ${adj} arm slowly out to the side.`;
}

export function getBatteryFlexionRaiseCopy(
  _side: RemoteUpperLimbBatterySide,
  lang: BatteryVoiceLang,
): string {
  if (lang === "ar") {
    return "ارفع ذراعك إلى أعلى ما تستطيع.";
  }
  return "Raise your arm as high as you can.";
}

export function getBatteryElbowBendCopy(
  _side: RemoteUpperLimbBatterySide,
  lang: BatteryVoiceLang,
): string {
  if (lang === "ar") {
    return "اثنِ مرفقك قدر ما تستطيع.";
  }
  return "Bend your elbow as far as you can.";
}

export function getBatteryFunctionalReachCopy(
  _side: RemoteUpperLimbBatterySide,
  lang: BatteryVoiceLang,
): string {
  if (lang === "ar") {
    return "مدّ ذراعك إلى الأمام نحو الهدف قدر ما تستطيع.";
  }
  return "Reach forward toward the target as far as you can.";
}

export function getBatterySideRepositionCopy(
  side: RemoteUpperLimbBatterySide,
  lang: BatteryVoiceLang,
): string {
  return getBatterySideViewSetupCopy(side, lang);
}

export function getBatteryTestStartVoiceCopy(
  testId: RemoteUpperLimbBatteryTestId,
  side: RemoteUpperLimbBatterySide,
  lang: BatteryVoiceLang,
): string {
  switch (testId) {
    case "shoulderAbduction":
      return getBatteryAbductionRaiseCopy(side, lang);
    case "shoulderFlexion":
      return getBatteryFlexionRaiseCopy(side, lang);
    case "elbowFlexion":
      return getBatteryElbowBendCopy(side, lang);
    case "functionalReach":
      return getBatteryFunctionalReachCopy(side, lang);
  }
}

export function getBatteryStandStillCopy(lang: BatteryVoiceLang): string {
  return lang === "ar" ? "قف بهدوء." : "Stand still.";
}

export function getBatteryDoneCopy(lang: BatteryVoiceLang): string {
  return lang === "ar" ? "تم." : "Done.";
}

export function getBatteryAssessmentCompleteCopy(lang: BatteryVoiceLang): string {
  return lang === "ar" ? "اكتمل التقييم." : "Assessment completed.";
}

export function getBatteryFinalTestSavingCopy(lang: BatteryVoiceLang): string {
  if (lang === "ar") {
    return "اكتمل الاختبار. يرجى الانتظار بينما نحفظ نتائجك.";
  }
  return "Test complete. Please wait while we save your results.";
}

export function getBatteryRepCountCopy(completed: number, lang: BatteryVoiceLang): string | null {
  if (lang === "ar") {
    if (completed === 1) return "واحد";
    if (completed === 2) return "اثنان";
    if (completed === 3) return "ثلاثة";
    return null;
  }
  if (completed === 1) return "One.";
  if (completed === 2) return "Two.";
  if (completed === 3) return "Three.";
  return null;
}

export function getBatteryPositioningStatusCopy(
  side: RemoteUpperLimbBatterySide,
  ready: boolean,
  lang: BatteryVoiceLang,
): string {
  if (ready) {
    return lang === "ar" ? "تم اكتشاف الوضعية" : "Position detected";
  }
  const arm = formatBatteryArmLabel(side);
  if (lang === "ar") {
    return `قف بهدوء وأبقِ ${arm === "right arm" ? "ذراعك اليمنى" : "ذراعك اليسرى"} مرئية.`;
  }
  return `Stand still and keep your ${arm} visible.`;
}

/** Legacy phrasing removed from patient copy. */
export const LEGACY_BATTERY_TRACKING_LOST_PHRASE = "can't clearly see your";
