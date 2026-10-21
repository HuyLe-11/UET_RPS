import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  BookOpen,
  ChartNoAxesColumnIncreasing,
  Check,
  ChevronRight,
  Code2,
  LayoutDashboard,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Swords,
  Trophy,
  Upload,
  UserRound,
} from 'lucide-react';
import Auth, { Brand } from './Auth';
import Replay from './Replay';
import SubmissionHistory from './SubmissionHistory';
import AdminDashboard from './AdminDashboard';
import { createAndDispatchScoringJob, getMyTodayMatches, getReplayMetadata, getSavedScoringUrl, getWebDashboard, saveScoringUrl, supabase, type Replays, type ScoringJob, type ScoringState, type Standing, type Status, type TodayMatch, type User } from './api';

const emptyReplays: Replays = { available: [], round: null, day: null, matches: [], allMatches: [] };
const statusLabel: Record<string, string> = {
  new: 'Chờ thi đầu vào',
  active: 'Đang thi đấu',
  eliminated: 'Đã dừng bước',
  out: 'Đã dừng bước',
  entry: 'Thi đầu vào',
  round: 'Vòng thi đấu',
  done: 'Đã kết thúc',
};

function routeForPath(path: string, isAdmin: boolean) {
  if (isAdmin) return path.startsWith('/admin') ? path : '/admin';
  if (path.startsWith('/admin')) return '/';
  return ['/submission', '/ranking', '/replay', '/rules'].includes(path) ? path : '/';
}

function useRoute(isAdmin: boolean) {
  const [path, setPath] = useState(() => routeForPath(window.location.pathname, isAdmin));
  useEffect(() => {
    const onPopState = () => setPath(routeForPath(window.location.pathname, isAdmin));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [isAdmin]);
  useEffect(() => {
    if (window.location.pathname !== path) window.history.replaceState({}, '', path);
  }, [path]);
  const navigate = useCallback((nextPath: string) => {
    const safePath = routeForPath(nextPath, isAdmin);
    if (window.location.pathname !== safePath) window.history.pushState({}, '', safePath);
    setPath(safePath);
  }, [isAdmin]);
  return { path, navigate };
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    async function initAuth() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('username, role')
            .eq('id', session.user.id)
            .single();

          const name = profile?.username || session.user.user_metadata?.username || session.user.email?.split('@')[0] || 'User';
          setUser({
            id: session.user.id,
            email: session.user.email,
            name,
            role: profile?.role || 'contestant',
          });
        }
      } catch (err) {
        console.error('Lỗi khởi tạo session:', err);
      } finally {
        setReady(true);
      }
    }

    void initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('username, role')
          .eq('id', session.user.id)
          .single();

        const name = profile?.username || session.user.user_metadata?.username || session.user.email?.split('@')[0] || 'User';
        setUser({
          id: session.user.id,
          email: session.user.email,
          name,
          role: profile?.role || 'contestant',
        });
      } else {
        setUser(null);
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  if (!ready) {
    return (
      <div className="loading-screen">
        <Swords />
        <h2>OTT ARENA</h2>
        <p>Đang chuẩn bị đấu trường…</p>
      </div>
    );
  }

  return user ? (
    <Dashboard user={user} onLogout={() => {
      setUser(null);
      window.history.replaceState({}, '', '/');
    }} />
  ) : (
    <Auth onLogin={(nextUser) => {
      setUser(nextUser);
      window.history.replaceState({}, '', nextUser.role === 'admin' ? '/admin' : '/');
    }} />
  );
}

