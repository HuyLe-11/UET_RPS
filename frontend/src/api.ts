let csrf = '';
export const DEMO_MODE = true;
export const DEMO_ACCOUNT = {name:'demo', password:'Demo@123456'};
// Demo-only accounts. Never use this frontend authentication for a real contest.
const accounts = new Map<string,string>([[DEMO_ACCOUNT.name, DEMO_ACCOUNT.password]]);
let demoUser: User | null = null;
let submittedFile = '';
export function setCsrf(value: string) { csrf = value; }
export class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (DEMO_MODE) return demoApi(path, options) as Promise<T>;
  const headers = new Headers(options.headers);
  if (options.method && options.method !== 'GET') headers.set('X-CSRF-Token', csrf);
  const response = await fetch(path, {...options, headers, credentials: 'same-origin'});
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.error || 'Không thể hoàn tất yêu cầu', response.status);
  return data as T;
}
async function demoApi(path:string, options:RequestInit):Promise<unknown> {
  const payload = typeof options.body === 'string' ? JSON.parse(options.body) : {};
  if(path==='/api/auth/session')return {user:demoUser,csrf:'demo'};
  if(path==='/api/auth/logout'){demoUser=null;submittedFile='';return {ok:true,csrf:'demo'};}
  if(path==='/api/auth/login'){
    if(typeof payload.name!=='string'||typeof payload.password!=='string'||!accounts.has(payload.name)||accounts.get(payload.name)!==payload.password)throw new ApiError('Tên đăng nhập hoặc mật khẩu không đúng',401);
    demoUser={name:payload.name};return {user:demoUser,csrf:'demo'};
  }
  if(path==='/api/auth/register'){
    if(typeof payload.name!=='string'||! /^[A-Za-z0-9_]{3,20}$/.test(payload.name))throw new ApiError('Tên cần 3–20 ký tự chữ, số hoặc dấu gạch dưới',400);
    if(typeof payload.password!=='string'||payload.password.length<8||payload.password.length>128)throw new ApiError('Mật khẩu cần 8–128 ký tự',400);
    if(accounts.has(payload.name))throw new ApiError('Tên tài khoản đã được sử dụng',409);
    accounts.set(payload.name,payload.password);demoUser={name:payload.name};return {user:demoUser,csrf:'demo'};
  }
  if(path==='/champion')return {champion:null};
  if(!demoUser)throw new ApiError('Vui lòng đăng nhập',401);
  if(path==='/me')return {name:demoUser.name,status:submittedFile?'Đã chọn bot (demo)':'Tài khoản dùng thử',phase:'demo',round:null,open_day:null,entry:null};
  if(path.startsWith('/leaderboard'))return [];
  if(path.startsWith('/replays'))return {available:[],round:null,day:null,matches:[]};
  if(path==='/submit'){
    const file=options.body instanceof FormData?options.body.get('file'):null;
    if(!(file instanceof File)||!file.name.endsWith('.py')||file.size>65536)throw new ApiError('Chọn file .py tối đa 64 KB',400);
    submittedFile=file.name;return {ok:true,demo:true};
  }
  throw new ApiError('Chức năng này cần kết nối backend thật.',400);
}
export function post<T>(path: string, body: unknown) { return api<T>(path, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)}); }
export interface User { name: string }
export interface AuthResponse { user: User | null; csrf: string }
export interface Status {name:string;status:string;phase:string;round:string|null;open_day:string|null;group?:number;entry:number|null;avg_rank?:number|null;days?:{day:number;pts:number;rank:number;n:number}[]}
export interface Standing { rank:number;name:string;pts:number;gs:number }
export type Move = [number,number,number,number];
export interface ReplayGame {players:('a'|'b')[];moves:[number,Move][];result?:number}
export interface ReplayMatch {rd:number;a:string;b:string;s:number;games:ReplayGame[]}
export interface Replays {available:{round:number;day:number}[];round:number|null;day:number|null;matches:ReplayMatch[]}
