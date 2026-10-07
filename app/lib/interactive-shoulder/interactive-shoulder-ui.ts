import type { PatientExerciseLanguage } from "@/app/lib/exercise-resolve";
import type { CaptureSetupGuidance } from "@/app/lib/cv/patient-cv-capture-readiness";
import {
  PATIENT_CAMERA_NO_FRAMES_ERROR,
} from "@/app/lib/cv/patient-camera-stream";
import type {
  SafetyHoldReason,
  SessionOrchestratorSnapshot,
  SessionState,
} from "@/app/lib/session-orchestrator/types";
import { SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION } from "./shoulder-abduction-reach-session-definition";
import type { FeedbackInteractionMode } from "./motion-patterns/motion-pattern-registry";
import { D1_INSPIRED_DIAGONAL_REACH_PATTERN } from "./motion-patterns/d1-inspired-diagonal-reach-pattern";
import type { OrchestratorCvRuntimeFault } from "./orchestrator-cv-block-dispatch";

export type InteractiveShoulderUi = {
  consentTitle: string;
  consentDescription: string;
  consentCheckbox: string;
  continueCamera: string;
  skipCamera: string;
  startingCamera: string;
  experienceTitle: string;
  clinicalHudExerciseLabel: string;
  clinicalHudTimeRemainingLabel: string;
  sessionProgressLabel: string;
  interactionTargetsLabel: (reached: number, shown: number) => string;
  interactionPatternsLabel: (completed: number, shown: number) => string;
  measuredRepsLabel: (reps: number) => string;
  movementBlockLabel: string;
  timeRemainingSeconds: (seconds: number) => string;
  blockProgressPercent: (percent: number) => string;
  targetsAndReps: (reached: number, shown: number, reps: number) => string;
  pause: string;
  resume: string;
  pauseAriaLabel: string;
  resumeAriaLabel: string;
  trackingLostHold: string;
  compensationSafetyHold: string;
  trackingRecalibrate: string;
  trackingRecovered: string;
  paused: string;
  blockInstructions: string;
  targetReached: string;
  patternPathComplete: string;
  encouragementNiceWork: string;
  blockCompleteTitle: string;
  blockCompleteSummary: (targets: number, reps: number) => string;
  blockCompleteDuration: (seconds: number) => string;
  blockCompleteDetailedSummary: (targets: number, reps: number, seconds: number) => string;
  blockCompleteDetailedSummaryPatterns: (patterns: number, reps: number, seconds: number) => string;
  metricsSeparationNote: string;
  patternMetricsSeparationNote: string;
  devMouseSimulation: string;
  therapeuticSideFallback: string;
  prescribedSideRequiredTitle: string;
  prescribedSideRequiredMessage: string;
  cameraPreviewAriaLabel: string;
  cameraAccessDenied: string;
  cameraNotFound: string;
  cameraInUse: string;
  cameraNoFrames: string;
  cameraStartFailed: string;
  repositionMoveFarther: string;
  repositionStepIntoFrame: string;
  repositionImproveLighting: string;
  repositionAdjustPosition: string;
  repositionReady: string;
  runtimeFaultTitle: string;
  runtimeFaultRunnerUnavailable: string;
  runtimeFaultPatternUnresolved: string;
  catalogSessionConfigErrorTitle: string;
  catalogSessionConfigErrorDescription: string;
  readyLabel: string;
  beginLabel: string;
  blockLabel: string;
  currentBlockLabel: string;
  repProgressLabel: (completed: number, target: number | null) => string;
  sessionCompleteTitle: string;
  sessionCompleteHeadline: string;
  sessionCompleteEncouragement: string;
  blocksCompletedLabel: string;
  repetitionsCompletedLabel: string;
  interactionsCompletedLabel: string;
  durationLabel: string;
  durationSeconds: (seconds: number) => string;
  sessionCompleteReviewNote: string;
  soundOnLabel: string;
  soundOffLabel: string;
  soundMuteAria: string;
  soundUnmuteAria: string;
  goodReachFeedback: string;
  niceControlFeedback: string;
  skipCameraSecondaryHint: string;
};