function Dashboard({ user, onLogout }: { user: User; onLogout: () => void }) {
  const { path, navigate } = useRoute(user.role === 'admin');
  const isAdminPage = path.startsWith('/admin');
  const tab = isAdminPage ? 'admin' : path === '/submission' ? 'submission' : path === '/ranking' ? 'ranking' : path === '/replay' ? 'replay' : path === '/rules' ? 'rules' : 'overview';
  const [status, setStatus] = useState<Status | null>(null);
  const [standings, setStandings] = useState<Standing[]>([]);
  const [replays, setReplays] = useState<Replays>(emptyReplays);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJobStatus, setActiveJobStatus] = useState<ScoringJob['status'] | null>(null);
  const [scoringState, setScoringState] = useState<ScoringState | null>(null);
  const [champion, setChampion] = useState<string | null>(null);
  const [scoringUrl, setScoringUrl] = useState(getSavedScoringUrl);
  const [todayMatches, setTodayMatches] = useState<TodayMatch[]>([]);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const [dashboard, r, matches] = await Promise.all([
        getWebDashboard(),
        getReplayMetadata().catch(() => emptyReplays),
        getMyTodayMatches().catch(() => [] as TodayMatch[]),
      ]);
      setStatus(dashboard.status);
      setStandings(dashboard.standings);
      if (r) setReplays(r);
      setTodayMatches(matches);
      setChampion(dashboard.champion);
      setScoringState(dashboard.scoring);
      setScoringUrl((current) => {
        const configured = dashboard.scoring.scoringUrl || '';
        const next = current || configured;
        if (!current && next) saveScoringUrl(next);
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không tải được dữ liệu');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (user.role !== 'admin') void refresh();
  }, [refresh, user.role]);

  useEffect(() => {
    if (!activeJobId) return;
    let finished = false;
    const readJob = async () => {
      const { data, error: readError } = await supabase
        .from('scoring_jobs')
        .select('id,status,result,error_code,error_message')
        .eq('id', activeJobId)
        .maybeSingle();
      if (finished || readError || !data) return;
      const job = data as ScoringJob;
      if (['dispatching', 'accepted', 'running'].includes(job.status)) {
        setActiveJobStatus(job.status);
        setMessage(job.status === 'running' ? 'Đang chấm bài…' : 'Máy chấm đã nhận bài, đang chờ xử lý…');
        return;
      }
      finished = true;
      setActiveJobId(null);
      setActiveJobStatus(job.status);
      if (job.status === 'succeeded') {
        const score = job.result?.converted_score;
        setMessage(typeof score === 'number'
          ? `Chấm xong! Điểm đầu vào có trọng số: ${score}/12.`
          : 'Đã nhận bài thành công.');
      } else {
        setError(job.error_code === 'module_unavailable'
          ? 'Máy chấm không nhận được bài. Vui lòng thử lại.'
          : `Chấm bài thất bại${job.error_code ? ` (${job.error_code})` : ''}. Vui lòng thử lại.`);
        setMessage('');
      }
      await refresh();
    };
    void readJob();
    // Realtime is the fast path. This slow poll only recovers missed events.
    const timer = window.setInterval(() => void readJob(), 12_000);
    const channel = supabase
      .channel(`scoring-job-${activeJobId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'scoring_jobs', filter: `id=eq.${activeJobId}`,
      }, () => void readJob())
      .subscribe();
    return () => {
      finished = true;
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [activeJobId, refresh, user.id]);

  async function upload(form: HTMLFormElement) {
    if (!file) return;
    setUploading(true);
    setError('');
    setMessage('');
    try {
      if (!file.name.endsWith('.py')) throw new Error('Chỉ nhận file Python .py');
      if (file.size > 65536) throw new Error('File bot không được vượt quá 64 KB');
      
      setMessage('Đang gửi bài đến máy chấm…');
      const kind = scoringState?.phase === 'round' ? 'submission' : 'entry';
      const context = kind === 'submission' && scoringState?.round && scoringState.day
        ? { round: scoringState.round, day: scoringState.day }
        : null;
      const jobId = await createAndDispatchScoringJob(file, kind, scoringUrl, context);
      setActiveJobId(jobId);
      setActiveJobStatus('accepted');
      setMessage('Máy chấm đã nhận bài, đang chấm…');

      form.reset();
      setFile(null);
      await refresh();
    } catch (e) {
      setMessage('');
      setError(e instanceof Error ? e.message : 'Gửi bài thất bại');
    } finally {
      setUploading(false);
    }
  }

  const baseNavigation = [
    ['overview', LayoutDashboard, 'Tổng quan'],
    ['submission', Upload, 'Nộp bài'],
    ['ranking', Trophy, 'Bảng xếp hạng'],
    ['replay', Swords, 'Phát lại trận đấu'],
    ['rules', BookOpen, 'Luật thi đấu'],
  ] as const;

  const navigation = user.role === 'admin' ? [] : baseNavigation;
  const routeByTab: Record<string, string> = { overview: '/', submission: '/submission', ranking: '/ranking', replay: '/replay', rules: '/rules', admin: '/admin' };
  const entryLimitReached = scoringState?.phase === 'entry' && scoringState.attempts >= 20;
  // The server checks submission availability again when accepting a job.
  const submissionsAllowed = !scoringState || Boolean(scoringState.accepting && scoringState.phase !== 'done' && !entryLimitReached);

  return (
    <div className="dashboard">
      <aside className={`sidebar ${isAdminPage ? 'admin-sidebar' : ''}`}>
        <Brand />
        <p className="nav-caption">{isAdminPage ? 'ĐIỀU HÀNH CUỘC THI' : 'ĐẤU TRƯỜNG CỦA BẠN'}</p>
        <nav>
          {navigation.map(([key, Icon, text]) => (
            <button
              key={key}
              className={tab === key ? 'active' : ''}
              onClick={() => navigate(routeByTab[key])}
            >
              <Icon size={19} />
              {text}
              {tab === key && <ChevronRight size={15} />}
            </button>
          ))}
        </nav>

        {user.role !== 'admin' && <div className="sidebar-tip">
          <ShieldCheck />
          <h3>Sẵn sàng bứt phá?</h3>
          <p>Hoàn thiện thuật toán rồi gửi bot để được chấm ngay trong giai đoạn đang mở.</p>
          <a href="/sample_bot.py" target="_blank" rel="noreferrer">
            Xem bot mẫu <ArrowRight size={15} />
          </a>
        </div>}

        {user.role !== 'admin' && <a className="live-link" href="/live-board.json" target="_blank" rel="noreferrer">
          <span className="live-dot" /> Theo dõi live data
        </a>}

        <div className="sidebar-user">
          <span className="avatar">{user.name.slice(0, 2).toUpperCase()}</span>
          <div>
            <strong>{user.name}</strong>
            <small>{user.role === 'admin' ? 'Ban tổ chức (Admin)' : 'Thí sinh'}</small>
          </div>
          <button
            aria-label="Đăng xuất"
            disabled={logoutBusy}
            onClick={async () => {
              setLogoutBusy(true);
              try {
                await supabase.auth.signOut();
                onLogout();
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Không đăng xuất được');
              } finally {
                setLogoutBusy(false);
              }
            }}
          >
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <div className="dashboard-main">
        <header className="dashboard-header">
          <span>
            {isAdminPage ? 'Khu vực quản trị' : 'Không gian thi đấu'} <ChevronRight size={14} /> {isAdminPage ? (path === '/admin/server' ? 'Quản trị máy chấm' : path === '/admin/observation' ? 'Quan sát hoạt động' : path === '/admin/monitor' ? 'Giám sát hệ thống' : 'Quản trị cuộc thi') : navigation.find((n) => n[0] === tab)?.[2]}
          </span>
          <span className="badge">
            <span className="live-dot" /> OTT ARENA · FIT-UET
          </span>
        </header>

        <main className="dashboard-content">
          {!isAdminPage && <div className="page-title">
            <div>
              <p className="eyebrow">LET’S MAKE YOUR NEXT MOVE</p>
              <h1>{isAdminPage ? (path === '/admin/server' ? 'Quản trị máy chấm' : path === '/admin/observation' ? 'Quan sát hoạt động' : path === '/admin/monitor' ? 'Giám sát hệ thống' : 'Quản trị cuộc thi') : tab === 'overview' ? `Chào ${user.name}!` : navigation.find((n) => n[0] === tab)?.[2]}</h1>
              <p>
                {tab === 'overview'
                  ? 'Một chiến thuật tốt bắt đầu từ một ý tưởng. Hôm nay bạn đã sẵn sàng chưa?'
                  : isAdminPage
                  ? 'Theo dõi và điều hành các hoạt động của cuộc thi.'
                  : 'Theo dõi, phân tích và hoàn thiện chiến thuật của bạn.'}
              </p>
            </div>
            {!isAdminPage && (
              <button className="secondary refresh-button" disabled={busy} onClick={() => void refresh()}>
                <RefreshCw size={16} className={busy ? 'spin' : ''} />
                {busy ? 'Đang tải' : 'Làm mới'}
              </button>
            )}
          </div>}

          {!isAdminPage && error && <div className="form-error" role="alert">{error}</div>}
          {!isAdminPage && message && <div className="success" role="status"><Check size={18} />{message}</div>}
          {!isAdminPage && (uploading || (activeJobId && ['dispatching', 'accepted', 'running'].includes(activeJobStatus || ''))) && (
            <div className="scoring-progress" role="status" aria-live="polite">
              <RefreshCw size={20} className="spin" />
              <div><strong>{uploading ? 'Đang gửi bài đến máy chấm' : 'Bài đã được nhận, đang chấm'}</strong>
                <span>{activeJobStatus === 'running' ? 'Trận đấu đang được xử lý và tính điểm.' : 'Giữ trang này mở để theo dõi kết quả.'}</span>
              </div>
              <div className="scoring-progress-track"><i /></div>
            </div>
          )}
          {!isAdminPage && champion && (
            <div className="champion-banner">
              <Trophy /> Nhà vô địch giải đấu: <strong>{champion}</strong>
            </div>
          )}

          {isAdminPage && <AdminDashboard route={path} navigate={navigate} />}

          {(tab === 'overview' || tab === 'submission') && (
            <>
                  {tab === 'overview' && <>
              <section className="welcome-banner">
                <div>
                  <span className="pill">ĐẤU TRƯỜNG THUẬT TOÁN</span>
                  <h2>Code thông minh.<br />Chơi khác biệt.</h2>
                  <p>✊ Búa · 🖐 Bao · ✌️ Kéo — Ba loại quân, vô vàn chiến thuật.</p>
                  <button onClick={() => navigate('/rules')}>Khám phá luật chơi <ArrowRight size={16} /></button>
                </div>
                <div className="banner-pieces" aria-hidden="true">
                  <span>✊</span><span>🖐</span><span>✌️</span>
                </div>
              </section>

              <div className="stat-grid">
                {[
                  [UserRound, 'Trạng thái', status ? statusLabel[status.status] ?? status.status : '—'],
                  [Swords, 'Giai đoạn', scoringState ? ({ entry: 'Vòng loại', round: 'Thi đấu', done: 'Đã kết thúc' }[scoringState.phase]) : '—'],
                  [ChartNoAxesColumnIncreasing, 'Điểm tốt nhất', scoringState?.bestScore ?? status?.entry ?? '—'],
                  [Trophy, 'Bảng thi đấu', status?.group ?? 'Chưa chia bảng'],
                ].map(([Icon, label, value], i) => {
                  const I = Icon as typeof Trophy;
                  return (
                    <div className="stat-card" key={i}>
                      <span className={`stat-icon color-${i}`}><I size={20} /></span>
                      <span>
                        <small>{String(label)}</small>
                        <strong>{String(value)}</strong>
                      </span>
                    </div>
                  );
                })}
              </div>
              </>}

              <div className="content-grid">
                <section className="panel upload-panel">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">YOUR NEXT CHALLENGER</p>
                  <h2>Gửi bot để chấm ngay</h2>
                    </div>
                    <Code2 className="muted" />
                  </div>
                  <p>Bot được chấm ngay sau khi gửi. Giai đoạn vòng loại cho tối đa 20 lượt; hệ thống giữ điểm cao nhất.</p>
                  {scoringState?.phase === 'entry' && <p className="attempt-count">Đã dùng {Math.min(scoringState.attempts, 20)}/20 lượt · Điểm đầu vào tốt nhất: {scoringState.bestScore ?? '—'}/12</p>}
                  {scoringState && !submissionsAllowed && <p className="form-error">{entryLimitReached ? 'Bạn đã dùng hết 20 lượt vòng loại.' : 'Hiện tại hệ thống đang đóng nhận bài.'}</p>}
                  <div className="bot-language-readonly" aria-label="Ngôn ngữ bot bắt buộc">
                    <span>NGÔN NGỮ BẮT BUỘC</span>
                    <strong>Python 3</strong>
                    <small>Ngôn ngữ được cố định cho cuộc thi · không thể thay đổi</small>
                  </div>
                  <p className="language-note">Hãy gửi file Python `.py` có hàm `choose_move(state)`.</p>
                  {scoringState?.phase === 'round' && <section className="today-opponents" aria-label="Các đối thủ hôm nay">
                    <strong>Đối thủ của bạn hôm nay</strong>
                    {todayMatches.length ? todayMatches.map((match) => <div key={`${match.rnd}-${match.day}-${match.rd}`}>
                      <span>Lượt {match.rd}</span><span>{match.opponent}</span>
                    </div>) : <p>Cặp đấu sẽ xuất hiện khi ban tổ chức mở ngày thi.</p>}
                  </section>}
                  <form onSubmit={(e) => { e.preventDefault(); void upload(e.currentTarget); }}>
                    <label className="scoring-url-field">
                      URL máy chấm do ban tổ chức cung cấp
                      <input type="url" required value={scoringUrl} placeholder="https://score.tenmiencuaban.vn" aria-describedby="scoring-url-help" onChange={(event) => { setScoringUrl(event.target.value); saveScoringUrl(event.target.value); }} />
                      <small id="scoring-url-help">URL được kiểm tra trước khi gửi. Dùng HTTPS qua Cloudflare Tunnel; hệ thống lưu lựa chọn trên trình duyệt này.</small>
                    </label>
                    <label className="drop-zone">
                      <span className="upload-icon"><Upload /></span>
                      <strong>{file ? file.name : 'Chọn file bot Python'}</strong>
                      <span>{file ? `${(file.size / 1024).toFixed(1)} KB` : 'Định dạng .py · Tối đa 64 KB'}</span>
                      <input
                        aria-label="Chọn file bot Python"
                        type="file"
                        accept=".py"
                        disabled={uploading || !submissionsAllowed}
                        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                      />
                    </label>
                    <button className="primary" disabled={!file || uploading || !submissionsAllowed || Boolean(activeJobId)}>
                      {uploading ? 'Đang gửi…' : activeJobId ? 'Đang chấm…' : 'Gửi bot để chấm ngay'}
                      <ArrowRight size={17} />
                    </button>
                  </form>
                  <a className="download-link" href="/sample_bot.py" target="_blank" rel="noreferrer">
                    <ArrowDownToLine size={16} /> Xem mã nguồn bot mẫu
                  </a>
                </section>

                <section className="panel">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">YOUR JOURNEY</p>
                      <h2>Tiến trình thi đấu</h2>
                    </div>
                    <span className="badge">{scoringState ? ({ entry: 'Vòng loại', round: 'Thi đấu', done: 'Đã kết thúc' }[scoringState.phase]) : 'Đang tải'}</span>
                  </div>
                  <div className="journey-step">
                    <span>01</span>
                    <div>
                      <h3>Tạo tài khoản</h3>
                      <p>Tài khoản đã được xác thực.</p>
                    </div>
                    <Check className="green" size={18} />
                  </div>
                  <div className="journey-step">
                    <span>02</span>
                    <div>
                      <h3>Gửi bot & nhận điểm ngay</h3>
                      <p>Mỗi lượt được chấm ngay; vòng loại có tối đa 20 lượt và giữ điểm cao nhất.</p>
                    </div>
                  </div>
                  <div className="journey-step">
                    <span>03</span>
                    <div>
                      <h3>Thi đấu & leo hạng</h3>
                      <p>Theo dõi điểm số và xem lại từng trận đấu.</p>
                    </div>
                  </div>
                  <button className="secondary full" onClick={() => navigate('/replay')}>
                    Xem lại trận đấu <ArrowRight size={16} />
                  </button>
                </section>
              </div>
              {tab === 'submission' && <SubmissionHistory user={user} replays={replays}/>}
            </>
          )}

          {tab === 'ranking' && (
            <section className="panel">
              <div className="section-heading">
                <h2>Bảng xếp hạng của bạn</h2>
                <span className="badge">Kết quả thi đấu</span>
              </div>
              {!standings.length ? (
                <div className="empty-state">
                  <Trophy />
                  <h3>Hành trình mới đang chờ</h3>
                  <p>Bảng xếp hạng xuất hiện sau khi bạn được chia bảng và chấm thi.</p>
                </div>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Hạng</th>
                        <th>Thí sinh</th>
                        <th>Điểm trận</th>
                        <th>Điểm ván</th>
                      </tr>
                    </thead>
                    <tbody>
                      {standings.map((row) => (
                        <tr key={row.name} className={row.name === user.name ? 'own-row' : ''}>
                          <td><span className="rank">{row.rank <= 3 ? '🏅 ' : ''}{row.rank}</span></td>
                          <td>{row.name}{row.name === user.name && <small> (Bạn)</small>}</td>
                          <td>{row.pts}</td>
                          <td>{row.gs}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {status?.days?.length ? (
                <>
                  <h3 className="history-title">Lịch sử thứ hạng</h3>
                  <div className="history">
                    {status.days.map((d) => (
                      <div key={d.day}>
                        <small>Ngày {d.day}</small>
                        <strong>#{d.rank} / {d.n}</strong>
                        <span>{d.pts} điểm</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </section>
          )}

          {tab === 'replay' && (
            <Replay
              data={replays}
              onDay={(r, d) => {
                void getReplayMetadata(r, d)
                  .then(setReplays)
                  .catch((e) => setError(e.message));
              }}
            />
          )}

          {tab === 'rules' && (
            <section className="panel rules">
              <p className="eyebrow">PLAY SMART. PLAY FAIR.</p>
              <h2>Luật oẳn tù tì trên bàn cờ</h2>
              <div className="rule-pieces">
                <span>✊ Búa thắng Kéo</span>
                <span>✌️ Kéo thắng Bao</span>
                <span>🖐 Bao thắng Búa</span>
              </div>
              <h3>Bàn cờ & nước đi</h3>
              <p>Bàn 9 × 9. Mỗi bên có 9 quân: 3 Búa, 3 Bao, 3 Kéo. Mỗi lượt đi một ô theo 8 hướng. Không được vào ô quân mình hoặc ô quân đối phương mà bạn không ăn được.</p>
              <h3>Điều kiện chiến thắng</h3>
              <p>Đưa quân đến đích: người đi trước đến i9, người đi sau đến a1; hoặc ăn hết một loại quân của đối phương. Hết nước đi, sai luật, quá thời gian hay bot lỗi đều bị xử thua. Quá 200 nước thì hòa.</p>
              <h3>Thể thức & chương trình bot</h3>
              <p>Mỗi trận BO2 gồm hai ván đổi lượt đi trước. Bot Python nhận một dòng JSON từ stdin và in ra bốn số x y nx ny trên stdout. Giới hạn 3 giây ở nước đầu của mỗi bên và 1 giây ở các nước tiếp theo.</p>
              <a href="/sample_bot.py" target="_blank" rel="noreferrer" className="download-link">
                <Code2 size={16} /> Đọc chương trình bot mẫu
              </a>
            </section>
          )}

          <footer className="dashboard-footer">
            OTT ARENA <span>Viết chiến thuật của riêng bạn.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
