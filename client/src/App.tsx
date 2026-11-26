import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import io from 'socket.io-client';
import QRCode from 'react-qr-code';
import { Scanner, type IDetectedBarcode } from '@yudiel/react-qr-scanner';
import GoogleSignInButton, { type GoogleProfile } from './components/GoogleSignInButton';
import ForgotPasswordModal from './components/ForgotPasswordModal';
import {
  QrCode, MapPin, RefreshCw, CheckCircle, Camera, X, House, GraduationCap, Calendar, ArrowRight, ChevronLeft,
  School, User, Lock, LogIn, LogOut, BadgeCheck, Keyboard, Search, Clock, FileText, Users, Map as MapIcon,
  Crosshair, PlusCircle, Star, Settings, Pencil, Trash2, Bluetooth, History, AlertCircle, Info,
} from 'lucide-react';
import { RecommendationDashboard } from './components/RecommendationDashboard';
import { UserProfile } from './components/UserProfile';
import { StudentManagement } from './components/StudentManagement';
import EventDashboard from './components/EventDashboard';
import { API_ORIGIN } from './config/api';
import type { AppUser } from './types/user';
import { clearAdmissionSession } from './AdmissionSystem/lib/admissionSession';

// 招生系統含 PDF、拖曳排序等較大的套件，進入時才載入，加快首頁開啟速度
const AdmissionApp = lazy(() => import('./AdmissionSystem/AdmissionApp'));

const socket = io(API_ORIGIN);
const roleRequestHeaders = (role: string) => ({ 'X-User-Role': role === '教師' ? 'teacher' : role });

// --- 資料常數 ---
const CAMPUSES = ['全部', '臺北校區', '桃園校區'];
const TARGETS = ['全部', '學生', '教職', '校外'];
const CATEGORIES = ['全部', '研討會', '專題演講/講座', '研習活動', '工作坊/研習營', '藝文活動', '座談/說明會', '成果展', '參訪觀摩', '活動通告', '課程'];
const OTHER_OPTION = '__other__';
const ORGANIZERS = [
  '全部', '人事室', '心理諮商組', '企業管理系', '服務學習組', '軍訓室',
  '課外活動組', '通識教育中心', '資訊管理系', '體育室', '圖書館', '教務處', '學生事務處',
];
const SESSION_USER_KEY = 'unipass-user';
// 簽到碼自動更新區間（毫秒）：每次隨機 5–12 秒
const CODE_ROTATE_MIN_MS = 5_000;
const CODE_ROTATE_MAX_MS = 12_000;

type Activity = {
  id: number;
  title: string;
  organizer: string;
  contactPerson: string;
  contactPhone: string;
  contactEmail: string;
  description: string;
  dateRange: string;
  regRange: string;
  campus: string;
  location: string;
  category: string;
  target: string;
  capacity: number;
  currentReg: number;
  fee: number;
  registrationStart: string;
  registrationEnd: string;
  locationLat?: number | null;
  locationLng?: number | null;
  bluetoothCheckInRequired?: boolean;
  bluetoothBeaconName?: string | null;
  bluetoothServiceUuid?: string | null;
  registered: boolean;
  checkedIn: boolean;
};

type ServerEvent = {
  id: number;
  title: string;
  description?: string | null;
  eventDate?: string | null;
  registrationStart?: string | null;
  registrationEnd?: string | null;
  organizer?: string | null;
  target?: string | null;
  category?: string | null;
  campus?: string | null;
  contactPerson?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  locationName?: string | null;
  locationLat?: number | null;
  locationLng?: number | null;
  bluetoothCheckInRequired?: boolean | null;
  bluetoothBeaconName?: string | null;
  bluetoothServiceUuid?: string | null;
  capacity?: number | null;
  currentReg?: number | null;
  fee?: number | null;
};

type RegistrationMap = Record<number, { registered: boolean; checkedIn: boolean }>;

type RegistrationStateKey = 'open' | 'not_started' | 'closed' | 'full';
type RegistrationState = { key: RegistrationStateKey; label: string; badge: string };

type Notice = { type: 'success' | 'error' | 'info'; text: string };

type PaymentReturn = {
  status: 'success' | 'failed' | 'cancelled';
  message: string;
  orderNo: string;
  eventId: number | null;
  studentId: string;
};

type BluetoothDeviceLike = {
  name?: string | null;
  gatt?: {
    connect: () => Promise<{
      getPrimaryService: (service: string) => Promise<unknown>;
      disconnect: () => void;
    }>;
  };
};

type BluetoothRequestFilter = { name?: string; services?: string[] };
type BluetoothApi = {
  requestDevice: (options: { filters: BluetoothRequestFilter[]; optionalServices?: string[] }) => Promise<BluetoothDeviceLike>;
};

// --- 工具函式 ---
function parseActivityDateRange(value: string | undefined): { start: string; end: string } {
  if (!value) return { start: '', end: '' };
  const dates = [...value.matchAll(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/g)];
  const times = [...value.matchAll(/(?:^|\s)(\d{1,2}):(\d{2})/g)];
  if (dates.length === 0) return { start: '', end: '' };
  const format = (dateMatch: RegExpMatchArray, timeMatch?: RegExpMatchArray) => {
    const [, year, month, day] = dateMatch;
    const hour = timeMatch?.[1] ?? '00';
    const minute = timeMatch?.[2] ?? '00';
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}`;
  };
  if (dates.length > 1) {
    return { start: format(dates[0], times[0]), end: format(dates[1], times[1]) };
  }
  return {
    start: format(dates[0], times[0]),
    end: format(dates[0], times[1] || times[0]),
  };
}

function formatActivityDateRange(start: string, end: string): string {
  const format = (value: string) => {
    const [date, time] = value.split('T');
    return `${date.replace(/-/g, '/')} ${time}`;
  };
  return `${format(start)} ~ ${format(end)}`;
}

function toDateTimeLocal(value: string | undefined): string {
  if (!value) return '';
  const normalized = value.trim().replace(' ', 'T');
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? `${normalized}T00:00` : normalized.slice(0, 16);
}

// 活動時間以臺灣時間（未帶時區）儲存
function parseTaipeiDateTime(value: string | undefined | null): number {
  const raw = String(value || '').trim();
  if (!raw) return Number.NaN;
  const normalized = raw.replace(' ', 'T');
  const withTime = /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? `${normalized}T00:00` : normalized;
  return Date.parse(/([zZ]|[+-]\d{2}:?\d{2})$/.test(withTime) ? withTime : `${withTime}+08:00`);
}

function formatDateTimeText(value: string): string {
  return value ? value.replace('T', ' ') : '';
}

function firstDate(dateRange: string): string {
  return dateRange.split(' ')[0] || '未設定';
}

function getRegistrationState(activity: Activity, now: number): RegistrationState {
  const start = parseTaipeiDateTime(activity.registrationStart);
  const end = parseTaipeiDateTime(activity.registrationEnd);
  if (Number.isFinite(start) && now < start) return { key: 'not_started', label: '尚未開放報名', badge: 'bg-gray-100 text-gray-600' };
  if (Number.isFinite(end) && now > end) return { key: 'closed', label: '報名已截止', badge: 'bg-red-50 text-red-600' };
  if (activity.capacity > 0 && activity.currentReg >= activity.capacity) return { key: 'full', label: '名額已滿', badge: 'bg-orange-50 text-orange-700' };
  return { key: 'open', label: '報名中', badge: 'bg-green-50 text-green-700' };
}

function mapServerEvent(e: ServerEvent): Omit<Activity, 'registered' | 'checkedIn'> {
  const registrationStart = e.registrationStart || '';
  const registrationEnd = e.registrationEnd || '';
  return {
    id: e.id,
    title: e.title,
    organizer: e.organizer || '資訊管理系',
    contactPerson: e.contactPerson || '陳助教',
    contactPhone: e.contactPhone || '02-23226321',
    contactEmail: e.contactEmail || 'imd@ntub.edu.tw',
    description: e.description || '',
    dateRange: e.eventDate || '',
    regRange: registrationStart && registrationEnd
      ? `${formatDateTimeText(registrationStart)} ~ ${formatDateTimeText(registrationEnd)}`
      : '即日起',
    registrationStart,
    registrationEnd,
    campus: e.campus || '臺北校區',
    location: e.locationName || '校園內',
    locationLat: e.locationLat,
    locationLng: e.locationLng,
    bluetoothCheckInRequired: Boolean(e.bluetoothCheckInRequired),
    bluetoothBeaconName: e.bluetoothBeaconName,
    bluetoothServiceUuid: e.bluetoothServiceUuid,
    category: e.category || '研習活動',
    target: e.target || '全部',
    capacity: Number(e.capacity ?? 50),
    currentReg: Number(e.currentReg ?? 0),
    fee: Number(e.fee ?? 0),
  };
}

// 帳號是否在資料庫有實體資料（展示用教職員／考生／訪客沒有）
function hasDatabaseRecord(user: AppUser): boolean {
  return Number.isInteger(Number(user.id)) && Number(user.id) > 0;
}

function getStudentId(user: AppUser): string {
  return String(user.studentId || user.id || '').trim();
}

function loadSessionUser(): AppUser | null {
  try {
    const saved = sessionStorage.getItem(SESSION_USER_KEY);
    return saved ? (JSON.parse(saved) as AppUser) : null;
  } catch {
    return null;
  }
}

function saveSessionUser(user: AppUser | null) {
  try {
    if (user) sessionStorage.setItem(SESSION_USER_KEY, JSON.stringify(user));
    else sessionStorage.removeItem(SESSION_USER_KEY);
  } catch {
    // 瀏覽器停用 sessionStorage 時，僅維持本次畫面的登入狀態
  }
}

function readPaymentReturn(): PaymentReturn | null {
  if (!window.location.pathname.startsWith('/payment/')) return null;
  const params = new URLSearchParams(window.location.search);
  const rawStatus = params.get('status');
  const status: PaymentReturn['status'] = rawStatus === 'success' ? 'success' : rawStatus === 'cancelled' ? 'cancelled' : 'failed';
  const eventId = Number(params.get('eventId'));
  return {
    status,
    message: params.get('message') || '',
    orderNo: params.get('orderNo') || '',
    eventId: Number.isInteger(eventId) && eventId > 0 ? eventId : null,
    studentId: params.get('studentId') || '',
  };
}

function paymentNoticeFrom(result: PaymentReturn): Notice {
  if (result.status === 'success') return { type: 'success', text: '付款成功，您已完成報名！' };
  if (result.status === 'cancelled') return { type: 'info', text: '您已離開付款頁面，尚未完成繳費。需要時可再按一次「我要報名並繳費」。' };
  return { type: 'error', text: `付款未完成${result.message ? `：${result.message}` : ''}。您可以重新報名繳費。` };
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 11) return '早安';
  if (hour < 18) return '午安';
  return '晚安';
}

// --- 共用 UI ---
function ModalShell({ children, maxWidth = 'max-w-lg', onClose, label }: { children: ReactNode; maxWidth?: string; onClose: () => void; label: string }) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50" role="dialog" aria-modal="true" aria-label={label}>
      <div className="flex min-h-full items-start justify-center p-3 sm:items-center sm:p-6">
        <div className={`w-full ${maxWidth} rounded-2xl bg-white shadow-2xl`}>{children}</div>
      </div>
    </div>
  );
}

function NoticeBanner({ notice, onClose }: { notice: Notice; onClose?: () => void }) {
  const tone = notice.type === 'success'
    ? 'border-green-200 bg-green-50 text-green-800'
    : notice.type === 'error'
      ? 'border-red-200 bg-red-50 text-red-700'
      : 'border-blue-200 bg-blue-50 text-blue-800';
  const Icon = notice.type === 'success' ? CheckCircle : notice.type === 'error' ? AlertCircle : Info;
  return (
    <div role="status" className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm font-bold ${tone}`}>
      <Icon size={20} className="mt-0.5 shrink-0" />
      <span className="flex-1">{notice.text}</span>
      {onClose && <button type="button" onClick={onClose} aria-label="關閉提示" className="shrink-0 opacity-60 hover:opacity-100"><X size={18} /></button>}
    </div>
  );
}

