export type DemoCameraPermissionState = "granted" | "prompt" | "denied" | "unsupported";

export async function queryDemoCameraPermissionState(): Promise<DemoCameraPermissionState> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) {
    return "unsupported";
  }
  try {
    const status = await navigator.permissions.query({ name: "camera" as PermissionName });
    if (status.state === "granted") return "granted";
    if (status.state === "denied") return "denied";
    return "prompt";
  } catch {
    return "unsupported";
  }
}

export function isDemoCameraPermissionDeniedError(error: unknown): boolean {
  if (!(error instanceof DOMException)) {
    return false;
  }
  return error.name === "NotAllowedError" || error.name === "PermissionDeniedError";
}
