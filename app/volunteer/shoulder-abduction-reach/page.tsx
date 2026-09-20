"use client";

/**
 * Volunteer Shoulder Abduction Reach — public capture with research persistence (Slice 8B.3).
 */

import { useCallback, useEffect, useState } from "react";
import { useVolunteerResearchPersistence } from "@/app/hooks/useVolunteerResearchPersistence";
import { VolunteerWizardShell } from "@/app/volunteer/shoulder-abduction-reach/components/VolunteerWizardShell";
import { useVolunteerCaptureSession } from "@/app/hooks/useVolunteerCaptureSession";
import {
  VOLUNTEER_CAPTURE_SIDE,
  VOLUNTEER_MOVEMENT_SAFETY_REMINDERS,
  VOLUNTEER_PROTOCOL_CONDITION_INSTRUCTIONS,
  VOLUNTEER_PROTOCOL_CONDITION_LABELS,
  VOLUNTEER_PROTOCOL_CONDITIONS,
  VOLUNTEER_TARGET_REPS,
  buildVolunteerSessionSummary,
  canProceedFromConsentWithCampaign,
  isCaptureComplete,
  type VolunteerConsentState,
  type VolunteerProtocolCondition,
  type VolunteerWizardStep,
} from "@/app/volunteer/shoulder-abduction-reach/volunteer-protocol";

