export const TOKEN_KEY = 'infohub_v3_access_token';

export type StorageChangeLike = {
  key: string | null;
  oldValue: string | null;
  newValue: string | null;
};

export function isStoredTokenChange(event: StorageChangeLike): boolean {
  return event.key === TOKEN_KEY && event.oldValue !== event.newValue;
}

export function shouldInvalidateSessionForRequest(
  requestToken: string | null,
  currentToken: string | null,
): boolean {
  return requestToken === currentToken;
}

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}
