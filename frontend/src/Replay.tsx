import {useEffect,useState} from 'react';
import {ChevronLeft,ChevronRight,Pause,Play} from 'lucide-react';
import type {Replays} from './api';
export default function Replay({data,onDay}:{data:Replays;onDay:(round:number,day:number)=>void}) {
  const [matchIndex,setMatchIndex]=useState(0),[gameIndex,setGameIndex]=useState(0),[step,setStep]=useState(0),[playing,setPlaying]=useState(false);
  useEffect(()=>{setMatchIndex(0);setGameIndex(0);setStep(0);setPlaying(false);},[data]);
  const match=data.matches[matchIndex],game=match?.games[gameIndex];
  const total=game?.moves.length??0;
  useEffect(()=>{
    if(!playing)return;
    if(step>=total){setPlaying(false);return;}
    const timer=window.setTimeout(()=>setStep(s=>s+1),650);
    return ()=>window.clearTimeout(timer);
  },[playing,step,total]);
  const pieces=new Map<string,{owner:number;type:number}>();
  for(let x=0;x<9;x++){pieces.set(`${x},0`,{owner:0,type:x%3});pieces.set(`${x},8`,{owner:1,type:x%3});}
  for(const [,move] of game?.moves.slice(0,step)??[]){const [x,y,nx,ny]=move;const p=pieces.get(`${x},${y}`);if(p){pieces.delete(`${x},${y}`);pieces.set(`${nx},${ny}`,p);}}
  const last=step?game?.moves[step-1]?.[1]:undefined;
  const botName=(side:'a'|'b')=>side==='a'?match?.a:match?.b;
  return <section className="panel"><div className="section-heading"><div><p className="eyebrow">MATCH REPLAY</p><h2>Nhìn lại từng nước đi</h2></div><span className="badge">BO2</span></div>
    <div className="replay-selects"><label>Ngày thi<select value={data.round&&data.day?`${data.round},${data.day}`:''} onChange={e=>{const [r,d]=e.target.value.split(',').map(Number);onDay(r,d);}} disabled={!data.available.length}>{!data.available.length&&<option>Chưa có ngày thi</option>}{data.available.map(d=><option key={`${d.round},${d.day}`} value={`${d.round},${d.day}`}>Vòng {d.round} · Ngày {d.day}</option>)}</select></label><label>Trận đấu<select value={matchIndex} disabled={!data.matches.length} onChange={e=>{setMatchIndex(Number(e.target.value));setGameIndex(0);setStep(0);setPlaying(false);}}>{!data.matches.length&&<option>Chưa có trận đấu</option>}{data.matches.map((m,i)=><option key={i} value={i}>Trận {m.rd}: {m.a} vs {m.b}</option>)}</select></label><label>Ván<select value={gameIndex} disabled={!match?.games.length} onChange={e=>{setGameIndex(Number(e.target.value));setStep(0);setPlaying(false);}}>{match?.games.map((_,i)=><option key={i} value={i}>Ván {i+1}</option>)}</select></label></div>
    {!game?<div className="empty-state"><Play/><h3>Trận đấu sẽ xuất hiện tại đây</h3><p>{match?'Trận này không có dữ liệu phát lại.':'Sau khi ban tổ chức chấm, bạn có thể xem lại các trận trong bảng của mình.'}</p></div>:<>
      <div className="replay-names"><span>🔵 {botName(game.players[0])}</span><span>🔴 {botName(game.players[1])}</span></div>
      <div className="replay-board" role="grid" aria-label="Bàn cờ phát lại 9 nhân 9">{Array.from({length:81},(_,i)=>{const x=i%9,y=8-Math.floor(i/9),p=pieces.get(`${x},${y}`);return <div role="gridcell" key={i} className={`square ${(x+y)%2?'dark':''} ${((x===0&&y===0)||(x===8&&y===8))?'goal':''} ${last&&x===last[2]&&y===last[3]?'last':''}`} aria-label={`${'abcdefghi'[x]}${y+1}${p?`, ${['Búa','Bao','Kéo'][p.type]}, bên ${p.owner}`:''}`}>{p&&<span className={`board-piece owner-${p.owner}`}>{['✊','🖐','✌️'][p.type]}</span>}</div>;})}</div>
      <div className="replay-controls"><button className="secondary" aria-label="Nước trước" disabled={step===0} onClick={()=>{setPlaying(false);setStep(s=>s-1);}}><ChevronLeft size={18}/></button><button className="primary" disabled={!total} onClick={()=>{if(step>=total)setStep(0);setPlaying(!playing);}}>{playing?<Pause size={17}/>:<Play size={17}/>} {playing?'Dừng':'Phát'}</button><button className="secondary" aria-label="Nước tiếp" disabled={step>=total} onClick={()=>{setPlaying(false);setStep(s=>s+1);}}><ChevronRight size={18}/></button><input aria-label="Chọn nước đi" type="range" min={0} max={total} value={step} onChange={e=>{setPlaying(false);setStep(Number(e.target.value));}}/><span>{step} / {total}</span></div>
    </>}
  </section>;
}
