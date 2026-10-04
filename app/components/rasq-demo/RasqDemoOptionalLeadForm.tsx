"use client";

import { useState } from "react";
import {
  RASQ_DEMO_MAIN_GOAL_OPTIONS,
  type RasqDemoMainGoalId,
} from "@/app/lib/rasq-demo/demo-copy";
import type { RasqDemoMovementSummary } from "@/app/lib/rasq-demo/demo-movement-summary";
import { validateRasqDemoLeadShareFormFields } from "@/app/lib/rasq-demo/demo-leads-validation";

export type RasqDemoOptionalLeadFormProps = {
  demoSessionId: string;
  movementSummary: RasqDemoMovementSummary;
  onSubmitted?: () => void;
};

export function RasqDemoOptionalLeadForm({
  demoSessionId,
  movementSummary,
  onSubmitted,
}: RasqDemoOptionalLeadFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [mainGoal, setMainGoal] = useState<RasqDemoMainGoalId | "">("");
  const [consentRasqUpdates, setConsentRasqUpdates] = useState(false);
  const [consentPilotStudy, setConsentPilotStudy] = useState(false);
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [emailRetryMessage, setEmailRetryMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrorMessage(null);
    setEmailRetryMessage(null);

    const clientValidation = validateRasqDemoLeadShareFormFields({
      name,
      email,
      phone,
      mainGoal,
      consentRasqUpdates,
      consentPilotStudy,
    });
    if (!clientValidation.ok) {
      setStatus("error");
      setErrorMessage(clientValidation.error);
      return;
    }

    setStatus("sending");
    try {
      const response = await fetch("/api/public/rasq-demo/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          demoSessionId,
          submitIntent: "share",
          name: name.trim() || undefined,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          mainGoal: mainGoal || undefined,
          consentRasqUpdates,
          consentPilotStudy,
          movementSummary,
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        ok?: boolean;
        skipped?: boolean;
        confirmationEmail?: {
          sent?: boolean;
          reason?: string;
          retry?: boolean;
          message?: string;
        };
      };
      if (!response.ok) {
        setStatus("error");
        setErrorMessage(data.error ?? "Unable to save your details.");
        return;
      }
      if (data.skipped) {
        setStatus("error");
        setErrorMessage("Add at least one detail to share, or choose Skip.");
        return;
      }
      if (
        data.confirmationEmail?.sent === false &&
        data.confirmationEmail.reason === "send-failed" &&
        data.confirmationEmail.retry
      ) {
        setEmailRetryMessage(
          data.confirmationEmail.message ??
            "Your details were saved, but we could not send the confirmation email. Please try again in a moment.",
        );
        setStatus("idle");
        return;
      }
      setStatus("done");
      onSubmitted?.();
    } catch {
      setStatus("error");
      setErrorMessage("Unable to save your details.");
    }
  }

  return (
    <form
      className="mt-6 rounded-[12px] border border-[#E2E8F0] bg-white p-4 shadow-sm"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <h3 className="text-base font-semibold text-[#0F172A]">Stay in touch (optional)</h3>
      <p className="mt-1 text-sm text-[#64748B]">
        You can finish the demo without sharing contact details. Fields below are optional.
      </p>

      <label className="mt-4 block text-sm font-medium text-[#334155]">
        Name
        <input
          type="text"
          autoComplete="name"
          className="mt-1 w-full rounded-[8px] border border-[#CBD5E1] px-3 py-2 text-sm"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>

      <label className="mt-3 block text-sm font-medium text-[#334155]">
        Email
        <input
          type="email"
          autoComplete="email"
          className="mt-1 w-full rounded-[8px] border border-[#CBD5E1] px-3 py-2 text-sm"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>

      <label className="mt-3 block text-sm font-medium text-[#334155]">
        Phone
        <input
          type="tel"
          autoComplete="tel"
          className="mt-1 w-full rounded-[8px] border border-[#CBD5E1] px-3 py-2 text-sm"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
        />
      </label>

      <fieldset className="mt-4">
        <legend className="text-sm font-medium text-[#334155]">Main goal</legend>
        <div className="mt-2 flex flex-col gap-2">
          {RASQ_DEMO_MAIN_GOAL_OPTIONS.map((option) => (
            <label key={option.id} className="flex items-center gap-2 text-sm text-[#475569]">
              <input
                type="radio"
                name="mainGoal"
                checked={mainGoal === option.id}
                onChange={() => setMainGoal(option.id)}
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="mt-4 flex items-start gap-2 text-sm text-[#475569]">
        <input
          type="checkbox"
          className="mt-1"
          checked={consentRasqUpdates}
          onChange={(event) => setConsentRasqUpdates(event.target.checked)}
        />
        <span>I agree to receive occasional RASQ product updates by email or phone.</span>
      </label>

      <label className="mt-3 flex items-start gap-2 text-sm text-[#475569]">
        <input
          type="checkbox"
          className="mt-1"
          checked={consentPilotStudy}
          onChange={(event) => setConsentPilotStudy(event.target.checked)}
        />
        <span>I am interested in hearing about a future RASQ pilot study.</span>
      </label>

      <p className="mt-4 text-sm text-[#64748B]" role="note">
        If you share your email or phone, the RASQ team may contact you about your demo interest.
        Product updates and pilot study information are optional.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={status === "sending" || status === "done"}
          className="rounded-[8px] bg-[#1D9E75] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {status === "sending" ? "Sending…" : status === "done" ? "Thank you" : "Share details"}
        </button>
        <button
          type="button"
          className="rounded-[8px] border border-[#CBD5E1] px-4 py-2 text-sm font-medium text-[#475569]"
          onClick={() => onSubmitted?.()}
        >
          Skip
        </button>
      </div>

      {errorMessage ? (
        <p className="mt-2 text-sm text-rose-700" role="alert">
          {errorMessage}
        </p>
      ) : null}
      {emailRetryMessage ? (
        <p className="mt-2 text-sm text-amber-800" role="status">
          {emailRetryMessage}
        </p>
      ) : null}
    </form>
  );
}