const INTERACTIVE_SHOULDER_UI: Record<PatientExerciseLanguage, InteractiveShoulderUi> = {
  en: {
    consentTitle: "Camera for movement guidance",
    consentDescription:
      "Your camera helps guide reaching targets. Video stays on your device and is not stored as a recording.",
    consentCheckbox: "I agree to use my camera for this guided session.",
    continueCamera: "Continue",
    skipCamera: "Skip camera",
    startingCamera: "Starting camera…",
    experienceTitle: "Reach the Light",
    clinicalHudExerciseLabel: "Exercise:",
    clinicalHudTimeRemainingLabel: "Time Remaining:",
    sessionProgressLabel: "Session progress",
    interactionTargetsLabel: (reached, shown) => `Interaction targets: ${reached}/${shown}`,
    interactionPatternsLabel: (completed, shown) => `Paths completed: ${completed}/${shown}`,
    measuredRepsLabel: (reps) => `Measured repetitions: ${reps}`,
    movementBlockLabel: "Movement block",
    timeRemainingSeconds: (seconds) => `${seconds}s remaining`,
    blockProgressPercent: (percent) => `${percent}%`,
    targetsAndReps: (reached, shown, reps) =>
      `Targets: ${reached}/${shown} · Reps: ${reps}`,
    pause: "Pause",
    resume: "Resume",
    pauseAriaLabel: "Pause movement block",
    resumeAriaLabel: "Resume movement block",
    trackingLostHold:
      "Tracking paused — hold still while we regain your movement.",
    compensationSafetyHold:
      "A posture change was observed — pause and reset your position when ready.",
    trackingRecalibrate:
      "Tracking was lost for a while — let's recalibrate before continuing.",
    trackingRecovered: "Tracking recovered — you can continue reaching.",
    paused: "Paused.",
    blockInstructions:
      "Lift your arm out to the side and reach toward each therapeutic light. Move at a comfortable pace.",
    targetReached: "Light reached — nice controlled reach.",
    patternPathComplete: "Path completed — nice controlled movement.",
    encouragementNiceWork: "Nice work.",
    blockCompleteTitle: "Movement block complete",
    blockCompleteSummary: (targets, reps) =>
      `Targets reached: ${targets}. Measured repetitions completed: ${reps}. These are separate observations for therapist review.`,
    blockCompleteDuration: (seconds) => `Session duration: ${seconds}s`,
    blockCompleteDetailedSummary: (targets, reps, seconds) =>
      `Targets reached: ${targets}. Measured repetitions completed: ${reps}. Session duration: ${seconds}s.`,
    blockCompleteDetailedSummaryPatterns: (patterns, reps, seconds) =>
      `Paths completed: ${patterns}. Measured repetitions completed: ${reps}. Session duration: ${seconds}s.`,
    metricsSeparationNote:
      "Interaction targets and measured movement repetitions are separate observations for therapist review.",
    patternMetricsSeparationNote:
      "Completed paths and measured movement repetitions are separate observations for therapist review.",
    devMouseSimulation:
      "Development simulation: move the mouse over the preview when pose wrist is unavailable.",
    therapeuticSideFallback:
      "Reach guidance is using a temporary default side until your therapist assigns a specific arm.",
    prescribedSideRequiredTitle: "Session cannot start",
    prescribedSideRequiredMessage:
      "The treatment side has not been prescribed. Please contact your therapist.",
    cameraPreviewAriaLabel: "Interactive shoulder rehabilitation camera preview",
    cameraAccessDenied:
      "Camera access was denied. Movement tracking could not start. Please check camera permission and try again.",
    cameraNotFound: "No camera was found on this device.",
    cameraInUse: "The camera is in use by another application. Close other apps and try again.",
    cameraNoFrames: "Camera opened but no video frames detected. Try restarting camera.",
    cameraStartFailed:
      "Movement tracking could not start. Please check camera permission and try again.",
    repositionMoveFarther: "Move back slightly so your upper body stays in frame.",
    repositionStepIntoFrame: "Step closer so your reaching arm stays visible.",
    repositionImproveLighting: "Improve lighting so your movement is easier to follow.",
    repositionAdjustPosition: "Adjust your position until your upper body is clearly visible.",
    repositionReady: "Ready — reach toward the glowing targets at a comfortable pace.",
    runtimeFaultTitle: "Session paused",
    runtimeFaultRunnerUnavailable:
      "This movement block could not start safely. The session is paused — please reload and try again.",
    runtimeFaultPatternUnresolved:
      "This movement block could not load its guided path. The session is paused — please reload and try again.",
    catalogSessionConfigErrorTitle: "Session could not start",
    catalogSessionConfigErrorDescription:
      "This rehabilitation session is not configured correctly. Please contact your care team for assistance.",
    readyLabel: "Ready",
    beginLabel: "Begin",
    blockLabel: "Block",
    currentBlockLabel: "Current block",
    repProgressLabel: (completed, target) =>
      target != null ? `Rep ${completed} of ${target}` : `Reps completed: ${completed}`,
    sessionCompleteTitle: "Session complete",
    sessionCompleteHeadline: "You finished this guided session.",
    sessionCompleteEncouragement: "Take a moment to rest. Your therapist can review your session results.",
    blocksCompletedLabel: "Blocks completed",
    repetitionsCompletedLabel: "Repetitions completed",
    interactionsCompletedLabel: "Targets and paths completed",
    durationLabel: "Duration",
    durationSeconds: (seconds) => `${seconds}s`,
    sessionCompleteReviewNote:
      "These observations are recorded for therapist review and do not replace clinical assessment.",
    soundOnLabel: "Sound on",
    soundOffLabel: "Muted",
    soundMuteAria: "Mute session sounds",
    soundUnmuteAria: "Unmute session sounds",
    goodReachFeedback: "Good reach",
    niceControlFeedback: "Nice control",
    skipCameraSecondaryHint: "Continue without camera guidance",
  },
  ar: {
    consentTitle: "الكاميرا لتوجيه الحركة",
    consentDescription:
      "تساعد الكاميرا على توجيهك نحو أهداف الوصول. يبقى الفيديو على جهازك ولا يُخزَّن كتسجيل.",
    consentCheckbox: "أوافق على استخدام الكاميرا في هذه الجلسة الموجّهة.",
    continueCamera: "متابعة",
    skipCamera: "تخطّي الكاميرا",
    startingCamera: "جاري تشغيل الكاميرا…",
    experienceTitle: "الوصول إلى الضوء",
    clinicalHudExerciseLabel: "التمرين:",
    clinicalHudTimeRemainingLabel: "الوقت المتبقي:",
    sessionProgressLabel: "تقدّم الجلسة",
    interactionTargetsLabel: (reached, shown) => `أهداف التفاعل: ${reached}/${shown}`,
    interactionPatternsLabel: (completed, shown) => `المسارات المكتملة: ${completed}/${shown}`,
    measuredRepsLabel: (reps) => `التكرارات المقاسة: ${reps}`,
    movementBlockLabel: "كتلة الحركة",
    timeRemainingSeconds: (seconds) => `${seconds} ث متبقية`,
    blockProgressPercent: (percent) => `${percent}٪`,
    targetsAndReps: (reached, shown, reps) =>
      `الأهداف: ${reached}/${shown} · التكرارات: ${reps}`,
    pause: "إيقاف مؤقت",
    resume: "استئناف",
    pauseAriaLabel: "إيقاف كتلة الحركة مؤقتًا",
    resumeAriaLabel: "استئناف كتلة الحركة",
    trackingLostHold:
      "تم إيقاف التتبع مؤقتًا — ابقَ ثابتًا بينما نستعيد حركتك.",
    compensationSafetyHold:
      "لاحظنا تغيُّرًا في الوضعية — توقّف وأعد وضعيتك عندما تكون مستعدًا.",
    trackingRecalibrate:
      "فُقد التتبع لفترة — لنعيد المعايرة قبل المتابعة.",
    trackingRecovered: "عاد التتبع — يمكنك متابعة الوصول.",
    paused: "متوقف مؤقتًا.",
    blockInstructions: "ارفع ذراعك باتجاه الضوء وتحرك بوتيرة مريحة.",
    targetReached: "تم الوصول للضوء — وصول متحكم وجيد.",
    patternPathComplete: "اكتمل المسار — حركة متحكم وجيدة.",
    encouragementNiceWork: "عمل رائع.",
    blockCompleteTitle: "اكتملت كتلة الحركة",
    blockCompleteSummary: (targets, reps) =>
      `الأهداف التي تم الوصول إليها: ${targets}. التكرارات المقاسة المكتملة: ${reps}. هذه ملاحظات منفصلة لمراجعة المعالج.`,
    blockCompleteDuration: (seconds) => `مدة الجلسة: ${seconds} ث`,
    blockCompleteDetailedSummary: (targets, reps, seconds) =>
      `الأهداف التي تم الوصول إليها: ${targets}. التكرارات المقاسة المكتملة: ${reps}. مدة الجلسة: ${seconds} ث.`,
    blockCompleteDetailedSummaryPatterns: (patterns, reps, seconds) =>
      `المسارات المكتملة: ${patterns}. التكرارات المقاسة المكتملة: ${reps}. مدة الجلسة: ${seconds} ث.`,
    metricsSeparationNote:
      "أهداف التفاعل والتكرارات المقاسة للحركة ملاحظات منفصلة لمراجعة المعالج.",
    patternMetricsSeparationNote:
      "المسارات المكتملة والتكرارات المقاسة للحركة ملاحظات منفصلة لمراجعة المعالج.",
    devMouseSimulation:
      "محاكاة للتطوير: حرّك المؤشر فوق المعاينة عندما لا يتوفر معصم التتبع.",
    therapeuticSideFallback:
      "يستخدم توجيه الوصول جانبًا افتراضيًا مؤقتًا حتى يحدّد معالجك الذراع المطلوب.",
    prescribedSideRequiredTitle: "تعذّر بدء الجلسة",
    prescribedSideRequiredMessage:
      "لم يُحدَّد جانب العلاج بعد. يرجى التواصل مع معالجك.",
    cameraPreviewAriaLabel: "معاينة كاميرا جلسة الكتف التفاعلية",
    cameraAccessDenied:
      "تم رفض الوصول إلى الكاميرا. تعذّر بدء تتبع الحركة. تحقّق من إذن الكاميرا وحاول مرة أخرى.",
    cameraNotFound: "لم يتم العثور على كاميرا على هذا الجهاز.",
    cameraInUse: "الكاميرا قيد الاستخدام من تطبيق آخر. أغلق التطبيقات الأخرى وحاول مرة أخرى.",
    cameraNoFrames: "تم فتح الكاميرا لكن لم تُكتشَف إطارات فيديو. جرّب إعادة تشغيل الكاميرا.",
    cameraStartFailed:
      "تعذّر بدء تتبع الحركة. تحقّق من إذن الكاميرا وحاول مرة أخرى.",
    repositionMoveFarther: "تراجع قليلًا للخلف ليبقى الجزء العلوي من جسمك في الإطار.",
    repositionStepIntoFrame: "اقترب قليلًا ليبقى ذراع الوصول ظاهرًا.",
    repositionImproveLighting: "حسّن الإضاءة لتسهيل متابعة حركتك.",
    repositionAdjustPosition: "عدّل وضعيتك حتى يظهر الجزء العلوي من جسمك بوضوح.",
    repositionReady: "جاهز — امتد نحو الأهداف المتوهجة بوتيرة مريحة.",
    runtimeFaultTitle: "تم إيقاف الجلسة مؤقتًا",
    runtimeFaultRunnerUnavailable:
      "تعذّر بدء كتلة الحركة بأمان. الجلسة متوقفة — يرجى إعادة تحميل الصفحة والمحاولة مرة أخرى.",
    runtimeFaultPatternUnresolved:
      "تعذّر تحميل المسار الموجّه لكتلة الحركة. الجلسة متوقفة — يرجى إعادة تحميل الصفحة والمحاولة مرة أخرى.",
    catalogSessionConfigErrorTitle: "تعذّر بدء الجلسة",
    catalogSessionConfigErrorDescription:
      "لم تُعدّ هذه الجلسة العلاجية بشكل صحيح. يرجى التواصل مع فريق الرعاية للمساعدة.",
    readyLabel: "جاهز",
    beginLabel: "ابدأ",
    blockLabel: "الكتلة",
    currentBlockLabel: "الكتلة الحالية",
    repProgressLabel: (completed, target) =>
      target != null ? `التكرار ${completed} من ${target}` : `التكرارات المكتملة: ${completed}`,
    sessionCompleteTitle: "اكتملت الجلسة",
    sessionCompleteHeadline: "أنهيت هذه الجلسة الموجّهة.",
    sessionCompleteEncouragement: "خذ لحظة للراحة. يمكن لمعالجك مراجعة نتائج جلستك.",
    blocksCompletedLabel: "الكتل المكتملة",
    repetitionsCompletedLabel: "التكرارات المكتملة",
    interactionsCompletedLabel: "الأهداف والمسارات المكتملة",
    durationLabel: "المدة",
    durationSeconds: (seconds) => `${seconds} ث`,
    sessionCompleteReviewNote:
      "تُسجَّل هذه الملاحظات لمراجعة المعالج ولا تحل محل التقييم السريري.",
    soundOnLabel: "الصوت مفعّل",
    soundOffLabel: "صامت",
    soundMuteAria: "كتم أصوات الجلسة",
    soundUnmuteAria: "تشغيل أصوات الجلسة",
    goodReachFeedback: "وصول جيد",
    niceControlFeedback: "تحكم جيد",
    skipCameraSecondaryHint: "المتابعة بدون توجيه الكاميرا",
  },
};

