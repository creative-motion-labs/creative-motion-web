import type { ClinicalActionStatus } from "@/app/lib/clinical-action-engine";
import type { PatientExerciseLanguage } from "@/app/lib/exercise-resolve";

import type { CvSaveOutcome } from "@/app/lib/cv/cv-save-outcome";
import { isHoldClassCvExercise } from "@/app/lib/cv/cv-metrics-display";
import type { CaptureSetupGuidance } from "@/app/lib/cv/patient-cv-capture-readiness";
import type { CvSaveResult } from "@/app/hooks/useCvSessionCapture";

export type PatientPortalLanguage = PatientExerciseLanguage;

/* ── Plan home ─────────────────────────────────────────────────────────────── */

export type PlanHomeUi = {
  loading: string;
  loadError: string;
  connectionError: string;
  planNotFound: string;
  goodMorning: string;
  goodAfternoon: string;
  goodEvening: string;
  yourRehabPlan: string;
  yourRehabFocus: string;
  weekOfProgram: (week: number, totalWeeks: number) => string;
  sessionProgram: (total: number) => string;
  assignedByClinician: string;
  yourProgress: string;
  sessionsProgress: (completed: number, total: number) => string;
  allSessionsComplete: string;
  allSessionsCompleteBody: string;
  viewMyProgress: string;
  viewMyProgressArrow: string;
  noteFromTherapist: string;
  noteFromTherapistInline: string;
  totalSessions: string;
  completed: string;
  progress: string;
  inYourPlan: string;
  sessionsDone: string;
  completion: string;
  yourSessions: string;
  tapTodaySession: string;
  completedSessionsListed: string;
  finalizingSchedule: string;
  checkBackLater: string;
  noSessionsScheduled: string;
  startToday: string;
  done: string;
  upcoming: string;
  exercisesMinutes: (count: number, minutes: number) => string;
};

const PLAN_HOME: Record<PatientPortalLanguage, PlanHomeUi> = {
  en: {
    loading: "Loading…",
    loadError: "Unable to load your plan. Please try again.",
    connectionError: "Connection error. Please check your connection and try again.",
    planNotFound: "Plan not found.",
    goodMorning: "Good morning",
    goodAfternoon: "Good afternoon",
    goodEvening: "Good evening",
    yourRehabPlan: "Your rehabilitation plan",
    yourRehabFocus: "Your rehab focus",
    weekOfProgram: (week, totalWeeks) => `Week ${week} of ${totalWeeks}`,
    sessionProgram: (total) => `Your ${total}-session program`,
    assignedByClinician: "Assigned by your clinician",
    yourProgress: "Your progress",
    sessionsProgress: (completed, total) =>
      `${completed} of ${total} session${total === 1 ? "" : "s"}`,
    allSessionsComplete: "All sessions complete",
    allSessionsCompleteBody:
      "You have finished every session in your current plan. Your therapist will review your progress and may update your program.",
    viewMyProgress: "View my progress",
    viewMyProgressArrow: "View my progress →",
    noteFromTherapist: "Note from your therapist",
    noteFromTherapistInline: "A note from your therapist:",
    totalSessions: "Total sessions",
    completed: "Completed",
    progress: "Progress",
    inYourPlan: "in your plan",
    sessionsDone: "sessions done",
    completion: "completion",
    yourSessions: "Your sessions",
    tapTodaySession: "Tap today's session when you are ready to begin.",
    completedSessionsListed: "Your completed sessions are listed below.",
    finalizingSchedule: "Your therapist is finalizing your session schedule.",
    checkBackLater: "Please check back later once your rehabilitation sessions are ready.",
    noSessionsScheduled: "No sessions scheduled yet.",
    startToday: "Start today",
    done: "Done",
    upcoming: "Upcoming",
    exercisesMinutes: (count, minutes) =>
      `${count} exercise${count === 1 ? "" : "s"} · ~${minutes} min`,
  },
  ar: {
    loading: "جاري التحميل…",
    loadError: "تعذّر تحميل خطتك. يرجى المحاولة مرة أخرى.",
    connectionError: "خطأ في الاتصال. تحقّق من الشبكة وحاول مرة أخرى.",
    planNotFound: "الخطة غير موجودة.",
    goodMorning: "صباح الخير",
    goodAfternoon: "مساء الخير",
    goodEvening: "مساء الخير",
    yourRehabPlan: "خطتك للتأهيل",
    yourRehabFocus: "تركيز خطتك التأهيلية",
    weekOfProgram: (week, totalWeeks) => `الأسبوع ${week} من ${totalWeeks}`,
    sessionProgram: (total) => `برنامجك (${total} جلسات)`,
    assignedByClinician: "موصى بها من معالجك",
    yourProgress: "تقدّمك",
    sessionsProgress: (completed, total) => `${completed} من ${total} جلسات`,
    allSessionsComplete: "أكملت جميع الجلسات",
    allSessionsCompleteBody:
      "أنهيت كل جلسات خطتك الحالية. سيراجع معالجك تقدّمك وقد يحدّث برنامجك.",
    viewMyProgress: "عرض تقدّمي",
    viewMyProgressArrow: "عرض تقدّمي ←",
    noteFromTherapist: "ملاحظة من معالجك",
    noteFromTherapistInline: "ملاحظة من معالجك:",
    totalSessions: "إجمالي الجلسات",
    completed: "مكتمل",
    progress: "التقدّم",
    inYourPlan: "في خطتك",
    sessionsDone: "جلسات منجزة",
    completion: "نسبة الإكمال",
    yourSessions: "جلساتك",
    tapTodaySession: "اضغط على جلسة اليوم عندما تكون مستعداً للبدء.",
    completedSessionsListed: "جلساتك المكتملة مدرجة أدناه.",
    finalizingSchedule: "معالجك يُجهّز جدول جلساتك.",
    checkBackLater: "يرجى العودة لاحقاً عندما تصبح جلسات التأهيل جاهزة.",
    noSessionsScheduled: "لا توجد جلسات مجدولة بعد.",
    startToday: "ابدأ اليوم",
    done: "منجز",
    upcoming: "قادمة",
    exercisesMinutes: (count, minutes) => `${count} تمارين · ~${minutes} د`,
  },
};

/* ── Session shell ─────────────────────────────────────────────────────────── */

export type SessionShellUi = {
  sessionNotFound: string;
  backToPlan: string;
  backToMyPlan: string;
  todaysRehabGoal: string;
  todaysGoal: (sessionTitle: string) => string;
  painBefore: string;
  safetyQuestion: string;
  yes: string;
  no: string;
  startSession: string;
  safetyStopTitle: string;
  safetyAcknowledge: string;
  therapistReviewNote: string;
  nextExercise: string;
  previousExercise: string;
  completeSession: string;
  saving: string;
  finalExerciseHint: string;
  effortQuestion: string;
  painAfter: string;
  optionalNoteLabel: string;
  optionalNotePlaceholder: string;
  finishHint: string;
  sessionComplete: string;
  exercisesCompleted: (count: number) => string;
  effort: string;
  painAfterLabel: string;
  viewProgress: string;
  completionSafetyNote: string;
  sessionSavedForReview: string;
  wellDone: string;
  progressUpdated: string;
  alreadyCompleted: string;
  finishedExercisesInSession: (count: number) => string;
  completedOn: (when: string) => string;
  noRepeatNeeded: string;
  saveError: string;
  sharpPainFooter: string;
};