function StatusBadge({ state }: { state: RegistrationState }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${state.badge}`}>{state.label}</span>;
}

function TopBar({ onHome, onProfile, onLogout, user }: { onHome: () => void; onProfile?: () => void; onLogout: () => void; user: AppUser }) {
  return (
    <div className="fixed left-0 right-0 top-0 z-30 border-b border-gray-100 bg-white/95 shadow-sm backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:h-16 sm:px-6">
        <button type="button" onClick={onHome} className="flex shrink-0 items-center gap-2 font-bold text-blue-900"><School size={24} /> UniPass</button>
        <div className="flex min-w-0 items-center gap-2 sm:gap-4">
          {onProfile && (
            <button type="button" onClick={onProfile} className="flex min-w-0 items-center gap-2 rounded-full bg-gray-100 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-200" title="個人資料設定">
              <User size={16} className="shrink-0" />
              <span className="truncate">{user.name}<span className="hidden sm:inline"> ({user.role})</span></span>
            </button>
          )}
          <button type="button" onClick={onLogout} className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1.5 text-sm font-bold text-gray-500 hover:bg-red-50 hover:text-red-600" title="登出">
            <LogOut size={18} /><span className="hidden sm:inline">登出</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// --- 建立/編輯活動 Modal ---
function CreateEventModal({ onClose, activity, role }: { onClose: () => void; activity?: Activity; role: string }) {
  const [title, setTitle] = useState(activity?.title || '');
  const [description, setDescription] = useState(activity?.description || '');
  const initialDateRange = parseActivityDateRange(activity?.dateRange);
  const [eventStart, setEventStart] = useState(initialDateRange.start);
  const [eventEnd, setEventEnd] = useState(initialDateRange.end);
  const [registrationStart, setRegistrationStart] = useState(toDateTimeLocal(activity?.registrationStart));
  const [registrationEnd, setRegistrationEnd] = useState(toDateTimeLocal(activity?.registrationEnd));
  const [organizer, setOrganizer] = useState(activity?.organizer || '資訊管理系');
  const [target, setTarget] = useState(activity?.target || '學生');
  const [category, setCategory] = useState(activity?.category || '研習活動');
  const [campus, setCampus] = useState(activity?.campus || '臺北校區');
  const [contactPerson, setContactPerson] = useState(activity?.contactPerson || '陳助教');
  const [contactPhone, setContactPhone] = useState(activity?.contactPhone || '02-23226321');
  const [contactEmail, setContactEmail] = useState(activity?.contactEmail || 'imd@ntub.edu.tw');
  const [locationName, setLocationName] = useState(activity?.location && activity.location !== '校園內' ? activity.location : '');
  const [fee, setFee] = useState(activity?.fee ?? 0);
  const [capacity, setCapacity] = useState(activity?.capacity ?? 50);
  const [lat, setLat] = useState(activity?.locationLat ?? 25.0423);
  const [lng, setLng] = useState(activity?.locationLng ?? 121.5255);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!title.trim() || !eventStart || !eventEnd || !registrationStart || !registrationEnd) { alert('請填寫活動名稱、活動起迄時間及報名起迄時間'); return; }
    if (eventEnd <= eventStart) { alert('活動結束時間必須晚於開始時間'); return; }
    if (registrationEnd < registrationStart) { alert('報名結束時間不能早於開始時間'); return; }
    if (registrationEnd > eventEnd) { alert('報名截止時間不能晚於活動結束時間'); return; }
    if (!Number.isInteger(fee) || fee < 0 || !Number.isInteger(capacity) || capacity < 1) {
      alert('報名費用及活動名額請輸入有效的非負整數（名額至少為 1）');
      return;
    }
    if (activity && capacity < activity.currentReg) {
      alert(`目前已有 ${activity.currentReg} 人報名，名額不能少於已報名人數`);
      return;
    }
    if (![organizer, target, category].every(value => value.trim())) {
      alert('請選擇或輸入主辦單位、對象及類別');
      return;
    }
    const eventData = {
      title: title.trim(), description, dateRange: formatActivityDateRange(eventStart, eventEnd), registrationStart, registrationEnd,
      organizer: organizer.trim(), target: target.trim(), category: category.trim(), campus,
      contactPerson, contactPhone, contactEmail, locationName,
      fee, capacity, lat, lng,
    };
    setSaving(true);
    if (!activity) {
      socket.emit('host_create_event', { ...eventData, role });
      return;
    }
    try {
      const response = await fetch(`${API_ORIGIN}/api/events/${activity.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...roleRequestHeaders(role) },
        body: JSON.stringify(eventData),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || '更新活動失敗');
      alert('活動更新成功');
      onClose();
    } catch (error) {
      console.error('更新活動失敗:', error);
      alert(`更新活動失敗：${(error as Error).message || '請稍後再試'}`);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const handleCreateSuccess = () => { setSaving(false); alert('✅ 活動建立成功！'); onClose(); };
    const handleCreateError = (data: { msg?: string }) => { setSaving(false); alert(`❌ ${data.msg || '建立失敗'}`); };
    socket.on('create_event_success', handleCreateSuccess);
    socket.on('create_event_error', handleCreateError);
    return () => {
      socket.off('create_event_success', handleCreateSuccess);
      socket.off('create_event_error', handleCreateError);
    };
  }, [onClose]);

  const handleGetGPS = () => {
    if (!('geolocation' in navigator)) { alert('此瀏覽器不支援 GPS 定位'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude);
        setLng(pos.coords.longitude);
        alert('📍 已抓取目前位置');
      },
      () => alert('無法取得目前位置，請確認已允許瀏覽器存取位置'),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const inputClass = 'w-full rounded-lg border p-2';
  return (
    <ModalShell onClose={onClose} label={activity ? '編輯活動' : '新增活動'}>
      <div className="p-4 sm:p-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-xl font-bold text-blue-900 sm:text-2xl"><PlusCircle />{activity ? '編輯活動' : '新增活動'}</h2>
          <button type="button" onClick={onClose} aria-label="關閉"><X size={24} className="text-gray-400 hover:text-gray-600" /></button>
        </div>
        <div className="space-y-4">
          <div><label className="mb-1 block text-sm font-bold text-gray-700">活動名稱</label><input type="text" value={title} onChange={e => setTitle(e.target.value)} className={inputClass} placeholder="例如：114學年度 期末成果發表" /></div>
          <div>
            <label className="mb-1 block text-sm font-bold text-gray-700">活動起迄時間</label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-gray-500">開始時間</label>
                <input aria-label="活動開始日期與時間" type="datetime-local" required max={eventEnd || undefined} value={eventStart} onChange={e => setEventStart(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">結束時間</label>
                <input aria-label="活動結束日期與時間" type="datetime-local" required min={eventStart || undefined} value={eventEnd} onChange={e => setEventEnd(e.target.value)} className={inputClass} />
              </div>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-bold text-gray-700">報名起迄時間</label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-gray-500">開始時間</label>
                <input aria-label="報名開始日期與時間" type="datetime-local" required max={registrationEnd || undefined} value={registrationStart} onChange={e => setRegistrationStart(e.target.value)} className={inputClass} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-gray-500">截止時間</label>
                <input aria-label="報名結束日期與時間" type="datetime-local" required min={registrationStart || undefined} max={eventEnd || undefined} value={registrationEnd} onChange={e => setRegistrationEnd(e.target.value)} className={inputClass} />
              </div>
            </div>
          </div>
          <div><label className="mb-1 block text-sm font-bold text-gray-700">活動描述</label><textarea value={description} onChange={e => setDescription(e.target.value)} className={`${inputClass} h-24`} placeholder="請輸入活動詳細內容..." /></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-bold text-gray-700">主辦單位</label>
              <select value={ORGANIZERS.includes(organizer) ? organizer : OTHER_OPTION} onChange={e => setOrganizer(e.target.value === OTHER_OPTION ? '' : e.target.value)} className={inputClass}>
                {ORGANIZERS.filter(option => option !== '全部').map(option => <option key={option} value={option}>{option}</option>)}
                <option value={OTHER_OPTION}>其他</option>
              </select>
              {!ORGANIZERS.includes(organizer) && <input type="text" value={organizer} onChange={e => setOrganizer(e.target.value)} className={`${inputClass} mt-2`} placeholder="請輸入自訂主辦單位" />}
            </div>
            <div>
              <label className="mb-1 block text-sm font-bold text-gray-700">對象</label>
              <select value={TARGETS.includes(target) ? target : OTHER_OPTION} onChange={e => setTarget(e.target.value === OTHER_OPTION ? '' : e.target.value)} className={inputClass}>
                {TARGETS.map(option => <option key={option} value={option}>{option}</option>)}
                <option value={OTHER_OPTION}>其他</option>
              </select>
              {!TARGETS.includes(target) && <input type="text" value={target} onChange={e => setTarget(e.target.value)} className={`${inputClass} mt-2`} placeholder="請輸入自訂對象" />}
            </div>
            <div>
              <label className="mb-1 block text-sm font-bold text-gray-700">類別</label>
              <select value={CATEGORIES.includes(category) ? category : OTHER_OPTION} onChange={e => setCategory(e.target.value === OTHER_OPTION ? '' : e.target.value)} className={inputClass}>
                {CATEGORIES.filter(option => option !== '全部').map(option => <option key={option} value={option}>{option}</option>)}
                <option value={OTHER_OPTION}>其他</option>
              </select>
              {!CATEGORIES.includes(category) && <input type="text" value={category} onChange={e => setCategory(e.target.value)} className={`${inputClass} mt-2`} placeholder="請輸入自訂類別" />}
            </div>
            <div>
              <label className="mb-1 block text-sm font-bold text-gray-700">校區</label>
              <select value={campus} onChange={e => setCampus(e.target.value)} className={inputClass}>
                {campus && !CAMPUSES.includes(campus) && <option value={campus}>{campus}</option>}
                {CAMPUSES.filter(option => option !== '全部').map(option => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label className="mb-1 block text-sm font-bold text-gray-700">聯絡人</label><input type="text" value={contactPerson} onChange={e => setContactPerson(e.target.value)} className={inputClass} /></div>
            <div><label className="mb-1 block text-sm font-bold text-gray-700">聯絡電話</label><input type="tel" value={contactPhone} onChange={e => setContactPhone(e.target.value)} className={inputClass} /></div>
          </div>
          <div><label className="mb-1 block text-sm font-bold text-gray-700">E-mail</label><input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} className={inputClass} /></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label className="mb-1 block text-sm font-bold text-gray-700">報名費用 (NT$)</label><input type="number" min="0" step="1" value={fee} onChange={e => setFee(Number(e.target.value))} className={inputClass} placeholder="0 代表免費" /></div>
            <div><label className="mb-1 block text-sm font-bold text-gray-700">活動名額</label><input type="number" min="1" step="1" value={capacity} onChange={e => setCapacity(Number(e.target.value))} className={inputClass} /></div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <label className="mb-2 block text-sm font-bold text-gray-700">簽到地點設定</label>
            <div className="mb-2 flex items-center gap-2"><MapPin size={16} className="text-red-500" /><span className="text-xs text-gray-500">{lat.toFixed(6)}, {lng.toFixed(6)}</span></div>
            <button type="button" onClick={handleGetGPS} className="flex w-full items-center justify-center gap-2 rounded-lg border border-blue-500 bg-white py-2 font-bold text-blue-600 hover:bg-blue-50"><Crosshair size={16} /> 使用目前位置</button>
            <label className="mb-1 mt-3 block text-sm font-bold text-gray-700">地點名稱／備註</label>
            <input type="text" value={locationName} onChange={e => setLocationName(e.target.value)} className={inputClass} placeholder="例如：行政大樓 3 樓第一會議室" />
          </div>
          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row">
            <button type="button" onClick={onClose} className="w-full rounded-xl bg-gray-100 py-3 font-bold text-gray-600 hover:bg-gray-200 sm:w-1/3">取消</button>
            <button type="button" onClick={() => void handleSave()} disabled={saving} className="w-full rounded-xl bg-blue-600 py-3 font-bold text-white shadow-lg hover:bg-blue-700 disabled:bg-gray-400">{saving ? '儲存中...' : activity ? '儲存變更' : '確認建立'}</button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

type EventAttendee = {
  registrationId: number;
  studentId: string | null;
  name: string | null;
  status: string | null;
  isCheckedIn: boolean | null;
};

const REGISTRATION_STATUS_LABEL: Record<string, string> = {
  registered: '已報名',
  paid: '已繳費',
  checked_in: '現場簽到',
};

function EventRegistrationsModal({ activity, role, onClose, onChanged }: {
  activity: Activity;
  role: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [attendees, setAttendees] = useState<EventAttendee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  const loadAttendees = useCallback(async (): Promise<EventAttendee[]> => {
    const response = await fetch(`${API_ORIGIN}/api/events/${activity.id}/registrations`, {
      headers: roleRequestHeaders(role),
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.message || '無法載入報名名單');
    return result.data;
  }, [activity.id, role]);

  useEffect(() => {
    let isMounted = true;
    loadAttendees()
      .then(result => { if (isMounted) setAttendees(result); })
      .catch((loadError: Error) => {
        console.error('載入活動報名名單失敗:', loadError);
        if (isMounted) setError(loadError.message || '載入報名名單失敗');
      })
      .finally(() => { if (isMounted) setLoading(false); });
    return () => { isMounted = false; };
  }, [loadAttendees]);

  const refreshAttendees = async () => {
    setLoading(true);
    setError('');
    try {
      setAttendees(await loadAttendees());
    } catch (loadError) {
      console.error('載入活動報名名單失敗:', loadError);
      setError((loadError as Error).message || '載入報名名單失敗');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async (attendee: EventAttendee) => {
    if (!window.confirm(`確定要取消 ${attendee.name || attendee.studentId || '此學生'} 的「${activity.title}」報名嗎？此操作不會自動退款。`)) return;
    setCancellingId(attendee.registrationId);
    try {
      const response = await fetch(`${API_ORIGIN}/api/events/${activity.id}/registrations/${attendee.registrationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...roleRequestHeaders(role) },
        body: JSON.stringify({ status: 'cancelled' }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || '取消報名失敗');
      await refreshAttendees();
      onChanged();
    } catch (cancelError) {
      console.error('取消學生報名失敗:', cancelError);
      alert(`取消報名失敗：${(cancelError as Error).message || '請稍後再試'}`);
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <ModalShell onClose={onClose} maxWidth="max-w-2xl" label="報名學生管理">
      <div className="p-4 sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-blue-900">報名學生管理</h2>
            <p className="mt-1 break-words text-sm text-gray-500">{activity.title}（{attendees.length} / {activity.capacity} 人）</p>
          </div>
          <button type="button" onClick={onClose} aria-label="關閉報名名單"><X size={24} className="text-gray-400 hover:text-gray-600" /></button>
        </div>
        {loading ? <p className="py-8 text-center text-gray-500">載入中...</p> : error ? (
          <div className="py-6 text-center text-red-600">{error}<button type="button" onClick={() => void refreshAttendees()} className="mx-auto mt-3 block underline">重新載入</button></div>
        ) : attendees.length === 0 ? (
          <p className="py-8 text-center text-gray-500">目前沒有有效報名的學生</p>
        ) : (
          <div className="max-h-[60vh] divide-y overflow-y-auto">
            {attendees.map(attendee => (
              <div key={attendee.registrationId} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate font-bold text-gray-800">{attendee.name || '未提供姓名'}</p>
                  <p className="text-sm text-gray-500">{attendee.studentId || '無學號'} · {REGISTRATION_STATUS_LABEL[attendee.status || ''] || '已報名'}{attendee.isCheckedIn ? ' · 已簽到' : ''}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleCancel(attendee)}
                  disabled={cancellingId === attendee.registrationId}
                  className="shrink-0 rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-700 hover:bg-red-100 disabled:opacity-50"
                >
                  {cancellingId === attendee.registrationId ? '處理中...' : '取消報名'}
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="mt-4 text-xs text-gray-500">取消後會保留報名與付款紀錄，不會自動退款。</p>
      </div>
    </ModalShell>
  );
}

// --- 地圖選點模擬器 ---
function MapPicker({ initialAddress, onConfirm, onClose }: { initialAddress: string; onConfirm: (lat: number, lng: number, addr: string) => void; onClose: () => void }) {
  const [pickedPos, setPickedPos] = useState({ x: 50, y: 50 });
  const [mockLat, setMockLat] = useState(25.0423);
  const [mockLng, setMockLng] = useState(121.5255);
  const [address, setAddress] = useState(initialAddress || '臺北商業大學 (預設)');
  const handleMapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setPickedPos({ x, y });
    const newLat = 25.0423 + (y - 50) * 0.0001;
    const newLng = 121.5255 + (x - 50) * 0.0001;
    setMockLat(newLat); setMockLng(newLng);
    setAddress(`自訂地圖座標 (${newLat.toFixed(4)}, ${newLng.toFixed(4)})`);
  };
  const handleUseGPS = () => {
    if (!('geolocation' in navigator)) { alert('此瀏覽器不支援 GPS 定位'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMockLat(pos.coords.latitude); setMockLng(pos.coords.longitude);
        setAddress('目前裝置 GPS 位置'); setPickedPos({ x: 50, y: 50 }); alert('📍 已抓取目前位置！');
      },
      () => alert('無法取得目前位置，請確認已允許瀏覽器存取位置'),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };
  return (
    <ModalShell onClose={onClose} maxWidth="max-w-md" label="設定活動地點">
      <div className="overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between bg-blue-900 p-4 text-white"><h3 className="flex items-center gap-2 font-bold"><MapIcon size={20} /> 設定活動地點</h3><button type="button" onClick={onClose} aria-label="關閉"><X size={20} /></button></div>
        <div className="group relative h-56 cursor-crosshair overflow-hidden bg-gray-200 sm:h-64" onClick={handleMapClick} style={{ backgroundImage: 'radial-gradient(#ccc 1px, transparent 1px)', backgroundSize: '20px 20px' }}>
          <div className="pointer-events-none absolute inset-0 flex select-none items-center justify-center text-5xl font-bold text-gray-400 opacity-10 sm:text-6xl">MAP VIEW</div>
          <div className="pointer-events-none absolute left-2 top-2 rounded bg-white/80 px-2 py-1 text-xs text-gray-600">點擊地圖以移動座標</div>
          <div className="absolute -translate-x-1/2 -translate-y-full transform text-red-600 transition-all duration-300" style={{ left: `${pickedPos.x}%`, top: `${pickedPos.y}%` }}><MapPin size={40} fill="currentColor" /></div>
        </div>
        <div className="space-y-4 p-4 sm:p-6">
          <div><label className="text-xs font-bold uppercase text-gray-500">地點名稱 / 地址</label><input type="text" value={address} onChange={(e) => setAddress(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-2 font-mono text-sm" /></div>
          <div className="grid grid-cols-2 gap-4"><div><label className="text-xs font-bold uppercase text-gray-500">緯度 (Lat)</label><input type="text" value={mockLat.toFixed(6)} readOnly className="w-full rounded-lg border bg-gray-50 p-2 font-mono text-xs" /></div><div><label className="text-xs font-bold uppercase text-gray-500">經度 (Lng)</label><input type="text" value={mockLng.toFixed(6)} readOnly className="w-full rounded-lg border bg-gray-50 p-2 font-mono text-xs" /></div></div>
          <div className="flex flex-col gap-2 pt-2 sm:flex-row"><button type="button" onClick={handleUseGPS} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gray-100 py-3 font-bold text-gray-700 hover:bg-gray-200"><Crosshair size={18} /> 使用 GPS</button><button type="button" onClick={() => onConfirm(mockLat, mockLng, address)} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 font-bold text-white hover:bg-blue-700"><CheckCircle size={18} /> 確認設定</button></div>
        </div>
      </div>
    </ModalShell>
  );
}

// --- 簽到核心元件 ---
function CheckInCore({ onBack, user, activity, onCheckedIn, mode }: {
  onBack: () => void;
  user: AppUser;
  activity: Activity;
  onCheckedIn: (eventId: number) => void;
  mode: 'host' | 'guest';
}) {
  const eventId = activity.id;
  const [currentCode, setCurrentCode] = useState('------');
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [attendeeCount, setAttendeeCount] = useState(0);
  const [inputCode, setInputCode] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [manualStudentId, setManualStudentId] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  const [showMapPicker, setShowMapPicker] = useState(false);
  const [eventLocation, setEventLocation] = useState(activity.location);
  const [bluetoothCheckInRequired, setBluetoothCheckInRequired] = useState(Boolean(activity.bluetoothCheckInRequired));
  const [bluetoothBeaconName, setBluetoothBeaconName] = useState(activity.bluetoothBeaconName || '');
  const [bluetoothServiceUuid, setBluetoothServiceUuid] = useState(activity.bluetoothServiceUuid || '');
  const [bluetoothProof, setBluetoothProof] = useState<{ deviceName: string; serviceUuid: string } | null>(null);
  const [isVerifyingBluetooth, setIsVerifyingBluetooth] = useState(false);
  const [isSavingBluetoothSettings, setIsSavingBluetoothSettings] = useState(false);
  const manualRotateRef = useRef<() => void>(() => {});
  const nextRotateAtRef = useRef(0);

  useEffect(() => {
    const handleCodeSync = (data: { eventId: number; code: string }) => {
      if (data.eventId !== eventId) return;
      setCurrentCode(data.code);
    };
    const handleAttendeeUpdate = (data: { eventId?: number; count: number }) => {
      if (data.eventId !== undefined && data.eventId !== eventId) return;
      setAttendeeCount(data.count);
    };
    const handleCheckInSettings = (data: {
      eventId: number;
      bluetoothCheckInRequired: boolean;
      bluetoothBeaconName: string | null;
      bluetoothServiceUuid: string | null;
    }) => {
      if (data.eventId !== eventId) return;
      setBluetoothCheckInRequired(data.bluetoothCheckInRequired);
      setBluetoothBeaconName(data.bluetoothBeaconName || '');
      setBluetoothServiceUuid(data.bluetoothServiceUuid || '');
      setBluetoothProof(null);
    };
    const handleLocationUpdate = (data: { eventId?: number; address?: string }) => {
      if (data.eventId !== undefined && data.eventId !== eventId) return;
      if (data.address) setEventLocation(data.address);
      alert('✅ 活動地點已更新！');
    };
    const handleCheckInResult = (data: { success: boolean; msg: string; source?: string; eventId?: number }) => {
      if (data.source === 'host') {
        if (data.success) {
          alert(`✅ ${data.msg}`);
          setManualStudentId('');
          setShowManualInput(false);
        } else {
          alert(`❌ 補登失敗！\n原因：${data.msg}`);
        }
        return;
      }
      if (mode !== 'guest') return;
      setIsSubmitting(false);
      setStatusMsg(data.msg);
      if (data.success) {
        setShowScanner(false);
        setTimeout(() => onCheckedIn(eventId), 800);
      }
    };
    socket.on('code_sync', handleCodeSync);
    socket.on('attendee_update', handleAttendeeUpdate);
    socket.on('check_in_settings_sync', handleCheckInSettings);
    socket.on('location_update_success', handleLocationUpdate);
    socket.on('check_in_result', handleCheckInResult);
    socket.emit('get_event_stats', { eventId });
    return () => {
      socket.off('code_sync', handleCodeSync);
      socket.off('attendee_update', handleAttendeeUpdate);
      socket.off('check_in_settings_sync', handleCheckInSettings);
      socket.off('location_update_success', handleLocationUpdate);
      socket.off('check_in_result', handleCheckInResult);
    };
  }, [eventId, mode, onCheckedIn]);

  // 主辦端：簽到碼每 5–12 秒隨機更新一次；手動更新會重新起算下一次的隨機時間
  useEffect(() => {
    if (mode !== 'host') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const rotate = () => {
      if (timer) clearTimeout(timer);
      const randomCode = Math.floor(100000 + Math.random() * 900000).toString();
      socket.emit('host_update_code', { eventId, newCode: randomCode });
      const delay = CODE_ROTATE_MIN_MS + Math.floor(Math.random() * (CODE_ROTATE_MAX_MS - CODE_ROTATE_MIN_MS + 1));
      nextRotateAtRef.current = Date.now() + delay;
      timer = setTimeout(rotate, delay);
    };
    manualRotateRef.current = rotate;
    rotate();
    const tick = setInterval(() => {
      setSecondsLeft(Math.max(0, Math.ceil((nextRotateAtRef.current - Date.now()) / 1000)));
    }, 250);
    return () => {
      clearInterval(tick);
      if (timer) clearTimeout(timer);
      manualRotateRef.current = () => {};
    };
  }, [mode, eventId]);

  const handleUpdateLocation = (lat: number, lng: number, addr: string) => {
    socket.emit('host_update_location', { eventId, lat, lng, address: addr });
    setShowMapPicker(false);
  };

  const handleSaveBluetoothSettings = async () => {
    if (bluetoothCheckInRequired && !bluetoothBeaconName.trim() && !bluetoothServiceUuid.trim()) {
      alert('啟用藍牙簽到時，請設定藍牙設備名稱或 Service UUID');
      return;
    }
    setIsSavingBluetoothSettings(true);
    try {
      const response = await fetch(`${API_ORIGIN}/api/events/${eventId}/check-in-settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...roleRequestHeaders(user.role) },
        body: JSON.stringify({ bluetoothCheckInRequired, bluetoothBeaconName, bluetoothServiceUuid }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || '儲存簽到設定失敗');
      setBluetoothProof(null);
      alert('簽到設定已儲存');
    } catch (error) {
      console.error('儲存藍牙簽到設定失敗:', error);
      alert(`儲存簽到設定失敗：${(error as Error).message || '請稍後再試'}`);
    } finally {
      setIsSavingBluetoothSettings(false);
    }
  };

  const handleGetGPS = () => {
    if (!('geolocation' in navigator)) { setStatusMsg('❌ 此瀏覽器不支援 GPS 定位'); return; }
    setStatusMsg('📡 定位中...');
    navigator.geolocation.getCurrentPosition(
      (position) => { setLocation({ lat: position.coords.latitude, lng: position.coords.longitude }); setStatusMsg('📍 已定位'); },
      () => {
        if (bluetoothCheckInRequired) {
          setLocation(null);
          setStatusMsg('❌ GPS 定位失敗，藍牙簽到必須使用實際定位，請允許瀏覽器存取位置後重試');
        } else {
          setLocation({ lat: 25.0423, lng: 121.5255 });
          setStatusMsg('⚠️ GPS 定位失敗，使用既有模擬定位');
        }
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const handleVerifyBluetooth = async () => {
    const expectedName = bluetoothBeaconName.trim();
    const expectedUuid = bluetoothServiceUuid.trim();
    if (!expectedName && !expectedUuid) { setStatusMsg('❌ 活動尚未設定藍牙設備名稱或 Service UUID'); return; }
    if (!window.isSecureContext) { setStatusMsg('❌ 藍牙簽到需要 HTTPS 安全連線或 localhost'); return; }
    const bluetooth = (navigator as Navigator & { bluetooth?: BluetoothApi }).bluetooth;
    if (!bluetooth) { setStatusMsg('❌ 此瀏覽器不支援 Web Bluetooth，請使用支援的 Chrome／Edge 瀏覽器'); return; }
    setIsVerifyingBluetooth(true);
    setBluetoothProof(null);
    setStatusMsg('請在瀏覽器裝置選擇視窗選取活動指定的藍牙設備');
    let connectedServer: Awaited<ReturnType<NonNullable<BluetoothDeviceLike['gatt']>['connect']>> | null = null;
    try {
      const filter: BluetoothRequestFilter = {};
      if (expectedName) filter.name = expectedName;
      if (expectedUuid) filter.services = [expectedUuid];
      const device = await bluetooth.requestDevice({ filters: [filter], optionalServices: expectedUuid ? [expectedUuid] : [] });
      if (expectedName && device.name !== expectedName) throw new Error('選取的設備名稱與活動設定不符');
      if (!device.gatt) throw new Error('此設備不支援 GATT 連線，請確認信標設備規格');
      connectedServer = await device.gatt.connect();
      if (expectedUuid) await connectedServer.getPrimaryService(expectedUuid);
      setBluetoothProof({ deviceName: expectedName ? String(device.name || '') : '', serviceUuid: expectedUuid });
      setStatusMsg(`✅ 藍牙設備驗證完成：${device.name || expectedUuid}`);
    } catch (error) {
      console.error('藍牙簽到驗證失敗:', error);
      setStatusMsg(`❌ 藍牙驗證失敗：${(error as Error).message || '請確認設備已開啟並重試'}`);
    } finally {
      connectedServer?.disconnect();
      setIsVerifyingBluetooth(false);
    }
  };

  const handleSubmit = () => {
    if (!location) { setStatusMsg('❌ 請先開啟 GPS'); return; }
    if (!/^\d{6}$/.test(inputCode)) { setStatusMsg('❌ 請輸入有效的 6 位數字簽到碼'); return; }
    if (bluetoothCheckInRequired && !bluetoothProof) { setStatusMsg('❌ 請先完成活動指定藍牙設備驗證'); return; }
    setIsSubmitting(true);
    setStatusMsg('簽到中...');
    socket.emit('guest_check_in', {
      userId: getStudentId(user),
      eventId,
      inputCode,
      userLat: location.lat,
      userLng: location.lng,
      bluetoothDeviceName: bluetoothProof?.deviceName,
      bluetoothServiceUuid: bluetoothProof?.serviceUuid,
    });
  };

  const handleManualCheckIn = () => {
    if (!manualStudentId.trim()) { alert('請輸入學號'); return; }
    socket.emit('host_manual_check_in', { userId: manualStudentId.trim(), eventId });
  };

  const handleScan = (result: IDetectedBarcode[]) => {
    const rawValue = result?.[0]?.rawValue?.trim() || '';
    if (!rawValue) return;
    const digits = rawValue.replace(/\D/g, '').slice(0, 6);
    setShowScanner(false);
    if (digits.length !== 6) { setStatusMsg('❌ 這不是本系統的簽到 QR Code'); return; }
    setInputCode(digits);
    setStatusMsg('📷 掃描成功，請按「簽到」送出');
  };

  const backButton = (
    <button type="button" onClick={onBack} className="mb-4 flex items-center gap-1 font-bold text-gray-500 hover:text-gray-800">
      <ChevronLeft /> 返回活動列表
    </button>
  );

  if (mode === 'host') {
    return (
      <div className="w-full max-w-5xl p-4 sm:p-6">
        {showMapPicker && <MapPicker initialAddress={eventLocation} onConfirm={handleUpdateLocation} onClose={() => setShowMapPicker(false)} />}
        {backButton}
        <h2 className="break-words text-xl font-extrabold text-blue-900 sm:text-2xl">{activity.title}</h2>
        <p className="mt-1 text-sm text-gray-500">簽到管理・活動編號 {eventId}</p>
        <EventDashboard eventId={eventId} />
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl bg-white p-5 text-center shadow-xl sm:p-6">
            <h3 className="mb-4 text-lg font-bold text-gray-700">活動簽到碼</h3>
            <div className="mx-auto mb-4 w-full max-w-[240px] rounded-xl border-4 border-blue-100 bg-white p-2">
              <QRCode value={currentCode} size={256} style={{ height: 'auto', maxWidth: '100%', width: '100%' }} viewBox="0 0 256 256" />
            </div>
            <div className="mb-2 font-mono text-3xl font-bold tracking-widest text-blue-600">{currentCode}</div>
            <p className="mb-4 text-xs text-gray-500">
              每 5–12 秒隨機自動更新{secondsLeft !== null ? `・${secondsLeft} 秒後更新` : ''}
            </p>
            <div className="mb-4 flex items-center justify-center gap-2 rounded-lg bg-green-50 py-2 font-bold text-green-700"><CheckCircle size={20} /> 已簽到：{attendeeCount} 人</div>
            <button type="button" onClick={() => manualRotateRef.current()} className="mb-3 flex w-full justify-center gap-2 rounded-xl bg-blue-600 py-3 font-bold text-white hover:bg-blue-700"><RefreshCw /> 立即更新簽到碼</button>
            <button type="button" onClick={() => setShowMapPicker(true)} className="mb-2 flex w-full justify-center gap-2 rounded-xl border-2 border-blue-100 bg-white py-3 font-bold text-blue-600 hover:bg-blue-50"><MapIcon size={20} /> 設定簽到地點</button>
            <div className="break-words text-xs text-gray-400">目前地點：{eventLocation}</div>
          </div>
          <div className="space-y-6">
            <div className={`rounded-2xl p-5 text-left text-sm shadow-xl sm:p-6 ${bluetoothCheckInRequired ? 'bg-blue-50 text-blue-800' : 'bg-white text-gray-600'}`}>
              <h3 className="mb-3 text-lg font-bold text-gray-700">簽到驗證設定</h3>
              <label className="flex items-center gap-2 font-bold">
                <input
                  type="checkbox"
                  checked={bluetoothCheckInRequired}
                  onChange={event => {
                    const enabled = event.target.checked;
                    setBluetoothCheckInRequired(enabled);
                    if (enabled && !bluetoothBeaconName && !bluetoothServiceUuid) setBluetoothBeaconName('UniPass-CheckIn');
                  }}
                  className="h-4 w-4"
                />
                簽到必須通過藍牙驗證
              </label>
              {bluetoothCheckInRequired && (
                <div className="mt-3 space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-bold">藍牙設備名稱</label>
                    <input value={bluetoothBeaconName} onChange={event => setBluetoothBeaconName(event.target.value)} className="w-full rounded-lg border p-2 text-sm" placeholder="預設 UniPass-CheckIn，可自行修改" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold">Bluetooth Service UUID (選填)</label>
                    <input value={bluetoothServiceUuid} onChange={event => setBluetoothServiceUuid(event.target.value)} className="w-full rounded-lg border p-2 text-sm" placeholder="確認信標規格後輸入 UUID" />
                  </div>
                  <p className="text-xs">儲存後，學生必須完成 GPS、簽到碼及此活動藍牙設備驗證。</p>
                </div>
              )}
              <button
                type="button"
                onClick={() => void handleSaveBluetoothSettings()}
                disabled={isSavingBluetoothSettings}
                className="mt-4 w-full rounded-lg bg-blue-600 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:bg-gray-400"
              >
                {isSavingBluetoothSettings ? '儲存中...' : '儲存簽到設定'}
              </button>
            </div>
            <div className="rounded-2xl bg-white p-5 shadow-xl sm:p-6">
              <h3 className="mb-3 text-lg font-bold text-gray-700">人工補登</h3>
              {!showManualInput ? (
                <button type="button" onClick={() => setShowManualInput(true)} className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 py-3 text-sm font-bold text-gray-500 hover:border-blue-300 hover:text-blue-600"><Keyboard size={16} /> 輸入學號補登簽到</button>
              ) : (
                <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); handleManualCheckIn(); }}>
                  <input type="text" placeholder="學號" value={manualStudentId} onChange={(e) => setManualStudentId(e.target.value)} className="min-w-0 flex-1 rounded-lg border p-2 text-center font-mono" autoFocus />
                  <button type="submit" className="shrink-0 rounded-lg bg-green-600 px-4 font-bold text-white">確認</button>
                  <button type="button" onClick={() => setShowManualInput(false)} aria-label="取消補登" className="shrink-0"><X className="text-gray-400" /></button>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md p-4 sm:p-6">
      {backButton}
      <div className="relative rounded-2xl bg-white p-5 shadow-xl sm:p-6">
        {showScanner && (
          <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black p-4">
            <div className="relative aspect-square w-full max-w-sm bg-black"><Scanner onScan={handleScan} /><div className="pointer-events-none absolute inset-0 m-8 animate-pulse rounded-lg border-4 border-blue-500/50"></div></div>
            <button type="button" onClick={() => setShowScanner(false)} className="mt-8 flex gap-2 rounded-full bg-white px-6 py-2 font-bold"><X /> 關閉</button>
          </div>
        )}
        <h2 className="mb-1 break-words text-lg font-extrabold text-blue-900">{activity.title}</h2>
        <p className="mb-5 text-sm text-gray-500">依序完成定位{bluetoothCheckInRequired ? '、藍牙驗證' : ''}與輸入簽到碼</p>
        <div className="space-y-4">
          <button type="button" onClick={handleGetGPS} className={`flex w-full justify-center gap-2 rounded-xl border-2 py-3 font-bold ${location ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-300 text-gray-500'}`}><MapPin /> {location ? '定位完成（點此重新定位）' : '1. 點擊取得位置'}</button>
          {bluetoothCheckInRequired && (
            <button
              type="button"
              onClick={() => void handleVerifyBluetooth()}
              disabled={isVerifyingBluetooth}
              className={`flex w-full justify-center gap-2 rounded-xl border-2 py-3 font-bold disabled:opacity-60 ${bluetoothProof ? 'border-green-500 bg-green-50 text-green-700' : 'border-blue-300 bg-blue-50 text-blue-700'}`}
            >
              <Bluetooth /> {isVerifyingBluetooth ? '正在驗證藍牙設備...' : bluetoothProof ? '藍牙設備驗證完成' : '2. 連線驗證活動藍牙設備'}
            </button>
          )}
          <div className="flex gap-2">
            <input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="輸入 6 位簽到碼" value={inputCode} onChange={(e) => setInputCode(e.target.value.replace(/\D/g, '').slice(0, 6))} className="min-w-0 flex-1 rounded-xl border-2 py-2 text-center font-mono text-xl tracking-widest" aria-label="簽到碼" />
            <button type="button" onClick={() => setShowScanner(true)} className="shrink-0 rounded-xl bg-blue-600 p-3 text-white" aria-label="掃描 QR Code"><Camera /></button>
          </div>
          <p className="text-xs text-gray-400">主辦方的簽到碼每 5–12 秒會更新一次，掃描後請盡快送出。</p>
          <button type="button" onClick={handleSubmit} disabled={isSubmitting || !location || inputCode.length !== 6 || isVerifyingBluetooth || (bluetoothCheckInRequired && !bluetoothProof)} className="flex w-full justify-center gap-2 rounded-xl bg-green-600 py-3 font-bold text-white disabled:bg-gray-300"><CheckCircle /> {isSubmitting ? '簽到中...' : '簽到'}</button>
          {statusMsg && <div className="rounded-lg bg-gray-100 p-2 text-center text-sm font-bold">{statusMsg}</div>}
        </div>
      </div>
    </div>
  );
}

// --- 活動歷程（履歷）---
const ARCHIVED_HISTORY = [
  { id: 'archived-101', title: '北商大高中生資訊體驗營', date: '2024/07/15' },
  { id: 'archived-102', title: '114學年度五專優先免試入學', date: '2025/05/20' },
  { id: 'archived-103', title: '114學年度新生入學輔導', date: '2025/09/05' },
];

function ActivityPortfolio({ user, checkedInActivities, highlightEventId, onBack, onViewDetail }: {
  user: AppUser;
  checkedInActivities: Activity[];
  highlightEventId?: number | null;
  onBack: () => void;
  onViewDetail: (id: number) => void;
}) {
  // 系統匯入的歷年紀錄只屬於在校生帳號
  const archived = user.role === '資管系學生' ? ARCHIVED_HISTORY : [];
  const items = [
    ...archived.map(item => ({ key: item.id, eventId: null as number | null, title: item.title, date: item.date, archived: true })),
    ...checkedInActivities.map(activity => ({ key: `event-${activity.id}`, eventId: activity.id, title: activity.title, date: firstDate(activity.dateRange), archived: false })),
  ];
  return (
    <div className="mx-auto w-full max-w-3xl animate-fade-in">
      <div className="overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="relative overflow-hidden bg-blue-900 p-5 text-white sm:p-6">
          <h2 className="flex items-center gap-2 text-xl font-bold sm:text-2xl"><History /> 活動歷程檔案</h2>
          <p className="mt-1 text-sm text-blue-200">{user.name} 的完整學習軌跡（共 {items.length} 筆簽到紀錄）</p>
        </div>
        <div className="min-h-[320px] bg-slate-50 p-4 sm:p-6">
          {items.length === 0 ? (
            <div className="py-16 text-center text-gray-400">
              <History size={40} className="mx-auto mb-3 opacity-40" />
              尚無簽到紀錄。完成活動簽到後，紀錄會自動出現在這裡。
            </div>
          ) : (
            <div className="relative space-y-6 before:absolute before:inset-0 before:ml-5 before:h-full before:w-0.5 before:-translate-x-px before:bg-gradient-to-b before:from-transparent before:via-slate-300 before:to-transparent md:before:mx-auto md:before:translate-x-0">
              {items.map((item) => {
                const isHighlight = item.eventId !== null && item.eventId === highlightEventId;
                const card = (
                  <>
                    <div className="mb-1 flex items-center justify-between gap-2"><span className="font-bold text-slate-900">{item.title}</span></div>
                    <div className="mb-2 flex items-center gap-2 text-xs text-slate-500"><Calendar size={12} /> {item.date}</div>
                    <div className="flex items-center gap-2 text-sm font-bold text-blue-600">已簽到{item.archived && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">系統匯入</span>}</div>
                  </>
                );
                const cardClass = `w-[calc(100%-4rem)] rounded-xl border bg-white p-4 text-left shadow-sm transition-all md:w-[calc(50%-2.5rem)] ${isHighlight ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200'}`;
                return (
                  <div key={item.key} className="group relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse">
                    <div className={`z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-4 border-slate-50 shadow md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 ${isHighlight ? 'animate-pulse bg-blue-600' : 'bg-green-500'}`}>
                      <CheckCircle size={18} className="text-white" />
                    </div>
                    {item.eventId !== null ? (
                      <button type="button" onClick={() => onViewDetail(item.eventId as number)} className={`${cardClass} cursor-pointer hover:shadow-md`}>{card}</button>
                    ) : (
                      <div className={cardClass}>{card}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="border-t border-gray-100 bg-white p-4"><button type="button" onClick={onBack} className="w-full rounded-xl bg-gray-100 py-3 font-bold text-gray-600 transition-colors hover:bg-gray-200">返回我的活動</button></div>
      </div>
    </div>
  );
}

// --- 星等評分 ---
function StarRating({ value, onChange, size = 32, disabled = false }: { value: number; onChange: (score: number) => void; size?: number; disabled?: boolean }) {
  return (
    <div className="flex justify-center gap-1 sm:gap-2">
      {[1, 2, 3, 4, 5].map((star) => (
        <button key={star} type="button" disabled={disabled} onClick={() => onChange(star)} aria-label={`${star} 顆星`} className={`transition-colors disabled:cursor-not-allowed ${value >= star ? 'text-amber-400' : 'text-gray-300 hover:text-amber-400'}`}>
          <Star size={size} fill="currentColor" />
        </button>
      ))}
    </div>
  );
}

async function submitEventRating(eventId: number, user: AppUser, rating: number, feedback?: string): Promise<void> {
  const response = await fetch(`${API_ORIGIN}/api/events/${eventId}/rate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studentId: getStudentId(user), rating, ...(feedback !== undefined ? { feedback } : {}) }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.success) throw new Error(result.error || '評分失敗');
}

// --- 活動詳情 ---
function ActivityDetail({ activity, user, registrationState, onBack, onRegister, isRegistering, notice, onDismissNotice, onCheckIn }: {
  activity: Activity;
  user: AppUser;
  registrationState: RegistrationState;
  onBack: () => void;
  onRegister: () => void;
  isRegistering: boolean;
  notice: Notice | null;
  onDismissNotice: () => void;
  onCheckIn: () => void;
}) {
  const [ratingScore, setRatingScore] = useState(0);
  const [ratingMessage, setRatingMessage] = useState<Notice | null>(null);
  const [isRating, setIsRating] = useState(false);
  const isGuest = user.role === '訪客';
  const canRegisterOnline = hasDatabaseRecord(user);

  const submitRating = async (score: number) => {
    setRatingScore(score);
    setIsRating(true);
    try {
      await submitEventRating(activity.id, user, score);
      setRatingMessage({ type: 'success', text: '感謝您的評分！數據已即時傳送至主辦方戰情室。' });
    } catch (error) {
      setRatingMessage({ type: 'error', text: (error as Error).message });
    } finally {
      setIsRating(false);
    }
  };

  const infoRow = (icon: ReactNode, label: string, value: ReactNode) => (
    <div>
      <h3 className="mb-1 flex items-center gap-2 font-bold text-black">{icon} {label}</h3>
      <div className="break-words pl-7 leading-relaxed text-gray-600">{value}</div>
    </div>
  );

  let action: ReactNode;
  if (activity.registered) {
    action = activity.checkedIn ? (
      <div className="mx-auto w-full max-w-md rounded-xl border border-gray-200 bg-gray-50 p-5 sm:p-6">
        <p className="mb-3 flex items-center justify-center gap-2 font-bold text-green-700"><BadgeCheck size={20} /> 您已完成簽到</p>
        <h3 className="mb-3 font-bold text-gray-700">您對這場活動滿意嗎？</h3>
        <StarRating value={ratingScore} onChange={(score) => void submitRating(score)} disabled={isRating} />
        <p className="mt-3 text-xs text-gray-400">點擊星星為活動評分，可至「我的活動」留下文字回饋</p>
        {ratingMessage && <div className="mt-4"><NoticeBanner notice={ratingMessage} /></div>}
      </div>
    ) : (
      <div className="mx-auto w-full max-w-md rounded-xl border border-green-200 bg-green-50 p-5 sm:p-6">
        <p className="mb-2 flex items-center justify-center gap-2 font-bold text-green-700"><CheckCircle size={20} /> 您已完成報名</p>
        <p className="mb-4 text-sm text-gray-600">活動當天請掃描主辦方的 QR Code 完成簽到。</p>
        <button type="button" onClick={onCheckIn} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 font-bold text-white hover:bg-blue-700"><QrCode size={18} /> 前往簽到</button>
      </div>
    );
  } else if (isGuest) {
    action = <p className="mx-auto max-w-md rounded-xl bg-gray-100 px-5 py-4 font-bold text-gray-500">訪客僅能瀏覽活動，報名請以學生帳號登入</p>;
  } else if (!canRegisterOnline) {
    action = <p className="mx-auto max-w-md rounded-xl bg-gray-100 px-5 py-4 font-bold text-gray-500">此帳號沒有學生資料，無法線上報名</p>;
  } else if (registrationState.key === 'open') {
    action = (
      <button type="button" onClick={onRegister} disabled={isRegistering} className="w-full max-w-sm rounded-lg bg-blue-600 px-10 py-3 text-lg font-bold text-white shadow-lg hover:bg-blue-700 disabled:bg-gray-400 sm:w-auto">
        {isRegistering ? (activity.fee === 0 ? '報名處理中...' : '建立付款訂單中...') : (activity.fee === 0 ? '我要免費報名' : '我要報名並繳費')}
      </button>
    );
  } else {
    action = <button type="button" disabled className="w-full max-w-sm cursor-not-allowed rounded-lg bg-gray-300 px-10 py-3 text-lg font-bold text-gray-500 sm:w-auto">{registrationState.label}</button>;
  }

  return (
    <div className="mx-auto min-h-screen w-full max-w-5xl animate-fade-in bg-white p-4 sm:p-6">
      <button type="button" onClick={onBack} className="mb-6 flex items-center gap-1 rounded bg-pink-500 px-4 py-1.5 text-sm font-bold text-white hover:bg-pink-600"><ChevronLeft size={16} /> 上一頁</button>
      {notice && <div className="mb-6"><NoticeBanner notice={notice} onClose={onDismissNotice} /></div>}
      <h1 className="mb-3 break-words text-center text-2xl font-bold text-red-600 sm:text-3xl">{activity.title}</h1>
      <div className="mb-8 flex flex-wrap justify-center gap-2">
        <StatusBadge state={registrationState} />
        {activity.registered && <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">{activity.checkedIn ? '已簽到' : '已報名'}</span>}
      </div>
      <div className="space-y-6 text-gray-700">
        {infoRow(<FileText size={20} />, '活動內容：', activity.description || '主辦單位尚未提供活動說明')}
        {infoRow(<Calendar size={20} />, '報名時間：', activity.regRange)}
        {infoRow(<Clock size={20} />, '活動時間：', activity.dateRange || '未設定')}
        {infoRow(<MapPin size={20} />, '活動地點：', `${activity.campus}・${activity.location}`)}
        {infoRow(<Users size={20} />, '報名人數：', `上限 ${activity.capacity} 人，目前已有 ${activity.currentReg} 人報名`)}
        {infoRow(<User size={20} />, '報名對象：', activity.target)}
        {infoRow(<span className="w-5 text-center font-bold">$</span>, '報名費用：', <span className="font-bold text-red-600">{activity.fee === 0 ? '免費' : `NT$ ${activity.fee}`}</span>)}
      </div>

      <div className="my-8 border-t border-gray-200 pt-6">
        <h4 className="mb-4 flex items-center gap-2 text-sm font-bold text-gray-500"><House size={16} /> 聯絡資訊</h4>
        <div className="grid grid-cols-1 gap-3 pl-2 text-sm text-gray-600 md:grid-cols-2">
          <div className="flex flex-wrap gap-x-2"><span className="font-bold">主辦單位：</span>{activity.organizer}</div>
          <div className="flex flex-wrap gap-x-2"><span className="font-bold">聯絡人：</span>{activity.contactPerson}</div>
          <div className="flex flex-wrap gap-x-2"><span className="font-bold">聯絡電話：</span><a href={`tel:${activity.contactPhone}`} className="text-blue-500 hover:underline">{activity.contactPhone}</a></div>
          <div className="flex flex-wrap gap-x-2"><span className="font-bold">E-mail：</span><a href={`mailto:${activity.contactEmail}`} className="break-all text-blue-500 hover:underline">{activity.contactEmail}</a></div>
        </div>
      </div>

      <div className="mb-10 mt-10 text-center">{action}</div>
    </div>
  );
}

// --- 評分與評論彈跳視窗 ---
function RatingModal({ activity, user, onClose }: { activity: Activity; user: AppUser; onClose: () => void }) {
  const [score, setScore] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (score === 0) { setError('請至少給予一顆星！'); return; }
    setIsSubmitting(true);
    setError('');
    try {
      await submitEventRating(activity.id, user, score, feedback);
      alert('感謝您的評分與回饋！');
      onClose();
    } catch (submitError) {
      setError((submitError as Error).message || '連線失敗，請檢查網路狀態');
    } finally {
      setIsSubmitting(false);
    }
  };
  return (
    <ModalShell onClose={onClose} maxWidth="max-w-sm" label="活動評分與回饋">
      <div className="p-5 sm:p-6">
        <h2 className="mb-1 text-center text-xl font-bold text-gray-800">活動評分與回饋</h2>
        <p className="mb-4 break-words text-center text-sm text-gray-500">{activity.title}</p>
        <div className="mb-6"><StarRating value={score} onChange={setScore} size={36} /></div>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="有什麼想對主辦方說的嗎？(選填)"
          className="mb-4 h-24 w-full resize-none rounded-xl border border-gray-300 p-3 focus:border-amber-400 focus:outline-none"
        />
        {error && <p className="mb-3 text-center text-sm font-bold text-red-600">{error}</p>}
        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 rounded-xl bg-gray-100 py-2 font-bold text-gray-600 hover:bg-gray-200">取消</button>
          <button type="button" onClick={() => void handleSubmit()} disabled={isSubmitting} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 py-2 font-bold text-white hover:bg-amber-600 disabled:bg-gray-400">{isSubmitting ? '送出中...' : '送出評分'}</button>
        </div>
      </div>
    </ModalShell>
  );
}

// --- ActivityPlatform (活動主介面) ---
type PlatformTab = 'market' | 'my_events' | 'history';

function ActivityPlatform({ user, onBack, initialEventId, initialTab = 'market', initialNotice = null }: {
  user: AppUser;
  onBack: () => void;
  initialEventId?: number | null;
  initialTab?: PlatformTab;
  initialNotice?: Notice | null;
}) {
  const [activeTab, setActiveTab] = useState<PlatformTab>(initialTab);
  const [rawActivities, setRawActivities] = useState<Omit<Activity, 'registered' | 'checkedIn'>[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [registrations, setRegistrations] = useState<RegistrationMap>({});
  const [checkIn, setCheckIn] = useState<{ eventId: number; mode: 'host' | 'guest' } | null>(null);
  const [historyHighlightId, setHistoryHighlightId] = useState<number | null>(null);
  const [viewingEventId, setViewingEventId] = useState<number | null>(initialEventId ?? null);
  const [detailNotice, setDetailNotice] = useState<{ eventId: number; notice: Notice } | null>(
    initialEventId && initialNotice ? { eventId: initialEventId, notice: initialNotice } : null,
  );
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null);
  const [managingActivity, setManagingActivity] = useState<Activity | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [ratingActivity, setRatingActivity] = useState<Activity | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const currentStudentId = getStudentId(user);
  const isTeacher = user.role === '教師';
  const [searchTerm, setSearchTerm] = useState('');
  const [filterOrganizer, setFilterOrganizer] = useState('全部');
  const [filterTarget, setFilterTarget] = useState('全部');
  const [filterCategory, setFilterCategory] = useState('全部');
  const [filterCampus, setFilterCampus] = useState('全部');

  useEffect(() => {
    const handleEvents = (data: { events: ServerEvent[] }) => {
      setRawActivities(data.events.map(mapServerEvent));
      setIsLoaded(true);
      socket.emit('get_user_registrations', { studentId: currentStudentId });
    };
    const handleRegistrations = (data: { registrationMap: RegistrationMap }) => setRegistrations(data.registrationMap);
    const handleForceRefresh = (data: { studentId: string; eventId: number; source?: string }) => {
      if (data.studentId !== currentStudentId) return;
      socket.emit('get_user_registrations', { studentId: currentStudentId });
      if (data.source === 'host') {
        alert('🔔 系統通知：主辦方已協助您完成報名/簽到！');
        setActiveTab('my_events');
      }
    };
    socket.on('all_events_data', handleEvents);
    socket.on('user_registrations_sync', handleRegistrations);
    socket.on('force_refresh_registrations', handleForceRefresh);
    socket.emit('fetch_all_events');
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      socket.off('all_events_data', handleEvents);
      socket.off('user_registrations_sync', handleRegistrations);
      socket.off('force_refresh_registrations', handleForceRefresh);
      clearInterval(clock);
    };
  }, [currentStudentId]);

  const activities: Activity[] = useMemo(() => rawActivities.map(act => ({
    ...act,
    registered: registrations[act.id]?.registered || false,
    checkedIn: registrations[act.id]?.checkedIn || false,
  })), [rawActivities, registrations]);

  const optionList = (base: string[], values: string[]) => [...new Set([
    ...base.filter(option => option !== '全部'),
    ...values.filter(value => value && value !== '全部'),
  ])];
  const organizerFilterOptions = optionList(ORGANIZERS, activities.map(activity => activity.organizer));
  const targetFilterOptions = optionList(TARGETS, activities.map(activity => activity.target));
  const categoryFilterOptions = optionList(CATEGORIES, activities.map(activity => activity.category));

  const keyword = searchTerm.trim().toLowerCase();
  const filteredActivities = activities.filter(act => {
    const matchSearch = !keyword || [act.title, act.organizer, act.description].join(' ').toLowerCase().includes(keyword);
    const matchOrg = filterOrganizer === '全部' || act.organizer === filterOrganizer;
    const matchTarget = filterTarget === '全部' || act.target === filterTarget || act.target === '全部';
    const matchCat = filterCategory === '全部' || act.category === filterCategory;
    const matchCampus = filterCampus === '全部' || act.campus === filterCampus;
    return matchSearch && matchOrg && matchTarget && matchCat && matchCampus;
  });
  const hasActiveFilter = Boolean(keyword) || [filterOrganizer, filterTarget, filterCategory, filterCampus].some(value => value !== '全部');
  const myActivities = activities.filter(a => a.registered);
  const checkedInActivities = activities.filter(a => a.checkedIn);

  const resetFilters = () => {
    setSearchTerm('');
    setFilterOrganizer('全部');
    setFilterTarget('全部');
    setFilterCategory('全部');
    setFilterCampus('全部');
  };

  const handleDeleteActivity = async (activity: Activity) => {
    if (!window.confirm(`確定要從活動首頁刪除「${activity.title}」嗎？活動和報名紀錄會保留，但不再顯示於首頁。`)) return;
    try {
      const response = await fetch(`${API_ORIGIN}/api/events/${activity.id}`, {
        method: 'DELETE',
        headers: roleRequestHeaders(user.role),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || '刪除活動失敗');
      alert('活動已從首頁移除，原有活動及報名資料已保留。');
    } catch (error) {
      console.error('刪除活動失敗:', error);
      alert(`刪除活動失敗：${(error as Error).message || '請稍後再試'}`);
    }
  };

  const handleRegister = async (activity: Activity) => {
    if (isRegistering) return;
    const fee = activity.fee;
    const confirmation = fee === 0
      ? `確定要免費報名「${activity.title}」嗎？`
      : `確定要報名「${activity.title}」並前往繳費嗎？\n報名費：NT$ ${fee}`;
    if (!window.confirm(confirmation)) return;
    setIsRegistering(true);
    try {
      const response = await fetch(`${API_ORIGIN}/api/create-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: activity.id,
          studentId: currentStudentId,
          email: String(user.email || `${currentStudentId}@ntub.edu.tw`),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) throw new Error(payload.message || '建立報名失敗');
      if (payload.free) {
        setRegistrations(previous => ({ ...previous, [activity.id]: { registered: true, checkedIn: false } }));
        setDetailNotice({ eventId: activity.id, notice: { type: 'success', text: '報名成功！活動當天請記得完成簽到。' } });
        setIsRegistering(false);
        return;
      }
      if (!payload.data) throw new Error(payload.message || '建立付款訂單失敗');
      // 付款會離開本站，先確保登入狀態已保存，藍新付款完成後才能回到這個活動頁
      saveSessionUser(user);
      const paymentForm = document.createElement('form');
      paymentForm.method = 'POST';
      paymentForm.action = payload.data.action || 'https://ccore.newebpay.com/MPG/mpg_gateway';
      paymentForm.style.display = 'none';
      const fields: Record<string, unknown> = { MerchantID: payload.data.MerchantID, TradeInfo: payload.data.TradeInfo, TradeSha: payload.data.TradeSha, Version: payload.data.Version || '2.0' };
      Object.entries(fields).forEach(([name, value]) => {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = String(value ?? '');
        paymentForm.appendChild(input);
      });
      document.body.appendChild(paymentForm);
      paymentForm.submit();
    } catch (error) {
      console.error('報名失敗:', error);
      setDetailNotice({ eventId: activity.id, notice: { type: 'error', text: `無法完成報名：${(error as Error).message || '請稍後再試'}` } });
      setIsRegistering(false);
      socket.emit('fetch_all_events');
    }
  };

  const openDetail = (id: number) => {
    setViewingEventId(id);
    window.scrollTo({ top: 0 });
  };

  const handleCheckedIn = useCallback((eventId: number) => {
    setCheckIn(null);
    setViewingEventId(null);
    setHistoryHighlightId(eventId);
    setActiveTab('history');
    socket.emit('get_user_registrations', { studentId: currentStudentId });
  }, [currentStudentId]);

  const checkInActivity = checkIn ? activities.find(a => a.id === checkIn.eventId) : undefined;
  if (checkIn && checkInActivity) {
    return <CheckInCore onBack={() => setCheckIn(null)} user={user} activity={checkInActivity} onCheckedIn={handleCheckedIn} mode={checkIn.mode} />;
  }

  if (viewingEventId) {
    const activity = activities.find(a => a.id === viewingEventId);
    if (!activity) {
      return (
        <div className="mx-auto min-h-screen w-full max-w-5xl bg-white p-6 text-center">
          <button type="button" onClick={() => setViewingEventId(null)} className="mb-6 flex items-center gap-1 rounded bg-pink-500 px-4 py-1.5 text-sm font-bold text-white hover:bg-pink-600"><ChevronLeft size={16} /> 上一頁</button>
          <p className="py-16 text-gray-500">{isLoaded ? '找不到此活動，可能已被主辦單位移除。' : '活動資料載入中...'}</p>
        </div>
      );
    }
    return (
      <ActivityDetail
        activity={activity}
        user={user}
        registrationState={getRegistrationState(activity, now)}
        onBack={() => setViewingEventId(null)}
        onRegister={() => void handleRegister(activity)}
        isRegistering={isRegistering}
        notice={detailNotice?.eventId === activity.id ? detailNotice.notice : null}
        onDismissNotice={() => setDetailNotice(null)}
        onCheckIn={() => setCheckIn({ eventId: activity.id, mode: 'guest' })}
      />
    );
  }

  const tabButton = (tab: PlatformTab, label: ReactNode) => (
    <button type="button" onClick={() => setActiveTab(tab)} className={`whitespace-nowrap px-2 py-2 text-sm font-bold transition-colors sm:px-4 sm:text-base ${activeTab === tab ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}>{label}</button>
  );
  const selectClass = 'w-full rounded border border-gray-300 bg-white px-2 py-2 text-sm text-gray-600';

  const teacherActions = (act: Activity) => (
    <div className="flex flex-wrap gap-2 md:justify-center">
      <button type="button" onClick={() => setCheckIn({ eventId: act.id, mode: 'host' })} className="flex items-center gap-1 rounded bg-indigo-600 px-2 py-1 text-xs font-bold text-white hover:bg-indigo-700"><QrCode size={12} />簽到管理</button>
      <button type="button" onClick={() => setEditingActivity(act)} className="flex items-center gap-1 rounded bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700 hover:bg-blue-100"><Pencil size={12} />編輯</button>
      <button type="button" onClick={() => setManagingActivity(act)} className="flex items-center gap-1 rounded bg-purple-50 px-2 py-1 text-xs font-bold text-purple-700 hover:bg-purple-100"><Users size={12} />報名名單</button>
      <button type="button" onClick={() => void handleDeleteActivity(act)} className="flex items-center gap-1 rounded bg-red-50 px-2 py-1 text-xs font-bold text-red-700 hover:bg-red-100"><Trash2 size={12} />刪除</button>
    </div>
  );

  const myEventActions = (act: Activity) => (
    <div className="flex flex-wrap gap-2 md:justify-center">
      {isTeacher && (
        <button type="button" onClick={() => setCheckIn({ eventId: act.id, mode: 'host' })} className="flex items-center gap-1 rounded bg-purple-600 px-3 py-1 text-xs text-white hover:bg-purple-700"><Settings size={12} /> 管理</button>
      )}
      {act.checkedIn ? (
        <>
          <span className="flex items-center gap-1 px-2 py-1 text-xs font-bold text-green-700"><BadgeCheck size={12} /> 已簽到</span>
          <button type="button" onClick={() => { setHistoryHighlightId(act.id); setActiveTab('history'); }} className="flex items-center gap-1 rounded bg-green-500 px-3 py-1 text-xs text-white hover:bg-green-600"><History size={12} /> 歷程</button>
          <button type="button" onClick={() => setRatingActivity(act)} className="flex items-center gap-1 rounded bg-amber-500 px-3 py-1 text-xs text-white hover:bg-amber-600"><Star size={12} /> 評分</button>
        </>
      ) : (
        <button type="button" onClick={() => setCheckIn({ eventId: act.id, mode: 'guest' })} className="flex items-center gap-1 rounded bg-blue-500 px-3 py-1 text-xs text-white hover:bg-blue-600"><QrCode size={12} /> 簽到</button>
      )}
    </div>
  );

  return (
    <div className="relative flex min-h-screen w-full max-w-6xl flex-col bg-white">
      {showCreateModal && <CreateEventModal onClose={() => setShowCreateModal(false)} role={user.role} />}
      {editingActivity && <CreateEventModal activity={editingActivity} onClose={() => setEditingActivity(null)} role={user.role} />}
      {managingActivity && <EventRegistrationsModal activity={managingActivity} role={user.role} onClose={() => setManagingActivity(null)} onChanged={() => socket.emit('fetch_all_events')} />}
      {ratingActivity && <RatingModal activity={ratingActivity} user={user} onClose={() => setRatingActivity(null)} />}

      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-gray-200 bg-white px-2 py-2 shadow-sm sm:px-4">
        <button type="button" onClick={onBack} className="flex shrink-0 items-center rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-800" aria-label="返回首頁"><ChevronLeft /><span className="hidden text-sm font-bold sm:inline">首頁</span></button>
        <div className="flex flex-1 justify-center gap-1 overflow-x-auto sm:gap-4">
          {tabButton('market', '活動首頁')}
          {tabButton('my_events', <>我的活動{myActivities.length > 0 && <span className="ml-1 rounded-full bg-blue-100 px-1.5 text-xs text-blue-700">{myActivities.length}</span>}</>)}
          {tabButton('history', <span className="inline-flex items-center gap-1"><History size={16} />活動歷程</span>)}
        </div>
        <div className="w-10 shrink-0 sm:w-20" />
      </div>

      <div className="p-4 sm:p-6">
        {activeTab === 'market' && (
          <div className="animate-fade-in">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="border-l-4 border-gray-400 pl-2 text-lg font-bold text-gray-700">活動查詢條件</h2>
              {isTeacher && (
                <button type="button" onClick={() => setShowCreateModal(true)} className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-bold text-white hover:bg-blue-700">
                  <PlusCircle size={18} /> 新增活動
                </button>
              )}
            </div>
            <div className="mb-4 border-t border-gray-200"></div>
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:flex lg:flex-wrap lg:items-center">
              <label className="relative col-span-2 sm:col-span-3 lg:w-64">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="search" placeholder="搜尋活動名稱、主辦單位" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full rounded border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-blue-400 focus:outline-none" aria-label="搜尋活動" />
              </label>
              <select aria-label="主辦單位" value={filterOrganizer} onChange={(e) => setFilterOrganizer(e.target.value)} className={`${selectClass} lg:w-auto`}><option value="全部">全部主辦單位</option>{organizerFilterOptions.map(org => <option key={org} value={org}>{org}</option>)}</select>
              <select aria-label="對象" value={filterTarget} onChange={(e) => setFilterTarget(e.target.value)} className={`${selectClass} lg:w-auto`}><option value="全部">全部對象</option>{targetFilterOptions.map(t => <option key={t} value={t}>{t}</option>)}</select>
              <select aria-label="類別" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className={`${selectClass} lg:w-auto`}><option value="全部">全部類別</option>{categoryFilterOptions.map(c => <option key={c} value={c}>{c}</option>)}</select>
              <select aria-label="校區" value={filterCampus} onChange={(e) => setFilterCampus(e.target.value)} className={`${selectClass} lg:w-auto`}>{CAMPUSES.map(c => <option key={c} value={c}>{c === '全部' ? '全部校區' : c}</option>)}</select>
              {hasActiveFilter && <button type="button" onClick={resetFilters} className="col-span-2 rounded border border-gray-300 px-3 py-2 text-sm font-bold text-gray-600 hover:bg-gray-50 sm:col-span-1 lg:w-auto">清除條件</button>}
            </div>

            {/* 手機／平板：卡片列表 */}
            <div className="space-y-3 md:hidden">
              {filteredActivities.map(act => {
                const state = getRegistrationState(act, now);
                return (
                  <div key={act.id} className="rounded-xl border border-gray-200 p-4 shadow-sm">
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <button type="button" onClick={() => openDetail(act.id)} className="min-w-0 text-left font-bold text-blue-600 hover:underline">{act.title}</button>
                      {act.registered ? <span className="shrink-0 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">已報名</span> : <StatusBadge state={state} />}
                    </div>
                    <dl className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1 text-sm text-gray-600">
                      <dt className="text-gray-400">活動日期</dt><dd>{firstDate(act.dateRange)}</dd>
                      <dt className="text-gray-400">校區</dt><dd>{act.campus}</dd>
                      <dt className="text-gray-400">主辦單位</dt><dd className="break-words">{act.organizer}</dd>
                      <dt className="text-gray-400">報名期間</dt><dd className="break-words">{act.regRange}</dd>
                      <dt className="text-gray-400">對象</dt><dd>{act.target}</dd>
                      <dt className="text-gray-400">費用</dt><dd>{act.fee === 0 ? '免費' : `NT$ ${act.fee}`}</dd>
                    </dl>
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
                      <button type="button" onClick={() => openDetail(act.id)} className="rounded bg-blue-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-600">{!act.registered && state.key === 'open' ? '詳情／報名' : '查看詳情'}</button>
                      {isTeacher && teacherActions(act)}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 桌機：表格 */}
            <div className="hidden overflow-x-auto rounded-t-md border border-gray-200 md:block">
              <table className="w-full text-left text-sm text-gray-600">
                <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-700">
                  <tr>
                    <th className="px-4 py-3">活動名稱</th><th className="whitespace-nowrap px-4 py-3">舉辦校區</th><th className="whitespace-nowrap px-4 py-3">活動日期</th><th className="px-4 py-3">主辦單位</th><th className="px-4 py-3">報名起迄</th><th className="whitespace-nowrap px-4 py-3">對象</th><th className="whitespace-nowrap px-4 py-3 text-center">我要報名</th>
                    {isTeacher && <th className="whitespace-nowrap px-4 py-3 text-center">活動管理</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredActivities.map(act => {
                    const state = getRegistrationState(act, now);
                    return (
                      <tr key={act.id} className="border-b bg-white hover:bg-gray-50">
                        <td className="min-w-[10rem] px-4 py-4 font-medium"><button type="button" className="text-left text-blue-600 hover:underline" onClick={() => openDetail(act.id)}>{act.title}</button></td>
                        <td className="whitespace-nowrap px-4 py-4">{act.campus}</td>
                        <td className="whitespace-nowrap px-4 py-4">{firstDate(act.dateRange)}</td>
                        <td className="min-w-[6rem] px-4 py-4">{act.organizer}</td>
                        <td className="min-w-[9rem] px-4 py-4 text-xs">{act.regRange}</td>
                        <td className="whitespace-nowrap px-4 py-4">{act.target}</td>
                        <td className="px-4 py-4 text-center">
                          <div className="flex flex-col items-center gap-1.5">
                            {act.registered ? <span className="text-xs font-bold text-blue-700">已報名</span> : <StatusBadge state={state} />}
                            <button type="button" onClick={() => openDetail(act.id)} className="whitespace-nowrap rounded bg-blue-500 px-3 py-1 text-xs text-white hover:bg-blue-600">詳情</button>
                          </div>
                        </td>
                        {isTeacher && <td className="min-w-[11rem] px-4 py-3">{teacherActions(act)}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filteredActivities.length === 0 && (
              <div className="py-8 text-center text-gray-400">
                {isLoaded ? '暫無符合條件的活動' : '活動資料載入中...'}
                {hasActiveFilter && <button type="button" onClick={resetFilters} className="ml-2 font-bold text-blue-600 underline">清除條件</button>}
              </div>
            )}
          </div>
        )}

        {activeTab === 'my_events' && (
          <div className="animate-fade-in">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
              <h2 className="border-l-4 border-gray-400 pl-2 text-lg font-bold text-gray-700">我的活動</h2>
              <button type="button" onClick={() => { setHistoryHighlightId(null); setActiveTab('history'); }} className="flex items-center gap-1 rounded-lg bg-green-50 px-3 py-1.5 text-sm font-bold text-green-700 hover:bg-green-100"><History size={16} /> 查看活動歷程</button>
            </div>
            <div className="mb-6 border-t border-gray-200"></div>
            {myActivities.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 py-10 text-center text-gray-400">
                尚無報名活動
                <button type="button" onClick={() => setActiveTab('market')} className="mx-auto mt-3 block font-bold text-blue-600 underline">前往活動首頁報名</button>
              </div>
            ) : (
              <>
                <div className="space-y-3 md:hidden">
                  {myActivities.map(act => (
                    <div key={act.id} className="rounded-xl border border-gray-200 p-4 shadow-sm">
                      <button type="button" onClick={() => openDetail(act.id)} className="mb-1 text-left font-bold text-blue-600 hover:underline">{act.title}</button>
                      <p className="mb-3 text-sm text-gray-500">{firstDate(act.dateRange)}・{act.location}</p>
                      {myEventActions(act)}
                    </div>
                  ))}
                </div>
                <div className="hidden overflow-x-auto rounded-t-md border border-gray-200 md:block">
                  <table className="w-full text-left text-sm text-gray-600">
                    <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-700"><tr><th className="w-1/2 px-4 py-3">活動名稱</th><th className="px-4 py-3 text-center">活動日期</th><th className="px-4 py-3 text-center">活動管理</th></tr></thead>
                    <tbody>
                      {myActivities.map(act => (
                        <tr key={act.id} className="border-b bg-white hover:bg-gray-50">
                          <td className="px-4 py-4 font-medium"><button type="button" className="text-left text-blue-600 hover:underline" onClick={() => openDetail(act.id)}>{act.title}</button></td>
                          <td className="whitespace-nowrap px-4 py-4 text-center">{firstDate(act.dateRange)}</td>
                          <td className="px-4 py-4 text-center">{myEventActions(act)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <ActivityPortfolio
            user={user}
            checkedInActivities={checkedInActivities}
            highlightEventId={historyHighlightId}
            onBack={() => setActiveTab('my_events')}
            onViewDetail={openDetail}
          />
        )}
      </div>
    </div>
  );
}

// --- 登入畫面 ---
type LoginTab = 'student' | 'applicant' | 'teacher' | 'guest';
const LOGIN_DEFAULTS: Record<LoginTab, { id: string; password: string }> = {
  teacher: { id: 'T98765', password: '********' },
  student: { id: '115507', password: '********' },
  applicant: { id: 'A123456789', password: '********' },
  guest: { id: 'GUEST001', password: '' },
};

function LoginScreen({ onLogin }: { onLogin: (user: AppUser) => void }) {
  const [activeTab, setActiveTab] = useState<LoginTab>('student');
  const [inputId, setInputId] = useState(LOGIN_DEFAULTS.student.id);
  const [inputPwd, setInputPwd] = useState(LOGIN_DEFAULTS.student.password);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState('');
  const [showForgotPasswordModal, setShowForgotPasswordModal] = useState(false);

  const switchTab = (tab: LoginTab) => {
    setActiveTab(tab);
    setInputId(LOGIN_DEFAULTS[tab].id);
    setInputPwd(LOGIN_DEFAULTS[tab].password);
    setError('');
  };

  const handleNormalLogin = async () => {
    setError('');
    if (activeTab === 'guest') {
      onLogin({ id: 'GUEST001', studentId: 'GUEST001', email: 'guest@ntub.edu.tw', name: '校園訪客', role: '訪客' });
      return;
    }
    if (!inputId.trim()) { setError('請輸入帳號'); return; }
    setIsLoggingIn(true);
    try {
      const response = await fetch(`${API_ORIGIN}/api/users/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: inputId.trim(), password: inputPwd, loginType: activeTab }),
      });
      const result = await response.json();
      if (result.success && result.data) {
        onLogin(result.data as AppUser);
      } else {
        setError(result.error || '帳號或密碼錯誤');
      }
    } catch (loginError) {
      console.error('API 登入發生錯誤:', loginError);
      setError('無法連線到伺服器，請稍後再試。');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleGoogleLoginSuccess = useCallback((profile: GoogleProfile) => {
    onLogin({ ...profile, role: profile.role === 'admin' || profile.role === 'teacher' ? '教師' : '資管系學生', authType: 'google' });
  }, [onLogin]);
  const handleGoogleLoginError = useCallback((loginError: Error) => {
    setError(loginError.message || 'Google 登入失敗');
  }, []);

  const tabs: { key: LoginTab; label: string; active: string }[] = [
    { key: 'teacher', label: '教職員', active: 'text-purple-700' },
    { key: 'student', label: '在校生', active: 'text-blue-900' },
    { key: 'applicant', label: '考生', active: 'text-orange-600' },
    { key: 'guest', label: '訪客', active: 'text-green-600' },
  ];
  const idPlaceholder = activeTab === 'teacher' ? '教職員編號（T 開頭）' : activeTab === 'applicant' ? '身分證字號' : activeTab === 'guest' ? '訪客免帳號' : '學號';

  return (
    <>
      {showForgotPasswordModal && <ForgotPasswordModal onClose={() => setShowForgotPasswordModal(false)} />}
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-4 font-sans sm:p-6">
        <div className="w-full max-w-md rounded-3xl border border-gray-100 bg-white p-6 shadow-2xl sm:p-8">
          <div className="mb-6 text-center sm:mb-8">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-900 text-white shadow-lg"><School size={32} /></div>
            <h1 className="text-3xl font-extrabold text-blue-900">UniPass</h1>
            <p className="text-gray-400">Unified ID 單一識別系統</p>
          </div>
          <div className="mb-6 grid grid-cols-4 gap-1 rounded-xl bg-gray-100 p-1" role="tablist">
            {tabs.map(tab => (
              <button key={tab.key} type="button" role="tab" aria-selected={activeTab === tab.key} onClick={() => switchTab(tab.key)} className={`rounded-lg py-2 text-xs font-bold sm:text-sm ${activeTab === tab.key ? `bg-white shadow-sm ${tab.active}` : 'text-gray-400'}`}>{tab.label}</button>
            ))}
          </div>
          <form onSubmit={(event) => { event.preventDefault(); void handleNormalLogin(); }}>
            <div className="mb-4 space-y-4">
              <div className="relative">
                <User className="absolute left-4 top-3.5 text-gray-400" size={20} />
                <input type="text" value={inputId} onChange={(e) => setInputId(e.target.value)} disabled={activeTab === 'guest'} placeholder={idPlaceholder} aria-label="帳號" autoComplete="username" className="w-full rounded-xl border bg-gray-50 p-3 pl-12 disabled:text-gray-400" />
              </div>
              <div className="relative">
                <Lock className="absolute left-4 top-3.5 text-gray-400" size={20} />
                <input type="password" value={inputPwd} onChange={(e) => setInputPwd(e.target.value)} disabled={activeTab === 'guest'} placeholder={activeTab === 'guest' ? '免密碼' : '密碼'} aria-label="密碼" autoComplete="current-password" className="w-full rounded-xl border bg-gray-50 p-3 pl-12 disabled:text-gray-400" />
              </div>
            </div>
            {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-600">❌ {error}</p>}
            <button type="submit" disabled={isLoggingIn} className="w-full rounded-xl bg-blue-900 py-4 font-bold text-white shadow-lg transition-all hover:bg-blue-800 disabled:bg-gray-400">
              <LogIn className="mr-2 inline" /> {isLoggingIn ? '登入中...' : activeTab === 'guest' ? '以訪客身分進入' : '登入系統'}
            </button>
          </form>
          <div className="my-6 flex items-center">
            <div className="flex-grow border-t"></div>
            <span className="mx-4 text-sm text-gray-400">第三方登入</span>
            <div className="flex-grow border-t"></div>
          </div>
          <div className="flex w-full justify-center">
            <GoogleSignInButton onSuccess={handleGoogleLoginSuccess} onError={handleGoogleLoginError} />
          </div>
          <div className="mt-4 text-center">
            <button type="button" onClick={() => setShowForgotPasswordModal(true)} className="text-sm font-bold text-blue-600 transition-colors hover:text-blue-800 hover:underline">
              忘記密碼？
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// --- 付款結果（找不到使用者資料時才會用到）---
function PaymentResultPage({ result, onContinue }: { result: PaymentReturn; onContinue: () => void }) {
  const notice = paymentNoticeFrom(result);
  const isSuccess = result.status === 'success';
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 font-sans sm:p-6">
      <div className="w-full max-w-lg rounded-3xl bg-white p-6 text-center shadow-xl sm:p-8">
        <div className={`mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full ${isSuccess ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
          {isSuccess ? <CheckCircle size={36} /> : <X size={36} />}
        </div>
        <h1 className="mb-3 text-2xl font-bold text-gray-800">{isSuccess ? '付款完成' : '付款未完成'}</h1>
        <p className="mb-4 leading-relaxed text-gray-600">{notice.text}</p>
        {result.orderNo && <p className="mb-6 text-xs text-gray-400">訂單編號：{result.orderNo}</p>}
        <button type="button" onClick={onContinue} className="w-full rounded-xl bg-blue-600 py-3 font-bold text-white hover:bg-blue-700">返回 UniPass</button>
      </div>
    </div>
  );
}

type AppView = 'portal' | 'admissions' | 'events' | 'profile' | 'students';

type InitialState = {
  user: AppUser | null;
  view: AppView;
  eventsEntry: { eventId: number | null; tab: PlatformTab; notice: Notice | null; key: number };
  orphanPayment: PaymentReturn | null;
};

// 處理藍新付款導回：還原登入狀態並直接打開該活動頁
function computeInitialState(): InitialState {
  const storedUser = loadSessionUser();
  const payment = readPaymentReturn();
  const base: InitialState = { user: storedUser, view: 'portal', eventsEntry: { eventId: null, tab: 'market', notice: null, key: 0 }, orphanPayment: null };
  if (!payment) return base;

  // 只有付款人與目前保存的登入者相同時才沿用，避免誤用他人身分
  let user = storedUser && (!payment.studentId || getStudentId(storedUser) === payment.studentId) ? storedUser : null;
  if (!user && payment.studentId) {
    user = { id: payment.studentId, studentId: payment.studentId, email: `${payment.studentId}@ntub.edu.tw`, name: payment.studentId, role: '資管系學生' };
  }
  if (!user || !payment.eventId) return { ...base, user, orphanPayment: payment };
  return {
    user,
    view: 'events',
    eventsEntry: { eventId: payment.eventId, tab: 'market', notice: paymentNoticeFrom(payment), key: 1 },
    orphanPayment: null,
  };
}

// --- App 核心入口 ---
export default function App() {
  const [initial] = useState(computeInitialState);
  const [currentUser, setCurrentUser] = useState<AppUser | null>(initial.user);
  const [currentApp, setCurrentApp] = useState<AppView>(initial.view);
  const [eventsEntry, setEventsEntry] = useState(initial.eventsEntry);
  const [orphanPayment, setOrphanPayment] = useState<PaymentReturn | null>(initial.orphanPayment);

  // 付款導回網址只用一次，避免重新整理後重複顯示結果
  useEffect(() => {
    if (window.location.pathname.startsWith('/payment/')) {
      window.history.replaceState(null, '', '/');
    }
  }, []);

  useEffect(() => {
    saveSessionUser(currentUser);
  }, [currentUser]);

  const login = useCallback((user: AppUser) => {
    setCurrentUser(user);
    setCurrentApp('portal');
  }, []);
  const logout = useCallback(() => {
    clearAdmissionSession();
    setCurrentUser(null);
    setCurrentApp('portal');
    setOrphanPayment(null);
  }, []);
  const goHome = useCallback(() => setCurrentApp('portal'), []);
  const openEvents = (entry: { eventId?: number | null; tab?: PlatformTab } = {}) => {
    setEventsEntry(previous => ({ eventId: entry.eventId ?? null, tab: entry.tab ?? 'market', notice: null, key: previous.key + 1 }));
    setCurrentApp('events');
  };

  if (orphanPayment) return <PaymentResultPage result={orphanPayment} onContinue={() => setOrphanPayment(null)} />;
  if (!currentUser) return <LoginScreen onLogin={login} />;

  if (currentApp === 'admissions') {
    return (
      <div className="min-h-screen w-full min-w-0 bg-gray-100">
        <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-gray-500">招生系統載入中...</div>}>
          <AdmissionApp onBack={goHome} user={currentUser} />
        </Suspense>
      </div>
    );
  }

  if (currentApp === 'events') {
    return (
      <div className="flex min-h-screen justify-center bg-gray-100">
        <ActivityPlatform
          key={eventsEntry.key}
          onBack={goHome}
          user={currentUser}
          initialEventId={eventsEntry.eventId}
          initialTab={eventsEntry.tab}
          initialNotice={eventsEntry.notice}
        />
      </div>
    );
  }

  if (currentApp === 'profile') {
    return (
      <div className="min-h-screen bg-slate-50 px-4 pb-10 pt-20 sm:px-6 sm:pt-24">
        <TopBar onHome={goHome} onLogout={logout} user={currentUser} />
        <div className="mx-auto max-w-4xl">
          <button type="button" onClick={goHome} className="mb-4 flex items-center gap-1 font-bold text-gray-500 hover:text-gray-800">
            <ChevronLeft /> 返回首頁
          </button>
          <UserProfile currentUser={currentUser} onSaved={(patch) => setCurrentUser(previous => (previous ? { ...previous, ...patch } : previous))} />
        </div>
      </div>
    );
  }

  if (currentApp === 'students') {
    return (
      <div className="min-h-screen bg-slate-50 px-4 pb-10 pt-20 sm:px-6 sm:pt-24">
        <TopBar onHome={goHome} onProfile={() => setCurrentApp('profile')} onLogout={logout} user={currentUser} />
        <StudentManagement currentUser={currentUser} onBack={goHome} />
      </div>
    );
  }

  const isApplicant = currentUser.role === '考生';
  const isGuest = currentUser.role === '訪客';
  const tileClass = 'group relative flex h-56 flex-col justify-between overflow-hidden rounded-3xl border-2 border-transparent bg-white p-6 text-left shadow-xl transition-all hover:shadow-2xl sm:h-64 sm:p-8';
  return (
    <div className="flex min-h-screen flex-col items-center bg-slate-50 px-4 pb-10 pt-20 font-sans sm:px-6 sm:pt-24">
      <TopBar onHome={goHome} onProfile={() => setCurrentApp('profile')} onLogout={logout} user={currentUser} />

      <div className="mb-8 text-center sm:mb-12"><h1 className="mb-2 text-2xl font-extrabold text-blue-900 sm:text-3xl">{greeting()}，{currentUser.name}</h1><p className="text-gray-500">請選擇服務</p></div>

      <div className="grid w-full max-w-4xl grid-cols-1 gap-5 sm:gap-8 md:grid-cols-2">
        <button type="button" onClick={() => setCurrentApp('admissions')} className={`${tileClass} hover:border-orange-400`}>
          <GraduationCap size={150} className="absolute right-0 top-0 text-orange-500 opacity-10 transition-transform group-hover:scale-110" />
          <div><div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-100 text-orange-600"><GraduationCap size={28} /></div><h2 className="text-2xl font-bold text-gray-800">招生入學</h2><p className="mt-2 text-gray-500">{currentUser.role === '教師' ? '審查報名案件與招生設定' : isApplicant ? '查看報名進度與榜單' : '線上報名與查詢入學資料'}</p></div>
          <div className="flex items-center gap-2 font-bold text-orange-600 transition-transform group-hover:translate-x-2">進入系統 <ArrowRight size={20} /></div>
        </button>
        <button type="button" onClick={() => openEvents()} className={`${tileClass} hover:border-blue-500`}>
          <Calendar size={150} className="absolute right-0 top-0 text-blue-600 opacity-10 transition-transform group-hover:scale-110" />
          <div><div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-100 text-blue-600"><QrCode size={28} /></div><h2 className="text-2xl font-bold text-gray-800">校園活動</h2><p className="mt-2 text-gray-500">{isApplicant ? '校園參觀與活動體驗' : '活動報名與簽到管理'}</p></div>
          <div className="flex items-center gap-2 font-bold text-blue-600 transition-transform group-hover:translate-x-2">進入系統 <ArrowRight size={20} /></div>
        </button>
        {!isGuest && (
          <button type="button" onClick={() => openEvents({ tab: 'history' })} className="group flex items-center justify-between gap-4 rounded-3xl border-2 border-transparent bg-white p-5 text-left shadow-xl transition-all hover:border-green-400 hover:shadow-2xl sm:p-6 md:col-span-2">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-green-100 text-green-600"><History size={24} /></div>
              <div><h2 className="text-lg font-bold text-gray-800 sm:text-xl">活動歷程</h2><p className="text-sm text-gray-500">查看你所有已簽到活動的完整學習軌跡</p></div>
            </div>
            <ArrowRight size={20} className="shrink-0 text-green-600 transition-transform group-hover:translate-x-2" />
          </button>
        )}
        {currentUser.role === '教師' && (
          <button type="button" onClick={() => setCurrentApp('students')} className={`${tileClass} hover:border-purple-400 md:col-span-2`}>
            <Users size={150} className="absolute right-0 top-0 text-purple-500 opacity-10 transition-transform group-hover:scale-110" />
            <div>
              <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-100 text-purple-600"><Users size={28} /></div>
              <h2 className="text-2xl font-bold text-gray-800">學生管理系統</h2>
              <p className="mt-2 text-gray-500">查詢與修改全校學生的基本資料、權限與聯絡方式</p>
            </div>
            <div className="flex items-center gap-2 font-bold text-purple-600 transition-transform group-hover:translate-x-2">進入管理 <ArrowRight size={20} /></div>
          </button>
        )}
      </div>

      <div className="mx-auto mt-10 w-full max-w-4xl sm:mt-12">
        <RecommendationDashboard key={getStudentId(currentUser)} studentId={getStudentId(currentUser)} onOpenActivity={(activityId) => openEvents({ eventId: activityId })} />
      </div>
    </div>
  );
}
