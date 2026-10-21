import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://etrvnyvmqkgdfujolref.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0cnZueXZtcWtnZGZ1am9scmVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzMDc1NTUsImV4cCI6MjEwNzg4MzU1NX0.J9oh0x4-PJK7yEIjIQa14pK4jduwTyrR36fgNTtEBvA';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const API_BASE = import.meta.env.VITE_API_URL || '';
const SCORING_MODULE_URL = (import.meta.env.VITE_SCORING_MODULE_URL || '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function getAccessToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || null;
}

export interface ScoringJob {
  id: string;
  status: 'dispatching' | 'accepted' | 'running' | 'succeeded' | 'failed' | 'timed_out' | 'dispatch_failed';
  result?: Record<string, any> | null;
  error_code?: string | null;
  error_message?: string | null;
}

export async function createAndDispatchScoringJob(
  file: File,
  kind: 'entry' | 'test' = 'entry',
): Promise<string> {
  if (!SCORING_MODULE_URL) throw new Error('Chưa cấu hình VITE_SCORING_MODULE_URL');
  const token = await getAccessToken();
  if (!token) throw new Error('Phiên đăng nhập đã hết hạn');
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  const id = crypto.randomUUID();

  const createJob = supabase.rpc('create_scoring_job', {
    p_job_id: id,
    p_kind: kind,
    p_rnd: null,
    p_day: null,
    p_sha256: sha256,
    p_size_bytes: file.size,
  });
  const body = new FormData();
  body.append('file', file);
  const dispatchController = new AbortController();
  const dispatchTimer = window.setTimeout(() => dispatchController.abort(), 10_000);
  const dispatch = fetch(`${SCORING_MODULE_URL}/v1/jobs/${id}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body,
    signal: dispatchController.signal,
  }).then(async response => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(payload.detail || 'Máy chấm không nhận bài', response.status);
    return payload;
  }).finally(() => window.clearTimeout(dispatchTimer));

  const [jobResult, dispatchResult] = await Promise.allSettled([createJob, dispatch]);
  const acceptedAfterRace = async () => {
    const { data: currentJob } = await supabase
      .from('scoring_jobs')
      .select('status')
      .eq('id', id)
      .maybeSingle();
    return Boolean(currentJob && ['accepted', 'running', 'succeeded'].includes(currentJob.status));
  };
  if (jobResult.status === 'rejected' || jobResult.value.error) {
    if (await acceptedAfterRace()) return id;
    await supabase.rpc('fail_scoring_dispatch', { p_job_id: id });
    if (await acceptedAfterRace()) return id;
    const reason = jobResult.status === 'rejected' ? jobResult.reason?.message : jobResult.value.error?.message;
    throw new Error(scoringErrorMessage(reason));
  }
  if (dispatchResult.status === 'rejected') {
    if (await acceptedAfterRace()) return id;
    await supabase.rpc('fail_scoring_dispatch', { p_job_id: id });
    if (await acceptedAfterRace()) return id;
    if (dispatchResult.reason?.name === 'AbortError') {
      throw new Error('Máy chấm chưa xác nhận nhận bài trong 10 giây. Hãy kiểm tra kết nối rồi thử lại.');
    }
    throw dispatchResult.reason;
  }
  return id;
}

function scoringErrorMessage(message: string): string {
  const known: Record<string, string> = {
    entry_closed: 'Giai đoạn vòng loại đã đóng. Hãy tải lại trang hoặc liên hệ ban tổ chức.',
    submission_context_stale: 'Thông tin cuộc thi chưa được đồng bộ. Vui lòng liên hệ ban tổ chức.',
    submissions_closed: 'Ban tổ chức đang tạm đóng nhận bài.',
    qualification_attempt_limit: 'Bạn đã dùng hết 20 lượt nộp ở giai đoạn vòng loại.',
    account_not_allowed: 'Tài khoản hiện không được phép tham gia cuộc thi.',
  };
  const key = Object.keys(known).find((candidate) => message?.includes(candidate));
  return key ? known[key] : message || 'Không thể tạo yêu cầu chấm bài.';
}

export interface ScoringState {
  phase: 'entry' | 'round' | 'done';
  accepting: boolean;
  attempts: number;
  bestScore: number | null;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  const headers = new Headers(options.headers);
  
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const url = `${API_BASE}${path}`;
  const response = await fetch(url, {
    ...options,
    headers,
  });

  const contentType = response.headers.get('content-type') || '';
  let data: any = null;
  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    const errorMsg = (typeof data === 'object' && (data?.detail || data?.error || data?.message)) || 'Không thể hoàn tất yêu cầu';
    throw new ApiError(errorMsg, response.status);
  }

  return data as T;
}

export function post<T>(path: string, body: unknown) {
  return api<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export interface User {
  id?: string;
  name: string;
  email?: string;
  role?: string;
}

export interface Status {
  name: string;
  email?: string;
  role?: string;
  status: string;
  phase: string;
  round: string | null;
  open_day: string | null;
  group?: number;
  entry: number | null;
  avg_rank?: number | null;
  days?: { day: number; pts: number; rank: number; n: number }[];
}

export interface Standing {
  rank: number;
  name: string;
  pts: number;
  gs: number;
}

export type Move = [number, number, number, number];

export interface ReplayGame {
  players: ('a' | 'b')[];
  moves: [number, Move][];
  result?: number;
}

export interface ReplayMatch {
  id?: number | string;
  kind?: 'match' | 'job';
  storagePath?: string;
  rd: number;
  a: string;
  b: string;
  s: number;
  games?: ReplayGame[];
}

export interface Replays {
  available: { round: number; day: number }[];
  round: number | null;
  day: number | null;
  matches: ReplayMatch[];
}

export async function getReplayMetadata(round?: number, day?: number): Promise<Replays> {
  const { data, error } = await supabase.rpc('get_my_replay_matches');
  if (error) throw new Error(error.message);
  const rows = (data || []) as Array<{ replay_id: string; replay_kind: 'match' | 'job'; rnd: number; day: number; rd: number; player_a: string; player_b: string; score_a: number; storage_path: string }>;
  const dates = [...new Map(rows.map(row => [`${row.rnd},${row.day}`, { round: row.rnd, day: row.day }])).values()]
    .sort((a, b) => b.round - a.round || b.day - a.day);
  const selected = round !== undefined && day !== undefined
    ? { round, day }
    : dates.find(date => date.round === 0 && date.day === 0) || dates[0] || null;
  const matches = selected ? rows
    .filter(row => row.rnd === selected.round && row.day === selected.day)
    .map(row => ({ id: row.replay_id, kind: row.replay_kind, storagePath: row.storage_path, rd: row.rd, a: row.player_a, b: row.player_b, s: row.score_a, games: [] })) : [];
  return { available: dates, round: selected?.round ?? null, day: selected?.day ?? null, matches };
}

export async function loadMatchReplay(storagePath: string): Promise<ReplayGame[]> {
  const { data: signed, error: signError } = await supabase.storage
    .from('replays')
    .createSignedUrl(storagePath, 120);
  if (signError) throw new Error(signError.message);
  const response = await fetch(signed.signedUrl);
  if (!response.ok) throw new Error('Không tải được replay từ kho lưu trữ');
  const compressed = await response.arrayBuffer();
  if (!('DecompressionStream' in window)) throw new Error('Trình duyệt không hỗ trợ giải nén replay');
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
  const payload = await new Response(stream).json().catch(() => null);
  if (!Array.isArray(payload)) throw new Error('Dữ liệu replay không hợp lệ');
  return payload as ReplayGame[];
}

export interface WebDashboard {
  status: Status;
  scoring: { phase: 'entry' | 'round' | 'done'; accepting: boolean; attempts: number; bestScore: number | null };
  standings: Standing[];
  champion: string | null;
}

export async function getWebDashboard(): Promise<WebDashboard> {
  const { data, error } = await supabase.rpc('get_my_dashboard');
  if (error) throw new Error(error.message);
  return data as WebDashboard;
}

export interface AdminOverview {
  phase: string;
  round: number | null;
  day: number | null;
  pending: number | null;
  accepting: boolean;
  total_users: number;
  active_users: number;
  champion?: string | null;
}