const SESSION_SHELL: Record<PatientPortalLanguage, SessionShellUi> = {
  en: {
    sessionNotFound: "Session not found.",
    backToPlan: "← Your plan",
    backToMyPlan: "← Back to my plan",
    todaysRehabGoal: "Today's rehab goal",
    todaysGoal: (title) =>
      title.trim()
        ? `Complete "${title}" gently and safely.`
        : "Complete today's session gently and safely.",
    painBefore: "How is your pain before starting? (0 = none, 10 = worst)",
    safetyQuestion: "Do you feel sharp pain, dizziness, or unusual symptoms today?",
    yes: "Yes",
    no: "No",
    startSession: "Start session",
    safetyStopTitle: "Please stop and contact your therapist before starting.",
    safetyAcknowledge: "I will contact my therapist before continuing",
    therapistReviewNote:
      "Your therapist will review your pain, effort, and session response.",
    nextExercise: "Next exercise →",
    previousExercise: "← Previous exercise",
    completeSession: "Complete session",
    saving: "Saving…",
    finalExerciseHint: "This is your final exercise for this session.",
    effortQuestion: "How did this feel? (1 = easy, 10 = very hard)",
    painAfter: "How is your pain after this session? (0 = none, 10 = worst)",
    optionalNoteLabel: "Anything you want your therapist to know? (optional)",
    optionalNotePlaceholder: "Optional note for your therapist…",
    finishHint: "Select how the session felt and your pain level after exercising to finish.",
    sessionComplete: "Session complete",
    exercisesCompleted: (count) =>
      `${count} exercise${count === 1 ? "" : "s"} completed`,
    effort: "Effort",
    painAfterLabel: "Pain after",
    viewProgress: "View progress",
    completionSafetyNote:
      "If you feel sharp or unusual pain during exercises, stop immediately and contact your therapist.",
    sessionSavedForReview:
      "Your session response has been saved. Your therapist can review what you reported.",
    wellDone: "Well done.",
    progressUpdated: "Your progress has been updated for your therapist to review.",
    alreadyCompleted: "Session already completed",
    finishedExercisesInSession: (count) =>
      `You finished ${count} exercise${count === 1 ? "" : "s"} in this session.`,
    completedOn: (when) => ` Completed ${when}.`,
    noRepeatNeeded:
      "Your therapist can review your progress on the plan dashboard. You do not need to repeat this session.",
    saveError: "Could not save session. Please try again.",
    sharpPainFooter:
      "If you feel sharp or unusual pain during exercises, stop immediately and contact your therapist.",
  },
  ar: {
    sessionNotFound: "الجلسة غير موجودة.",
    backToPlan: "← خطتك",
    backToMyPlan: "← العودة إلى خطتي",
    todaysRehabGoal: "هدف تأهيل اليوم",
    todaysGoal: (title) =>
      title.trim()
        ? `أنجز «${title}» بلطف وأمان.`
        : "أنجز جلسة اليوم بلطف وأمان.",
    painBefore: "ما مستوى ألمك قبل البدء؟ (0 = لا يوجد، 10 = الأسوأ)",
    safetyQuestion: "هل تشعر بألم حاد أو دوخة أو أعراض غير معتادة اليوم؟",
    yes: "نعم",
    no: "لا",
    startSession: "بدء الجلسة",
    safetyStopTitle: "توقّف وتواصل مع معالجك قبل البدء.",
    safetyAcknowledge: "سأتواصل مع معالجك قبل المتابعة",
    therapistReviewNote: "سيراجع معالجك ألمك ومجهودك واستجابتك للجلسة.",
    nextExercise: "← التمرين التالي",
    previousExercise: "التمرين السابق →",
    completeSession: "إنهاء الجلسة",
    saving: "جاري الحفظ…",
    finalExerciseHint: "هذا آخر تمرين في هذه الجلسة.",
    effortQuestion: "كيف كان شعورك؟ (1 = سهل، 10 = صعب جداً)",
    painAfter: "ما مستوى ألمك بعد الجلسة؟ (0 = لا يوجد، 10 = الأسوأ)",
    optionalNoteLabel: "هل تريد إخبار معالجك بشيء؟ (اختياري)",
    optionalNotePlaceholder: "ملاحظة اختيارية لمعالجك…",
    finishHint: "اختر شعور الجلسة ومستوى الألم بعد التمرين لإنهاء الجلسة.",
    sessionComplete: "تم إكمال الجلسة",
    exercisesCompleted: (count) =>
      count === 1 ? "تمرين واحد مكتمل" : `${count} تمارين مكتملة`,
    effort: "المجهود",
    painAfterLabel: "الألم بعد الجلسة",
    viewProgress: "عرض التقدّم",
    completionSafetyNote:
      "إذا شعرت بألم حاد أو غير معتاد أثناء التمارين، توقّف فوراً وتواصل مع معالجك.",
    sessionSavedForReview:
      "تم حفظ استجابتك للجلسة. يمكن لمعالجك مراجعة ما قمت بتسجيله.",
    wellDone: "أحسنت.",
    progressUpdated: "تم تحديث تقدّمك ليراجعه معالجك.",
    alreadyCompleted: "الجلسة مكتملة مسبقاً",
    finishedExercisesInSession: (count) =>
      count === 1
        ? "أنجزت تمريناً واحداً في هذه الجلسة."
        : `أنجزت ${count} تمارين في هذه الجلسة.`,
    completedOn: (when) => ` اكتملت في ${when}.`,
    noRepeatNeeded:
      "يمكن لمعالجك مراجعة تقدّمك. لا حاجة لإعادة هذه الجلسة.",
    saveError: "تعذّر حفظ الجلسة. يرجى المحاولة مرة أخرى.",
    sharpPainFooter:
      "إذا شعرت بألم حاد أو غير معتاد أثناء التمارين، توقّف فوراً وتواصل مع معالجك.",
  },
};

/* ── Exercise card (Sprint 4) ──────────────────────────────────────────────── */

export type SessionExerciseUi = {
  exerciseOf: string;
  safetyBanner: string;
  whyThisMatters: string;
  stopIf: string;
  therapistNote: string;
  doseFallback: string;
  asPrescribed: string;
  exerciseFallback: string;
};

/* ── Exercise session flow (Sprint W-0) ───────────────────────────────────── */

export type SessionExerciseFlowUi = {
  sessionOverviewTitle: string;
  sessionOverviewBody: string;
  exercisesInSession: (count: number) => string;
  beginExercises: string;
  demoMediaPlaceholder: string;
  bodyRegionLabel: string;
  doseSets: string;
  doseReps: string;
  doseDuration: string;
  doseRest: string;
  doseNotSet: string;
  durationSeconds: (sec: number) => string;
  restSeconds: (sec: number) => string;
  startThisExercise: string;
  completeSet: string;
  setProgress: (done: number, total: number) => string;
  completeExercise: string;
  exerciseCompleteTitle: string;
  exerciseCompleteBody: string;
  nextExercise: string;
  takeYourTime: string;
  restBetweenSets: string;
  followTherapistPlan: string;
  stopSharpPain: string;
  therapistCanReview: string;
  sessionProgressLabel: string;
  inProgressLabel: string;
  sessionWrapUpTitle: string;
  continueToFinish: string;
  cvSavedForReview: string;
  cvNotSavedManual: string;
  cvPostErrorContinue: string;
  cvSaving: string;
  cvSavedCheck: string;
  cvSaveFailedSessionRecorded: string;
  cvHoldTooShort: string;
};

const BODY_REGION_PATIENT: Record<
  PatientPortalLanguage,
  Record<string, string>
> = {
  en: {
    knee: "Knee",
    lumbar: "Lower back",
    shoulder: "Shoulder",
    cervical: "Neck",
    ankle: "Ankle",
    hip: "Hip",
    general: "General",
  },
  ar: {
    knee: "الركبة",
    lumbar: "أسفل الظهر",
    shoulder: "الكتف",
    cervical: "الرقبة",
    ankle: "الكاحل",
    hip: "الورك",
    general: "عام",
  },
};

const SESSION_EXERCISE_FLOW_UI: Record<
  PatientPortalLanguage,
  SessionExerciseFlowUi
> = {
  en: {
    sessionOverviewTitle: "Session overview",
    sessionOverviewBody:
      "You will move through each exercise one at a time. Take your time and follow your therapist's plan.",
    exercisesInSession: (count) =>
      `${count} exercise${count === 1 ? "" : "s"} in this session`,
    beginExercises: "Begin exercises",
    demoMediaPlaceholder: "Demo media placeholder",
    bodyRegionLabel: "Body region",
    doseSets: "Sets",
    doseReps: "Reps",
    doseDuration: "Duration",
    doseRest: "Rest",
    doseNotSet: "—",
    durationSeconds: (sec) => `${sec}s`,
    restSeconds: (sec) => `${sec}s rest`,
    startThisExercise: "Start this exercise",
    completeSet: "Complete set",
    setProgress: (done, total) => `Set ${done} of ${total}`,
    completeExercise: "Complete exercise",
    exerciseCompleteTitle: "Exercise complete",
    exerciseCompleteBody: "Take a short rest before the next exercise when you are ready.",
    nextExercise: "Next exercise",
    takeYourTime: "Take your time",
    restBetweenSets: "Rest between sets",
    followTherapistPlan: "Follow your therapist's plan",
    stopSharpPain: "Stop if you feel sharp or unusual pain",
    therapistCanReview: "Your therapist can review your progress",
    sessionProgressLabel: "Session progress",
    inProgressLabel: "In progress",
    sessionWrapUpTitle: "Finish your session",
    continueToFinish: "Continue to finish session",
    cvSavedForReview: "Camera result saved for therapist review.",
    cvNotSavedManual: "Camera result not saved — session completed manually.",
    cvPostErrorContinue: "Could not save camera result — you can continue.",
    cvSaving: "Saving camera result…",
    cvSavedCheck: "Camera result saved ✓",
    cvSaveFailedSessionRecorded:
      "Camera data could not be saved — your session is still recorded",
    cvHoldTooShort:
      "Hold time was under 3 seconds, so camera metrics were not saved.",
  },
  ar: {
    sessionOverviewTitle: "نظرة على الجلسة",
    sessionOverviewBody:
      "ستنتقل من تمرين إلى آخر. خذ وقتك واتبع خطة معالجك.",
    exercisesInSession: (count) =>
      count === 1 ? "تمرين واحد في هذه الجلسة" : `${count} تمارين في هذه الجلسة`,
    beginExercises: "بدء التمارين",
    demoMediaPlaceholder: "عنصر توضيحي للعرض التجريبي",
    bodyRegionLabel: "منطقة الجسم",
    doseSets: "مجموعات",
    doseReps: "تكرارات",
    doseDuration: "المدة",
    doseRest: "راحة",
    doseNotSet: "—",
    durationSeconds: (sec) => `${sec} ث`,
    restSeconds: (sec) => `راحة ${sec} ث`,
    startThisExercise: "بدء هذا التمرين",
    completeSet: "إكمال المجموعة",
    setProgress: (done, total) => `المجموعة ${done} من ${total}`,
    completeExercise: "إكمال التمرين",
    exerciseCompleteTitle: "اكتمل التمرين",
    exerciseCompleteBody: "خذ راحة قصيرة قبل التمرين التالي عندما تكون مستعداً.",
    nextExercise: "التمرين التالي",
    takeYourTime: "خذ وقتك",
    restBetweenSets: "راحة بين المجموعات",
    followTherapistPlan: "اتبع خطة معالجك",
    stopSharpPain: "توقّف عند الشعور بألم حاد أو غير معتاد",
    therapistCanReview: "يمكن لمعالجك مراجعة تقدّمك",
    sessionProgressLabel: "تقدّم الجلسة",
    inProgressLabel: "قيد التنفيذ",
    sessionWrapUpTitle: "إنهاء الجلسة",
    continueToFinish: "متابعة لإنهاء الجلسة",
    cvSavedForReview: "تم حفظ نتيجة الكاميرا لمراجعة المعالج.",
    cvNotSavedManual: "لم يتم حفظ نتيجة الكاميرا — تم إكمال الجلسة يدويًا.",
    cvPostErrorContinue: "تعذر حفظ نتيجة الكاميرا — يمكنك المتابعة.",
    cvSaving: "جاري حفظ نتيجة الكاميرا…",
    cvSavedCheck: "تم حفظ نتيجة الكاميرا ✓",
    cvSaveFailedSessionRecorded: "تعذر حفظ بيانات الكاميرا — تم تسجيل جلستك",
    cvHoldTooShort:
      "مدة الثبات أقل من 3 ثوانٍ، لذلك لم تُحفظ مقاييس الكاميرا.",
  },
};