export function interactiveShoulderUi(lang: PatientExerciseLanguage): InteractiveShoulderUi {
  return INTERACTIVE_SHOULDER_UI[lang];
}

export function interactiveShoulderSetupGuidanceCopy(
  lang: PatientExerciseLanguage,
  guidance: CaptureSetupGuidance,
): string {
  const ui = interactiveShoulderUi(lang);
  switch (guidance) {
    case "ready":
      return ui.repositionReady;
    case "move_farther":
      return ui.repositionMoveFarther;
    case "step_into_frame":
      return ui.repositionStepIntoFrame;
    case "improve_lighting":
      return ui.repositionImproveLighting;
    default:
      return ui.repositionAdjustPosition;
  }
}

const ORCHESTRATOR_MESSAGE_KEYS: Record<string, keyof InteractiveShoulderUi> = {
  "Paused.": "paused",
  "Tracking issue detected — please wait.": "trackingLostHold",
  "Tracking was lost for a while — let's recalibrate before continuing.": "trackingRecalibrate",
  "Nice work.": "encouragementNiceWork",
};

function resolveSafetyHoldCopy(
  ui: InteractiveShoulderUi,
  reason: SafetyHoldReason | null,
): string {
  if (reason === "compensation") return ui.compensationSafetyHold;
  return ui.trackingLostHold;
}

