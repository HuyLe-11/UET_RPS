import {useCallback,useEffect,useState} from 'react';
import {ArrowDownToLine,ArrowRight,BookOpen,ChartNoAxesColumnIncreasing,Check,ChevronRight,Code2,LayoutDashboard,LogOut,PanelLeftClose,PanelLeftOpen,RefreshCw,ShieldCheck,Swords,Trophy,Upload,UserRound} from 'lucide-react';
import Auth,{Brand} from './Auth';
import Replay from './Replay';
import ThemeToggle from './ThemeToggle';
import './sidebar.css';
import {api,post,setCsrf,type AuthConfig,type AuthResponse,type Replays,type Standing,type Status,type User} from './api';
const emptyReplays:Replays={available:[],round:null,day:null,matches:[]};
const statusLabel:Record<string,string>={new:'Chờ thi đầu vào',active:'Đang thi đấu',eliminated:'Đã dừng bước',out:'Đã dừng bước',entry:'Thi đầu vào',round:'Vòng thi đấu',done:'Đã kết thúc'};
export default function App(){
  const [user,setUser]=useState<User|null>(null),[ready,setReady]=useState(false),[initError,setInitError]=useState('');
  const [config,setConfig]=useState<AuthConfig>({mode:'demo',configured:false,open_registration:false});
  function loggedIn(next:User){if(next.role==='admin'){window.location.assign('/admin');return;}setUser(next);}
  useEffect(()=>{api<AuthResponse>('/api/auth/session').then(d=>{setCsrf(d.csrf);setConfig({mode:d.mode??'demo',configured:d.configured??false,open_registration:d.open_registration??false});if(d.user?.role==='admin'){window.location.assign('/admin');return;}setUser(d.user);setReady(true);}).catch(()=>setInitError('Chưa kết nối được máy chủ. Hãy chạy Python backend và tải lại trang.'));},[]);
  return <>
    <ThemeToggle/>
    {!ready
      ? <div className="loading-screen"><Swords/><h2>OTT ARENA</h2><p>{initError||'Đang chuẩn bị đấu trường…'}</p>{initError&&<button className="primary" onClick={()=>window.location.reload()}>Thử lại</button>}</div>
      : user
        ? <Dashboard user={user} config={config} onLogout={()=>setUser(null)}/>
        : <Auth config={config} onLogin={loggedIn}/>
    }
  </>;
}
function Dashboard({user,config,onLogout}:{user:User;config:AuthConfig;onLogout:()=>void}){
  const [tab,setTab]=useState<'overview'|'leaderboard'|'replay'|'rules'>('overview');
  const [sidebarCollapsed,setSidebarCollapsed]=useState(false);
  const [status,setStatus]=useState<Status|null>(null),[standings,setStandings]=useState<Standing[]>([]),[replays,setReplays]=useState<Replays>(emptyReplays);
  const [message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[uploading,setUploading]=useState(false),[logoutBusy,setLogoutBusy]=useState(false);
  const [file,setFile]=useState<File|null>(null),[champion,setChampion]=useState<string|null>(null);
  const refresh=useCallback(async()=>{setBusy(true);setError('');try{
    const [s,l,r,c]=await Promise.all([api<Status>('/me'),api<Standing[]>('/leaderboard'),api<Replays>('/replays'),api<{champion:string|null}>('/champion')]);
    setStatus(s);setStandings(l);setReplays(r);setChampion(c.champion);
  }catch(e){setError(e instanceof Error?e.message:'Không tải được dữ liệu');}finally{setBusy(false);}},[]);
  useEffect(()=>{void refresh();},[refresh]);
  async function upload(form:HTMLFormElement){if(!file)return;setUploading(true);setError('');setMessage('');try{if(!file.name.endsWith('.py'))throw new Error('Chỉ nhận file Python .py');if(file.size>65536)throw new Error('File bot không được vượt quá 64 KB');const body=new FormData();body.append('file',file);await api('/submit',{method:'POST',body});setMessage('Nộp bot thành công. Backend đã kiểm tra và lưu bài; chờ ban tổ chức chấm.');form.reset();setFile(null);await refresh();}catch(e){setError(e instanceof Error?e.message:'Nộp bài thất bại');}finally{setUploading(false);}}
  const navigation=[['overview',LayoutDashboard,'Tổng quan'],['leaderboard',Trophy,'Bảng xếp hạng'],['replay',Swords,'Phát lại trận đấu'],['rules',BookOpen,'Luật thi đấu']] as const;
  return <div className="dashboard"><aside id="dashboard-sidebar" className={`sidebar ${sidebarCollapsed?'is-collapsed':''}`}>
    <div className="sidebar-header"><Brand/><button
      type="button"
      className="sidebar-toggle secondary"
      aria-label={sidebarCollapsed?'Mở rộng sidebar':'Thu gọn sidebar'}
      title={sidebarCollapsed?'Mở rộng sidebar':'Thu gọn sidebar'}
      aria-expanded={!sidebarCollapsed}
      aria-controls="dashboard-navigation"
      onClick={()=>setSidebarCollapsed(current=>!current)}
    >{sidebarCollapsed?<PanelLeftOpen size={18}/>:<PanelLeftClose size={18}/>}</button></div>
    <p className="nav-caption">ĐẤU TRƯỜNG CỦA BẠN</p><nav id="dashboard-navigation" aria-label="Điều hướng thí sinh">{navigation.map(([key,Icon,text])=><button key={key} aria-label={text} title={sidebarCollapsed?text:undefined} className={tab===key?'active':''} onClick={()=>setTab(key)}><Icon size={19}/><span className="sidebar-label">{text}</span>{tab===key&&<ChevronRight className="nav-chevron" size={15}/>}</button>)}</nav>
    <div className="sidebar-tip"><ShieldCheck/><h3>Sẵn sàng bứt phá?</h3><p>Hoàn thiện thuật toán và nộp bot trước khi ban tổ chức chốt ngày thi.</p><a href="/sample_bot.py" target="_blank" rel="noreferrer">Xem bot mẫu <ArrowRight size={15}/></a></div>
    <a className="live-link" href="/live" aria-label="Theo dõi giải trực tiếp" title={sidebarCollapsed?'Theo dõi giải trực tiếp':undefined}><span className="live-dot"/><span className="sidebar-label">Theo dõi giải trực tiếp</span></a><a className="admin-link" href="/admin" aria-label="Dành cho ban tổ chức" title={sidebarCollapsed?'Dành cho ban tổ chức':undefined}><ShieldCheck size={16}/><span className="sidebar-label">Dành cho ban tổ chức ↗</span></a>
    <div className="sidebar-user"><span className="avatar" title={user.name}>{user.name.slice(0,2).toUpperCase()}</span><div className="sidebar-user-details"><strong>{user.name}</strong><small>Thí sinh</small></div><button aria-label="Đăng xuất" title="Đăng xuất" disabled={logoutBusy} onClick={async()=>{setLogoutBusy(true);try{const d=await post<{csrf:string}>('/api/auth/logout',{});setCsrf(d.csrf);onLogout();}catch(e){setError(e instanceof Error?e.message:'Không đăng xuất được');setLogoutBusy(false);}}}><LogOut size={18}/></button></div>
    </aside><div className="dashboard-main"><header className="dashboard-header"><span>Không gian thí sinh <ChevronRight size={14}/> {navigation.find(n=>n[0]===tab)?.[2]}</span><span className="badge"><span className="live-dot"/> OTT COMPETITION</span></header>
      <main className="dashboard-content"><div className="page-title"><div><p className="eyebrow">LET’S MAKE YOUR NEXT MOVE</p><h1>{tab==='overview'?`Chào ${user.name}!`:navigation.find(n=>n[0]===tab)?.[2]}</h1><p>{tab==='overview'?'Một chiến thuật tốt bắt đầu từ một ý tưởng. Hôm nay bạn đã sẵn sàng chưa?':'Theo dõi, phân tích và hoàn thiện chiến thuật của bạn.'}</p></div><button className="secondary refresh-button" disabled={busy} onClick={()=>void refresh()}><RefreshCw size={16} className={busy?'spin':''}/>{busy?'Đang tải':'Làm mới'}</button></div>
      {config.mode==='demo'&&<div className="demo-account"><strong>Backend local đã kết nối</strong><span>Tài khoản lưu trong bộ nhớ Python. Bài nộp và kết quả giải được lưu thật; bot sẽ thi đấu sau khi ban tổ chức chạy chấm.</span></div>}
      {error&&<div className="form-error" role="alert">{error}</div>}{message&&<div className="success" role="status"><Check size={18}/>{message}</div>}
      {champion&&<div className="champion-banner"><Trophy/> Nhà vô địch giải đấu: <strong>{champion}</strong></div>}
      {tab==='overview'&&<>
        <section className="welcome-banner"><div><span className="pill">ĐẤU TRƯỜNG THUẬT TOÁN</span><h2>Code thông minh.<br/>Chơi khác biệt.</h2><p>✊ Búa · 🖐 Bao · ✌️ Kéo — Ba loại quân, vô vàn chiến thuật.</p><button onClick={()=>setTab('rules')}>Khám phá luật chơi <ArrowRight size={16}/></button></div><div className="banner-pieces" aria-hidden="true"><span>✊</span><span>🖐</span><span>✌️</span></div></section>
        <div className="stat-grid">{[[UserRound,'Trạng thái',status?statusLabel[status.status]??status.status:'—'],[Swords,'Vòng / Ngày',`${status?.round??'—'} / ${status?.open_day??'—'}`],[ChartNoAxesColumnIncreasing,'Điểm đầu vào',status?.entry??'—'],[Trophy,'Bảng thi đấu',status?.group??'Chưa chia bảng']].map(([Icon,label,value],i)=>{const I=Icon as typeof Trophy;return <div className="stat-card" key={i}><span className={`stat-icon color-${i}`}><I size={20}/></span><span><small>{String(label)}</small><strong>{String(value)}</strong></span></div>;})}</div>
        <div className="content-grid"><section className="panel upload-panel"><div className="section-heading"><div><p className="eyebrow">YOUR NEXT CHALLENGER</p><h2>Nộp bot của bạn</h2></div><Code2 className="muted"/></div><p>Đưa thuật toán lên sàn đấu. Mỗi lần nộp sẽ thay thế bot hiện tại.</p><form onSubmit={e=>{e.preventDefault();void upload(e.currentTarget);}}><label className="drop-zone"><span className="upload-icon"><Upload/></span><strong>{file?file.name:'Chọn file bot Python'}</strong><span>{file?`${(file.size/1024).toFixed(1)} KB`:'Định dạng .py · Tối đa 64 KB'}</span><input aria-label="Chọn file bot Python" type="file" accept=".py" disabled={uploading} onChange={e=>setFile(e.target.files?.[0]??null)}/></label><button className="primary" disabled={!file||uploading}>{uploading?'Đang nộp bot…':'Nộp bot lên đấu trường'}<ArrowRight size={17}/></button></form><a className="download-link" href="/sample_bot.py" target="_blank" rel="noreferrer"><ArrowDownToLine size={16}/> Xem mã nguồn bot mẫu</a></section>
        <section className="panel"><div className="section-heading"><div><p className="eyebrow">YOUR JOURNEY</p><h2>Tiến trình thi đấu</h2></div><span className="badge">{statusLabel[status?.phase??'']??'Đang tải'}</span></div><div className="journey-step"><span>01</span><div><h3>Tạo tài khoản</h3><p>Bạn đã sẵn sàng tham gia đấu trường.</p></div><Check className="green" size={18}/></div><div className="journey-step"><span>02</span><div><h3>Nộp bot & thi đầu vào</h3><p>Bot sẽ đấu với ba bot của ban tổ chức.</p></div></div><div className="journey-step"><span>03</span><div><h3>Thi đấu & leo hạng</h3><p>Theo dõi điểm số và xem lại từng trận.</p></div></div><button className="secondary full" onClick={()=>setTab('replay')}>Xem lại trận đấu <ArrowRight size={16}/></button></section></div>
      </>}
      {tab==='leaderboard'&&<section className="panel"><div className="section-heading"><h2>Bảng xếp hạng của bạn</h2><span className="badge">Ngày chấm gần nhất</span></div>{!standings.length?<div className="empty-state"><Trophy/><h3>Hành trình mới đang chờ</h3><p>Bảng xếp hạng xuất hiện sau khi bạn được chia bảng và chấm thi.</p></div>:<div className="table-scroll"><table><thead><tr><th>Hạng</th><th>Thí sinh</th><th>Điểm trận</th><th>Điểm ván</th></tr></thead><tbody>{standings.map(row=><tr key={row.name} className={row.name===user.name?'own-row':''}><td><span className="rank">{row.rank<=3?'🏅 ':''}{row.rank}</span></td><td>{row.name}{row.name===user.name&&<small> (Bạn)</small>}</td><td>{row.pts}</td><td>{row.gs}</td></tr>)}</tbody></table></div>}{status?.days?.length&&<><h3 className="history-title">Lịch sử thứ hạng</h3><div className="history">{status.days.map(d=><div key={d.day}><small>Ngày {d.day}</small><strong>#{d.rank} / {d.n}</strong><span>{d.pts} điểm</span></div>)}</div></>}</section>}
      {tab==='replay'&&<Replay data={replays} onDay={(r,d)=>{void api<Replays>(`/replays?round=${r}&day=${d}`).then(setReplays).catch(e=>setError(e.message));}}/>}
      {tab==='rules'&&<section className="panel rules"><p className="eyebrow">PLAY SMART. PLAY FAIR.</p><h2>Luật oẳn tù tì trên bàn cờ</h2><div className="rule-pieces"><span>✊ Búa thắng Kéo</span><span>✌️ Kéo thắng Bao</span><span>🖐 Bao thắng Búa</span></div><h3>Bàn cờ & nước đi</h3><p>Bàn 9 × 9. Mỗi bên có 9 quân: 3 Búa, 3 Bao, 3 Kéo. Mỗi lượt đi một ô theo 8 hướng. Không được vào ô quân mình hoặc ô quân đối phương mà bạn không ăn được.</p><h3>Điều kiện chiến thắng</h3><p>Đưa quân đến đích: người đi trước đến i9, người đi sau đến a1; hoặc ăn hết một loại quân của đối phương. Hết nước đi, sai luật, quá thời gian hay bot lỗi đều bị xử thua. Quá 200 nước thì hòa.</p><h3>Thể thức & chương trình bot</h3><p>Mỗi trận BO2 gồm hai ván đổi lượt đi trước. Bot Python nhận một dòng JSON từ stdin và in ra bốn số x y nx ny trên stdout. Giới hạn 3 giây ở nước đầu của mỗi bên và 1 giây ở các nước tiếp theo.</p><a href="/sample_bot.py" target="_blank" rel="noreferrer" className="download-link"><Code2 size={16}/> Đọc chương trình bot mẫu</a></section>}
      <footer className="dashboard-footer">OTT ARENA <span>Viết chiến thuật của riêng bạn.</span></footer>
      </main></div></div>;
}