/** Patient notice after parent-owned CV save on exercise completion. */
export function cvSessionCapturePatientMessage(
  lang: PatientPortalLanguage,
  result: CvSaveResult,
  exerciseId?: string,
): string | null {
  if (result === "not_applicable") return null;
  const ui = sessionExerciseFlowUi(lang);
  if (result === "saved" || result === "already_saved") return ui.cvSavedCheck;
  if (result === "post_error") return ui.cvSaveFailedSessionRecorded;
  if (result === "too_short" && isHoldClassCvExercise(exerciseId)) {
    return ui.cvHoldTooShort;
  }
  return ui.cvNotSavedManual;
}

export function cvSessionCaptureSavingMessage(lang: PatientPortalLanguage): string {
  return sessionExerciseFlowUi(lang).cvSaving;
}

/** Patient notice after Complete exercise when optional CV ran or was eligible. */
export function cvSaveOutcomePatientMessage(
  lang: PatientPortalLanguage,
  outcome: CvSaveOutcome,
): string | null {
  if (outcome === "not_applicable") return null;
  if (outcome === "saved" || outcome === "already_saved") {
    return sessionExerciseFlowUi(lang).cvSavedForReview;
  }
  if (outcome === "post_error") {
    return sessionExerciseFlowUi(lang).cvPostErrorContinue;
  }
  return sessionExerciseFlowUi(lang).cvNotSavedManual;
}

export function sessionExerciseFlowUi(
  lang: PatientPortalLanguage,
): SessionExerciseFlowUi {
  return SESSION_EXERCISE_FLOW_UI[lang];
}

export function formatBodyRegionForPatient(
  lang: PatientPortalLanguage,
  region: string | undefined,
): string | null {
  if (!region?.trim()) return null;
  return BODY_REGION_PATIENT[lang][region] ?? region;
}

/* ── Exercise media area (Sprint MEDIA-1) ─────────────────────────────────── */

export type ExerciseMediaUi = {
  movementGuideTitle: string;
  movementGuideSubtitle: string;
  followTherapistInstructions: string;
  mediaAlt: (name: string) => string;
};

const EXERCISE_MEDIA_UI: Record<PatientPortalLanguage, ExerciseMediaUi> = {
  en: {
    movementGuideTitle: "Movement guide",
    movementGuideSubtitle: "Review the movement before you start",
    followTherapistInstructions: "Follow your therapist's instructions",
    mediaAlt: (name) => (name.trim() ? `Exercise guide: ${name}` : "Exercise guide"),
  },
  ar: {
    movementGuideTitle: "دليل الحركة",
    movementGuideSubtitle: "راجع الحركة قبل بدء التمرين",
    followTherapistInstructions: "اتبع تعليمات معالجك",
    mediaAlt: (name) => (name.trim() ? `دليل التمرين: ${name}` : "دليل التمرين"),
  },
};

export function exerciseMediaUi(lang: PatientPortalLanguage): ExerciseMediaUi {
  return EXERCISE_MEDIA_UI[lang];
}

const SESSION_EXERCISE_UI: Record<PatientPortalLanguage, SessionExerciseUi> = {
  en: {
    exerciseOf: "Exercise {current} of {total}",
    safetyBanner:
      "Move slowly and stop if you feel sharp pain, dizziness, or unusual symptoms.",
    whyThisMatters: "Why this matters:",
    stopIf: "Stop if:",
    therapistNote: "Note from your therapist:",
    doseFallback: "As prescribed by your therapist",
    asPrescribed: "As prescribed by your therapist",
    exerciseFallback: "Exercise",
  },
  ar: {
    exerciseOf: "التمرين {current} من {total}",
    safetyBanner:
      "تحرّك ببطء وتوقّف إذا شعرت بألم حاد أو دوخة أو أعراض غير معتادة.",
    whyThisMatters: "لماذا هذا مهم:",
    stopIf: "توقّف إذا:",
    therapistNote: "ملاحظة من معالجك:",
    doseFallback: "حسب ما وصفه معالجك",
    asPrescribed: "حسب ما وصفه معالجك",
    exerciseFallback: "تمرين",
  },
};

const CLINICAL_ACTION_AR: Record<ClinicalActionStatus, string> = {
  needs_review:
    "تمت إشارة استجابتك لمراجعة المعالج. إذا شعرت بأعراض غير معتادة، تواصل مع معالجك.",
  pain_increase:
    "أبلغت عن زيادة في الألم بعد هذه الجلسة. ارتح كما يلزم وتواصل مع معالجك إذا استمر الألم.",
  high_effort:
    "كانت هذه الجلسة صعبة. تحرّك بلطف وأخبر معالجك إذا استمر ذلك.",
  adherence_follow_up:
    "لاحظنا أنك قد تكون فاتتك جلسات. يمكن لمعالجك مساعدتك على العودة للمسار.",
  ready_for_progression_review:
    "أكملت عدة جلسات. سيراجع معالجك ما إذا كان ينبغي تحديث خطتك.",
  stable: "عمل رائع. تم حفظ استجاباتك ليراجعها معالجك.",
};

/* ── Helpers ───────────────────────────────────────────────────────────────── */

export function planHomeUi(lang: PatientPortalLanguage): PlanHomeUi {
  return PLAN_HOME[lang];
}

export function sessionShellUi(lang: PatientPortalLanguage): SessionShellUi {
  return SESSION_SHELL[lang];
}

export function sessionExerciseUi(lang: PatientPortalLanguage): SessionExerciseUi {
  return SESSION_EXERCISE_UI[lang];
}

export function getPortalGreeting(lang: PatientPortalLanguage): string {
  const h = new Date().getHours();
  const ui = planHomeUi(lang);
  if (h < 12) return ui.goodMorning;
  if (h < 18) return ui.goodAfternoon;
  return ui.goodEvening;
}

export function formatExerciseProgress(
  lang: PatientPortalLanguage,
  current: number,
  total: number,
): string {
  return sessionExerciseUi(lang).exerciseOf
    .replace("{current}", String(current))
    .replace("{total}", String(total));
}

export function localizeScheduleLabel(
  label: string,
  lang: PatientPortalLanguage,
): string {
  if (lang !== "ar") return label;
  const week = /^Week (\d+)$/.exec(label);
  if (week) return `الأسبوع ${week[1]}`;
  const day = /^Day (\d+)$/.exec(label);
  if (day) return `اليوم ${day[1]}`;
  if (label.startsWith("Week of ")) {
    return label.replace("Week of ", "أسبوع ");
  }
  return label;
}

export function formatSessionDisplayTitle(
  sessionNumber: number,
  title: string,
  lang: PatientPortalLanguage,
): string {
  const trimmed = title.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith(`session ${sessionNumber}`)) return title;
  if (lang === "ar") return `الجلسة ${sessionNumber} — ${title}`;
  return `Session ${sessionNumber} — ${title}`;
}

export function localizeClinicalActionMessage(
  status: ClinicalActionStatus,
  lang: PatientPortalLanguage,
  englishMessage: string,
): string {
  if (lang !== "ar") return englishMessage;
  return CLINICAL_ACTION_AR[status] ?? englishMessage;
}

export function portalTextDir(lang: PatientPortalLanguage): "rtl" | "ltr" {
  return lang === "ar" ? "rtl" : "ltr";
}

/* ── Progress page ─────────────────────────────────────────────────────────── */

