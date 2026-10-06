export function buildGuidedRestCountdownScopeKey(
  restPhaseKey: string,
  countdownStart: number,
): string {
  return `${restPhaseKey}:${countdownStart}`;
}

export function resolveGuidedRestCountdownOnScopeChange(input: {
  countdownScopeKey: string;
  countdownScopeKeyState: string;
  countdownStart: number;
  secondsLeft: number;
}): { countdownScopeKeyState: string; secondsLeft: number } {
  if (input.countdownScopeKeyState === input.countdownScopeKey) {
    return {
      countdownScopeKeyState: input.countdownScopeKeyState,
      secondsLeft: input.secondsLeft,
    };
  }
  return {
    countdownScopeKeyState: input.countdownScopeKey,
    secondsLeft: input.countdownStart,
  };
}
