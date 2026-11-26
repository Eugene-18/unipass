import type { PortalUser } from '../types';

// 從 UniPass 進入招生系統時，招生系統的登入狀態只在「同一位 UniPass 使用者、同一個分頁」內有效
const ADMISSION_SESSION_KEY = 'unipass-admission-session';

export function loadAdmissionSession(owner: string): PortalUser | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(ADMISSION_SESSION_KEY) || 'null') as { owner?: string; user?: PortalUser } | null;
    return saved?.owner === owner && saved.user ? saved.user : null;
  } catch {
    return null;
  }
}

export function saveAdmissionSession(owner: string, user: PortalUser | null) {
  try {
    if (user) sessionStorage.setItem(ADMISSION_SESSION_KEY, JSON.stringify({ owner, user }));
    else sessionStorage.removeItem(ADMISSION_SESSION_KEY);
  } catch {
    // 瀏覽器停用 sessionStorage 時，只維持本次畫面的登入狀態
  }
}

// UniPass 登出時一併清除，避免下一位使用者沿用招生系統的登入狀態
export function clearAdmissionSession() {
  saveAdmissionSession('', null);
}