export type ProgressPageUi = {
  loading: string;
  loadError: string;
  connectionError: string;
  planNotFound: string;
  backToPlan: string;
  pageTitle: string;
  pageSubtitle: string;
  sessionsCompleted: string;
  progress: string;
  adherence: string;
  averageEffort: string;
  latestPain: string;
  inYourPlan: string;
  completionRate: string;
  selfReported: string;
  notRecordedYet: string;
  keepGoing: string;
  overallProgress: string;
  sessionHistory: string;
  completeFirstSession: string;
  clinicalReviewNote: string;
  latestPainScore: string;
  noteFromTherapist: string;
  sessionLabel: (n: number) => string;
  completedStatus: string;
  notCompletedStatus: string;
  painAfterSession: string;
  effort: string;
  noteToTherapist: string;
  noSessionDataYet: string;
  exercisesCompleted: (count: number) => string;
  contextNotice: string;
  lastReportedIndicators: string;
  lastReportedPain: (score: number) => string;
  lastReportedEffort: (score: number) => string;
  lastReportedTherapistNote: string;
};

const PROGRESS_PAGE: Record<PatientPortalLanguage, ProgressPageUi> = {
  en: {
    loading: "Loading…",
    loadError: "Unable to load progress data. Please try again.",
    connectionError: "Connection error. Please check your connection and try again.",
    planNotFound: "Plan not found.",
    backToPlan: "← Back to my plan",
    pageTitle: "Your Rehabilitation Progress",
    pageSubtitle:
      "Progress is updated after each completed session. Your therapist reviews this regularly.",
    sessionsCompleted: "Sessions completed",
    progress: "Progress",
    adherence: "Adherence",
    averageEffort: "Average effort",
    latestPain: "Latest pain",
    inYourPlan: "in your plan",
    completionRate: "completion rate",
    selfReported: "self-reported",
    notRecordedYet: "not recorded yet",
    keepGoing: "Keep going — your progress builds as you complete more sessions.",
    overallProgress: "Overall progress",
    sessionHistory: "Session history",
    completeFirstSession: "Complete your first session to see your timeline.",
    clinicalReviewNote: "Detailed clinical progress will be reviewed by your therapist.",
    latestPainScore: "Latest pain score",
    noteFromTherapist: "Note from your therapist",
    sessionLabel: (n) => `Session ${n}`,
    completedStatus: "Completed",
    notCompletedStatus: "Not completed",
    painAfterSession: "Pain after session",
    effort: "Effort",
    noteToTherapist: "Note to your therapist",
    noSessionDataYet: "No session data recorded yet.",
    exercisesCompleted: (count) =>
      `${count} exercise${count === 1 ? "" : "s"} completed`,
    contextNotice:
      "This page reflects the sessions, pain, and effort you have reported. Your therapist uses this information together with clinical assessment to follow your rehabilitation journey.",
    lastReportedIndicators: "Last reported indicators",
    lastReportedPain: (score) => `Last reported pain: ${score}/10`,
    lastReportedEffort: (score) => `Last reported effort: ${score}/10`,
    lastReportedTherapistNote:
      "Your therapist reviews these indicators to follow your response to rehabilitation",
  },
  ar: {
    loading: "جاري التحميل…",
    loadError: "تعذّر تحميل بيانات التقدّم. يرجى المحاولة مرة أخرى.",
    connectionError: "خطأ في الاتصال. تحقّق من الشبكة وحاول مرة أخرى.",
    planNotFound: "الخطة غير موجودة.",
    backToPlan: "← العودة إلى خطتي",
    pageTitle: "تقدّمك في التأهيل",
    pageSubtitle:
      "يُحدَّث التقدّم بعد كل جلسة مكتملة. يراجع معالجك هذا بانتظام.",
    sessionsCompleted: "الجلسات المكتملة",
    progress: "التقدّم",
    adherence: "الالتزام",
    averageEffort: "متوسط الجهد",
    latestPain: "آخر مستوى ألم",
    inYourPlan: "في خطتك",
    completionRate: "نسبة الإكمال",
    selfReported: "حسب تقريرك",
    notRecordedYet: "لم يُسجَّل بعد",
    keepGoing: "واصل — يتكوّن تقدّمك مع كل جلسة تكملها.",
    overallProgress: "التقدّم الإجمالي",
    sessionHistory: "سجل الجلسات",
    completeFirstSession: "أكمل جلستك الأولى لعرض الجدول الزمني.",
    clinicalReviewNote: "سيراجع معالجك التقدّم السريري التفصيلي.",
    latestPainScore: "آخر درجة ألم",
    noteFromTherapist: "ملاحظة من معالجك",
    sessionLabel: (n) => `الجلسة ${n}`,
    completedStatus: "مكتملة",
    notCompletedStatus: "غير مكتملة",
    painAfterSession: "الألم بعد الجلسة",
    effort: "الجهد",
    noteToTherapist: "ملاحظة للمُعالج",
    noSessionDataYet: "لا توجد بيانات مسجّلة لهذه الجلسة بعد.",
    exercisesCompleted: (count) =>
      count === 1 ? "تمرين واحد مكتمل" : `${count} تمارين مكتملة`,
    contextNotice:
      "تعكس هذه الصفحة ما قمت بتسجيله من جلسات، ألم، وجهد. يستخدم معالجك هذه المعلومات مع تقييمه السريري لمتابعة رحلتك التأهيلية.",
    lastReportedIndicators: "آخر مؤشرات مُبلَّغ عنها",
    lastReportedPain: (score) => `آخر ألم مُبلَّغ عنه: ${score}/10`,
    lastReportedEffort: (score) => `آخر جهد مُبلَّغ عنه: ${score}/10`,
    lastReportedTherapistNote:
      "يقوم معالجك بمراجعة هذه المؤشرات لمتابعة استجابتك للتأهيل",
  },
};

/* ── Token layout ──────────────────────────────────────────────────────────── */

export type TokenLayoutUi = {
  assignedBy: (name: string) => string;
};

const TOKEN_LAYOUT: Record<PatientPortalLanguage, TokenLayoutUi> = {
  en: {
    assignedBy: (name) => `Assigned by ${name}`,
  },
  ar: {
    assignedBy: (name) => `موصى بها من ${name}`,
  },
};

export function progressPageUi(lang: PatientPortalLanguage): ProgressPageUi {
  return PROGRESS_PAGE[lang];
}

/* ── Progress Portal v1 (PR76) ─────────────────────────────────────────────── */

export type ProgressPortalV1Ui = {
  backToPlan: string;
  pageTitle: string;
  pageSubtitle: string;
  recoveryProgress: string;
  performanceProgress: string;
  progressHeroGreeting: (name: string) => string;
  sessionsStat: string;
  activeDaysStat: string;
  completionStat: string;
  effortStat: string;
  effortNotYet: string;
  quickStatsTitle: string;
  activeProgramTitle: string;
  activeProgramSubtitle: string;
  nextSessionLabel: string;
  startNextSession: string;
  exerciseHighlightsTitle: string;
  exerciseHighlightsEmpty: string;
  practicedInSessions: (count: number) => string;
  achievementsTitle: string;
  achievementsSubtitle: string;
  achievementLocked: string;
  recentSessionsTitle: string;
  recentSessionsEmpty: string;
  howYouFelt: string;
  yourEffort: string;
  safetyFooter: string;
  noteFromTherapist: string;
  weekOfProgram: (week: number, total: number) => string;
};

const PROGRESS_PORTAL_V1: Record<PatientPortalLanguage, ProgressPortalV1Ui> = {
  en: {
    backToPlan: "← Back to my plan",
    pageTitle: "Your progress",
    pageSubtitle: "A friendly look at the sessions you have completed so far.",
    recoveryProgress: "Recovery Progress",
    performanceProgress: "Performance Progress",
    progressHeroGreeting: (name) => `Nice work, ${name}`,
    sessionsStat: "Sessions",
    activeDaysStat: "Active days (7d)",
    completionStat: "Completion",
    effortStat: "Avg. effort",
    effortNotYet: "Not yet recorded",
    quickStatsTitle: "Quick stats",
    activeProgramTitle: "Your active program",
    activeProgramSubtitle: "Keep going at your own pace.",
    nextSessionLabel: "Up next",
    startNextSession: "Start next session",
    exerciseHighlightsTitle: "Exercise highlights",
    exerciseHighlightsEmpty: "Complete a session to see which exercises you have practiced most.",
    practicedInSessions: (count) =>
      `Practiced in ${count} session${count === 1 ? "" : "s"}`,
    achievementsTitle: "Achievements",
    achievementsSubtitle: "Small wins along the way.",
    achievementLocked: "Keep going to unlock",
    recentSessionsTitle: "Recent sessions",
    recentSessionsEmpty: "Your recent sessions will show up here after you complete one.",
    howYouFelt: "How you felt",
    yourEffort: "Your effort",
    safetyFooter:
      "Stop if you feel sharp pain, dizziness, or unusual symptoms. Contact your therapist if symptoms worsen.",
    noteFromTherapist: "Note from your therapist",
    weekOfProgram: (week, total) => `Week ${week} of ${total}`,
  },
  ar: {
    backToPlan: "← العودة إلى خطتي",
    pageTitle: "تقدّمك",
    pageSubtitle: "نظرة ودّية على الجلسات التي أكملتها حتى الآن.",
    recoveryProgress: "تقدّم التعافي",
    performanceProgress: "تقدّم الأداء",
    progressHeroGreeting: (name) => `عمل رائع، ${name}`,
    sessionsStat: "الجلسات",
    activeDaysStat: "أيام نشطة (7)",
    completionStat: "الإكمال",
    effortStat: "متوسط الجهد",
    effortNotYet: "لم يُسجَّل بعد",
    quickStatsTitle: "إحصاءات سريعة",
    activeProgramTitle: "برنامجك الحالي",
    activeProgramSubtitle: "واصل على وتيرتك الخاصة.",
    nextSessionLabel: "التالي",
    startNextSession: "بدء الجلسة التالية",
    exerciseHighlightsTitle: "أبرز التمارين",
    exerciseHighlightsEmpty: "أكمل جلسة لترى التمارين التي تتدرّب عليها أكثر.",
    practicedInSessions: (count) =>
      count === 1 ? "تم التمرين في جلسة واحدة" : `تم التمرين في ${count} جلسات`,
    achievementsTitle: "إنجازات",
    achievementsSubtitle: "انتصارات صغيرة على الطريق.",
    achievementLocked: "واصل لفتح هذا الإنجاز",
    recentSessionsTitle: "الجلسات الأخيرة",
    recentSessionsEmpty: "ستظهر جلساتك الأخيرة هنا بعد إكمال جلسة.",
    howYouFelt: "شعورك",
    yourEffort: "جهدك",
    safetyFooter:
      "توقّف عند ألم حاد أو دوخة أو أعراض غير معتادة. تواصل مع معالجك إذا زادت الأعراض.",
    noteFromTherapist: "ملاحظة من معالجك",
    weekOfProgram: (week, total) => `الأسبوع ${week} من ${total}`,
  },
};

