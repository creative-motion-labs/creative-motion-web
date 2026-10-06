/** PR #313 synthetic QA harness — must not be reachable in production. */
export function isPr313QaPath(pathname: string): boolean {
  return pathname === "/qa/pr313" || pathname.startsWith("/qa/pr313/");
}

export function isProductionRuntime(nodeEnv?: string, vercelEnv?: string): boolean {
  return nodeEnv === "production" || vercelEnv === "production";
}

export function shouldBlockPr313QaInProduction(
  pathname: string,
  nodeEnv?: string,
  vercelEnv?: string,
): boolean {
  return isPr313QaPath(pathname) && isProductionRuntime(nodeEnv, vercelEnv);
}

export function isPr313QaPublicInCurrentRuntime(nodeEnv?: string, vercelEnv?: string): boolean {
  return !isProductionRuntime(nodeEnv, vercelEnv);
}
