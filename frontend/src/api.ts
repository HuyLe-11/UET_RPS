let csrf = '';
export function setCsrf(value: string) { csrf = value; }
export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.method && options.method !== 'GET') headers.set('X-CSRF-Token', csrf);
  const response = await fetch(path, {...options, headers, credentials: 'same-origin'});
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw new ApiError('Máy chủ không trả về JSON. Kiểm tra Python backend và Vite proxy.', response.status); }
  if (!response.ok) throw new ApiError(data.error || 'Không thể hoàn tất yêu cầu', response.status);
  return data as T;
}
export function post<T>(path: string, body: unknown) { return api<T>(path, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)}); }
export interface User { name: string; role: 'player'|'admin' }
export interface AuthConfig { mode: 'demo'|'supabase'; configured: boolean; open_registration: boolean }
export interface AuthResponse extends Partial<AuthConfig> { user: User | null; csrf: string; redirect?:string }
export interface Status {name:string;status:string;phase:string;round:string|null;open_day:string|null;group?:number;entry:number|null;avg_rank?:number|null;days?:{day:number;pts:number;rank:number;n:number}[]}
export interface Standing { rank:number;name:string;pts:number;gs:number }
export type Move = [number,number,number,number];
export interface ReplayGame {players:('a'|'b')[];moves:[number,Move][];result?:number}
export interface ReplayMatch {rd:number;a:string;b:string;s:number;games:ReplayGame[]}
export interface Replays {available:{round:number;day:number}[];round:number|null;day:number|null;matches:ReplayMatch[]}