export function progressPortalV1Ui(lang: PatientPortalLanguage): ProgressPortalV1Ui {
  return PROGRESS_PORTAL_V1[lang];
}

/* ── Patient Workspace App Shell (PR77) ───────────────────────────────────── */

export type WorkspaceUi = {
  navHome: string;
  navSessions: string;
  navProgress: string;
  navProfile: string;
  recoveryHome: string;
  performanceHome: string;
  homeGreeting: (name: string) => string;
  currentProgram: string;
  todaySession: string;
  nextSession: string;
  startSession: string;
  viewAllSessions: string;
  viewFullProgress: string;
  progressSummary: string;
  quickStatsPreview: string;
  achievementsPreview: string;
  recentActivityPreview: string;
  providerClinic: string;
  movementCheckTitle: string;
  movementCheckSubtitle: string;
  movementCheckEmpty: string;
  latestResult: string;
  bestResult: string;
  beforeVsLatest: string;
  functionalReachLabel: string;
  singleLegStanceLabel: string;
  reachesUnit: (count: number) => string;
  holdSecondsUnit: (seconds: number) => string;
  sessionsPageTitle: string;
  sessionsPageSubtitle: string;
  sessionHistorySummary: string;
  sessionHistoryCount: (completed: number, total: number) => string;
  sessionStatusCompleted: string;
  sessionStatusNext: string;
  sessionStatusLocked: string;
  profileTitle: string;
  profileSubtitle: string;
  patientName: string;
  memberSince: string;
  planStatus: string;
  planStatusPreparing: string;
  planStatusActive: string;
  planStatusComplete: string;
  languageLabel: string;
  languageEn: string;
  languageAr: string;
  secureLinkNote: string;
  supportNote: string;
  noSessionsYet: string;
  preparingSchedule: string;
  viewAchievements: string;
  viewRecentSessions: string;
  heroRecoveryTagline: string;
  heroPerformanceTagline: string;
  weeklyActivityTitle: string;
  weeklyActivitySubtitle: string;
  nextSessionReady: string;
  nextSessionDoneToday: string;
  programProgressLabel: string;
  startSessionCta: string;
  sessionsLeft: (remaining: number) => string;
  recentEmptyFriendly: string;
  providerCardSubtitle: string;
  homeProgressTitle: string;
  homeProgressSubtitle: string;
  homeProgressViewLink: string;
  homeProgressSingleSessionNote: string;
  statSessions: string;
  statActiveDays: string;
  statCompletion: string;
  statEffort: string;
  nextSessionDuration: string;
  nextSessionTherapistContext: string;
  nextSessionStatusReady: string;
  nextSessionStatusDoneToday: string;
  exerciseCountLabel: (count: number) => string;
};

const WORKSPACE: Record<PatientPortalLanguage, WorkspaceUi> = {
  en: {
    navHome: "Home",
    navSessions: "Sessions",
    navProgress: "Progress",
    navProfile: "Profile",
    recoveryHome: "Recovery Home",
    performanceHome: "Performance Home",
    homeGreeting: (name) => `Welcome back, ${name}`,
    currentProgram: "Current program",
    todaySession: "Today's session",
    nextSession: "Next session",
    startSession: "Start session",
    viewAllSessions: "View all sessions",
    viewFullProgress: "View full progress",
    progressSummary: "Progress summary",
    quickStatsPreview: "Quick stats",
    achievementsPreview: "Achievements",
    recentActivityPreview: "Recent activity",
    providerClinic: "Your provider",
    movementCheckTitle: "Movement check",
    movementCheckSubtitle: "Your latest movement results. For progress comparison only.",
    movementCheckEmpty: "Complete a movement check during a session to see results here.",
    latestResult: "Latest",
    bestResult: "Best",
    beforeVsLatest: "Before → latest",
    functionalReachLabel: "Functional reach",
    singleLegStanceLabel: "Balance hold",
    reachesUnit: (count) => `${count} reach${count === 1 ? "" : "es"}`,
    holdSecondsUnit: (seconds) => `${seconds} sec hold`,
    sessionsPageTitle: "Your sessions",
    sessionsPageSubtitle: "Follow your plan one session at a time.",
    sessionHistorySummary: "Session history",
    sessionHistoryCount: (completed, total) =>
      `${completed} of ${total} session${total === 1 ? "" : "s"} completed`,
    sessionStatusCompleted: "Completed",
    sessionStatusNext: "Up next",
    sessionStatusLocked: "Locked",
    profileTitle: "Your profile",
    profileSubtitle: "Your program details and secure access.",
    patientName: "Name",
    memberSince: "Member since",
    planStatus: "Plan status",
    planStatusPreparing: "Schedule preparing",
    planStatusActive: "Active",
    planStatusComplete: "Complete",
    languageLabel: "Language",
    languageEn: "English",
    languageAr: "Arabic",
    secureLinkNote:
      "You access this workspace through your secure personal link. No password is required.",
    supportNote:
      "If you have questions about your program, contact your provider or clinic.",
    noSessionsYet: "No sessions scheduled yet.",
    preparingSchedule: "Your provider is preparing your session schedule.",
    viewAchievements: "See all achievements",
    viewRecentSessions: "See recent sessions",
    heroRecoveryTagline: "Your recovery journey, one session at a time.",
    heroPerformanceTagline: "Train smarter. Move better. Feel stronger.",
    weeklyActivityTitle: "This week",
    weeklyActivitySubtitle: "Days you showed up",
    nextSessionReady: "You're ready — let's keep the momentum going.",
    nextSessionDoneToday: "Great work today. Rest up and come back when you're ready.",
    programProgressLabel: "Program progress",
    startSessionCta: "Start session",
    sessionsLeft: (remaining) =>
      `${remaining} session${remaining === 1 ? "" : "s"} to go`,
    recentEmptyFriendly: "Your completed sessions will appear here.",
    providerCardSubtitle: "Supporting your program",
    homeProgressTitle: "Your progress",
    homeProgressSubtitle: "Progress across your recorded sessions",
    homeProgressViewLink: "View progress",
    homeProgressSingleSessionNote:
      "Progress charts will appear after more recorded sessions.",
    statSessions: "Sessions",
    statActiveDays: "Active days",
    statCompletion: "Completion",
    statEffort: "Effort",
    nextSessionDuration: "Estimated duration",
    nextSessionTherapistContext: "Assigned by your therapist",
    nextSessionStatusReady: "Ready to begin",
    nextSessionStatusDoneToday: "Completed for today",
    exerciseCountLabel: (count) =>
      `${count} exercise${count === 1 ? "" : "s"}`,
  },
  ar: {
    navHome: "الرئيسية",
    navSessions: "الجلسات",
    navProgress: "التقدّم",
    navProfile: "الملف",
    recoveryHome: "صفحة التعافي",
    performanceHome: "صفحة الأداء",
    homeGreeting: (name) => `مرحبًا بعودتك، ${name}`,
    currentProgram: "البرنامج الحالي",
    todaySession: "جلسة اليوم",
    nextSession: "الجلسة التالية",
    startSession: "بدء الجلسة",
    viewAllSessions: "عرض كل الجلسات",
    viewFullProgress: "عرض التقدّم الكامل",
    progressSummary: "ملخص التقدّم",
    quickStatsPreview: "إحصاءات سريعة",
    achievementsPreview: "الإنجازات",
    recentActivityPreview: "النشاط الأخير",
    providerClinic: "مقدّم الرعاية",
    movementCheckTitle: "فحص الحركة",
    movementCheckSubtitle: "أحدث نتائج حركتك. للمقارنة فقط وليس تقييمًا سريريًا.",
    movementCheckEmpty: "أكمل فحص حركة خلال جلسة لعرض النتائج هنا.",
    latestResult: "الأحدث",
    bestResult: "الأفضل",
    beforeVsLatest: "قبل ← الأحدث",
    functionalReachLabel: "الوصول الوظيفي",
    singleLegStanceLabel: "ثبات التوازن",
    reachesUnit: (count) => (count === 1 ? "وصول واحد" : `${count} وصولات`),
    holdSecondsUnit: (seconds) => `ثبات ${seconds} ث`,
    sessionsPageTitle: "جلساتك",
    sessionsPageSubtitle: "اتبع خطتك جلسة بجلسة.",
    sessionHistorySummary: "سجل الجلسات",
    sessionHistoryCount: (completed, total) => `أكملت ${completed} من ${total} جلسات`,
    sessionStatusCompleted: "مكتملة",
    sessionStatusNext: "التالي",
    sessionStatusLocked: "مقفلة",
    profileTitle: "ملفك",
    profileSubtitle: "تفاصيل برنامجك والوصول الآمن.",
    patientName: "الاسم",
    memberSince: "عضو منذ",
    planStatus: "حالة الخطة",
    planStatusPreparing: "جاري تجهيز الجدول",
    planStatusActive: "نشطة",
    planStatusComplete: "مكتملة",
    languageLabel: "اللغة",
    languageEn: "الإنجليزية",
    languageAr: "العربية",
    secureLinkNote:
      "تصل إلى مساحة العمل هذه عبر رابطك الشخصي الآمن. لا حاجة لكلمة مرور.",
    supportNote: "للأسئلة حول برنامجك، تواصل مع مقدّم الرعاية أو العيادة.",
    noSessionsYet: "لا توجد جلسات مجدولة بعد.",
    preparingSchedule: "مقدّم الرعاية يجهّز جدول جلساتك.",
    viewAchievements: "عرض كل الإنجازات",
    viewRecentSessions: "عرض الجلسات الأخيرة",
    heroRecoveryTagline: "رحلة تعافيك، جلسة بجلسة.",
    heroPerformanceTagline: "تدرّب بذكاء. تحرّك أفضل. اشعر بقوة أكبر.",
    weeklyActivityTitle: "هذا الأسبوع",
    weeklyActivitySubtitle: "أيام حضورك",
    nextSessionReady: "أنت جاهز — واصل الزخم.",
    nextSessionDoneToday: "عمل رائع اليوم. استرح وعد عندما تكون مستعدًا.",
    programProgressLabel: "تقدّم البرنامج",
    startSessionCta: "ابدأ الجلسة",
    sessionsLeft: (remaining) =>
      remaining === 1 ? "جلسة واحدة متبقية" : `${remaining} جلسات متبقية`,
    recentEmptyFriendly: "ستظهر جلساتك المكتملة هنا.",
    providerCardSubtitle: "يدعم برنامجك",
    homeProgressTitle: "تقدمك",
    homeProgressSubtitle: "تطورك عبر الجلسات المسجلة",
    homeProgressViewLink: "عرض التقدم",
    homeProgressSingleSessionNote: "ستظهر مخططات التقدم بعد تسجيل المزيد من الجلسات.",
    statSessions: "الجلسات",
    statActiveDays: "أيام نشطة",
    statCompletion: "الإكمال",
    statEffort: "الجهد",
    nextSessionDuration: "المدة التقديرية",
    nextSessionTherapistContext: "مخصصة من معالجك",
    nextSessionStatusReady: "جاهزة للبدء",
    nextSessionStatusDoneToday: "اكتملت لليوم",
    exerciseCountLabel: (count) =>
      count === 1 ? "تمرين واحد" : `${count} تمارين`,
  },
};

