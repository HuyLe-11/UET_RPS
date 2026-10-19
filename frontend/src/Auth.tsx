import {useState} from 'react';
import {ArrowRight, Check, Code2, Eye, EyeOff, Fingerprint, LockKeyhole, ShieldCheck, Sparkles, Swords, Trophy, UserRound} from 'lucide-react';
import {DEMO_ACCOUNT, post, setCsrf, type AuthResponse, type User} from './api';

export function Brand() { return <a className="brand" href="/"><span className="brand-icon"><Swords size={23}/></span><span>OTT<span className="brand-light">ARENA</span><small>CODE. COMPETE. CONQUER.</small></span></a>; }

export default function Auth({onLogin}:{onLogin:(user:User)=>void}) {
  const [mode,setMode]=useState<'login'|'register'|'token'>('login');
  const [show,setShow]=useState(false), [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [password,setPassword]=useState(DEMO_ACCOUNT.password);
  const changeMode=(next:typeof mode)=>{setMode(next);setError('');setPassword('');};
  async function submit(form:HTMLFormElement) {
    const data=new FormData(form);
    if(mode==='register' && data.get('password')!==data.get('confirm')) {setError('Mật khẩu xác nhận chưa khớp.');return;}
    setBusy(true);setError('');
    try {
      const body=mode==='token'?{token:String(data.get('token')).trim()}:{name:String(data.get('name')).trim(),password:data.get('password')};
      const result=await post<AuthResponse>(`/api/auth/${mode}`,body);
      setCsrf(result.csrf); if(result.user) onLogin(result.user);
    } catch(error) {setError(error instanceof Error?error.message:'Không thể kết nối. Vui lòng thử lại.');}
    finally {setBusy(false);}
  }
  return <div className="auth-layout">
    <section className="auth-story"><Brand/><div className="story-body">
      <span className="pill"><span className="live-dot"/> ĐẤU TRƯỜNG BOT OẲN TÙ TÌ</span>
      <h1>Mỗi nước đi.<br/>Một <span>chiến thuật.</span></h1>
      <p>Biến ý tưởng thành thuật toán. Đưa bot của bạn lên bàn cờ và chinh phục đấu trường.</p>
      <div className="game-art" aria-label="Minh họa bàn cờ bot oẳn tù tì"><div className="art-top"><span><span className="live-dot"/> BOT ARENA</span><span>9 × 9 BOARD</span></div>
        <div className="mini-board">{Array.from({length:49},(_,i)=><div key={i} className={(Math.floor(i/7)+i%7)%2?'shade':''}>{({3:'✊',9:'✌️',15:'🖐',24:'✊',33:'✌️',39:'🖐',45:'✊'} as Record<number,string>)[i]&&<span className={`art-piece ${i>24?'violet':'blue'}`}>{({3:'✊',9:'✌️',15:'🖐',24:'✊',33:'✌️',39:'🖐',45:'✊'} as Record<number,string>)[i]}</span>}</div>)}</div>
        <div className="floating-tag"><Code2 size={17}/><span>Thuật toán của bạn.<br/><strong>Dấu ấn của bạn.</strong></span><Sparkles size={18}/></div>
      </div>
      <div className="story-features"><span><Code2/> Viết bot Python</span><span><Swords/> Thi đấu BO2</span><span><Trophy/> Leo bảng xếp hạng</span></div>
    </div><footer>OTT ARENA <span>Không ngừng học hỏi. Không ngừng tiến bộ.</span></footer></section>
    <section className="auth-panel"><div className="auth-top"><span className="badge">BẢN DEMO · KHÔNG CẦN SQLITE</span></div>
      <div className="auth-card"><span className="form-icon">{mode==='register'?<Sparkles/>:<Fingerprint/>}</span><p className="eyebrow">SẴN SÀNG CHO THỬ THÁCH?</p>
        <h2>{mode==='register'?'Bắt đầu hành trình.':mode==='token'?'Chào người chơi cũ.':'Chào mừng trở lại.'}</h2>
        <p>{mode==='register'?'Tạo tài khoản và mang chiến thuật của bạn vào cuộc chơi.':mode==='token'?'Dùng token đã được cấp để truy cập tài khoản hiện có.':'Đăng nhập để tiếp tục hành trình trên đấu trường.'}</p>
        <div className="auth-tabs" role="tablist" aria-label="Tài khoản"><button role="tab" aria-selected={mode!=='register'} className={mode!=='register'?'selected':''} onClick={()=>changeMode('login')} disabled={busy}>Đăng nhập</button><button role="tab" aria-selected={mode==='register'} className={mode==='register'?'selected':''} onClick={()=>changeMode('register')} disabled={busy}>Tạo tài khoản</button></div>
        {mode==='login'&&<div className="demo-account"><strong>Tài khoản có sẵn</strong><span>Tên đăng nhập: <code>demo</code></span><span>Mật khẩu: <code>Demo@123456</code></span></div>}
        <form key={mode} onSubmit={e=>{e.preventDefault();void submit(e.currentTarget);}}>
          <fieldset disabled={busy}>
          {mode==='token'?<label>Token tài khoản<div className="input-wrap"><Fingerprint size={18}/><input name="token" required autoComplete="off" type="password" placeholder="Dán token của bạn"/></div></label>:<>
            <label>Tên tài khoản<div className="input-wrap"><UserRound size={18}/><input name="name" defaultValue={mode==='login'?DEMO_ACCOUNT.name:''} required minLength={3} maxLength={20} pattern="[A-Za-z0-9_]{3,20}" autoComplete="username" placeholder="Nhập tên tài khoản"/></div>{mode==='register'&&<small>3–20 ký tự, gồm chữ, số hoặc dấu gạch dưới.</small>}</label>
            <label>Mật khẩu<div className="input-wrap"><LockKeyhole size={18}/><input name="password" required minLength={mode==='register'?8:1} maxLength={128} autoComplete={mode==='register'?'new-password':'current-password'} type={show?'text':'password'} placeholder={mode==='register'?'Tạo mật khẩu (ít nhất 8 ký tự)':'Nhập mật khẩu của bạn'} value={password} onChange={e=>setPassword(e.target.value)}/><button className="icon-button" type="button" aria-label={show?'Ẩn mật khẩu':'Hiện mật khẩu'} onClick={()=>setShow(!show)}>{show?<EyeOff size={18}/>:<Eye size={18}/>}</button></div></label>
            {mode==='register'&&<><div className="password-meter"><i className={password.length>=8?'filled':''}/><i className={password.length>=12?'filled':''}/><i className={password.length>=12&&/[0-9]/.test(password)&&/[^A-Za-z0-9]/.test(password)?'filled':''}/></div><label>Xác nhận mật khẩu<div className="input-wrap"><ShieldCheck size={18}/><input name="confirm" type={show?'text':'password'} required minLength={8} maxLength={128} autoComplete="new-password" placeholder="Nhập lại mật khẩu"/></div></label></>}
          </>}
          {error&&<div className="form-error" role="alert">{error}</div>}
          <button className="primary auth-submit" type="submit">{busy?'Đang xử lý…':mode==='register'?'Tạo tài khoản': 'Vào đấu trường'}{!busy&&<ArrowRight size={18}/>}</button>
          </fieldset>
        </form>
        <div className="auth-divider"><span>thử ngay</span></div><button className="token-button" disabled={busy} onClick={async()=>{setBusy(true);try{const result=await post<AuthResponse>('/api/auth/login',DEMO_ACCOUNT);if(result.user)onLogin(result.user);}finally{setBusy(false);}}}><Fingerprint size={18}/>Vào bằng tài khoản demo</button>
        <p className="secure-note"><ShieldCheck size={15}/> Dữ liệu demo trong bộ nhớ, được xóa khi tải lại trang.</p>
      </div><div className="auth-bottom"><span><Check size={14}/> Sáng tạo chiến thuật</span><span><Check size={14}/> Cạnh tranh công bằng</span></div>
    </section>
  </div>;
}
