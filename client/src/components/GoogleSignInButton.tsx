import { useEffect, useRef } from 'react';
import { API_ORIGIN, GOOGLE_CLIENT_ID as CONFIGURED_GOOGLE_CLIENT_ID } from '../config/api';

type GoogleCredentialResponse = {
  credential: string;
};

export type GoogleProfile = {
  id: number;
  studentId: string;
  email: string;
  name: string;
  role?: string;
};

type GoogleSignInButtonProps = {
  onSuccess: (profile: GoogleProfile) => void;
  onError?: (error: Error) => void;
};

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (options: {
            client_id: string;
            callback: (response: GoogleCredentialResponse) => void;
          }) => void;
          renderButton: (container: HTMLElement, options: Record<string, string>) => void;
        };
      };
    };
  }
}

// 從環境變數讀取 Google Client ID（建置時決定）
const GOOGLE_CLIENT_ID: string | undefined = CONFIGURED_GOOGLE_CLIENT_ID;
const GOOGLE_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

export default function GoogleSignInButton({ onSuccess, onError }: GoogleSignInButtonProps) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const initRef = useRef(false);
  // 以 ref 保存最新的回呼，避免 Google SDK 只記住第一次渲染的函式
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onSuccessRef.current = onSuccess;
    onErrorRef.current = onError;
  }, [onSuccess, onError]);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    const clientId = GOOGLE_CLIENT_ID;
    const backendEndpoint = `${API_ORIGIN}/api/auth/google`;

    // 動態載入 Google SDK 腳本（已載入則略過）
    if (!document.querySelector(`script[src="${GOOGLE_SCRIPT_SRC}"]`)) {
      const script = document.createElement('script');
      script.src = GOOGLE_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }

    const tryInit = () => {
      if (initRef.current) return true;
      if (!window.google?.accounts?.id || !buttonRef.current) return false;

      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: async (response: GoogleCredentialResponse) => {
          try {
            // 將 Google 回傳的 Token 送往後端驗證
            const res = await fetch(backendEndpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ credential: response.credential }),
            });
            if (!res.ok) throw new Error('Google 授權驗證失敗，請確認後端 API 狀態');
            const profile = (await res.json()) as GoogleProfile;
            onSuccessRef.current(profile);
          } catch (error) {
            onErrorRef.current?.(error instanceof Error ? error : new Error('Google 授權驗證發生未知錯誤'));
          }
        },
      });

      // Google 按鈕寬度只接受 200–400 像素，依容器寬度決定
      const containerWidth = buttonRef.current.offsetWidth || 320;
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: 'outline',
        size: 'large',
        type: 'standard',
        text: 'signin_with',
        width: String(Math.max(200, Math.min(400, Math.floor(containerWidth)))),
      });
      initRef.current = true;
      return true;
    };

    if (tryInit()) return;
    // 若腳本尚未載入完畢，使用輪詢等待（最多 15 秒）
    let attempts = 0;
    const intervalId = window.setInterval(() => {
      attempts += 1;
      if (tryInit() || attempts > 75) window.clearInterval(intervalId);
    }, 200);
    return () => window.clearInterval(intervalId);
  }, []);

  // 未設定金鑰時的防呆畫面
  if (!GOOGLE_CLIENT_ID) {
    return (
      <button
        type="button"
        className="w-full cursor-not-allowed rounded-xl border border-red-200 bg-red-50 py-3 font-bold text-red-500"
        disabled
      >
        Google 登入尚未設定（缺少 VITE_GOOGLE_CLIENT_ID）
      </button>
    );
  }

  return <div ref={buttonRef} className="flex w-full justify-center" />;
}
