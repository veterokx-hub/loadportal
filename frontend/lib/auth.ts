export type UserRole = "ADMIN" | "USER";

export interface AuthSession {
  token: string;
  username: string;
  role: UserRole;
  mustChangePassword?: boolean;
}

const TOKEN_KEY = "ltp-token";
const USER_KEY = "ltp-user";
const ROLE_KEY = "ltp-role";
const MUST_CHANGE_KEY = "ltp-must-change";

export function saveSession(s: AuthSession) {
  localStorage.setItem(TOKEN_KEY, s.token);
  localStorage.setItem(USER_KEY, s.username);
  localStorage.setItem(ROLE_KEY, s.role);
  if (s.mustChangePassword) {
    localStorage.setItem(MUST_CHANGE_KEY, "1");
  } else {
    localStorage.removeItem(MUST_CHANGE_KEY);
  }
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(ROLE_KEY);
  localStorage.removeItem(MUST_CHANGE_KEY);
  localStorage.removeItem("ltp-auth");
}

export function getSession(): AuthSession | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const username = localStorage.getItem(USER_KEY);
    const role = localStorage.getItem(ROLE_KEY) as UserRole | null;
    if (!token || !username || !role) return null;
    return {
      token,
      username,
      role,
      mustChangePassword: localStorage.getItem(MUST_CHANGE_KEY) === "1",
    };
  } catch {
    return null;
  }
}

export function isAuthenticated(): boolean {
  return getSession() !== null;
}

export function mustChangePassword(): boolean {
  return getSession()?.mustChangePassword === true;
}

export function clearMustChangePassword() {
  localStorage.removeItem(MUST_CHANGE_KEY);
}

export function isAdmin(): boolean {
  return getSession()?.role === "ADMIN";
}

export function authHeaders(): Record<string, string> {
  const s = getSession();
  if (!s) return {};
  return { Authorization: `Bearer ${s.token}` };
}

export function getUsername(): string {
  return getSession()?.username ?? "";
}
