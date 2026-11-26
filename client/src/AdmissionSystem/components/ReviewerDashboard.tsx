import { useContext, useMemo, useState } from 'react';
import { AlertCircle, BadgeCheck, ChevronLeft, Clock3, Filter, FileText, History, LayoutDashboard, LogOut, Mail, MessageSquare, Search, ShieldCheck, User2, Users } from 'lucide-react';
import { format } from 'date-fns';
import type { AdmissionApplication, AdmissionChannelConfig, PortalUser, ReviewStatus } from '../types';
import AdminConfigPanel from './AdminConfigPanel';
import { AdmissionContext } from '../contexts/admissionContextCore';

interface ReviewerDashboardProps {
  user: PortalUser;
  channelConfig: AdmissionChannelConfig;
  applications: AdmissionApplication[];
  onApplicationsChange: (next: AdmissionApplication[]) => void;
  onConfigChange: (next: AdmissionChannelConfig) => void;
  onLogout: () => void;
  onBack?: () => void;
}

type DashboardTab = 'review' | 'settings';
type StatusFilter = 'all' | ReviewStatus;

const STATUS_META: Record<ReviewStatus, { label: string; tone: string; hint: string }> = {
  pending: { label: '待初審', tone: 'bg-amber-50 text-amber-700 border-amber-100', hint: '等待審查員開啟案件' },
  under_review: { label: '審查中', tone: 'bg-indigo-50 text-[#6B21A8] border-indigo-100', hint: '案件已被鎖定審查' },
  supplement_requested: { label: '補件通知', tone: 'bg-orange-50 text-orange-700 border-orange-100', hint: '請求候選人補件' },
  pending_recheck: { label: '待複核', tone: 'bg-cyan-50 text-cyan-700 border-cyan-100', hint: '補件已回覆，等待複核' },
  approved: { label: '已通過', tone: 'bg-green-50 text-green-700 border-green-100', hint: '審查完成並核准' },
  rejected: { label: '不通過', tone: 'bg-rose-50 text-rose-700 border-rose-100', hint: '案件已退件' },
};

const REVIEW_FLOW: Record<ReviewStatus, ReviewStatus[]> = {
  pending: ['under_review'],
  under_review: ['supplement_requested', 'pending_recheck', 'approved', 'rejected'],
  supplement_requested: ['under_review', 'pending_recheck'],
  pending_recheck: ['under_review', 'approved', 'rejected'],
  approved: [],
  rejected: [],
};

const filterOptions: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: '全部案件' },
  { value: 'pending', label: '待初審' },
  { value: 'under_review', label: '審查中' },
  { value: 'supplement_requested', label: '補件中' },
  { value: 'pending_recheck', label: '待複核' },
  { value: 'approved', label: '已通過' },
  { value: 'rejected', label: '不通過' },
];

function formatDateTime(value: string) {
  if (!value) return '未提供';
  try {
    return format(new Date(value), 'yyyy/MM/dd HH:mm');
  } catch {
    return value;
  }
}

function formatPaymentLabel(status: AdmissionApplication['paymentStatus']) {
  if (status === '已付款') return '已完成';
  if (status === '已取消') return '已取消';
  return '待付款';
}

