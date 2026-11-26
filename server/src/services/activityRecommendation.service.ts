import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { events, registrations, users } from '../db/schema';
import { parseTaipeiDateTime } from '../utils/time';

/**
 * 校園活動推薦（自動計算版）
 *
 * 演算法維持「能力標籤向量 + 餘弦相似度」：
 * 1. 活動向量：依活動「類別」自動對應 5 個能力標籤，再以標題／說明中的關鍵字微調。
 * 2. 學生向量：把學生參加過的活動向量加總，簽到與評分會提高權重。
 * 3. 以餘弦相似度計算學生與每個可報名活動的契合度，由高到低排序。
 * 學生沒有任何紀錄時，改推薦報名人數最多的熱門活動。
 */

export const SKILL_TAGS = ['程式邏輯', '商業企劃', '團隊溝通', '美感設計', '數據分析'] as const;
type Vector = number[];

// 活動類別 → 能力標籤權重（順序同 SKILL_TAGS）
const CATEGORY_WEIGHTS: Record<string, Vector> = {
  '研討會': [0.3, 0.6, 0.4, 0.1, 1.0],
  '專題演講/講座': [0.2, 1.0, 0.4, 0.2, 0.5],
  '研習活動': [1.0, 0.3, 0.3, 0.2, 0.6],
  '工作坊/研習營': [1.0, 0.2, 0.6, 0.5, 0.3],
  '藝文活動': [0.0, 0.1, 0.4, 1.0, 0.0],
  '座談/說明會': [0.1, 0.6, 1.0, 0.1, 0.2],
  '成果展': [1.0, 0.7, 0.6, 0.6, 0.5],
  '參訪觀摩': [0.2, 1.0, 0.6, 0.3, 0.3],
  '活動通告': [0.1, 0.2, 1.0, 0.2, 0.1],
  '課程': [1.0, 0.2, 0.1, 0.1, 0.7],
};
const DEFAULT_WEIGHTS: Vector = [0.3, 0.3, 0.3, 0.3, 0.3];

// 標題／說明關鍵字 → 對應的能力標籤（每個標籤最多加分一次）
const KEYWORDS: string[][] = [
  ['python', 'java', 'react', 'c++', '程式', 'coding', 'ai', '人工智慧', 'app', '網頁', '前端', '後端', '資訊', 'its', '演算法', '系統開發'],
  ['創業', '行銷', '企劃', '商業', '職涯', '管理', '提案', '財務', '電商', '轉型', '金融', '會計'],
  ['志工', '服務', '社團', '團隊', '領導', '溝通', '交流', '座談', '輔導', '迎新', '營隊', '英語', '英文', '語言'],
  ['設計', '藝術', '美術', '歌唱', '音樂', '攝影', '影像', '繪', '展演', '舞', '創作', '好聲音'],
  ['資料', '數據', '分析', '統計', '機器學習', '大數據', 'excel', 'power bi'],
];
const KEYWORD_BOOST = 0.5;

type EventRow = typeof events.$inferSelect;

export function activityVector(event: Pick<EventRow, 'category' | 'title' | 'description'>): Vector {
  const base = [...(CATEGORY_WEIGHTS[event.category || ''] ?? DEFAULT_WEIGHTS)];
  const text = `${event.title || ''} ${event.description || ''}`.toLowerCase();
  KEYWORDS.forEach((words, index) => {
    if (words.some(word => text.includes(word))) base[index] += KEYWORD_BOOST;
  });
  const max = Math.max(...base);
  return max > 0 ? base.map(value => value / max) : base;
}

function cosineSimilarity(a: Vector, b: Vector): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return normA && normB ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
}

// 參與程度權重：報名 1、簽到再 +1；評分 1–5 星換算為 0.7–1.5 倍
function participationWeight(reg: { isCheckedIn: boolean | null; rating: number | null }): number {
  const base = reg.isCheckedIn ? 2 : 1;
  const rating = Number(reg.rating);
  return rating >= 1 && rating <= 5 ? base * (0.5 + rating / 5) : base;
}

// 雷達圖分數：各能力在參與活動中的加權平均（0–100），反映學生的強項分布
function toRadarScores(vector: Vector, totalWeight: number): number[] {
  return vector.map(value => (totalWeight > 0 ? Math.round((value / totalWeight) * 100) : 0));
}

