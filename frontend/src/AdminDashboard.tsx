import { useEffect, useState, useCallback } from 'react';
import {
  Activity,
  ArrowDownToLine,
  Check,
  Download,
  FileSpreadsheet,
  Plus,
  RefreshCw,
  ShieldCheck,
  Upload,
  UserPlus,
  Users,
  Server,
  Eye,
  Gauge,
  Swords,
} from 'lucide-react';
import { api, post, supabase } from './api';

interface AdminOverviewData {
  phase: 'entry' | 'round' | 'done';
  accepting: boolean;
  total_users: number;
}

interface JobStatus {
  id: string;
  user_id: string;
  kind: string;
  status: string;
  error_code: string | null;
  error_message: string | null;
  result: Record<string, any> | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

interface MatchRow {
  id: number;
  rnd: number;
  day: number;
  rd: number;
  grp: number;
  player_a: string;
  player_b: string;
  score_a: number;
  has_replay: boolean;
}

export default function AdminDashboard({ route, navigate }: { route: string; navigate: (path: string) => void }) {
  const section = route === '/admin/server' ? 'server' : route === '/admin/observation' ? 'observation' : route === '/admin/monitor' ? 'monitor' : 'tournament';
  const [scoringUrl, setScoringUrl] = useState('');
  const [overview, setOverview] = useState<AdminOverviewData | null>(null);
  const [jobs, setJobs] = useState<JobStatus[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [usernames, setUsernames] = useState<Record<string, string>>({});
  const [selectedPhase, setSelectedPhase] = useState<'entry' | 'round' | 'done'>('entry');
  const [selectedAccepting, setSelectedAccepting] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // Single admin form
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newAdminUser, setNewAdminUser] = useState('');
  const [newAdminPass, setNewAdminPass] = useState('');
  const [createAdminBusy, setCreateAdminBusy] = useState(false);

  // CSV Import
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<{
    success_count: number;
    error_count: number;
    created: any[];
    errors: any[];
  } | null>(null);

  const fetchOverview = useCallback(async () => {
    try {
      const [{ data: state, error: stateError }, { data: profiles, error: profilesError }] = await Promise.all([
        supabase.from('tournament_state').select('phase,accepting_submissions').eq('id', 1).single(),
        supabase.from('profiles').select('id'),
      ]);
      if (stateError) throw stateError;
      if (profilesError) throw profilesError;
      const data = { phase: state.phase, accepting: state.accepting_submissions, total_users: profiles?.length ?? 0 } as AdminOverviewData;
      setOverview(data);
      setSelectedPhase(data.phase);
      setSelectedAccepting(data.accepting);
    } catch (err: any) {
      setError(err?.message || 'Không thể tải thông tin giải đấu');
    }
  }, []);

  const fetchJob = useCallback(async () => {
    try {
      const [{ data, error: jobsError }, { data: profiles, error: profilesError }, { data: matchesData, error: matchesError }] = await Promise.all([
        supabase.from('scoring_jobs').select('id,user_id,kind,status,error_code,error_message,result,created_at,started_at,finished_at').order('created_at', { ascending: false }).limit(50),
        supabase.from('profiles').select('id,username'),
        supabase.from('matches').select('id,rnd,day,rd,grp,player_a,player_b,score_a,has_replay').order('id', { ascending: false }).limit(50),
      ]);
      if (jobsError) throw jobsError;
      if (profilesError) throw profilesError;
      if (matchesError) throw matchesError;
      setJobs((data || []) as JobStatus[]);
      setMatches((matchesData || []) as MatchRow[]);
      setUsernames(Object.fromEntries((profiles || []).map((p: any) => [p.id, p.username])));
    } catch (err: any) {
      setError(err?.message || 'Không thể tải tiến độ chấm');
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchOverview(), fetchJob()]).finally(() => setLoading(false));
  }, [fetchOverview, fetchJob]);

  // Refresh job progress so administrators can follow active submissions.
  useEffect(() => {
    const timer = setInterval(() => void fetchJob(), 2000);
    return () => clearInterval(timer);
  }, [fetchJob]);

