export function buildCvReadinessScopeKey(exerciseId: string, step: string): string {
  return `${exerciseId}:${step}`;
}

export function shouldResetCvReadinessScope(
  nextScopeKey: string,
  storedScopeKey: string,
): boolean {
  return nextScopeKey !== storedScopeKey;
}
