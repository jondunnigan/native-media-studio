export function isOAuthEnabled(oAuthServerUrl: string | undefined): boolean {
  return Boolean(oAuthServerUrl?.trim());
}