export type ActivityRecommendation = {
  activityId: number;
  title: string;
  category: string | null;
  matchRate: number;
  reason: string;
  registrations: number;
};

export type ActivityRecommendationResult = {
  basis: 'history' | 'popular';
  historyCount: number;
  profile: { labels: string[]; scores: number[] };
  recommendations: ActivityRecommendation[];
};

export async function getPersonalActivityRecommendations(studentNumber: string, topK = 5): Promise<ActivityRecommendationResult> {
  const now = Date.now();
  const allEvents = (await db.select().from(events)).filter(event => event.status !== 'deleted');

  const counts = await db
    .select({ eventId: registrations.eventId, count: sql<number>`count(*)::int` })
    .from(registrations)
    .where(sql`${registrations.status} IS DISTINCT FROM 'cancelled' AND ${registrations.status} IS DISTINCT FROM 'payment_pending'`)
    .groupBy(registrations.eventId);
  const countMap = new Map(counts.map(row => [Number(row.eventId), Number(row.count)]));

  // 學生的參與紀錄
  const [user] = studentNumber
    ? await db.select({ id: users.id }).from(users).where(eq(users.studentId, studentNumber)).limit(1)
    : [];
  const history = user
    ? await db
        .select({ eventId: registrations.eventId, isCheckedIn: registrations.isCheckedIn, rating: registrations.rating, status: registrations.status })
        .from(registrations)
        .where(and(eq(registrations.userId, user.id), sql`${registrations.status} IS DISTINCT FROM 'cancelled' AND ${registrations.status} IS DISTINCT FROM 'payment_pending'`))
    : [];

  const eventMap = new Map(allEvents.map(event => [event.id, event]));
  const studentVector: Vector = SKILL_TAGS.map(() => 0);
  let historyCount = 0;
  let totalWeight = 0;
  for (const reg of history) {
    if (reg.eventId == null) continue;
    const event = eventMap.get(reg.eventId);
    if (!event) continue;
    historyCount += 1;
    const weight = participationWeight(reg);
    totalWeight += weight;
    activityVector(event).forEach((value, index) => { studentVector[index] += value * weight; });
  }
  const joined = new Set(history.map(reg => reg.eventId));

  // 只推薦目前還能報名（或即將開放）且未額滿、尚未參加的活動
  const candidates = allEvents.filter(event => {
    if (joined.has(event.id)) return false;
    const end = parseTaipeiDateTime(event.registrationEnd);
    if (Number.isFinite(end) && now > end) return false;
    return (countMap.get(event.id) ?? 0) < Number(event.capacity || 0);
  });

  const profile = { labels: [...SKILL_TAGS], scores: toRadarScores(studentVector, totalWeight) };

  if (historyCount === 0) {
    const popular = candidates
      .map(event => ({ event, registrations: countMap.get(event.id) ?? 0 }))
      .sort((a, b) => b.registrations - a.registrations || a.event.id - b.event.id)
      .slice(0, topK)
      .map(({ event, registrations }) => ({
        activityId: event.id,
        title: event.title,
        category: event.category,
        matchRate: 0,
        reason: registrations > 0 ? `熱門活動，已有 ${registrations} 人報名` : '近期開放報名的活動',
        registrations,
      }));
    return { basis: 'popular', historyCount, profile, recommendations: popular };
  }

  const recommendations = candidates
    .map(event => {
      const vector = activityVector(event);
      const similarity = cosineSimilarity(studentVector, vector);
      // 推薦理由：學生分數與活動權重乘積最高的標籤
      const best = vector
        .map((value, index) => ({ index, score: value * studentVector[index] }))
        .sort((a, b) => b.score - a.score)[0];
      return {
        activityId: event.id,
        title: event.title,
        category: event.category,
        matchRate: Math.round(similarity * 100),
        reason: `符合你在「${SKILL_TAGS[best.index]}」的參與經驗`,
        registrations: countMap.get(event.id) ?? 0,
      };
    })
    .sort((a, b) => b.matchRate - a.matchRate || b.registrations - a.registrations)
    .slice(0, topK);

  return { basis: 'history', historyCount, profile, recommendations };
}
