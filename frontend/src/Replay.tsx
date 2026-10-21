import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { loadMatchReplay, type ReplayGame, type Replays } from './api';

export default function Replay({ data, onDay }: { data: Replays; onDay: (round: number, day: number) => void }) {
  const [matchIndex, setMatchIndex] = useState(0);
  const [gameIndex, setGameIndex] = useState(0);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [games, setGames] = useState<ReplayGame[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const match = data.matches[matchIndex];

  useEffect(() => {
    setMatchIndex(0);
    setGameIndex(0);
    setStep(0);
    setPlaying(false);
  }, [data]);

  useEffect(() => {
    let cancelled = false;
    setGames([]);
    setGameIndex(0);
    setStep(0);
    setPlaying(false);
    setLoadError('');
    if (!match?.storagePath) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void loadMatchReplay(match.storagePath)
      .then(result => { if (!cancelled) setGames(result); })
      .catch(error => { if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Không tải được replay'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [match?.storagePath]);

  const game = games[gameIndex];
  const total = game?.moves.length ?? 0;

  useEffect(() => {
    if (!playing) return;
    if (step >= total) { setPlaying(false); return; }
    const timer = window.setTimeout(() => setStep(value => value + 1), 650);
    return () => window.clearTimeout(timer);
  }, [playing, step, total]);

  const pieces = new Map<string, { owner: number; type: number }>();
  for (let x = 0; x < 9; x++) {
    pieces.set(`${x},0`, { owner: 0, type: x % 3 });
    pieces.set(`${x},8`, { owner: 1, type: x % 3 });
  }
  for (const [, move] of game?.moves.slice(0, step) ?? []) {
    const [x, y, nx, ny] = move;
    const piece = pieces.get(`${x},${y}`);
    if (piece) { pieces.delete(`${x},${y}`); pieces.set(`${nx},${ny}`, piece); }
  }
  const last = step ? game?.moves[step - 1]?.[1] : undefined;
  const botName = (side: 'a' | 'b') => side === 'a' ? match?.a : match?.b;

  return (
    <section className="panel">
      <div className="section-heading"><div><p className="eyebrow">MATCH REPLAY</p><h2>Nhìn lại từng nước đi</h2></div><span className="badge">BO2</span></div>
      <div className="replay-selects">
        <label>Ngày thi<select value={data.round && data.day ? `${data.round},${data.day}` : ''} onChange={event => { const [round, day] = event.target.value.split(',').map(Number); onDay(round, day); }} disabled={!data.available.length}>
          {!data.available.length && <option>Chưa có ngày thi</option>}
          {data.available.map(date => <option key={`${date.round},${date.day}`} value={`${date.round},${date.day}`}>{date.round === 0 ? 'Vòng loại' : `Vòng ${date.round} · Ngày ${date.day}`}</option>)}
        </select></label>
        <label>Trận đấu<select value={matchIndex} disabled={!data.matches.length} onChange={event => { setMatchIndex(Number(event.target.value)); setGameIndex(0); setStep(0); setPlaying(false); }}>
          {!data.matches.length && <option>Chưa có trận đấu</option>}
          {data.matches.map((item, index) => <option key={item.id ?? index} value={index}>{item.kind === 'job' ? `Lượt chấm ${item.rd}` : `Trận ${item.rd}`}: {item.a} vs {item.b}</option>)}
        </select></label>
        <label>Ván<select value={gameIndex} disabled={!games.length} onChange={event => { setGameIndex(Number(event.target.value)); setStep(0); setPlaying(false); }}>
          {games.map((_, index) => <option key={index} value={index}>Ván {index + 1}</option>)}
        </select></label>
      </div>
      {loading ? <div className="empty-state"><Play/><h3>Đang tải replay…</h3><p>Đang lấy diễn biến trận từ kho lưu trữ.</p></div>
        : loadError ? <div className="empty-state"><Play/><h3>Chưa tải được replay</h3><p>{loadError}</p></div>
          : !game ? <div className="empty-state"><Play/><h3>Trận đấu sẽ xuất hiện tại đây</h3><p>{match ? 'Trận này không có dữ liệu phát lại.' : 'Sau khi ban tổ chức chấm, bạn có thể xem lại các trận trong bảng của mình.'}</p></div>
            : <>
              <div className="replay-names"><span>🔵 {botName(game.players[0])}</span><span>🔴 {botName(game.players[1])}</span></div>
              <div className="replay-board" role="grid" aria-label="Bàn cờ phát lại 9 nhân 9">
                {Array.from({ length: 81 }, (_, index) => {
                  const x = index % 9, y = 8 - Math.floor(index / 9), piece = pieces.get(`${x},${y}`);
                  return <div role="gridcell" key={index} className={`square ${(x + y) % 2 ? 'dark' : ''} ${((x === 0 && y === 0) || (x === 8 && y === 8)) ? 'goal' : ''} ${last && x === last[2] && y === last[3] ? 'last' : ''}`} aria-label={`${'abcdefghi'[x]}${y + 1}${piece ? `, ${['Búa', 'Bao', 'Kéo'][piece.type]}, bên ${piece.owner}` : ''}`}>
                    {piece && <span className={`board-piece owner-${piece.owner}`}>{['✊', '🖐', '✌️'][piece.type]}</span>}
                  </div>;
                })}
              </div>
              <div className="replay-controls">
                <button className="secondary" aria-label="Nước trước" disabled={step === 0} onClick={() => { setPlaying(false); setStep(value => value - 1); }}><ChevronLeft size={18}/></button>
                <button className="primary" disabled={!total} onClick={() => { if (step >= total) setStep(0); setPlaying(value => !value); }}>{playing ? <Pause size={17}/> : <Play size={17}/>} {playing ? 'Dừng' : 'Phát'}</button>
                <button className="secondary" aria-label="Nước tiếp" disabled={step >= total} onClick={() => { setPlaying(false); setStep(value => value + 1); }}><ChevronRight size={18}/></button>
                <input aria-label="Chọn nước đi" type="range" min={0} max={total} value={step} onChange={event => { setPlaying(false); setStep(Number(event.target.value)); }}/>
                <span>{step} / {total}</span>
              </div>
            </>}
    </section>
  );
}
