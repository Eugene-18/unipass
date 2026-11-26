import React, { useEffect, useState } from 'react';
import { validatePassword } from '../utils/passwordPolicy';
import { API_ORIGIN } from '../config/api';
import type { AppUser } from '../types/user';

type ProfileForm = {
  name: string;
  gender: string;
  birthday: string;
  email: string;
  phone: string;
  password: string;
};

type Message = { type: 'success' | 'error' | 'info'; text: string };

// 資料庫中性別可能存成中文或英文，統一轉成表單使用的值
function normalizeGender(value: string | null | undefined): string {
  if (value === '女' || value === 'female') return 'female';
  if (value === '男' || value === 'male') return 'male';
  return '';
}

function toForm(user: Partial<AppUser>): ProfileForm {
  return {
    name: user.name || '',
    gender: normalizeGender(user.gender),
    birthday: user.birthday ? String(user.birthday).slice(0, 10) : '',
    email: user.email || '',
    phone: user.phone || '',
    password: '',
  };
}

const isPersistedUser = (user: Partial<AppUser>) => Number.isInteger(Number(user.id)) && Number(user.id) > 0;

// 接收 currentUser(當前登入者) 與 targetUser(可選，要修改的對象)
export const UserProfile = ({ currentUser, targetUser, onSaved }: {
  currentUser: AppUser;
  targetUser?: AppUser;
  onSaved?: (updated: Partial<AppUser>) => void;
}) => {
  // 如果有傳入 targetUser (老師改學生)，就編輯 targetUser；否則編輯自己
  const editingUser = targetUser || currentUser;
  const [formData, setFormData] = useState<ProfileForm>(() => toForm(editingUser));
  const [message, setMessage] = useState<Message | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // 判斷當前「登入者」是否為管理員
  const isAdmin = currentUser.role === '教師' || currentUser.role === 'admin';
  const canEdit = isPersistedUser(editingUser);
  const useAdminApi = isAdmin;

  // 元件載入時向後端拉取最新資料
  useEffect(() => {
    if (!canEdit) return;
    let isMounted = true;
    const url = useAdminApi
      ? `${API_ORIGIN}/api/admin/users/${editingUser.id}`
      : `${API_ORIGIN}/api/users/${editingUser.id}`;
    fetch(url)
      .then(response => response.json())
      .then(result => {
        if (isMounted && result.success && result.data) setFormData(toForm(result.data));
      })
      .catch(error => console.error('無法獲取最新使用者資料:', error));
    return () => { isMounted = false; };
  }, [canEdit, editingUser.id, useAdminApi]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      setMessage({ type: 'error', text: '請輸入正確的電子郵件格式' });
      return;
    }
    if (formData.phone && !/^[0-9+\-\s()]{8,20}$/.test(formData.phone)) {
      setMessage({ type: 'error', text: '請輸入正確的聯絡電話（8–20 碼數字）' });
      return;
    }
    if (formData.password) {
      const passwordError = validatePassword(formData.password, [
        editingUser.name,
        editingUser.email,
        editingUser.studentId,
        editingUser.birthday,
        editingUser.phone,
        formData.email,
        formData.phone,
        formData.name,
        formData.birthday,
      ]);
      if (passwordError) {
        setMessage({ type: 'error', text: passwordError });
        return;
      }
    }
    setIsSaving(true);
    setMessage({ type: 'info', text: '處理中...' });

    try {
      const url = useAdminApi ? `${API_ORIGIN}/api/admin/users/${editingUser.id}` : `${API_ORIGIN}/api/users/profile`;
      const payload = useAdminApi
        ? { adminId: currentUser.id, ...formData }
        : { userId: currentUser.id, email: formData.email, phone: formData.phone, password: formData.password };

      const response = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (result.success) {
        setMessage({ type: 'success', text: targetUser ? `已成功更新 ${formData.name || editingUser.name} 的資料！` : '資料更新成功！' });
        setFormData(previous => ({ ...previous, password: '' }));
        if (!targetUser) {
          onSaved?.({
            email: formData.email,
            phone: formData.phone,
            ...(useAdminApi ? { name: formData.name, gender: formData.gender, birthday: formData.birthday } : {}),
            ...(formData.password ? { hasPassword: true } : {}),
          });
        }
      } else {
        setMessage({ type: 'error', text: result.error || '更新失敗' });
      }
    } catch {
      setMessage({ type: 'error', text: '網路錯誤，請稍後再試。' });
    } finally {
      setIsSaving(false);
    }
  };

  const fieldClass = 'w-full rounded-lg border p-3 disabled:bg-gray-200 disabled:text-gray-500';

  if (!canEdit) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-gray-100 bg-white p-6 shadow-lg sm:p-8">
        <h2 className="mb-4 text-center text-2xl font-extrabold text-gray-800 sm:text-3xl">個人資料</h2>
        <dl className="mb-6 grid grid-cols-[5rem_1fr] gap-y-3 text-gray-700">
          <dt className="font-bold text-gray-500">姓名</dt><dd>{editingUser.name}</dd>
          <dt className="font-bold text-gray-500">身分</dt><dd>{editingUser.role}</dd>
          <dt className="font-bold text-gray-500">帳號</dt><dd className="break-all">{editingUser.studentId || String(editingUser.id)}</dd>
        </dl>
        <p className="rounded-lg bg-blue-50 p-4 text-sm leading-6 text-blue-800">
          此帳號為展示用身分，尚未在系統資料庫建立個人資料，因此無法修改。若需要可編輯的個人資料，請使用學生帳號或 Google 登入。
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl rounded-xl border border-gray-100 bg-white p-5 shadow-lg sm:p-8">
      <div className="mb-6 text-center sm:mb-8">
        <h2 className="break-words text-2xl font-extrabold text-gray-800 sm:text-3xl">
          {targetUser ? `編輯 ${targetUser.name} 的資料` : '個人資料設定'}
        </h2>
        <p className="mt-2 text-gray-500">
          當前操作身分：
          <span className={`ml-2 rounded-full px-3 py-1 text-sm font-bold ${isAdmin ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
            {isAdmin ? '系統管理員' : '一般學生'}
          </span>
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 sm:p-6">
          <h3 className="mb-4 text-sm font-semibold text-gray-500">基本資訊 {isAdmin ? '' : '(僅管理員可變更)'}</h3>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="profile-name">姓名</label>
              <input id="profile-name" name="name" type="text" value={formData.name} onChange={handleChange} disabled={!isAdmin} className={fieldClass} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="profile-gender">性別</label>
                <select id="profile-gender" name="gender" value={formData.gender} onChange={handleChange} disabled={!isAdmin} className={fieldClass}>
                  <option value="">未設定</option>
                  <option value="male">男</option>
                  <option value="female">女</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="profile-birthday">生日</label>
                <input id="profile-birthday" name="birthday" type="date" value={formData.birthday} onChange={handleChange} disabled={!isAdmin} className={fieldClass} />
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
          <h3 className="mb-4 text-sm font-semibold text-blue-500">聯絡資訊與密碼 (可自由變更)</h3>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="profile-email">電子郵件</label>
              <input id="profile-email" name="email" type="email" value={formData.email} onChange={handleChange} className={fieldClass} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="profile-phone">聯絡電話</label>
              <input id="profile-phone" name="phone" type="tel" value={formData.phone} onChange={handleChange} className={fieldClass} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="profile-password">新密碼</label>
              <input id="profile-password" name="password" type="password" autoComplete="new-password" placeholder="若不修改請留白" value={formData.password} onChange={handleChange} className={fieldClass} />
              <p className="mt-2 text-xs leading-5 text-gray-500">
                至少 8 個字元，包含大小寫英文字母、數字及符號；不可使用連續或重複字元、常見單字、機關縮寫，或包含帳號、姓名、生日及電話。設定後登入時需輸入此密碼。
              </p>
            </div>
          </div>
        </div>

        {message && <div role="status" className={`rounded-lg p-4 text-center font-medium ${message.type === 'error' ? 'bg-red-100 text-red-700' : message.type === 'info' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>{message.type === 'error' ? `錯誤：${message.text}` : message.text}</div>}

        <button type="submit" disabled={isSaving} className="w-full rounded-lg bg-blue-600 px-4 py-3 font-bold text-white transition hover:bg-blue-700 disabled:bg-gray-400">
          {isSaving ? '儲存中...' : '儲存變更'}
        </button>
      </form>
    </div>
  );
};
