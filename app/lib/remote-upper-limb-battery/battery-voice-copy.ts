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
  if (lang === "ar") {
    return "ضع ذراعك في مجال رؤية الكاميرا.";
  }
  return "Place your arm in view of the camera.";
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
  side: RemoteUpperLimbBatterySide,
  lang: BatteryVoiceLang,
): string {
  const adj = formatBatterySideAdjective(side, lang);
  if (lang === "ar") {
    return `ارفع ذراعك ${adj} ببطء إلى الأمام وإلى الأعلى.`;
  }
  return `Raise your ${adj} arm slowly forward and upward.`;
}

export function getBatteryElbowBendCopy(
  side: RemoteUpperLimbBatterySide,
  lang: BatteryVoiceLang,
): string {
  const adj = formatBatterySideAdjective(side, lang);
  if (lang === "ar") {
    return `اثنِ مرفقك ${adj} ببطء مع إبقاء ذراعك العلوي قريبًا من جانبك.`;
  }
  return `Bend your ${adj} elbow slowly, keeping your upper arm near your side.`;
}

export function getBatteryFunctionalReachCopy(
  side: RemoteUpperLimbBatterySide,
  lang: BatteryVoiceLang,
): string {
  const adj = formatBatterySideAdjective(side, lang);
  if (lang === "ar") {
    return `مد ذراعك ${adj} إلى الأمام ببطء قدر ما يريحك، مع إبقاء قدميك ثابتتين.`;
  }
  return `Reach your ${adj} arm forward slowly, as far as is comfortable, without stepping.`;
}

export function getBatterySideRepositionCopy(
  side: RemoteUpperLimbBatterySide,
  lang: BatteryVoiceLang,
): string {
  if (lang === "ar") {
    return side === "right"
      ? "استدر جانبياً، واجعل جانبك الأيمن باتجاه الكاميرا."
      : "استدر جانبياً، واجعل جانبك الأيسر باتجاه الكاميرا.";
  }
  return side === "right"
    ? "Turn sideways so your right side faces the camera."
    : "Turn sideways so your left side faces the camera.";
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
