import { useEffect, useState } from 'react';
import { UserProfile } from './UserProfile';
import { ChevronLeft, Search } from 'lucide-react';
import { API_ORIGIN } from '../config/api';
import type { AppUser } from '../types/user';

type ManagedUser = AppUser & { id: number };

export const StudentManagement = ({ currentUser, onBack }: { currentUser: AppUser; onBack: () => void }) => {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [keyword, setKeyword] = useState('');
  const [editingStudent, setEditingStudent] = useState<ManagedUser | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // 元件載入，或從編輯畫面返回列表時，重新抓取最新資料
  useEffect(() => {
    if (editingStudent) return;
    let isMounted = true;
    fetch(`${API_ORIGIN}/api/admin/users`)
      .then(res => res.json())
      .then(data => {
        if (!isMounted) return;
        if (data.success) {
          // 過濾掉教職員，只顯示學生
          setUsers((data.data as ManagedUser[]).filter(u => u.role !== '教師' && u.role !== 'admin'));
          setError('');
        } else {
          setError(data.error || '無法載入學生資料');
        }
      })
      .catch(() => { if (isMounted) setError('無法連線到伺服器，請稍後再試'); })
      .finally(() => { if (isMounted) setLoading(false); });
    return () => { isMounted = false; };
  }, [editingStudent, reloadKey]);

  // 如果選擇了某個學生，就顯示編輯個人資料的畫面
  if (editingStudent) {
    return (
      <div className="mx-auto w-full max-w-4xl">
        <button type="button" onClick={() => setEditingStudent(null)} className="mb-4 flex items-center gap-1 font-bold text-gray-500 hover:text-gray-800">
          <ChevronLeft /> 返回學生列表
        </button>
        <UserProfile currentUser={currentUser} targetUser={editingStudent} />
      </div>
    );
  }

  const term = keyword.trim().toLowerCase();
  const visibleUsers = users.filter(u => !term || [u.name, u.email, u.studentId, u.phone].join(' ').toLowerCase().includes(term));

  return (
    <div className="mx-auto w-full max-w-5xl animate-fade-in rounded-xl bg-white p-4 shadow-lg sm:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-extrabold text-gray-800 sm:text-2xl">學生資料管理系統</h2>
        <button type="button" onClick={onBack} className="flex items-center gap-1 rounded-lg bg-gray-100 px-4 py-2 font-bold text-gray-500 hover:text-gray-800">
          <ChevronLeft /> 返回首頁
        </button>
      </div>

      <label className="relative mb-4 block">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input type="search" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜尋姓名、學號、信箱或電話" className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-blue-400 focus:outline-none" aria-label="搜尋學生" />
      </label>

      {loading ? (
        <p className="py-10 text-center text-gray-500">載入中...</p>
      ) : error ? (
        <div className="py-10 text-center text-red-600">
          {error}
          <button type="button" onClick={() => { setLoading(true); setReloadKey(key => key + 1); }} className="mx-auto mt-3 block underline">重新載入</button>
        </div>
      ) : visibleUsers.length === 0 ? (
        <p className="py-10 text-center text-gray-400">{users.length === 0 ? '目前沒有學生資料' : '查無符合的學生'}</p>
      ) : (
        <>
          {/* 手機：卡片 */}
          <div className="space-y-3 md:hidden">
            {visibleUsers.map(u => (
              <div key={u.id} className="rounded-xl border border-gray-200 p-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="font-bold text-blue-700">{u.name}</p>
                  <span className="text-xs text-gray-400">{u.studentId || `#${u.id}`}</span>
                </div>
                <p className="break-all text-sm text-gray-600">{u.email}</p>
                <p className="mb-3 text-sm text-gray-600">{u.phone || '未填寫電話'}</p>
                <button type="button" onClick={() => setEditingStudent(u)} className="w-full rounded-lg bg-purple-100 py-2 font-bold text-purple-700 hover:bg-purple-200">編輯資料</button>
              </div>
            ))}
          </div>
          {/* 桌機：表格 */}
          <div className="hidden overflow-x-auto rounded-lg border border-gray-200 md:block">
            <table className="w-full text-left">
              <thead className="border-b border-gray-200 bg-gray-50">
                <tr>
                  <th className="p-4 font-bold text-gray-600">學號</th>
                  <th className="p-4 font-bold text-gray-600">姓名</th>
                  <th className="p-4 font-bold text-gray-600">信箱</th>
                  <th className="p-4 font-bold text-gray-600">電話</th>
                  <th className="p-4 text-center font-bold text-gray-600">操作</th>
                </tr>
              </thead>
              <tbody>
                {visibleUsers.map(u => (
                  <tr key={u.id} className="border-b transition-colors hover:bg-gray-50">
                    <td className="p-4 text-gray-500">{u.studentId || `#${u.id}`}</td>
                    <td className="p-4 font-bold text-blue-700">{u.name}</td>
                    <td className="break-all p-4 text-gray-600">{u.email}</td>
                    <td className="whitespace-nowrap p-4 text-gray-600">{u.phone || '未填寫'}</td>
                    <td className="p-4 text-center">
                      <button
                        type="button"
                        onClick={() => setEditingStudent(u)}
                        className="inline-block whitespace-nowrap rounded-lg bg-purple-100 px-4 py-1.5 font-bold text-purple-700 transition-colors hover:bg-purple-200"
                      >
                        編輯資料
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};
