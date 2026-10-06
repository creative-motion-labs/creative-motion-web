/** Ignore stale fetch results after navigation or unmount (AbortController or route key mismatch). */
export function shouldIgnorePatientRouteFetchResult(options: {
  aborted: boolean;
  /** Current route key: assessment token or clinician patient id. */
  activeToken: string;
  /** Route key captured when the fetch started. */
  responseToken: string;
}): boolean {
  if (options.aborted) {
    return true;
  }
  return options.activeToken !== options.responseToken;
}
