export function parseCookies(header: string | null | undefined): Record<string, string> {
  if (!header) return {};
  const list: Record<string, string> = {};
  header.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    const name = parts.shift()?.trim();
    if (name) {
      const val = parts.join('=').trim();
      try {
        list[name] = decodeURIComponent(val);
      } catch {
        list[name] = val;
      }
    }
  });
  return list;
}

export function createSessionCookie(sessionId: string, secure: boolean = false, maxAge: number = 60 * 60 * 24 * 365): string {
  let cookie = `gram_session=${encodeURIComponent(sessionId)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`;
  if (secure) cookie += '; Secure';
  return cookie;
}

export function clearSessionCookie(secure: boolean = false): string {
  let cookie = `gram_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax`;
  if (secure) cookie += '; Secure';
  return cookie;
}