  async function saveCompetitionPhase() {
    setError('');
    setMessage('');
    try {
      const { error: updateError } = await supabase.rpc('set_tournament_phase', {
        p_phase: selectedPhase,
        p_accepting: selectedAccepting,
      });
      if (updateError) throw updateError;
      setMessage('Đã cập nhật giai đoạn và trạng thái nhận bài.');
      void fetchOverview();
    } catch (err: any) {
      setError(err?.message || 'Không thể cập nhật giai đoạn cuộc thi');
    }
  }

  const activeJobs = jobs.filter((item) => ['dispatching', 'accepted', 'running'].includes(item.status));
  const completedJobs = jobs.filter((item) => item.status === 'succeeded' || item.status === 'failed' || item.status === 'timed_out');
  const successfulJobs = jobs.filter((item) => item.status === 'succeeded').length;
  const durations = completedJobs.map((item) => item.started_at && item.finished_at ? (new Date(item.finished_at).getTime() - new Date(item.started_at).getTime()) / 1000 : null).filter((n): n is number => n !== null && n >= 0);
  const averageDuration = durations.length ? `${(durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1)} giây` : '—';

  async function handleCreateSingleAdmin(e: React.FormEvent) {
    e.preventDefault();
    setCreateAdminBusy(true);
    setError('');
    setMessage('');
    try {
      const res = await post<{ ok: boolean; admin: any }>('/api/admin/create-admin', {
        email: newAdminEmail.trim(),
        username: newAdminUser.trim(),
        password: newAdminPass,
      });
      setMessage(`Đã tạo Admin thành công: ${res.admin.username} (${res.admin.email})`);
      setNewAdminEmail('');
      setNewAdminUser('');
      setNewAdminPass('');
    } catch (err: any) {
      setError(err?.message || 'Tạo admin thất bại');
    } finally {
      setCreateAdminBusy(false);
    }
  }

  async function handleImportCsv(e: React.FormEvent) {
    e.preventDefault();
    if (!csvFile) return;
    setImportBusy(true);
    setError('');
    setMessage('');
    setImportResult(null);

    const formData = new FormData();
    formData.append('file', csvFile);

    try {
      const res = await api<{ ok: boolean; result: any }>('/api/admin/import-admins', {
        method: 'POST',
        body: formData,
      });
      setImportResult(res.result);
      setMessage(`Import xong: ${res.result.success_count} tài khoản thành công, ${res.result.error_count} lỗi.`);
      setCsvFile(null);
    } catch (err: any) {
      setError(err?.message || 'Import CSV thất bại');
    } finally {
      setImportBusy(false);
    }
  }