export function workspaceUi(lang: PatientPortalLanguage): WorkspaceUi {
  return WORKSPACE[lang];
}

/* ── Lifetime progress summary (PR93) ───────────────────────────────────────── */

export type LifetimeSummaryUi = {
  title: string;
  subtitle: string;
  completedSessions: string;
  programsAssigned: string;
  movementCaptures: string;
  lastActivity: string;
};

const LIFETIME_SUMMARY: Record<PatientPortalLanguage, LifetimeSummaryUi> = {
  en: {
    title: "Your rehab journey",
    subtitle: "Across all your programs with this clinic",
    completedSessions: "Completed sessions",
    programsAssigned: "Programs assigned",
    movementCaptures: "Movement captures",
    lastActivity: "Last activity",
  },
  ar: {
    title: "رحلة تأهيلك",
    subtitle: "عبر كل برامجك مع هذه العيادة",
    completedSessions: "الجلسات المكتملة",
    programsAssigned: "البرامج المخصصة",
    movementCaptures: "تسجيلات الحركة",
    lastActivity: "آخر نشاط",
  },
};

export function lifetimeSummaryUi(lang: PatientPortalLanguage): LifetimeSummaryUi {
  return LIFETIME_SUMMARY[lang];
}

/* ── Camera setup & tracking readiness (PR81) ─────────────────────────────── */

export type PatientCvReadinessDisplayState =
  | "ready_to_track"
  | "move_back_slightly"
  | "keep_full_body_visible"
  | "improve_lighting"
  | "limited_camera_evidence";

export type CameraReadinessUi = {
  setupCardTitle: string;
  setupCardSubtitle: string;
  setupBullets: string[];
  floorGuideAreaLabel: string;
  floorGuideHint: string;
  assistiveEvidenceNote: string;
  clinicianReviewNote: string;
  manualFallbackHint: string;
  liveReadinessEyebrow: string;
  readyToTrack: string;
  moveBackSlightly: string;
  keepFullBodyVisible: string;
  improveLighting: string;
  limitedCameraEvidence: string;
};

const CAMERA_READINESS: Record<PatientPortalLanguage, CameraReadinessUi> = {
  en: {
    setupCardTitle: "Camera setup before tracking",
    setupCardSubtitle:
      "A quick check helps the camera capture clearer movement evidence for your therapist to review.",
    setupBullets: [
      "Keep your full body visible from head to feet",
      "Use good, even lighting — avoid strong backlight",
      "Hold the phone steady or rest it on a stable surface",
      "Stand or sit far enough back so head and feet stay in frame",
      "Position yourself in the guide area shown below when you start",
    ],
    floorGuideAreaLabel: "Guide area",
    floorGuideHint:
      "Stand or sit so your full body fits inside the guide area — not a calibration, just positioning help.",
    assistiveEvidenceNote:
      "Camera tracking provides assistive movement evidence only. It does not judge correct or incorrect form.",
    clinicianReviewNote:
      "Your therapist reviews all results. This is not a diagnosis.",
    manualFallbackHint:
      "You can still complete this exercise manually if camera evidence is limited.",
    liveReadinessEyebrow: "Camera readiness",
    readyToTrack: "Ready to track",
    moveBackSlightly: "Move back slightly",
    keepFullBodyVisible: "Keep full body visible",
    improveLighting: "Improve lighting",
    limitedCameraEvidence: "Limited camera evidence",
  },
  ar: {
    setupCardTitle: "إعداد الكاميرا قبل التتبع",
    setupCardSubtitle:
      "فحص سريع يساعد الكاميرا على التقاط دليل حركة أوضح لمراجعة معالجك.",
    setupBullets: [
      "أبقِ جسمك كاملًا ظاهرًا من الرأس إلى القدمين",
      "استخدم إضاءة جيدة ومتساوية — تجنّب الضوء الخلفي القوي",
      "ثبّت الهاتف أو ضعه على سطح مستقر",
      "قف أو اجلس بعيدًا بما يكفي ليبقى الرأس والقدمان في الإطار",
      "ضع نفسك في منطقة الإرشاد أدناه عند البدء",
    ],
    floorGuideAreaLabel: "منطقة الإرشاد",
    floorGuideHint:
      "قف أو اجلس بحيث يتسع جسمك كاملًا داخل منطقة الإرشاد — ليست معايرة، بل مساعدة للوضعية فقط.",
    assistiveEvidenceNote:
      "التتبع بالكاميرا يقدّم دليل حركة مساعدًا فقط. لا يحكم على صحة أو خطأ الأداء.",
    clinicianReviewNote:
      "معالجك يراجع كل النتائج. هذا ليس تشخيصًا.",
    manualFallbackHint:
      "يمكنك إكمال التمرين يدويًا حتى لو كان دليل الكاميرا محدودًا.",
    liveReadinessEyebrow: "جاهزية الكاميرا",
    readyToTrack: "جاهز للتتبع",
    moveBackSlightly: "تراجع قليلًا للخلف",
    keepFullBodyVisible: "أبقِ الجسم كاملًا ظاهرًا",
    improveLighting: "حسّن الإضاءة",
    limitedCameraEvidence: "دليل كاميرا محدود",
  },
};

export function cameraReadinessUi(lang: PatientPortalLanguage): CameraReadinessUi {
  return CAMERA_READINESS[lang];
}

export function readinessStateLabel(
  lang: PatientPortalLanguage,
  state: PatientCvReadinessDisplayState,
): string {
  const ui = cameraReadinessUi(lang);
  switch (state) {
    case "ready_to_track":
      return ui.readyToTrack;
    case "move_back_slightly":
      return ui.moveBackSlightly;
    case "keep_full_body_visible":
      return ui.keepFullBodyVisible;
    case "improve_lighting":
      return ui.improveLighting;
    case "limited_camera_evidence":
      return ui.limitedCameraEvidence;
    default:
      return ui.keepFullBodyVisible;
  }
}

