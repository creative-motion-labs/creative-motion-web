export function traceDemoReachTargetHit(
  tag: string,
  payload: Record<string, unknown>,
): void {
  if (process.env.NODE_ENV === "production") return;
  console.info("[rasq-demo-reach-target-hit]", { tag, ...payload });
}
