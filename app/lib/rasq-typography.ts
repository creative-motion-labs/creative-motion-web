/** Central RASQ typography class names — pair with tokens in globals.css */

export const FONT_UI_EN_CLASS = "font-ui-en";
export const FONT_UI_AR_CLASS = "font-ui-ar";
export const FONT_DATA_CLASS = "font-data";

export const PATIENT_ARABIC_READABLE_CLASS = "patient-arabic-readable";

/** Arabic portal surfaces: IBM Plex Sans Arabic + readable line-height */
export function patientPortalArabicClass(isArabic: boolean): string {
  return isArabic ? `${FONT_UI_AR_CLASS} ${PATIENT_ARABIC_READABLE_CLASS}` : FONT_UI_EN_CLASS;
}

/** Nested patient components that need explicit Arabic font inheritance */
export function patientPortalArabicSurfaceClass(isArabic: boolean): string {
  return isArabic ? FONT_UI_AR_CLASS : "";
}