/** Maps orchestrator feedback to localized patient copy when possible. */
export function resolveInteractiveShoulderLiveMessage(
  lang: PatientExerciseLanguage,
  snapshot: SessionOrchestratorSnapshot,
): string | null {
  const ui = interactiveShoulderUi(lang);

  if (snapshot.safetyStatus === "hold") {
    return resolveSafetyHoldCopy(ui, snapshot.safetyHoldReason);
  }

  if (snapshot.sessionState === "paused" || snapshot.isPaused) {
    return ui.paused;
  }

  const raw = snapshot.patientFeedbackState.message;
  if (!raw) {
    if (snapshot.patientFeedbackState.encouragement) {
      return ui.encouragementNiceWork;
    }
    return null;
  }

  const mappedKey = ORCHESTRATOR_MESSAGE_KEYS[raw];
  if (mappedKey && typeof ui[mappedKey] === "string") {
    return ui[mappedKey] as string;
  }

  const blockInstructions = SHOULDER_ABDUCTION_REACH_INTERACTIVE_SESSION.blocks[0]?.instructions;
  if (raw === ui.blockInstructions || raw === blockInstructions) {
    return ui.blockInstructions;
  }

  return raw;
}

/** Localizes camera start failures for the interactive shoulder session. */
export function resolveInteractiveShoulderStartError(
  lang: PatientExerciseLanguage,
  err: unknown,
): string {
  const ui = interactiveShoulderUi(lang);
  if (err instanceof Error && err.message === PATIENT_CAMERA_NO_FRAMES_ERROR) {
    return ui.cameraNoFrames;
  }
  if (err instanceof DOMException) {
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      return ui.cameraAccessDenied;
    }
    if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
      return ui.cameraNotFound;
    }
    if (err.name === "NotReadableError" || err.name === "TrackStartError") {
      return ui.cameraInUse;
    }
  }
  if (err instanceof Error) {
    return err.message;
  }
  return ui.cameraStartFailed;
}

