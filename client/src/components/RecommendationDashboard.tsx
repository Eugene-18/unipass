import React, { useEffect, useState } from 'react';
import {
  Chart as ChartJS,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';
import { Radar } from 'react-chartjs-2';
import { ArrowRight, Sparkles, TrendingUp } from 'lucide-react';
import { API_ORIGIN } from '../config/api';

// 註冊 Chart.js 元件
ChartJS.register(
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend
);

interface Recommendation {
  activityId: number;
  title: string;
  category: string | null;
  matchRate: number;
  reason: string;
  registrations: number;
}

interface RecommendationData {
  basis: 'history' | 'popular';
  historyCount: number;
  profile: { labels: string[]; scores: number[] };
  recommendations: Recommendation[];
}

const CHART_OPTIONS = {
  responsive: true,
  maintainAspectRatio: true,
  scales: { r: { suggestedMin: 0, suggestedMax: 100, ticks: { stepSize: 20 } } },
  plugins: { legend: { display: false } },
};

/**
 * AI 專屬校園活動推薦
 * 能力雷達圖與推薦清單都由後端依「登入者自己的報名、簽到、評分紀錄」自動計算。
 */
export const RecommendationDashboard: React.FC<{
  studentId: string;
  onOpenActivity?: (activityId: number) => void;
}> = ({ studentId, onOpenActivity }) => {
  const [data, setData] = useState<RecommendationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let isMounted = true;
    fetch(`${API_ORIGIN}/api/recommendations/activities?studentId=${encodeURIComponent(studentId)}`)
      .then(response => response.json())
      .then(result => {
        if (!isMounted) return;
        if (result.success && result.data) setData(result.data as RecommendationData);
        else setFailed(true);
      })
      .catch(error => {
        console.error('取得活動推薦資料失敗:', error);
        if (isMounted) setFailed(true);
      })
      .finally(() => { if (isMounted) setLoading(false); });
    return () => { isMounted = false; };
  }, [studentId]);

  if (loading) return <div className="rounded-xl bg-white p-6 text-center text-gray-500 shadow-lg">AI 正在計算最適合你的校園活動...</div>;
  if (failed || !data) return <div className="rounded-xl bg-white p-6 text-center text-gray-500 shadow-lg">暫時無法取得推薦，請稍後再試。</div>;

  const hasHistory = data.basis === 'history';
  const chartData = {
    labels: data.profile.labels,
    datasets: [
      {
        label: '你的能力分數',
        data: data.profile.scores,
        backgroundColor: 'rgba(54, 162, 235, 0.2)',
        borderColor: 'rgba(54, 162, 235, 1)',
        borderWidth: 2,
      },
    ],
  };

  return (
    <div className="mx-auto max-w-4xl rounded-xl bg-white p-4 shadow-lg sm:p-6">
      <h2 className="mb-6 text-center text-xl font-bold text-gray-800 sm:text-2xl">
        AI 專屬校園活動推薦
      </h2>

      <div className="flex flex-col items-center gap-6 md:flex-row md:items-start md:gap-8">
        <div className="mx-auto w-full max-w-sm md:w-1/2 md:max-w-none">
          <h3 className="mb-2 text-center font-semibold text-gray-700">你的能力雷達圖</h3>
          {hasHistory ? (
            <>
              <Radar data={chartData} options={CHART_OPTIONS} />
              <p className="mt-2 text-center text-xs text-gray-500">依你參加過的 {data.historyCount} 場活動自動計算，簽到與評分會提高權重</p>
            </>
          ) : (
            <div className="flex aspect-square w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 p-6 text-center text-gray-500">
              <Sparkles className="mb-3 text-blue-400" size={36} />
              <p className="font-bold text-gray-700">還沒有參與紀錄</p>
              <p className="mt-2 text-sm leading-6">報名、簽到或評分活動後，系統會依活動類別自動計算你的能力分數，並推薦最適合你的活動。</p>
            </div>
          )}
        </div>

        <div className="w-full md:w-1/2">
          <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-blue-600">
            {hasHistory ? <>為你推薦的專屬活動 Top {data.recommendations.length}：</> : <><TrendingUp size={20} /> 目前的熱門活動：</>}
          </h3>
          {data.recommendations.length === 0 ? (
            <p className="rounded-lg bg-gray-50 p-6 text-center text-gray-500">目前沒有可報名的新活動，敬請期待！</p>
          ) : (
            <ul className="space-y-3">
              {data.recommendations.map((rec) => (
                <li key={rec.activityId}>
                  <button
                    type="button"
                    onClick={() => onOpenActivity?.(rec.activityId)}
                    disabled={!onOpenActivity}
                    className="group flex w-full items-center justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3 text-left transition hover:border-blue-200 hover:bg-white hover:shadow-md sm:p-4"
                  >
                    <span className="min-w-0">
                      <span className="block break-words font-bold text-gray-700 sm:text-lg">{rec.title}</span>
                      <span className="mt-1 block text-xs text-gray-500">{rec.reason}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end">
                      {hasHistory && <span className="whitespace-nowrap text-lg font-bold text-blue-500 sm:text-xl">{rec.matchRate}% 契合</span>}
                      {onOpenActivity && (
                        <span className="mt-1 inline-flex items-center gap-1 whitespace-nowrap rounded-lg bg-blue-100 px-3 py-1 text-sm font-semibold text-blue-600 transition group-hover:bg-blue-200">
                          查看詳情 <ArrowRight size={14} />
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};
