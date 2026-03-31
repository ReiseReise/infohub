const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:', 'ftp:', 'socks:', 'socks4:', 'socks5:']);

// Normalize proxy URI to a safe, single endpoint format.
// Adapted from the desktop reference implementation we are borrowing from.
export function normalizeProxyUri(userProxy: string): string | undefined {
  if (!userProxy) return undefined;

  const firstInput = userProxy.split(',')[0]?.trim();
  if (!firstInput) return undefined;

  try {
    const proxyUrl = new URL(firstInput);
    if (!SUPPORTED_PROTOCOLS.has(proxyUrl.protocol) || !proxyUrl.hostname) {
      return undefined;
    }
    return `${proxyUrl.protocol}//${proxyUrl.hostname}${proxyUrl.port ? `:${proxyUrl.port}` : ''}`;
  } catch {
    return undefined;
  }
}