export function resolveInteractiveShoulderEncouragement(
  lang: PatientExerciseLanguage,
  snapshot: SessionOrchestratorSnapshot,
): string | null {
  if (snapshot.safetyStatus === "hold") return null;
  if (!snapshot.patientFeedbackState.encouragement) return null;
  return interactiveShoulderUi(lang).encouragementNiceWork;
}

/** HUD experience title follows the active block feedback mode — not one global label. */
export function resolveInteractiveShoulderExperienceTitle(
  language: PatientExerciseLanguage,
  feedbackMode: FeedbackInteractionMode,
): string {
  if (feedbackMode === "motion-pattern") {
    return language === "ar"
      ? D1_INSPIRED_DIAGONAL_REACH_PATTERN.nameAr
      : D1_INSPIRED_DIAGONAL_REACH_PATTERN.nameEn;
  }
  return interactiveShoulderUi(language).experienceTitle;
}

export function shouldTickTargetLifecycle(sessionState: SessionState): boolean {
  return sessionState === "active";
}

export function resolveInteractiveShoulderRuntimeFaultMessage(
  language: PatientExerciseLanguage,
  fault: OrchestratorCvRuntimeFault,
): string {
  const ui = interactiveShoulderUi(language);
  if (fault.kind === "pattern_unresolved") {
    return ui.runtimeFaultPatternUnresolved;
  }
  return ui.runtimeFaultRunnerUnavailable;
}