/** Map existing capture guidance signals to patient-facing readiness labels. */
export function resolvePatientCvReadinessDisplay(input: {
  primaryGuidance: CaptureSetupGuidance;
  canStartTracking: boolean;
  minimumMet: boolean;
  previewActive: boolean;
}): PatientCvReadinessDisplayState | null {
  const { primaryGuidance, canStartTracking, minimumMet, previewActive } = input;
  if (!previewActive) return null;
  if (!minimumMet) return "limited_camera_evidence";
  if (primaryGuidance === "ready" && canStartTracking) return "ready_to_track";
  if (primaryGuidance === "ready" && !canStartTracking) {
    return "limited_camera_evidence";
  }
  if (primaryGuidance === "move_farther") return "move_back_slightly";
  if (primaryGuidance === "improve_lighting") return "improve_lighting";
  return "keep_full_body_visible";
}

/* ── Guided session flow (PR79) ────────────────────────────────────────────── */

export type GuidedSessionUi = {
  startEyebrow: string;
  startTitle: (sessionTitle: string) => string;
  startSubtitle: string;
  exercisesReady: (count: number) => string;
  firstUpLabel: string;
  beginSession: string;
  backToDashboard: string;
  restTitle: string;
  restSubtitle: string;
  restRecommended: (seconds: number) => string;
  restDefaultHint: string;
  nextExercisePreview: string;
  continueToNext: string;
  proceedToRest: string;
  proceedToFinish: string;
  yourInstructions: string;
  exercisesCompletedCount: (count: number) => string;
  viewProgress: string;
  sessionCompleteTitle: string;
  sessionCompleteBody: string;
  greatWork: string;
  safetyReminder: string;
  restTakeYourTime: string;
  restSecondsRemaining: (seconds: number) => string;
  restCountdownSeconds: (seconds: number) => string;
  restReadyForNext: string;
  manualExerciseNoCv: string;
  cameraRequiredTitle: string;
  cameraRequiredBody: string;
  cameraRequiredRetry: string;
};

const GUIDED_SESSION: Record<PatientPortalLanguage, GuidedSessionUi> = {
  en: {
    startEyebrow: "Ready when you are",
    startTitle: (sessionTitle) => sessionTitle,
    startSubtitle: "One exercise at a time. Move at your own pace.",
    exercisesReady: (count) =>
      `${count} exercise${count === 1 ? "" : "s"} in this session`,
    firstUpLabel: "First up",
    beginSession: "Begin session",
    backToDashboard: "Back to dashboard",
    restTitle: "Rest",
    restSubtitle: "Breathe, hydrate, and get ready for what's next.",
    restRecommended: (seconds) => `Suggested rest: ${seconds} seconds`,
    restDefaultHint: "Take a short break before your next exercise.",
    nextExercisePreview: "Up next",
    continueToNext: "Next exercise",
    proceedToRest: "Take a rest",
    proceedToFinish: "Finish session",
    yourInstructions: "Your instructions",
    exercisesCompletedCount: (count) =>
      `${count} exercise${count === 1 ? "" : "s"} completed`,
    viewProgress: "View progress",
    sessionCompleteTitle: "Session complete!",
    sessionCompleteBody: "You finished every exercise in this session.",
    greatWork: "Great work today.",
    safetyReminder: "Stop if you feel sharp pain or unusual symptoms.",
    restTakeYourTime: "Take your time — continue when you feel ready.",
    restSecondsRemaining: (seconds) =>
      `${seconds} second${seconds === 1 ? "" : "s"} remaining`,
    restCountdownSeconds: (seconds) =>
      `${seconds} second${seconds === 1 ? "" : "s"}`,
    restReadyForNext: "Ready for the next exercise",
    manualExerciseNoCv:
      "Camera tracking is not available for this exercise yet. Follow the instructions and complete it manually.",
    cameraRequiredTitle: "Camera access is required",
    cameraRequiredBody:
      "This session uses your camera to guide the movement. Please continue and allow camera access to begin.",
    cameraRequiredRetry: "Try again",
  },
  ar: {
    startEyebrow: "جاهز عندما تكون أنت",
    startTitle: (sessionTitle) => sessionTitle,
    startSubtitle: "تمرين واحد في كل مرة. تحرّك على وتيرتك.",
    exercisesReady: (count) =>
      count === 1 ? "تمرين واحد في هذه الجلسة" : `${count} تمارين في هذه الجلسة`,
    firstUpLabel: "أول تمرين",
    beginSession: "بدء الجلسة",
    backToDashboard: "العودة للوحة الرئيسية",
    restTitle: "راحة",
    restSubtitle: "تنفّس، رطّب جسمك، واستعد لما يلي.",
    restRecommended: (seconds) => `راحة مقترحة: ${seconds} ثانية`,
    restDefaultHint: "خذ استراحة قصيرة قبل التمرين التالي.",
    nextExercisePreview: "التالي",
    continueToNext: "التمرين التالي",
    proceedToRest: "خذ راحة",
    proceedToFinish: "إنهاء الجلسة",
    yourInstructions: "تعليماتك",
    exercisesCompletedCount: (count) =>
      count === 1 ? "تمرين واحد مكتمل" : `${count} تمارين مكتملة`,
    viewProgress: "عرض التقدّم",
    sessionCompleteTitle: "اكتملت الجلسة!",
    sessionCompleteBody: "أنهيت كل تمارين هذه الجلسة.",
    greatWork: "عمل رائع اليوم.",
    safetyReminder: "توقّف عند ألم حاد أو أعراض غير معتادة.",
    restTakeYourTime: "خذ وقتك — تابع عندما تكون مستعدًا.",
    restSecondsRemaining: (seconds) =>
      seconds === 1 ? "ثانية واحدة متبقية" : `${seconds} ثوانٍ متبقية`,
    restCountdownSeconds: (seconds) =>
      seconds === 1 ? "ثانية واحدة" : `${seconds} ثوانٍ`,
    restReadyForNext: "جاهز للتمرين التالي",
    manualExerciseNoCv:
      "التتبع بالكاميرا غير متاح لهذا التمرين حاليًا. اتبع التعليمات وأكمل التمرين يدويًا.",
    cameraRequiredTitle: "الوصول إلى الكاميرا مطلوب",
    cameraRequiredBody:
      "تستخدم هذه الجلسة الكاميرا لتوجيه الحركة. يرجى المتابعة والسماح بالوصول إلى الكاميرا للبدء.",
    cameraRequiredRetry: "حاول مرة أخرى",
  },
};

export function guidedSessionUi(lang: PatientPortalLanguage): GuidedSessionUi {
  return GUIDED_SESSION[lang];
}

export function tokenLayoutUi(lang: PatientPortalLanguage): TokenLayoutUi {
  return TOKEN_LAYOUT[lang];
}

/* ── Trust footer & safety notice (Sprint D) ───────────────────────────────── */

export type TrustFooterUi = {
  privacy: string;
  terms: string;
  intendedUse: string;
  clinicalSafety: string;
};

export type PatientSafetyNoticeUi = {
  title: string;
  line1: string;
  line2: string;
  line3: string;
};

const TRUST_FOOTER: Record<PatientPortalLanguage, TrustFooterUi> = {
  en: {
    privacy: "Privacy",
    terms: "Terms",
    intendedUse: "Intended Use",
    clinicalSafety: "Clinical Safety",
  },
  ar: {
    privacy: "الخصوصية",
    terms: "الشروط",
    intendedUse: "الاستخدام المقصود",
    clinicalSafety: "السلامة السريرية",
  },
};

const PATIENT_SAFETY_NOTICE: Record<PatientPortalLanguage, PatientSafetyNoticeUi> = {
  en: {
    title: "Safety notice",
    line1:
      "Stop if you feel sharp pain, dizziness, chest pain, shortness of breath, or unusual symptoms.",
    line2: "Contact your therapist if symptoms worsen.",
    line3:
      "This platform supports your therapist's plan and does not replace clinical assessment.",
  },
  ar: {
    title: "تنبيه السلامة",
    line1: "توقّف إذا شعرت بألم حاد، دوخة، ألم في الصدر، ضيق تنفس، أو أعراض غير معتادة.",
    line2: "تواصل مع معالجك إذا زادت الأعراض.",
    line3: "هذه المنصة تدعم خطة معالجك ولا تستبدل التقييم السريري.",
  },
};

export function trustFooterUi(lang: PatientPortalLanguage): TrustFooterUi {
  return TRUST_FOOTER[lang];
}

export function patientSafetyNoticeUi(lang: PatientPortalLanguage): PatientSafetyNoticeUi {
  return PATIENT_SAFETY_NOTICE[lang];
}

/* ── Journey context card (Sprint G) ─────────────────────────────────────────── */

export type JourneyContextUi = {
  rehabGoalLabel: string;
  sessionsCompletedLabel: string;
  sessionsCompleted: (completed: number, total: number) => string;
  weekOfProgram: (week: number, totalWeeks: number) => string;
  lastReportedLabel: string;
  painScore: (score: number) => string;
  effortScore: (score: number) => string;
  lastReportedNote: string;
  clinicianNoteLabel: string;
  therapistVisibility: string;
};

