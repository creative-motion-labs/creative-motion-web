/**
 * Client-side helpers for provider profile and pilot access requests.
 */
export type EnsureProviderClientInput = {
  name?: string;
  clinic_name?: string | null;
  email?: string;
};

const SAFE_SETUP_ERROR =
  "Could not set up your provider account. Please try again or contact support.";

export async function submitProviderAccessRequest(
  fields: EnsureProviderClientInput,
): Promise<void> {
  const res = await fetch("/api/auth/provider-access-request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(fields),
  });

  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
  };

  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? "Could not submit your access request.");
  }
}

export async function ensureProviderProfile(
  fields?: EnsureProviderClientInput,
): Promise<void> {
  const res = await fetch("/api/auth/create-provider", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(fields ?? {}),
  });

  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    pending?: boolean;
    error?: string;
    code?: string;
  };

  if (res.status === 403 || data.code === "provider_not_approved") {
    return;
  }

  if (res.status === 202 || data.pending) {
    throw new Error(
      "Provider account setup is not available yet. Please contact support.",
    );
  }

  if (!res.ok || !data.ok) {
    throw new Error(SAFE_SETUP_ERROR);
  }
}

export async function resolvePostLoginPath(input: {
  returnTo: string;
  defaultRedirect: string;
}): Promise<string> {
  const params = new URLSearchParams({
    returnTo: input.returnTo,
    default: input.defaultRedirect,
  });
  const res = await fetch(`/api/auth/post-login-destination?${params.toString()}`, {
    credentials: "include",
  });

  if (!res.ok) {
    return input.defaultRedirect;
  }

  const data = (await res.json()) as { path?: string };
  if (typeof data.path === "string" && data.path.startsWith("/")) {
    return data.path;
  }

  return input.defaultRedirect;
}