function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg bg-[#0A0F1A] px-5 py-2.5 text-[14px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function MovementSafetyReminder() {
  return (
    <div className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-[13px] text-[#991B1B]">
      <p className="font-semibold text-[#7F1D1D]">Movement safety</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {VOLUNTEER_MOVEMENT_SAFETY_REMINDERS.map((reminder) => (
          <li key={reminder}>{reminder}</li>
        ))}
      </ul>
    </div>
  );
}

function SecondaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border border-[#D1D5DB] bg-white px-5 py-2.5 text-[14px] font-medium text-[#374151] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export default function VolunteerShoulderAbductionReachPage() {
  const [step, setStep] = useState<VolunteerWizardStep>("welcome");
  const [consent, setConsent] = useState<VolunteerConsentState>({
    ageConfirmed: false,
    participationAgreed: false,
  });
  const [campaignCode, setCampaignCode] = useState("");
  const [protocolCondition, setProtocolCondition] = useState<VolunteerProtocolCondition>("NORMAL");
  const [consentSubmitting, setConsentSubmitting] = useState(false);
  const [startSubmitting, setStartSubmitting] = useState(false);

  const persistence = useVolunteerResearchPersistence();
  const {
    enqueueRep,
    notifyCaptureTargetReached,
    createCollectionSession,
    createMovementSession,
    resetMovementBlock,
    resetAll,
    clearDeletionCode,
    retryFailedRep,
    retryCompletion,
    isCompleted,
    isCreatingSession,
    isCreatingMovement,
    isSaving,
    phase,
    retryKind,
    safeErrorMessage,
    deletionCode,
    captureTargetReached,
  } = persistence;

  const handleRepCaptured = useCallback(
    (record: Parameters<typeof enqueueRep>[0]) => {
      enqueueRep(record);
    },
    [enqueueRep],
  );

  const handleTargetReached = useCallback(() => {
    notifyCaptureTargetReached();
  }, [notifyCaptureTargetReached]);

  const {
    videoRef,
    canvasRef,
    cameraPreviewActive,
    starting,
    running,
    error,
    snapshot,
    capturedCount,
    rejectedCount,
    lastRejection,
    enableCameraPreview,
    reattachCameraPreview,
    startCapture,
    stopDetector,
    stopAll,
    resetSession,
  } = useVolunteerCaptureSession({
    side: VOLUNTEER_CAPTURE_SIDE,
    protocolCondition,
    onRepCaptured: handleRepCaptured,
    onTargetReached: handleTargetReached,
  });

  useEffect(() => {
    if (captureTargetReached && step === "capture") {
      stopAll();
    }
  }, [captureTargetReached, step, stopAll]);

  useEffect(() => {
    if (phase === "fatal_error" && step === "capture") {
      stopAll();
    }
  }, [phase, step, stopAll]);

  useEffect(() => {
    if (step === "capture") {
      void reattachCameraPreview();
    }
  }, [step, reattachCameraPreview]);

  useEffect(() => {
    if (isCompleted) {
      stopAll();
    }
  }, [isCompleted, stopAll]);

  const displayStep: VolunteerWizardStep = isCompleted ? "summary" : step;

  const handleConsentContinue = async () => {
    if (!canProceedFromConsentWithCampaign(consent, campaignCode)) return;
    setConsentSubmitting(true);
    const code = campaignCode.trim();
    const ok = await createCollectionSession(code);
    setConsentSubmitting(false);
    if (ok) {
      setCampaignCode("");
      setStep("camera");
    }
  };

  const handleStartCapture = async () => {
    if (startSubmitting || running || starting) return;
    setStartSubmitting(true);
    const movementReady = await createMovementSession(protocolCondition);
    if (movementReady) {
      await startCapture();
    }
    setStartSubmitting(false);
  };

  const handleResetSession = () => {
    stopAll();
    resetSession();
    resetMovementBlock();
    setStep("condition");
  };

  const handleFinishExit = () => {
    stopAll();
    clearDeletionCode();
    resetAll();
    setStep("welcome");
    setConsent({ ageConfirmed: false, participationAgreed: false });
    setCampaignCode("");
    setProtocolCondition("NORMAL");
    resetSession();
  };

  const summary =
    displayStep === "summary" && isCompleted
      ? buildVolunteerSessionSummary({
          capturedCount,
          rejectedCount,
          protocolCondition,
          side: VOLUNTEER_CAPTURE_SIDE,
          lastTrackingStatus: snapshot?.trackingStatus ?? "idle",
        })
      : null;

  const showSavingState =
    step === "capture" &&
    isCaptureComplete(capturedCount) &&
    !isCompleted;

  return (
    <VolunteerWizardShell stepLabel="Volunteer capture">
      {step === "welcome" ? (
        <section className="space-y-6">
          <h1 className="text-[24px] font-bold text-[#0A0F1A]">Volunteer Motion Data Collection</h1>
          <div className="space-y-3 text-[14px] leading-relaxed text-[#6B7280]">
            <p>
              Thank you for helping with technical software development. This session collects
              movement data without name or contact information to improve computer-vision research
              tools.
            </p>
            <p>
              <strong className="font-semibold text-[#374151]">This is not medical care.</strong> It
              is not a diagnosis, clinical assessment, or treatment. This is research and technical
              data collection only.
            </p>
            <p className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-4 py-3 text-[#92400E]">
              For this initial technical pilot, please use a <strong>laptop or desktop computer</strong>{" "}
              with a front-facing camera.
            </p>
          </div>
          <PrimaryButton onClick={() => setStep("consent")}>Continue</PrimaryButton>
        </section>
      ) : null}

      {step === "consent" ? (
        <section className="space-y-6">
          <h1 className="text-[22px] font-bold text-[#0A0F1A]">Eligibility and consent</h1>
          <div className="space-y-3 text-[14px] leading-relaxed text-[#6B7280]">
            <p>Please confirm the following before continuing:</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                No name, email, phone number, diagnosis, or patient record is requested in this flow.
              </li>
              <li>
                The server creates a random research participant identifier for this session.
              </li>
              <li>
                Bounded pose-landmark time-series and derived technical movement features are
                uploaded to research storage after each successfully captured repetition.
              </li>
              <li>
                Raw camera video, photos, and audio are <strong>not</strong> uploaded.
              </li>
              <li>
                Loading this page and movement-tracking model files uses normal network downloads.
              </li>
              <li>
                The selected movement condition is <strong>protocol metadata only</strong> — not
                therapist ground truth and not an ML prediction.
              </li>
              <li>
                You may stop participation before completion by closing or exiting this page.
              </li>
              <li>
                Refreshing or closing this page loses the in-memory session and any unsaved retry
                state — you would need to start again.
              </li>
              <li>This technical pilot is not medical care, diagnosis, or treatment.</li>
            </ul>
          </div>

          <div className="space-y-3 rounded-lg border border-[#E2E8E5] bg-white p-4">
            <label className="block text-[14px] text-[#374151]">
              <span className="mb-1 block font-medium">Study campaign code</span>
              <input
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={campaignCode}
                onChange={(e) => setCampaignCode(e.target.value)}
                className="w-full rounded-lg border border-[#D1D5DB] px-3 py-2 text-[14px]"
                placeholder="Enter the code provided by the study team"
              />
            </label>
            <label className="flex items-start gap-3 text-[14px] text-[#374151]">
              <input
                type="checkbox"
                className="mt-1"
                checked={consent.ageConfirmed}
                onChange={(e) =>
                  setConsent((current) => ({ ...current, ageConfirmed: e.target.checked }))
                }
              />
              <span>I am 18 years or older.</span>
            </label>
            <label className="flex items-start gap-3 text-[14px] text-[#374151]">
              <input
                type="checkbox"
                className="mt-1"
                checked={consent.participationAgreed}
                onChange={(e) =>
                  setConsent((current) => ({ ...current, participationAgreed: e.target.checked }))
                }
              />
              <span>
                I voluntarily agree to participate in this technical movement-data collection.
              </span>
            </label>
          </div>

          {safeErrorMessage ? (
            <p className="text-[14px] text-red-600">{safeErrorMessage}</p>
          ) : null}

          <div className="flex gap-3">
            <SecondaryButton onClick={() => setStep("welcome")}>Back</SecondaryButton>
            <PrimaryButton
              onClick={() => void handleConsentContinue()}
              disabled={
                !canProceedFromConsentWithCampaign(consent, campaignCode) ||
                consentSubmitting ||
                isCreatingSession
              }
            >
              {consentSubmitting || isCreatingSession
                ? "Starting session…"
                : phase === "retry_required" && retryKind === "session"
                  ? "Retry starting session"
                  : "Continue"}
            </PrimaryButton>
          </div>
        </section>
      ) : null}

      {step === "camera" ? (
        <section className="space-y-6">
          <h1 className="text-[22px] font-bold text-[#0A0F1A]">Camera setup</h1>
          <ul className="list-disc space-y-2 pl-5 text-[14px] text-[#6B7280]">
            <li>Face the camera directly.</li>
            <li>Use good, even lighting.</li>
            <li>Keep your upper body clearly visible.</li>
            <li>Step back enough to keep shoulders and arms in frame.</li>
          </ul>

          <div className="relative aspect-[4/3] w-full max-w-[640px] overflow-hidden rounded-lg bg-black">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="h-full w-full object-cover"
            />
            <canvas
              ref={canvasRef}
              width={640}
              height={480}
              className="pointer-events-none absolute inset-0 h-full w-full"
            />
          </div>

          {error ? <p className="text-[14px] text-red-600">{error}</p> : null}

          <div className="flex flex-wrap gap-3">
            <SecondaryButton onClick={() => setStep("consent")}>Back</SecondaryButton>
            <PrimaryButton onClick={() => void enableCameraPreview()}>
              Enable camera
            </PrimaryButton>
            <PrimaryButton
              onClick={() => setStep("condition")}
              disabled={!cameraPreviewActive}
            >
              Continue
            </PrimaryButton>
          </div>
        </section>
      ) : null}

      {step === "condition" ? (
        <section className="space-y-6">
          <h1 className="text-[22px] font-bold text-[#0A0F1A]">Movement condition</h1>
          <p className="text-[14px] leading-relaxed text-[#6B7280]">
            Select how you will perform the next repetitions. This is{" "}
            <strong className="font-semibold text-[#374151]">protocol metadata only</strong> — not a
            therapist label, not ground truth, and not an ML prediction.
          </p>

          <MovementSafetyReminder />

          <div className="space-y-3">
            {VOLUNTEER_PROTOCOL_CONDITIONS.map((condition) => (
              <label
                key={condition}
                className={`block cursor-pointer rounded-lg border p-4 ${
                  protocolCondition === condition
                    ? "border-[#0A0F1A] bg-white"
                    : "border-[#E2E8E5] bg-white"
                }`}
              >
                <div className="flex items-start gap-3">
                  <input
                    type="radio"
                    name="protocolCondition"
                    className="mt-1"
                    checked={protocolCondition === condition}
                    onChange={() => setProtocolCondition(condition)}
                    disabled={running}
                  />
                  <div>
                    <p className="text-[14px] font-semibold text-[#0A0F1A]">
                      {VOLUNTEER_PROTOCOL_CONDITION_LABELS[condition]}
                    </p>
                    <p className="mt-1 text-[13px] text-[#6B7280]">
                      {VOLUNTEER_PROTOCOL_CONDITION_INSTRUCTIONS[condition]}
                    </p>
                  </div>
                </div>
              </label>
            ))}
          </div>

          {running ? (
            <p className="text-[13px] text-[#9CA3AF]">
              Stop the capture session before changing the movement condition.
            </p>
          ) : null}

          <div className="flex gap-3">
            <SecondaryButton onClick={() => setStep("camera")} disabled={running}>
              Back
            </SecondaryButton>
            <PrimaryButton onClick={() => setStep("capture")} disabled={running}>
              Continue to capture
            </PrimaryButton>
          </div>
        </section>
      ) : null}

      {step === "capture" ? (
        <section className="space-y-6">
          <h1 className="text-[22px] font-bold text-[#0A0F1A]">Guided capture</h1>
          <p className="text-[14px] text-[#6B7280]">
            Perform shoulder abduction reach repetitions with your{" "}
            <strong className="font-semibold text-[#374151]">{VOLUNTEER_CAPTURE_SIDE}</strong> arm.
            Target: <strong>{VOLUNTEER_TARGET_REPS}</strong> successfully captured technical
            repetitions.
          </p>
          <p className="rounded-lg border border-[#E2E8E5] bg-white px-4 py-3 text-[13px] text-[#6B7280]">
            Condition:{" "}
            <span className="font-medium text-[#374151]">
              {VOLUNTEER_PROTOCOL_CONDITION_LABELS[protocolCondition]}
            </span>
            {" — "}
            {VOLUNTEER_PROTOCOL_CONDITION_INSTRUCTIONS[protocolCondition]}
          </p>

          <MovementSafetyReminder />

          <div className="relative aspect-[4/3] w-full max-w-[640px] overflow-hidden rounded-lg bg-black">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="h-full w-full object-cover"
            />
            <canvas
              ref={canvasRef}
              width={640}
              height={480}
              className="pointer-events-none absolute inset-0 h-full w-full"
            />
          </div>

          <dl className="grid grid-cols-2 gap-3 text-[13px] text-[#6B7280] sm:grid-cols-4">
            <div>
              <dt className="font-medium text-[#9CA3AF]">Side</dt>
              <dd className="text-[#374151]">{VOLUNTEER_CAPTURE_SIDE}</dd>
            </div>
            <div>
              <dt className="font-medium text-[#9CA3AF]">Tracking</dt>
              <dd className="text-[#374151]">{snapshot?.trackingStatus ?? "idle"}</dd>
            </div>
            <div>
              <dt className="font-medium text-[#9CA3AF]">Live reps</dt>
              <dd className="text-[#374151]">{snapshot?.primaryRepCount ?? 0}</dd>
            </div>
            <div>
              <dt className="font-medium text-[#9CA3AF]">Captured</dt>
              <dd className="text-[#374151]">
                {capturedCount} / {VOLUNTEER_TARGET_REPS}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-[#9CA3AF]">Rejected</dt>
              <dd className="text-[#374151]">
                {rejectedCount}
                {lastRejection ? ` (${lastRejection.reason})` : ""}
              </dd>
            </div>
          </dl>

          {error ? <p className="text-[14px] text-red-600">{error}</p> : null}
          {safeErrorMessage ? (
            <p className="text-[14px] text-red-600">{safeErrorMessage}</p>
          ) : null}

          {showSavingState ? (
            <p className="text-[14px] text-[#374151]">
              {isSaving
                ? "Saving repetitions and finalizing your session…"
                : "All repetitions captured. Waiting to save…"}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <PrimaryButton
              onClick={() => void handleStartCapture()}
              disabled={
                starting ||
                running ||
                startSubmitting ||
                isCreatingMovement ||
                isCaptureComplete(capturedCount) ||
                phase === "fatal_error"
              }
            >
              {startSubmitting || isCreatingMovement
                ? "Preparing…"
                : starting
                  ? "Starting…"
                  : "Start"}
            </PrimaryButton>
            <SecondaryButton onClick={stopDetector} disabled={!running}>
              Stop
            </SecondaryButton>
            <SecondaryButton onClick={handleResetSession} disabled={running}>
              Reset session
            </SecondaryButton>
          </div>

          {phase === "retry_required" && retryKind === "rep" ? (
            <div className="flex flex-wrap gap-3">
              <PrimaryButton onClick={() => void retryFailedRep()}>
                Retry saving repetition
              </PrimaryButton>
            </div>
          ) : null}

          {phase === "retry_required" && retryKind === "completion" ? (
            <div className="flex flex-wrap gap-3">
              <PrimaryButton onClick={() => void retryCompletion()}>
                Retry finalizing session
              </PrimaryButton>
            </div>
          ) : null}
        </section>
      ) : null}

      {displayStep === "summary" && summary && isCompleted ? (
        <section className="space-y-6">
          <h1 className="text-[22px] font-bold text-[#0A0F1A]">Session complete</h1>
          <p className="text-[14px] text-[#6B7280]">
            Thank you. Your technical movement data has been saved to research storage.
          </p>

          <div className="rounded-lg border border-[#E2E8E5] bg-white p-4 text-[14px] text-[#374151]">
            <dl className="space-y-3">
              <div>
                <dt className="text-[12px] font-medium uppercase tracking-wide text-[#9CA3AF]">
                  Completed repetitions
                </dt>
                <dd className="mt-1 text-[18px] font-semibold">{summary.capturedCount}</dd>
              </div>
              <div>
                <dt className="text-[12px] font-medium uppercase tracking-wide text-[#9CA3AF]">
                  Protocol condition (metadata only)
                </dt>
                <dd className="mt-1">{VOLUNTEER_PROTOCOL_CONDITION_LABELS[summary.protocolCondition]}</dd>
              </div>
              <div>
                <dt className="text-[12px] font-medium uppercase tracking-wide text-[#9CA3AF]">
                  Side
                </dt>
                <dd className="mt-1">{summary.side}</dd>
              </div>
              <div>
                <dt className="text-[12px] font-medium uppercase tracking-wide text-[#9CA3AF]">
                  Rejected stubs
                </dt>
                <dd className="mt-1">{summary.rejectedCount}</dd>
              </div>
              <div>
                <dt className="text-[12px] font-medium uppercase tracking-wide text-[#9CA3AF]">
                  Last tracking status
                </dt>
                <dd className="mt-1">{summary.lastTrackingStatus}</dd>
              </div>
            </dl>
          </div>

          {deletionCode ? (
            <div className="rounded-lg border border-[#BFDBFE] bg-[#EFF6FF] px-4 py-3 text-[14px] text-[#1E3A8A]">
              <p className="font-semibold">One-time research reference</p>
              <p className="mt-2">
                If the study team provides a deletion-request process, retain this code — it is shown
                only once and cannot be recovered from this page:
              </p>
              <p className="mt-2 font-mono text-[16px] tracking-wider">{deletionCode}</p>
            </div>
          ) : null}

          <p className="text-[13px] text-[#9CA3AF]">
            No therapist labels or clinical scores are shown here. Raw video was not uploaded.
          </p>

          <PrimaryButton onClick={handleFinishExit}>Finish / Exit</PrimaryButton>
        </section>
      ) : null}
    </VolunteerWizardShell>
  );
}