const JOURNEY_CONTEXT: Record<PatientPortalLanguage, JourneyContextUi> = {
  en: {
    rehabGoalLabel: "Your rehabilitation goal",
    sessionsCompletedLabel: "Sessions completed",
    sessionsCompleted: (completed, total) =>
      `${completed} of ${total} session${total === 1 ? "" : "s"}`,
    weekOfProgram: (week, totalWeeks) => `Week ${week} of ${totalWeeks}`,
    lastReportedLabel: "Last reported",
    painScore: (score) => `Pain: ${score}/10`,
    effortScore: (score) => `Effort: ${score}/10`,
    lastReportedNote:
      "This information helps your therapist follow your rehabilitation journey",
    clinicianNoteLabel: "A note from your therapist",
    therapistVisibility: "Your therapist reviews what you report after each session",
  },
  ar: {
    rehabGoalLabel: "هدفك التأهيلي",
    sessionsCompletedLabel: "الجلسات المكتملة",
    sessionsCompleted: (completed, total) => `${completed} من ${total} جلسة`,
    weekOfProgram: (week, totalWeeks) => `الأسبوع ${week} من ${totalWeeks}`,
    lastReportedLabel: "آخر ما سجّلته",
    painScore: (score) => `الألم: ${score}/10`,
    effortScore: (score) => `الجهد: ${score}/10`,
    lastReportedNote: "هذه المعلومات تساعد معالجك في متابعة رحلتك التأهيلية",
    clinicianNoteLabel: "ملاحظة معالجك",
    therapistVisibility: "معالجك يطّلع على ما تسجّله بعد كل جلسة",
  },
};

export function journeyContextUi(lang: PatientPortalLanguage): JourneyContextUi {
  return JOURNEY_CONTEXT[lang];
}

/* ── Session focus & exercise safety (Sprint G) ──────────────────────────────── */

export type SessionFocusUi = {
  todaysSessionFocus: string;
  exerciseSafetyReminder: string;
};

const SESSION_FOCUS: Record<PatientPortalLanguage, SessionFocusUi> = {
  en: {
    todaysSessionFocus: "Today's session focus",
    exerciseSafetyReminder:
      "Stop if you feel sharp pain or unusual symptoms and contact your therapist",
  },
  ar: {
    todaysSessionFocus: "تركيز جلسة اليوم",
    exerciseSafetyReminder:
      "توقف إذا شعرت بألم حاد أو أعراض غير معتادة وتواصل مع معالجك",
  },
};

export function sessionFocusUi(lang: PatientPortalLanguage): SessionFocusUi {
  return SESSION_FOCUS[lang];
}

/* ── Motivation layer (Sprint V) ─────────────────────────────────────────────── */

export type MotivationUi = {
  todaysSessionStatus: string;
  todayReady: string;
  todayCompleted: string;
  allSessionsCompleteShort: string;
  completedSessionsCount: (completed: number, total: number) => string;
  remainingSessions: (remaining: number) => string;
  gentleEncouragementTitle: string;
  gentleEncouragementBody: string;
  followTherapistPlan: string;
  safetyReminderShort: string;
  preSessionComfort: string;
  greatEffort: string;
  youShowedUpToday: string;
  therapistCanReviewProgress: string;
  smallStepsConsistency: string;
  consistencyActiveDays: (days: number) => string;
  progressRemainingLabel: string;
};

const MOTIVATION: Record<PatientPortalLanguage, MotivationUi> = {
  en: {
    todaysSessionStatus: "Today's session",
    todayReady: "Your next session is ready when you are.",
    todayCompleted: "You completed a session today. Well done.",
    allSessionsCompleteShort: "You have completed all sessions in your current plan.",
    completedSessionsCount: (completed, total) =>
      `${completed} of ${total} session${total === 1 ? "" : "s"} completed`,
    remainingSessions: (remaining) =>
      `${remaining} session${remaining === 1 ? "" : "s"} remaining in your plan`,
    gentleEncouragementTitle: "Keep going at your pace",
    gentleEncouragementBody: "Small steps build consistency. Follow your therapist's instructions.",
    followTherapistPlan: "Follow your therapist's plan",
    safetyReminderShort:
      "Stop and contact your therapist if symptoms feel unusual.",
    preSessionComfort:
      "Move comfortably and stop if you feel unusual pain.",
    greatEffort: "Great effort",
    youShowedUpToday: "You showed up today",
    therapistCanReviewProgress: "Your therapist can review your progress",
    smallStepsConsistency: "Small steps build consistency",
    consistencyActiveDays: (days) =>
      days === 0
        ? "Complete a session to start building your routine."
        : days === 1
          ? "You were active on 1 day in the last 7 days."
          : `You were active on ${days} days in the last 7 days.`,
    progressRemainingLabel: "Sessions remaining",
  },
  ar: {
    todaysSessionStatus: "جلسة اليوم",
    todayReady: "جلستك التالية جاهزة عندما تكون مستعداً.",
    todayCompleted: "أكملت جلسة اليوم. أحسنت.",
    allSessionsCompleteShort: "أكملت جميع جلسات خطتك الحالية.",
    completedSessionsCount: (completed, total) => `${completed} من ${total} جلسات مكتملة`,
    remainingSessions: (remaining) =>
      remaining === 1
        ? "جلسة واحدة متبقية في خطتك"
        : `${remaining} جلسات متبقية في خطتك`,
    gentleEncouragementTitle: "واصل على وتيرتك",
    gentleEncouragementBody: "الخطوات الصغيرة تبني الاستمرارية. اتبع تعليمات معالجك.",
    followTherapistPlan: "اتبع خطة معالجك",
    safetyReminderShort: "توقّف وتواصل مع معالجك إذا شعرت بأعراض غير معتادة.",
    preSessionComfort: "تحرّك براحة وتوقّف إذا شعرت بألم غير معتاد.",
    greatEffort: "جهد رائع",
    youShowedUpToday: "حضرت اليوم",
    therapistCanReviewProgress: "يمكن لمعالجك مراجعة تقدّمك",
    smallStepsConsistency: "الخطوات الصغيرة تبني الاستمرارية",
    consistencyActiveDays: (days) =>
      days === 0
        ? "أكمل جلسة لبدء روتينك."
        : days === 1
          ? "كنت نشطاً يوماً واحداً خلال الأيام السبعة الماضية."
          : `كنت نشطاً ${days} أيام خلال الأيام السبعة الماضية.`,
    progressRemainingLabel: "الجلسات المتبقية",
  },
};

export function motivationUi(lang: PatientPortalLanguage): MotivationUi {
  return MOTIVATION[lang];
}

/* ── Clinician adherence summary (Sprint V) ──────────────────────────────────── */

export type ClinicianAdherenceSummaryUi = {
  title: string;
  forClinicianReview: string;
  completedSessions: string;
  notCompletedSessions: string;
  lastPatientActivity: string;
  noActivityYet: string;
  derivedFromSessionsOnly: string;
};

const CLINICIAN_ADHERENCE_SUMMARY: Record<PatientPortalLanguage, ClinicianAdherenceSummaryUi> = {
  en: {
    title: "Session activity summary",
    forClinicianReview: "For clinician review",
    completedSessions: "Completed sessions",
    notCompletedSessions: "Not completed",
    lastPatientActivity: "Last patient activity",
    noActivityYet: "No session activity recorded yet",
    derivedFromSessionsOnly: "Counts are based on plan session status only. Not a clinical assessment.",
  },
  ar: {
    title: "ملخص نشاط الجلسات",
    forClinicianReview: "لمراجعة المعالج",
    completedSessions: "الجلسات المكتملة",
    notCompletedSessions: "غير مكتملة",
    lastPatientActivity: "آخر نشاط للمريض",
    noActivityYet: "لا يوجد نشاط جلسات مسجّل بعد",
    derivedFromSessionsOnly: "الأرقام مبنية على حالة جلسات الخطة فقط. ليست تقييماً سريرياً.",
  },
};

export function clinicianAdherenceSummaryUi(lang: PatientPortalLanguage): ClinicianAdherenceSummaryUi {
  return CLINICIAN_ADHERENCE_SUMMARY[lang];
}

export function isDescriptiveSessionTitle(title: string): boolean {
  const t = title.trim();
  if (!t) return false;
  if (/^Session\s+\d+(\s*[—–-]\s*)?$/i.test(t)) return false;
  if (/^الجلسة\s+\d+(\s*[—–-]\s*)?$/i.test(t)) return false;
  return true;
}

export function resolveSessionFocusPurpose(
  sessionTitle: string,
  patientFriendlyGoal: string | null | undefined,
): string | null {
  if (isDescriptiveSessionTitle(sessionTitle)) return sessionTitle.trim();
  const goal = patientFriendlyGoal?.trim();
  if (goal) return goal;
  return null;
}

export function getLatestReportedScores(
  logs: { painScore: number | null; effortScore: number | null; completedAt: string }[],
): { painScore: number | null; effortScore: number | null } | null {
  const sorted = [...logs].sort(
    (a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime(),
  );
  for (const log of sorted) {
    if (log.painScore != null || log.effortScore != null) {
      return { painScore: log.painScore, effortScore: log.effortScore };
    }
  }
  return null;
}

export function formatPortalDate(
  iso: string,
  lang: PatientPortalLanguage,
): string {
  try {
    return new Date(iso).toLocaleString(lang === "ar" ? "ar-SA" : undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

/** Compact session date for progress chart axes (no time). */
export function formatPortalChartDate(
  iso: string,
  lang: PatientPortalLanguage,
): string {
  try {
    return new Date(iso).toLocaleString(lang === "ar" ? "ar-SA" : "en-US", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}
