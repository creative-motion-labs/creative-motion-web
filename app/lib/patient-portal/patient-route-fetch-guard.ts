/** Ignore stale fetch results after navigation or unmount (AbortController or explicit token). */
export function shouldIgnorePatientRouteFetchResult(options: {
  aborted: boolean;
  activeToken: string;
  responseToken: string;
}): boolean {
  if (options.aborted) {
    return true;
  }
  return options.activeToken !== options.responseToken;
}
