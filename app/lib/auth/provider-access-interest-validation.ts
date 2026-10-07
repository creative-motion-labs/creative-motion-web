const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ALLOWED_KEYS = new Set(["email", "fullName", "clinicName"]);

const MAX_FIELD_LEN = 200;

export type ProviderAccessInterestPayload = {
  email: string;
  fullName: string | null;
  clinicName: string | null;
};

export type ProviderAccessInterestValidationResult =
  | { ok: true; value: ProviderAccessInterestPayload }
  | { ok: false; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimOptionalString(value: unknown, maxLen: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

export function isValidProviderAccessInterestEmail(email: string): boolean {
  const trimmed = email.trim();
  if (!trimmed || trimmed.length > 254) return false;
  return EMAIL_PATTERN.test(trimmed);
}

export function validateProviderAccessInterestBody(
  body: unknown,
): ProviderAccessInterestValidationResult {
  if (!isPlainObject(body)) {
    return { ok: false, error: "Invalid request body." };
  }

  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(key)) {
      return { ok: false, error: "Invalid request body." };
    }
  }

  if (typeof body.email !== "string" || !body.email.trim()) {
    return { ok: false, error: "Email is required." };
  }

  const email = body.email.trim().toLowerCase();
  if (!isValidProviderAccessInterestEmail(email)) {
    return { ok: false, error: "Please enter a valid email address." };
  }

  const fullName = trimOptionalString(body.fullName, MAX_FIELD_LEN);
  const clinicName = trimOptionalString(body.clinicName, MAX_FIELD_LEN);

  return {
    ok: true,
    value: { email, fullName, clinicName },
  };
}

/** Client-side check before POST /api/public/provider-access-interest */
export function validateProviderAccessInterestFormFields(input: {
  email: string;
}): { ok: true } | { ok: false; error: string } {
  const emailTrim = input.email.trim();
  if (!emailTrim) {
    return { ok: false, error: "Email is required." };
  }
  if (!isValidProviderAccessInterestEmail(emailTrim)) {
    return { ok: false, error: "Please enter a valid email address." };
  }
  return { ok: true };
}

export function mapProviderAccessInterestPersistenceError(message: string): string {
  if (/provider_access_interest|relation .* does not exist|schema cache/i.test(message)) {
    return "Unable to submit your request right now. Please try again later.";
  }
  return "Unable to submit your request right now. Please try again later.";
}