function createReviewHistoryEntry(status: ReviewStatus, note: string, reviewerName: string, type: 'status' | 'score' = 'status') {
  return {
    id: `${status}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    status,
    note: note.trim() || '無備註',
    reviewerName,
    createdAt: new Date().toISOString(),
    type,
  };
}

function getDocumentSummary(documents: AdmissionApplication['documents']) {
  const uploaded = documents.filter((doc) => doc.status === 'uploaded').length;
  return `${uploaded}/${documents.length}`;
}

type ReviewDraft = { status?: ReviewStatus; note?: string; score?: string; examNumber?: string };

function getSubmittedYear(application: AdmissionApplication): number | null {
  const year = new Date(application.submittedAt).getFullYear();
  return Number.isFinite(year) ? year : null;
}

export default function ReviewerDashboard({
  user,
  channelConfig,
  applications: applicationsProp,
  onApplicationsChange: onApplicationsChangeProp,
  onConfigChange,
  onLogout,
  onBack,
}: ReviewerDashboardProps) {
  // 優先使用 AdmissionProvider 提供的資料，與考生端即時同步
  const admissionContext = useContext(AdmissionContext);
  const applications = admissionContext?.applications ?? applicationsProp;
  const onApplicationsChange = (admissionContext?.setApplications as ((next: AdmissionApplication[]) => void) | undefined) ?? onApplicationsChangeProp;

  const [activeView, setActiveView] = useState<DashboardTab>('review');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [reviewMode, setReviewMode] = useState<'normal' | 'score'>('normal');
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({});
  const [bulkSelected, setBulkSelected] = useState<string[]>([]);
  const [bulkWarning, setBulkWarning] = useState<string | null>(null);
  const [workflowWarning, setWorkflowWarning] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [scoreWarning, setScoreWarning] = useState<string | null>(null);

  const years = useMemo(() => {
    const setYears = new Set<number>();
    for (const application of applications) {
      const year = getSubmittedYear(application);
      if (year !== null) setYears.add(year);
    }
    return Array.from(setYears).sort((a, b) => b - a);
  }, [applications]);

  // 未手動選擇年度時，預設顯示最新年度
  const activeYear = selectedYear !== null && years.includes(selectedYear) ? selectedYear : years[0] ?? null;

  // 左側「篩選案件」與「快速搜尋」會同時套用在目前年度的案件清單
  const filteredApplications = useMemo(() => {
    const keyword = query.toLowerCase().trim();
    return applications.filter((application) => {
      const matchesQuery = !keyword || [
        application.applicantName,
        application.email,
        application.registrationId,
        application.admissionType,
        application.selectedDepartments.map((department) => department.name).join(' '),
      ]
        .join(' ')
        .toLowerCase()
        .includes(keyword);
      const matchesStatus = statusFilter === 'all' ? true : application.reviewStatus === statusFilter;
      const matchesYear = activeYear === null || getSubmittedYear(application) === activeYear;
      return matchesQuery && matchesStatus && matchesYear;
    });
  }, [applications, query, statusFilter, activeYear]);

  const selectedApplication = filteredApplications.find((application) => application.id === selectedId) ?? filteredApplications[0] ?? null;
  const draft: ReviewDraft = selectedApplication ? drafts[selectedApplication.id] ?? {} : {};
  const reviewStatus: ReviewStatus = draft.status ?? selectedApplication?.reviewStatus ?? 'pending';
  const reviewerNote = draft.note ?? selectedApplication?.reviewerNote ?? '';
  const scoreDraft = draft.score ?? (selectedApplication ? String(selectedApplication.score) : '');
  const examNumberDraft = draft.examNumber ?? selectedApplication?.examNumber ?? '';

  const updateDraft = (patch: ReviewDraft) => {
    if (!selectedApplication) return;
    const id = selectedApplication.id;
    setSaveNotice(null);
    setDrafts((previous) => ({ ...previous, [id]: { ...previous[id], ...patch } }));
  };
  const clearDraft = (id: string, keys: (keyof ReviewDraft)[]) => {
    setDrafts((previous) => {
      const next = { ...previous[id] };
      keys.forEach((key) => { delete next[key]; });
      return { ...previous, [id]: next };
    });
  };

  const selectApplication = (id: string | null) => {
    setSelectedId(id);
    setWorkflowWarning(null);
    setScoreWarning(null);
    setSaveNotice(null);
  };

  const toggleSelect = (id: string) => {
    setBulkWarning(null);
    setBulkSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const selectAllVisible = () => {
    setBulkWarning(null);
    setBulkSelected(filteredApplications.map((a) => a.id));
  };

  const clearBulk = () => setBulkSelected([]);

  const batchApprove = () => {
    if (!bulkSelected.length) return;

    const selectedApplications = applications.filter((application) => bulkSelected.includes(application.id));
    const eligibleApplications = selectedApplications.filter((application) =>
      REVIEW_FLOW[application.reviewStatus].includes('approved')
    );
    const skippedCount = selectedApplications.length - eligibleApplications.length;

    if (!eligibleApplications.length) {
      setBulkWarning('所選案件皆不符合核准條件，請先依審查流程更新案件狀態。');
      return;
    }

    const eligibleIds = new Set(eligibleApplications.map((application) => application.id));
    const now = new Date().toISOString();
    onApplicationsChange(
      applications.map((app) =>
        eligibleIds.has(app.id)
          ? {
              ...app,
              reviewStatus: 'approved',
              reviewerName: user.name,
              updatedAt: now,
              reviewHistory: [
                ...(app.reviewHistory ?? []),
                createReviewHistoryEntry('approved', '批次核准', user.name),
              ],
            }
          : app
      )
    );
    setBulkWarning(skippedCount > 0 ? `已核准 ${eligibleApplications.length} 件；${skippedCount} 件因狀態不符而略過。` : `已核准 ${eligibleApplications.length} 件。`);
    clearBulk();
  };

  const canSubmitToReview = selectedApplication ? REVIEW_FLOW[selectedApplication.reviewStatus].includes('under_review') : false;
  const canRequestSupplement = selectedApplication ? REVIEW_FLOW[selectedApplication.reviewStatus].includes('supplement_requested') : false;
  const canFinalizeDecision = selectedApplication ? REVIEW_FLOW[selectedApplication.reviewStatus].some((status) => status === 'approved' || status === 'rejected') : false;

  const counts = useMemo(() => {
    const base = {
      total: applications.length,
      pending: 0,
      underReview: 0,
      approved: 0,
      flagged: 0,
    };

    for (const application of applications) {
      if (application.reviewStatus === 'pending') base.pending += 1;
      if (application.reviewStatus === 'under_review') base.underReview += 1;
      if (application.reviewStatus === 'approved') base.approved += 1;
      if (application.reviewStatus === 'supplement_requested' || application.reviewStatus === 'rejected') base.flagged += 1;
    }

    return base;
  }, [applications]);

  const updateSelectedApplication = (nextStatus: ReviewStatus, note = reviewerNote) => {
    if (!selectedApplication) return;

    const currentStatus = selectedApplication.reviewStatus;
    const allowedNext = REVIEW_FLOW[currentStatus] ?? [];
    const isValidTransition = allowedNext.includes(nextStatus);

    if (!isValidTransition) {
      setWorkflowWarning(`非法狀態轉換：${STATUS_META[currentStatus].label} 不能直接轉為 ${STATUS_META[nextStatus].label}，請依流程進行。`);
      return;
    }

    setWorkflowWarning(null);
    const now = new Date().toISOString();
    onApplicationsChange(
      applications.map((application) =>
        application.id === selectedApplication.id
          ? {
              ...application,
              reviewStatus: nextStatus,
              reviewerNote: note.trim(),
              reviewerName: user.name,
              updatedAt: now,
              reviewHistory: [
                ...(application.reviewHistory ?? []),
                createReviewHistoryEntry(nextStatus, note.trim() || '審查狀態更新', user.name),
              ],
            }
          : application
      )
    );
    clearDraft(selectedApplication.id, ['status', 'note']);
    setSaveNotice(`已將案件更新為「${STATUS_META[nextStatus].label}」。`);
  };

  const scoreIsLocked = selectedApplication?.scoreReviewStatus === 'completed';

  const submitScore = () => {
    if (!selectedApplication) {
      setScoreWarning('請先選擇案件，再輸入成績。');
      return;
    }

    if (selectedApplication.scoreReviewStatus === 'completed') {
      setScoreWarning('此案件已完成評分，為維持公平性，評分已鎖定且不可再次修改。');
      return;
    }

    if (!scoreDraft.trim()) {
      setScoreWarning('請輸入評審分數後再送出。');
      return;
    }

    const score = Number(scoreDraft);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      setScoreWarning('分數不能小於 0 或大於 100，請修正後再送出。');
      return;
    }

    setScoreWarning(null);
    const updatedAt = new Date().toISOString();
    onApplicationsChange(
      applications.map((application) =>
        application.id === selectedApplication.id && application.scoreReviewStatus !== 'completed'
          ? {
              ...application,
              score,
              scoreReviewStatus: 'completed',
              reviewerName: user.name,
              updatedAt,
              reviewHistory: [
                ...(application.reviewHistory ?? []),
                createReviewHistoryEntry(application.reviewStatus, `評審完成，最終分數為 ${score.toFixed(1)} 分。`, user.name, 'score'),
              ],
            }
          : application
      )
    );
    clearDraft(selectedApplication.id, ['score']);
  };

  const saveExamNumber = () => {
    if (!selectedApplication) return;
    const value = examNumberDraft.trim();
    onApplicationsChange(
      applications.map((application) =>
        application.id === selectedApplication.id
          ? { ...application, examNumber: value || null, updatedAt: new Date().toISOString() }
          : application
      )
    );
    clearDraft(selectedApplication.id, ['examNumber']);
    setSaveNotice(value ? `准考證號已儲存：${value}` : '已清除准考證號。');
  };

  return (
    <div className="min-h-screen w-full min-w-0 bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/85 backdrop-blur-xl shadow-sm">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                aria-label="返回 UniPass 首頁"
                className="inline-flex shrink-0 items-center gap-1 rounded-2xl border border-slate-200 bg-white px-2 py-2 text-sm font-bold text-[#6B21A8] transition-all hover:bg-purple-50 sm:px-3"
              >
                <ChevronLeft size={18} /> <span className="hidden sm:inline">返回首頁</span>
              </button>
            )}
            <div className="min-w-0">
              <p className="hidden text-[10px] font-bold uppercase tracking-[0.25em] text-slate-400 sm:block">Review Center</p>
              <h1 className="truncate text-lg font-black text-slate-900">招生審查中心</h1>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <div className="hidden rounded-2xl bg-slate-50 px-4 py-2 text-right sm:block">
              <p className="text-xs font-bold text-slate-500">{user.name}</p>
              <p className="text-[10px] text-slate-400">{user.email}</p>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition-all hover:border-[#5c1126]/30 hover:text-[#5c1126]"
            >
              <LogOut size={16} /> <span className="hidden sm:inline">登出</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-[320px_minmax(0,1fr)] sm:px-6">
        <aside className="min-w-0 space-y-6">
          <div className="rounded-[1.75rem] border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#5c1126]/10 text-[#5c1126]">
                <ShieldCheck size={22} />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">審查員面板</p>
                <h2 className="text-xl font-black text-slate-900">{channelConfig.name}</h2>
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">總案件</p>
                <p className="mt-2 text-2xl font-black text-slate-900">{counts.total}</p>
              </div>
              <div className="rounded-2xl bg-amber-50 p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-500">待初審</p>
                <p className="mt-2 text-2xl font-black text-amber-700">{counts.pending}</p>
              </div>
              <div className="rounded-2xl bg-indigo-50 p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#6B21A8]">審查中</p>
                <p className="mt-2 text-2xl font-black text-[#6B21A8]">{counts.underReview}</p>
              </div>
              <div className="rounded-2xl bg-green-50 p-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-green-600">已通過</p>
                <p className="mt-2 text-2xl font-black text-green-700">{counts.approved}</p>
              </div>
            </div>
          </div>

          <div className="rounded-[1.75rem] border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2 text-sm font-black text-slate-900">
              <Filter size={16} className="text-[#6B21A8]" /> 篩選案件
            </div>
            <div className="mt-4 space-y-2">
              {filterOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => { setStatusFilter(option.value); selectApplication(null); }}
                  className={statusFilter === option.value ? 'flex w-full items-center justify-between rounded-2xl bg-[#6B21A8] px-4 py-3 text-left text-sm font-bold text-white shadow-sm' : 'flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-semibold text-slate-600 transition-all hover:border-slate-300 hover:bg-slate-50'}
                >
                  <span>{option.label}</span>
                  <span className="text-xs opacity-80">
                    {option.value === 'all'
                      ? applications.length
                      : applications.filter((application) => application.reviewStatus === option.value).length}
                  </span>
                </button>
              ))}
            </div>

            <label className="mt-5 block">
              <span className="mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-slate-400">快速搜尋</span>
              <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                <Search size={16} className="text-slate-400" />
                <input
                  type="text"
                  value={query}
                  onChange={(event) => { setQuery(event.target.value); selectApplication(null); }}
                  placeholder="姓名、序號、系所、信箱"
                  className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
                />
              </div>
            </label>
          </div>

        </aside>

        <section className="min-w-0 space-y-6">
          <div className="rounded-[2rem] border border-slate-200 bg-white p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">操作視圖</p>
                <h2 className="mt-1 text-2xl font-black text-slate-900">案件審查與設定</h2>
              </div>
              <div className="inline-flex rounded-2xl bg-slate-100 p-1">
                {([
                  ['review', '案件審查'],
                  ['settings', '招生設定'],
                ] as const).map(([tab, label]) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveView(tab)}
                    className={activeView === tab
                      ? 'rounded-xl bg-white px-4 py-2 text-sm font-bold text-[#6B21A8] shadow-sm ring-1 ring-[#6B21A8]/10'
                      : 'rounded-xl px-4 py-2 text-sm font-semibold text-slate-500 transition-colors hover:text-slate-700'}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {activeView === 'review' && (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">審查模式</p>
                  <div className="inline-flex rounded-2xl bg-white p-1">
                    <button type="button" onClick={() => setReviewMode('normal')} className={reviewMode === 'normal' ? 'rounded-xl bg-[#6B21A8] px-3 py-1 text-xs font-bold text-white' : 'rounded-xl px-3 py-1 text-xs font-semibold text-slate-600'}>報名資料</button>
                    <button type="button" onClick={() => setReviewMode('score')} className={reviewMode === 'score' ? 'rounded-xl bg-[#6B21A8] px-3 py-1 text-xs font-bold text-white' : 'rounded-xl px-3 py-1 text-xs font-semibold text-slate-600'}>成績審查</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {activeView === 'review' ? (
            <div className="space-y-6">
              <div className="rounded-[2rem] border border-slate-200 bg-white p-4 sm:p-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">歷年招生清單</p>
                    <h3 className="mt-1 text-2xl font-black text-slate-900">年度審查總表</h3>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500">{years.length} 個年度</span>
                </div>

                <div className="mt-5 overflow-x-auto">
                  <table className="min-w-full border-separate border-spacing-y-2 text-left">
                    <colgroup>
                      <col className="w-[18%]" />
                      <col className="w-[22%]" />
                      <col className="w-[16%]" />
                      <col className="w-[14%]" />
                      <col className="w-[30%]" />
                    </colgroup>
                    <thead>
                      <tr className="text-xs uppercase tracking-[0.18em] text-slate-400">
                        <th className="min-w-[110px] whitespace-nowrap px-4 py-3 font-bold">招生年度</th>
                        <th className="min-w-[180px] whitespace-normal px-4 py-3 font-bold">招生類別</th>
                        <th className="min-w-[110px] whitespace-nowrap px-4 py-3 font-bold">報名人數</th>
                        <th className="min-w-[110px] whitespace-nowrap px-4 py-3 font-bold">狀態</th>
                        <th className="min-w-[320px] px-4 py-3 text-right font-bold">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {years.map((year) => {
                        const yearCount = applications.filter((application) => getSubmittedYear(application) === year).length;
                        const isCurrent = activeYear === year;

                        return (
                          <tr key={year} className={isCurrent ? 'rounded-2xl bg-[#6B21A8]/5' : 'rounded-2xl bg-slate-50'}>
                            <td className="rounded-l-2xl whitespace-nowrap px-4 py-4 text-sm font-black text-slate-800">{year} 學年度</td>
                            <td className="whitespace-normal px-4 py-4 text-sm text-slate-600">四技招生 / 轉學考 / 甄選</td>
                            <td className="whitespace-nowrap px-4 py-4 text-sm font-bold text-slate-800">{yearCount} 人</td>
                            <td className="whitespace-nowrap px-4 py-4">
                              <span className="rounded-full bg-green-50 px-2.5 py-1 text-[10px] font-bold text-green-700 whitespace-nowrap">已開放</span>
                            </td>
                            <td className="rounded-r-2xl px-4 py-4">
                              <div className="flex shrink-0 justify-end items-center gap-2 whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedYear(year);
                                    setReviewMode('normal');
                                    selectApplication(null);
                                  }}
                                  className="h-9 shrink-0 rounded-xl bg-[#6B21A8] px-3 text-xs font-bold text-white shadow-sm transition hover:opacity-95"
                                >
                                  報名資料審查
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedYear(year);
                                    setReviewMode('score');
                                    selectApplication(null);
                                  }}
                                  className="h-9 shrink-0 rounded-xl bg-slate-200 px-3 text-xs font-bold text-slate-700 transition hover:bg-slate-300"
                                >
                                  成績審查
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-[370px_minmax(0,1fr)]">
                <div className="rounded-[2rem] border border-slate-200 bg-white p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-base font-black text-slate-900">{activeYear ?? ''} 年度案件清單</h3>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500">{filteredApplications.length} 筆</span>
                      <button type="button" onClick={selectAllVisible} className="rounded-xl bg-[#6B21A8] px-3 py-1 text-xs font-bold text-white">選取全部</button>
                      <button type="button" onClick={clearBulk} className="rounded-xl border px-3 py-1 text-xs font-semibold text-slate-600">清除選取</button>
                    </div>
                  </div>

                  <div className="mt-4 space-y-3 max-h-[62vh] overflow-auto pr-1">
                    {filteredApplications.length > 0 ? filteredApplications.map((application) => {
                      const isSelected = application.id === selectedApplication?.id;
                      const meta = STATUS_META[application.reviewStatus];
                      const isChecked = bulkSelected.includes(application.id);
                      return (
                        <div
                          key={application.id}
                          className={isSelected ? 'w-full rounded-[1.5rem] border border-[#6B21A8]/20 bg-[#6B21A8]/6 p-4 text-left shadow-sm flex items-start gap-3' : 'w-full rounded-[1.5rem] border border-slate-200 bg-slate-50/70 p-4 text-left transition-all hover:border-slate-300 hover:bg-white flex items-start gap-3'}
                        >
                          <div className="flex items-start">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => { e.stopPropagation(); toggleSelect(application.id); }}
                              className="mt-1 h-4 w-4 rounded"
                              aria-label={`選取 ${application.applicantName}`}
                            />
                          </div>
                          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => selectApplication(application.id)}>
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-black text-slate-900">{application.applicantName}</p>
                                <p className="mt-1 text-xs text-slate-500">{application.registrationId}</p>
                              </div>
                              <span className={meta.tone + ' rounded-full border px-2.5 py-1 text-[10px] font-bold'}>{meta.label}</span>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold text-slate-500">
                              <span className="rounded-full bg-white px-2.5 py-1">{application.selectedDepartments.length} 個志願</span>
                              <span className="rounded-full bg-white px-2.5 py-1">{formatPaymentLabel(application.paymentStatus)}</span>
                              <span className="rounded-full bg-white px-2.5 py-1">分數 {application.score.toFixed(1)}</span>
                            </div>
                          </button>
                        </div>
                      );
                    }) : (
                      <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
                        目前沒有符合條件的案件。
                      </div>
                    )}
                  </div>

                  {bulkSelected.length > 0 && (
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <span className="text-sm text-slate-700">已選取 {bulkSelected.length} 筆</span>
                      <button type="button" onClick={batchApprove} className="rounded-xl bg-green-600 px-3 py-1 text-xs font-bold text-white">批次核准</button>
                    </div>
                  )}
                  {bulkWarning && (
                    <div role="status" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                      {bulkWarning}
                    </div>
                  )}
                </div>

                <div className="space-y-6">
                  {selectedApplication ? (
                    <>
                      <div className="rounded-[2rem] border border-slate-200 bg-white p-5 sm:p-6">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div>
                            <div className="flex flex-wrap items-center gap-3">
                              <h3 className="text-2xl font-black text-slate-900">{selectedApplication.applicantName}</h3>
                              <span className={STATUS_META[selectedApplication.reviewStatus].tone + ' rounded-full border px-3 py-1 text-xs font-bold'}>{STATUS_META[selectedApplication.reviewStatus].label}</span>
                            </div>
                            <p className="mt-2 text-sm text-slate-500">{selectedApplication.registrationId} · {selectedApplication.admissionType}</p>
                          </div>
                          <div className="grid grid-cols-2 gap-3 text-right text-sm">
                            <div className="rounded-2xl bg-slate-50 px-4 py-3">
                              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">審查分數</p>
                              <p className="mt-1 text-xl font-black text-slate-900">{selectedApplication.score.toFixed(1)}</p>
                            </div>
                            <div className="rounded-2xl bg-indigo-50 px-4 py-3">
                              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#6B21A8]">文件完成度</p>
                              <p className="mt-1 text-xl font-black text-[#6B21A8]">{getDocumentSummary(selectedApplication.documents)}</p>
                            </div>
                          </div>
                        </div>

                        <div className="mt-5 grid gap-4 md:grid-cols-3">
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">聯絡資訊</p>
                            <div className="mt-3 space-y-2 text-sm text-slate-700">
                              <div className="flex items-center gap-2 break-all"><Mail size={14} className="shrink-0 text-[#6B21A8]" /> {selectedApplication.email}</div>
                              <div className="flex items-center gap-2"><User2 size={14} className="text-[#5c1126]" /> {selectedApplication.phone}</div>
                            </div>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">繳費與時間</p>
                            <div className="mt-3 space-y-2 text-sm text-slate-700">
                              <div className="flex items-center gap-2"><Clock3 size={14} className="text-[#6B21A8]" /> {formatDateTime(selectedApplication.submittedAt)}</div>
                              <div className="flex items-center gap-2"><BadgeCheck size={14} className="text-green-600" /> {formatPaymentLabel(selectedApplication.paymentStatus)}</div>
                            </div>
                          </div>
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">最近更新</p>
                            <p className="mt-3 text-sm font-semibold text-slate-700">{formatDateTime(selectedApplication.updatedAt)}</p>
                            <p className="mt-2 text-xs text-slate-500">審查員：{selectedApplication.reviewerName || '尚未指定'}</p>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                        <div className="rounded-[2rem] border border-slate-200 bg-white p-5">
                          <div className="flex items-center gap-2 text-base font-black text-slate-900">
                            <FileText size={18} className="text-[#6B21A8]" /> 應附文件
                          </div>
                          <div className="mt-4 space-y-3">
                            {selectedApplication.documents.map((document) => (
                              <div key={document.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                <div className="min-w-0">
                                  <p className="text-sm font-bold text-slate-800">{document.name}{document.isRequired ? <span className="ml-1 text-rose-500">*</span> : null}</p>
                                  <p className="break-all text-xs text-slate-500">
                                    {document.fileName ? `${document.fileName}${document.lastUploaded ? `・${document.lastUploaded}` : ''}` : `格式：${document.format.join('、')}`}
                                  </p>
                                </div>
                                <span className={document.status === 'uploaded' ? 'rounded-full bg-green-50 px-3 py-1 text-xs font-bold text-green-700' : document.status === 'pending_payment' ? 'rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700' : 'rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500'}>
                                  {document.status === 'uploaded' ? '已附檔' : document.status === 'pending_payment' ? '待繳費' : '未上傳'}
                                </span>
                              </div>
                            ))}
                          </div>

                          <p className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs leading-5 text-slate-500">
                            備審檔案由考生端上傳，此處顯示檔名與上傳時間，供審查員核對文件是否齊全。
                          </p>
                        </div>

                        <div className="rounded-[2rem] border border-slate-200 bg-white p-5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-base font-black text-slate-900">
                              <MessageSquare size={18} className="text-[#5c1126]" /> 審查操作
                            </div>
                            {reviewMode === 'score' && (
                              <span className="rounded-full bg-[#6B21A8]/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#6B21A8]">
                                目前模式：成績審查
                              </span>
                            )}
                          </div>
                          <div className="mt-4 space-y-4">
                            {reviewMode === 'score' ? (
                              <div className="space-y-4">
                                {(
                                  <>
                                    <div className="rounded-[1.5rem] border border-[#6B21A8]/20 bg-[#6B21A8]/5 p-4">
                                      <label className="block space-y-2">
                                        <span className="text-xs font-bold uppercase tracking-[0.2em] text-[#6B21A8]">評審分數</span>
                                        <input
                                          type="number"
                                          step="any"
                                          value={scoreDraft}
                                          onChange={(event) => updateDraft({ score: event.target.value })}
                                          disabled={scoreIsLocked}
                                          className="w-full rounded-2xl border-2 border-[#6B21A8]/20 bg-white px-4 py-3 text-lg font-black text-slate-900 outline-none transition focus:border-[#6B21A8] focus:ring-4 focus:ring-[#6B21A8]/10 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                                          placeholder="請輸入分數"
                                        />
                                      </label>
                                      <p className="mt-3 rounded-xl bg-white/80 px-3 py-2 text-xs font-semibold text-slate-600">分數範圍：0–100</p>
                                    </div>
                                    {scoreWarning && (
                                      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                                        {scoreWarning}
                                      </div>
                                    )}
                                    {!scoreIsLocked && (
                                      <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800">
                                        目前評分將以 0–100 分為範圍，超出範圍將被視為無效輸入。
                                      </div>
                                    )}
                                    {scoreIsLocked && (
                                      <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
                                        <p className="font-black">🔒 評分已鎖定，無法再次修改</p>
                                        <p className="mt-1">為確保招生審查公平性，本次評分一經送出即完成鎖定。若須修正，請由系統管理員重新開啟審查權限後再進行更新。</p>
                                      </div>
                                    )}
                                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">最後更新者與時間</p>
                                      <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-700">
                                        <span className="font-semibold">{selectedApplication.reviewerName || '尚未指定'}</span>
                                        <span>{formatDateTime(selectedApplication.updatedAt)}</span>
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={submitScore}
                                      disabled={scoreIsLocked || !scoreDraft.trim() || !Number.isFinite(Number(scoreDraft))}
                                      className="w-full rounded-2xl bg-[#6B21A8] px-4 py-3 text-sm font-bold text-white shadow-sm transition-all hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      確認送出評分
                                    </button>
                                  </>
                                )}
                              </div>
                            ) : (
                            <div className="space-y-4">
                            <div className="space-y-2">
                              <span className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">准考證號</span>
                              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                                <input
                                  value={examNumberDraft}
                                  onChange={(event) => updateDraft({ examNumber: event.target.value })}
                                  placeholder="請輸入准考證號"
                                  aria-label="准考證號"
                                  className="w-full min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#6B21A8]"
                                />
                                <button
                                  type="button"
                                  onClick={saveExamNumber}
                                  disabled={examNumberDraft.trim() === (selectedApplication.examNumber ?? '')}
                                  className="w-full shrink-0 whitespace-nowrap rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition-all hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
                                >
                                  儲存准考證號
                                </button>
                              </div>
                            </div>

                            <div className="space-y-2">
                              <span className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">案件狀態</span>
                              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                                <select
                                  value={reviewStatus}
                                  onChange={(event) => updateDraft({ status: event.target.value as ReviewStatus })}
                                  aria-label="案件狀態"
                                  className="w-full min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#6B21A8]"
                                >
                                  {Object.entries(STATUS_META).filter(([status]) => REVIEW_FLOW[selectedApplication.reviewStatus].includes(status as ReviewStatus) || status === selectedApplication.reviewStatus).map(([status, meta]) => (
                                    <option key={status} value={status}>{status === selectedApplication.reviewStatus ? `${meta.label}（目前）` : meta.label}</option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  onClick={() => updateSelectedApplication(reviewStatus)}
                                  disabled={reviewStatus === selectedApplication.reviewStatus}
                                  className="w-full shrink-0 whitespace-nowrap rounded-2xl bg-[#6B21A8] px-4 py-3 text-sm font-bold text-white shadow-sm transition-all hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
                                >
                                  套用狀態
                                </button>
                              </div>
                            </div>

                            {workflowWarning && (
                              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                                {workflowWarning}
                              </div>
                            )}
                            {saveNotice && (
                              <div role="status" className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-800">
                                {saveNotice}
                              </div>
                            )}

                            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
                              流程規則：{STATUS_META[selectedApplication.reviewStatus].hint}
                            </div>

                            <label className="block space-y-2">
                              <span className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">審查備註</span>
                              <textarea
                                rows={6}
                                value={reviewerNote}
                                onChange={(event) => updateDraft({ note: event.target.value })}
                                placeholder="可輸入補件內容、審查意見、核准條件等"
                                className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#6B21A8]"
                              />
                            </label>

                            <div className="grid gap-3 sm:grid-cols-3">
                              <button
                                type="button"
                                onClick={() => updateSelectedApplication('under_review')}
                                disabled={!canSubmitToReview}
                                className="rounded-2xl bg-[#6B21A8] px-4 py-3 text-sm font-bold text-white shadow-sm transition-all hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                送入審查
                              </button>
                              <button
                                type="button"
                                onClick={() => updateSelectedApplication('supplement_requested')}
                                disabled={!canRequestSupplement}
                                className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm font-bold text-orange-700 transition-all hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                通知補件
                              </button>
                              <button
                                type="button"
                                onClick={() => updateSelectedApplication('approved')}
                                disabled={!canFinalizeDecision || !REVIEW_FLOW[selectedApplication.reviewStatus].includes('approved')}
                                className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-bold text-green-700 transition-all hover:bg-green-100 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                核准通過
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={() => updateSelectedApplication('rejected')}
                              disabled={!canFinalizeDecision || !REVIEW_FLOW[selectedApplication.reviewStatus].includes('rejected')}
                              className="w-full rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700 transition-all hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              退件不通過
                            </button>
                            </div>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="rounded-[2rem] border border-slate-200 bg-white p-5">
                        <div className="flex items-center gap-2 text-base font-black text-slate-900">
                          <History size={18} className="text-[#6B21A8]" /> 審查歷程
                        </div>
                        <div className="mt-4 space-y-3">
                          {(selectedApplication.reviewHistory ?? []).length > 0 ? [...(selectedApplication.reviewHistory ?? [])].reverse().map((entry) => (
                            <div key={entry.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                              <div className="flex items-center justify-between gap-3">
                                <span className={STATUS_META[entry.status].tone + ' rounded-full border px-2.5 py-1 text-[10px] font-bold'}>{STATUS_META[entry.status].label}</span>
                                <span className="text-[11px] font-semibold text-slate-500">{formatDateTime(entry.createdAt)}</span>
                              </div>
                              <p className="mt-2 text-sm text-slate-700">{entry.note}</p>
                              <div className="mt-2 flex items-center justify-between gap-3 text-[11px] font-semibold text-slate-500">
                                <span>操作人：{entry.reviewerName}</span>
                                {entry.type === 'score' && <span>類型：評分</span>}
                              </div>
                            </div>
                          )) : (
                            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
                              尚無審查歷程紀錄。
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="rounded-[2rem] border border-slate-200 bg-white p-5">
                        <div className="flex items-center gap-2 text-base font-black text-slate-900">
                          <Users size={18} className="text-[#6B21A8]" /> 志願概覽
                        </div>
                        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                          {selectedApplication.selectedDepartments.map((department, index) => (
                            <div key={department.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-bold text-slate-800">{department.name}</p>
                                <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-[#6B21A8]">志願 {index + 1}</span>
                              </div>
                              <p className="mt-2 text-xs text-slate-500">{department.code} · {department.campus}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-[2rem] border border-dashed border-slate-200 bg-white p-10 text-center text-slate-500">
                      <AlertCircle size={28} className="mx-auto text-slate-300" />
                      <p className="mt-4 text-lg font-bold text-slate-800">沒有可審查的案件</p>
                      <p className="mt-2 text-sm text-slate-500">{applications.length === 0 ? '目前尚無報名案件。' : '目前篩選條件下沒有案件，請調整左側的篩選或搜尋條件。'}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-[2rem] border border-slate-200 bg-white p-5 sm:p-6">
              <div className="mb-5 flex items-center gap-3">
                <LayoutDashboard size={18} className="text-[#6B21A8]" />
                <div>
                  <h3 className="text-xl font-black text-slate-900">招生設定</h3>
                  <p className="text-sm text-slate-500">沿用候選端同一組招生規則與欄位設定。</p>
                </div>
              </div>
              <AdminConfigPanel config={channelConfig} onChange={onConfigChange} />
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