  function downloadSampleCsv() {
    const csvContent = 'email,username,password\nadmin1@example.com,admin_alpha,SecureAdmin@123456\nadmin2@example.com,admin_beta,SecureAdmin@654321\n';
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'admins_sample.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="admin-dashboard-view" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <nav className="admin-section-nav" aria-label="Menu quản trị">
        {[
          ['/admin', 'Quản trị cuộc thi', ShieldCheck],
          ['/admin/server', 'Quản trị máy chấm', Server],
          ['/admin/observation', 'Quan sát hoạt động', Eye],
          ['/admin/monitor', 'Giám sát hệ thống', Gauge],
        ].map(([path, label, Icon]) => {
          const NavIcon = Icon as typeof ShieldCheck;
          return <button key={String(path)} className={route === path ? 'active' : ''} onClick={() => navigate(String(path))}><NavIcon size={16} />{String(label)}</button>;
        })}
      </nav>
      <div className="page-title" style={{ marginBottom: 0 }}>
        <div>
          <p className="eyebrow">HỆ THỐNG ĐIỀU HÀNH GIẢI ĐẤU</p>
          <h1>{section === 'server' ? 'Quản trị máy chấm' : section === 'observation' ? 'Quan sát hoạt động' : section === 'monitor' ? 'Giám sát hệ thống' : 'Quản trị cuộc thi'}</h1>
          <p>{section === 'server' ? 'Cấu hình địa chỉ máy chấm dự kiến.' : section === 'observation' ? 'Theo dõi bài gửi, tiến độ xử lý và các lượt thi đối đầu.' : section === 'monitor' ? 'Theo dõi các chỉ số xử lý và địa chỉ kết nối.' : 'Quản lý giai đoạn cuộc thi và tài khoản ban tổ chức.'}</p>
        </div>
        <button
          className="secondary refresh-button"
          disabled={loading}
          onClick={() => {
            void fetchOverview();
            void fetchJob();
          }}
        >
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
          {loading ? 'Đang tải' : 'Làm mới'}
        </button>
      </div>

      {error && <div className="form-error" role="alert">{error}</div>}
      {message && <div className="success" role="status"><Check size={18} />{message}</div>}

      {section === 'tournament' && <>
      {/* Tổng quan giải đấu */}
      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-icon color-0"><Activity size={20} /></span>
          <span>
            <small>Giai đoạn</small>
            <strong>{overview?.phase === 'entry' ? 'Vòng loại' : overview?.phase === 'round' ? 'Thi đấu' : overview?.phase === 'done' ? 'Đã kết thúc' : '—'}</strong>
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-icon color-1"><ShieldCheck size={20} /></span>
          <span>
            <small>Thí sinh</small>
            <strong>{overview?.total_users ?? '—'}</strong>
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-icon color-2"><Users size={20} /></span>
          <span>
            <small>Đang chấm</small>
            <strong>{activeJobs.length}</strong>
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-icon color-3"><FileSpreadsheet size={20} /></span>
          <span>
            <small>Nhận bài</small>
            <strong style={{ color: overview?.accepting ? '#4ade80' : '#f87171' }}>
              {overview?.accepting ? 'Đang mở' : 'Đã đóng'}
            </strong>
          </span>
        </div>
      </div>

      {/* Cấu hình giai đoạn cuộc thi */}
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">ĐIỀU HÀNH CUỘC THI</p>
            <h2>Giai đoạn cuộc thi</h2>
          </div>
          <ShieldCheck size={20} className="muted" />
        </div>
        <p>Chọn giai đoạn trực tiếp. Khi nhận bài đang mở, mỗi lần gửi được chấm ngay; giai đoạn vòng loại giới hạn 20 lượt và giữ điểm cao nhất.</p>
        <div className="phase-controls">
          <label>Giai đoạn
            <select value={selectedPhase} onChange={(e) => setSelectedPhase(e.target.value as AdminOverviewData['phase'])}>
              <option value="entry">Vòng loại</option>
              <option value="round">Thi đấu</option>
              <option value="done">Đã kết thúc</option>
            </select>
          </label>
          <label className="phase-toggle">
            <input type="checkbox" checked={selectedAccepting} disabled={selectedPhase === 'done'} onChange={(e) => setSelectedAccepting(e.target.checked)} />
            Nhận bài đang mở
          </label>
          <button className="primary" disabled={!overview || (selectedPhase === overview.phase && selectedAccepting === overview.accepting)} onClick={() => void saveCompetitionPhase()}>
            <Check size={16} /> Lưu giai đoạn
          </button>
        </div>
      </section>
      </>}

      {(section === 'observation' || section === 'tournament') && <section className="panel">
        <div className="section-heading">
          <div><p className="eyebrow">CÁC LƯỢT CHẤM</p><h2>Tiến độ chấm bài</h2></div>
          <button className="secondary" onClick={() => void fetchJob()}><RefreshCw size={14} /> Làm mới</button>
        </div>
        {activeJobs.length > 0 && <p className="muted">{activeJobs.length} bài đang chờ hoặc được xử lý. Tiến độ cập nhật tự động mỗi 2 giây.</p>}
        {section === 'observation' && <div className="observation-summary"><span><strong>{activeJobs.length}</strong> lượt đang xử lý</span><span><strong>{matches.length}</strong> cặp đấu gần đây</span><span><strong>{jobs.filter((job) => job.status === 'failed' || job.status === 'timed_out').length}</strong> lượt cần xem lại</span></div>}
        {!jobs.length ? <div className="empty-state"><Activity /><h3>Chưa có lượt chấm</h3><p>Các lượt gửi mới sẽ xuất hiện tại đây.</p></div> : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Thí sinh</th><th>Trạng thái</th><th>Điểm</th><th>Gửi lúc</th><th>Chi tiết</th></tr></thead>
              <tbody>{jobs.map((item) => {
                const active = ['dispatching', 'accepted', 'running'].includes(item.status);
                const label: Record<string, string> = { dispatching: 'Đang gửi', accepted: 'Đã nhận · chờ xử lý', running: 'Đang chấm', succeeded: 'Hoàn tất', failed: 'Thất bại', timed_out: 'Quá thời gian', dispatch_failed: 'Máy chấm không nhận' };
                return <tr key={item.id}>
                  <td>{usernames[item.user_id] || item.user_id.slice(0, 8)}</td>
                  <td><span className={active ? 'badge scoring-active' : 'badge'}>{active && <RefreshCw size={12} className="spin" />}{label[item.status] || item.status}</span></td>
                  <td>{typeof item.result?.converted_score === 'number' ? `${item.result.converted_score}/100` : '—'}</td>
                  <td>{new Date(item.created_at).toLocaleString()}</td>
                  <td>{item.error_code ? `${item.error_code}${item.error_message ? `: ${item.error_message}` : ''}` : item.kind}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        )}
      </section>}

      {section === 'observation' && <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">LỊCH GHÉP CẶP</p><h2>Các trận đấu gần đây</h2></div><Swords size={20} className="muted" /></div>
        {!matches.length ? <div className="empty-state"><Swords /><h3>Chưa có cặp đấu</h3><p>Các trận đã được xếp lịch sẽ xuất hiện tại đây.</p></div> : <div className="table-scroll"><table><thead><tr><th>Vòng / ngày</th><th>Bảng / lượt</th><th>Thí sinh A</th><th>Thí sinh B</th><th>Điểm</th><th>Phát lại</th></tr></thead><tbody>{matches.map((match) => <tr key={match.id}><td>{match.rnd} / {match.day}</td><td>{match.grp} / {match.rd}</td><td>{usernames[match.player_a] || match.player_a.slice(0, 8)}</td><td>{usernames[match.player_b] || match.player_b.slice(0, 8)}</td><td>{match.score_a}</td><td>{match.has_replay ? 'Có' : '—'}</td></tr>)}</tbody></table></div>}
      </section>}

      {/* Quản lý Admin: Tạo tài khoản & Import CSV */}
      {section === 'tournament' && <div className="content-grid">
        {/* Form tạo 1 Admin */}
        <section className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">TÀI KHOẢN BAN TỔ CHỨC</p>
              <h2>Tạo tài khoản quản trị</h2>
            </div>
            <UserPlus size={20} className="muted" />
          </div>
          <p style={{ fontSize: '0.88rem', color: '#94a3b8', margin: '4px 0 16px' }}>
            Tài khoản quản trị được tạo và kích hoạt ngay sau khi hoàn tất.
          </p>

          <form onSubmit={handleCreateSingleAdmin} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <label>
              Email Admin
              <input
                type="email"
                required
                placeholder="admin@example.com"
                value={newAdminEmail}
                onChange={(e) => setNewAdminEmail(e.target.value)}
                disabled={createAdminBusy}
              />
            </label>
            <label>
              Tên tài khoản (Username)
              <input
                type="text"
                required
                minLength={3}
                maxLength={20}
                pattern="[A-Za-z0-9_]{3,20}"
                placeholder="admin_username"
                value={newAdminUser}
                onChange={(e) => setNewAdminUser(e.target.value)}
                disabled={createAdminBusy}
              />
            </label>
            <label>
              Mật khẩu Admin
              <input
                type="password"
                required
                minLength={8}
                placeholder="Tối thiểu 8 ký tự"
                value={newAdminPass}
                onChange={(e) => setNewAdminPass(e.target.value)}
                disabled={createAdminBusy}
              />
            </label>
            <button className="primary" type="submit" disabled={createAdminBusy} style={{ marginTop: '8px' }}>
              <Plus size={16} /> {createAdminBusy ? 'Đang tạo...' : 'Tạo tài khoản Admin'}
            </button>
          </form>
        </section>

        {/* Import CSV Admin */}
        <section className="panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">NHẬP DANH SÁCH</p>
              <h2>Nhập tài khoản quản trị</h2>
            </div>
            <FileSpreadsheet size={20} className="muted" />
          </div>
          <p style={{ fontSize: '0.88rem', color: '#94a3b8', margin: '4px 0 12px' }}>
            Nhập danh sách Admin cùng lúc bằng file CSV với các cột: <code>email,username,password</code>.
          </p>

          <button
            type="button"
            className="secondary"
            onClick={downloadSampleCsv}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', padding: '6px 12px', marginBottom: '14px' }}
          >
            <Download size={15} /> Tải file CSV mẫu (admins_sample.csv)
          </button>

          <form onSubmit={handleImportCsv}>
            <label className="drop-zone" style={{ padding: '20px', cursor: 'pointer' }}>
              <Upload size={22} className="muted" />
              <strong>{csvFile ? csvFile.name : 'Chọn file CSV danh sách Admin'}</strong>
              <span>{csvFile ? `${(csvFile.size / 1024).toFixed(1)} KB` : 'Định dạng .csv'}</span>
              <input
                type="file"
                accept=".csv"
                disabled={importBusy}
                onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                style={{ display: 'none' }}
              />
            </label>

            <button
              className="primary full"
              type="submit"
              disabled={!csvFile || importBusy}
              style={{ marginTop: '12px' }}
            >
              <Upload size={16} /> {importBusy ? 'Đang import...' : 'Tiến hành Import'}
            </button>
          </form>

          {importResult && (
            <div style={{ marginTop: '16px', background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '8px', fontSize: '0.85rem' }}>
              <div style={{ color: '#4ade80', fontWeight: 600 }}>Thành công: {importResult.success_count} tài khoản</div>
              {importResult.errors.length > 0 && (
                <div style={{ marginTop: '8px', color: '#f87171' }}>
                  <strong>Lỗi ({importResult.error_count}):</strong>
                  <ul style={{ paddingLeft: '20px', margin: '4px 0 0' }}>
                    {importResult.errors.map((err, i) => (
                      <li key={i}>Dòng {err.row}: {err.error}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>
      </div>}

      {section === 'server' && <section className="panel server-config-panel">
        <div className="section-heading"><div><p className="eyebrow">ĐỊA CHỈ MÁY CHẤM</p><h2>Thông tin kết nối</h2></div><Server size={20} className="muted" /></div>
        <p>Nhập địa chỉ máy chấm để xem trước thông tin sẽ được dùng trong luồng gửi bài. Khu vực này hiện chỉ là giao diện minh họa, chưa kiểm tra kết nối hoặc thay đổi cấu hình thật.</p>
        <label>URL máy chấm
          <input type="url" value={scoringUrl} onChange={(event) => setScoringUrl(event.target.value)} placeholder="https://scoring.example.com" />
          <small>Ví dụ: https://scoring.tenmiencuaban.vn</small>
        </label>
        <div className="server-status-row"><span className="status-indicator" /> Chưa kiểm tra kết nối</div>
        <button className="primary" type="button" disabled={!scoringUrl} onClick={() => navigate('/admin/monitor')}>Xem trong giám sát <Gauge size={16} /></button>
        <p className="muted server-note">Giá trị này chỉ tồn tại trên trang hiện tại và chưa được dùng khi gửi bài.</p>
      </section>}

      {section === 'monitor' && <>
        <div className="stat-grid">
          {[[Activity, 'Đang xử lý', activeJobs.length], [Check, 'Hoàn tất', successfulJobs], [Gauge, 'Thời gian xử lý TB', averageDuration], [Eye, 'Tỉ lệ hoàn tất', completedJobs.length ? `${Math.round(successfulJobs / completedJobs.length * 100)}%` : '—']].map(([Icon, label, value], index) => {
            const MetricIcon = Icon as typeof Activity;
            return <div className="stat-card" key={String(label)}><span className={`stat-icon color-${index}`}><MetricIcon size={20} /></span><span><small>{String(label)}</small><strong>{String(value)}</strong></span></div>;
          })}
        </div>
        <section className="panel"><div className="section-heading"><div><p className="eyebrow">ĐƯỜNG TRUYỀN & HIỆU NĂNG</p><h2>Thông tin giám sát</h2></div><Gauge size={20} className="muted" /></div>
          <div className="monitor-list"><div><span>Địa chỉ máy chấm</span><strong>{scoringUrl || 'Chưa nhập'}</strong></div><div><span>Kiểm tra đường truyền</span><strong>Chưa kết nối kiểm tra</strong></div><div><span>Cập nhật hàng đợi</span><strong>Tự làm mới mỗi 2 giây</strong></div><div><span>Phạm vi số liệu</span><strong>{jobs.length} lượt gần nhất</strong></div></div>
          <p className="muted server-note">Các chỉ số xử lý được tính từ những lượt chấm gần đây. Kiểm tra đường truyền và lưu địa chỉ sẽ được nối với máy chủ khi triển khai phần kết nối.</p>
        </section>
      </>}
    </div>
  );
}
