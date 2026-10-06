import {
  validateProviderAccessInterestFormFields,
  type ProviderAccessInterestPayload,
} from "./provider-access-interest-validation";

const GENERIC_ERROR =
  "Unable to submit your request right now. Please try again later.";

export type SubmitProviderAccessInterestInput = {
  email: string;
  fullName?: string;
  clinicName?: string;
};

export async function submitProviderAccessInterest(
  input: SubmitProviderAccessInterestInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const fieldCheck = validateProviderAccessInterestFormFields({ email: input.email });
  if (!fieldCheck.ok) {
    return fieldCheck;
  }

  const payload: ProviderAccessInterestPayload = {
    email: input.email.trim().toLowerCase(),
    fullName: input.fullName?.trim() || null,
    clinicName: input.clinicName?.trim() || null,
  };

  const res = await fetch("/api/public/provider-access-interest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: payload.email,
      fullName: payload.fullName,
      clinicName: payload.clinicName,
    }),
  });

  if (res.status === 429) {
    return { ok: false, error: "Too many requests. Please try again later." };
  }

  const data = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean };

  if (!res.ok || !data.ok) {
    const message =
      typeof data.error === "string" && data.error.trim()
        ? data.error.trim()
        : GENERIC_ERROR;
    return { ok: false, error: message };
  }

  return { ok: true };
}
