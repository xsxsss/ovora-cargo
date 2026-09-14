import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Send, Truck, Package, Wifi, WifiOff, Mic, MicOff, Play, Pause, Square, X } from 'lucide-react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
// @ts-ignore — Vite virtual module resolved at build time
import { projectId, publicAnonKey } from '/utils/supabase/info';
import { CSRF_HEADER, CSRF_TOKEN } from '../api/csrfToken';
import { withUserToken } from '../api/userToken';

const BASE = `https://${projectId}.supabase.co/functions/v1/make-server-4e36197a`;
const H    = { 'Content-Type': 'application/json', Authorization: `Bearer ${publicAnonKey}`, [CSRF_HEADER]: CSRF_TOKEN };

// Preferred channel; if backend doesn't have it yet (not deployed), falls back to first available
const FALLBACK_CHANNEL = { id: 'ch-russia', name: 'Россия', emoji: '🇷🇺', color: '#5ba3f5', desc: 'Общий канал' };
type Channel = { id: string; name: string; emoji: string; color: string; desc: string };

interface Message {
  id: string;
  channelId: string;
  userEmail: string;
  userName: string;
  userRole: string;
  type: 'text' | 'voice';
  text?: string;
  audioUrl?: string;
  audioDuration?: number;
  ts: number;
  createdAt: string;
  reactions?: Record<string, string[]>;
}

function timeShort(iso: string) {
  try { return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

function dateLine(ts: number) {
  const d = new Date(ts); const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Сегодня';
  const diff = Math.floor((today.getTime() - d.getTime()) / 86400000);
  if (diff === 1) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function fmtDur(sec: number) {
  const m = Math.floor(sec / 60); const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/* ─── Voice bubble player ─────────────────────────────────────────── */
const SPEEDS = [1, 1.5, 2];
function VoiceBubble({ audioUrl, duration, isMe }: { audioUrl: string; duration: number; isMe: boolean }) {
  const [playing,  setPlaying]  = useState(false);
  const [progress, setProgress] = useState(0);
  const [elapsed,  setElapsed]  = useState(0);
  const [speedIdx, setSpeedIdx] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speed = SPEEDS[speedIdx];

  useEffect(() => {
    const a = new Audio(audioUrl);
    audioRef.current = a;
    a.playbackRate = speed;
    a.onended = () => { setPlaying(false); setProgress(0); setElapsed(0); };
    a.ontimeupdate = () => {
      if (a.duration) { setProgress(a.currentTime / a.duration); setElapsed(a.currentTime); }
    };
    return () => { a.pause(); };
  }, [audioUrl]);

  useEffect(() => { if (audioRef.current) audioRef.current.playbackRate = speed; }, [speed]);

  const toggle = () => {
    const a = audioRef.current; if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play(); setPlaying(true); }
  };
  const cycleSpeed = () => setSpeedIdx(i => (i + 1) % SPEEDS.length);

  const accent = isMe ? '#93c5fd' : '#5ba3f5';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 190 }}>
      <button onClick={toggle} style={{
        width: 36, height: 36, borderRadius: 12, flexShrink: 0,
        background: isMe ? 'rgba(255,255,255,0.18)' : '#1a2d45',
        border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
      }}>
        {playing ? <Pause style={{ width: 14, height: 14, color: '#fff' }} /> : <Play style={{ width: 14, height: 14, color: accent }} />}
      </button>
      <div style={{ flex: 1 }}>
        <div style={{ position: 'relative', height: 4, background: isMe ? 'rgba(255,255,255,0.25)' : '#1a2d45', borderRadius: 2 }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${progress * 100}%`, background: accent, borderRadius: 2, transition: 'width .1s linear' }} />
        </div>
        <span style={{ fontSize: 10, color: isMe ? 'rgba(255,255,255,0.55)' : '#3a5070', marginTop: 3, display: 'block' }}>
          {fmtDur(playing ? elapsed : duration)}
        </span>
      </div>
      <button onClick={cycleSpeed} style={{
        fontSize: 10, fontWeight: 800, color: accent, background: isMe ? 'rgba(255,255,255,0.12)' : '#0d1929',
        border: `1px solid ${accent}55`, borderRadius: 6, padding: '2px 5px', cursor: 'pointer', flexShrink: 0,
      }}>{speed}×</button>
    </div>
  );
}

/* ─── Voice recorder hook with waveform ──────────────────────────── */
function useVoiceRecorder() {
  const [recording, setRecording] = useState(false);
  const [seconds,   setSeconds]   = useState(0);
  const [blob,      setBlob]      = useState<Blob | null>(null);
  const [bars,      setBars]      = useState<number[]>(Array(20).fill(0));
  const mrRef       = useRef<MediaRecorder | null>(null);
  const chunksRef   = useRef<Blob[]>([]);
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef      = useRef<number>(0);
  const ctxRef      = useRef<AudioContext | null>(null);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Web Audio waveform
      const ctx      = new AudioContext();
      ctxRef.current = ctx;
      const source   = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserRef.current = analyser;
      const tick = () => {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        setBars(Array.from(data.slice(0, 20)).map(v => v / 255));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);

      const mr = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg' });
      mrRef.current   = mr;
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        cancelAnimationFrame(rafRef.current);
        ctxRef.current?.close();
        setBars(Array(20).fill(0));
        const b = new Blob(chunksRef.current, { type: mr.mimeType });
        setBlob(b);
      };
      mr.start();
      setRecording(true);
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000);
    } catch {
      toast.error('Нет доступа к микрофону');
    }
  }, []);

  const stop = useCallback(() => {
    mrRef.current?.stop();
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
  }, []);

  const cancel = useCallback(() => {
    mrRef.current?.stop();
    cancelAnimationFrame(rafRef.current);
    ctxRef.current?.close();
    if (timerRef.current) clearInterval(timerRef.current);
    mrRef.current = null;
    chunksRef.current = [];
    setRecording(false);
    setSeconds(0);
    setBlob(null);
    setBars(Array(20).fill(0));
  }, []);

  const clear = useCallback(() => setBlob(null), []);

  return { recording, seconds, blob, bars, start, stop, cancel, clear };
}

/* ─── Chat View ──────────────────────────────────────────────────── */
export function RadioPage() {
  const navigate   = useNavigate();
  const userEmail  = sessionStorage.getItem('ovora_user_email') || '';
  const userRole   = sessionStorage.getItem('userRole') || 'sender';
  const isDriver   = userRole === 'driver';
  const userName   = sessionStorage.getItem('ovora_user_name') || userEmail.split('@')[0] || 'Аноним';

  const [channels,  setChannels]  = useState<Channel[]>([FALLBACK_CHANNEL]);
  const [channel,   setChannel]   = useState<Channel>(FALLBACK_CHANNEL);
  useEffect(() => {
    fetch(`${BASE}/radio/channels`, { headers: withUserToken(H) })
      .then(r => r.json())
      .then((data: { channels?: Channel[] }) => {
        const list = data.channels || [];
        if (list.length > 0) {
          setChannels(list);
          setChannel(list[0]);
        }
      })
      .catch(() => {});
  }, []);

  const [messages,    setMessages]    = useState<Message[]>([]);
  const [text,        setText]        = useState('');
  const [sending,     setSending]     = useState(false);
  const [connected,   setConnected]   = useState(true);
  const [hasMore,     setHasMore]     = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [online,      setOnline]      = useState<{ userEmail: string; userName: string; userRole: string }[]>([]);
  const [atBottom,    setAtBottom]    = useState(true);
  const [newCount,    setNewCount]    = useState(0);
  const [activeMenu,  setActiveMenu]  = useState<string | null>(null);
  const [mutedUsers,  setMutedUsers]  = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('radio_muted') || '[]'); } catch { return []; }
  });
  const lastMsgCount  = useRef(0);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const scrollRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLInputElement>(null);
  const pttRef     = useRef(false);
  const voice      = useVoiceRecorder();

  const loadMessages = useCallback(async () => {
    try {
      const res  = await fetch(`${BASE}/radio/channels/${channel.id}/messages?limit=30`, { headers: withUserToken(H) });
      const data = await res.json();
      if (data.messages) {
        setMessages(_prev => {
          const incoming = data.messages as Message[];
          const diff = incoming.length - lastMsgCount.current;
          if (diff > 0 && lastMsgCount.current > 0) {
            setAtBottom(ab => { if (!ab) setNewCount(n => n + diff); return ab; });
          }
          lastMsgCount.current = incoming.length;
          return incoming;
        });
        setHasMore(!!data.hasMore);
        setConnected(true);
      } else if (data.error) { setConnected(false); }
    } catch { setConnected(false); }
  }, [channel.id]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || messages.length === 0) return;
    setLoadingMore(true);
    const oldestTs = messages[0].ts;
    const scroller = scrollRef.current;
    const prevScrollHeight = scroller?.scrollHeight || 0;
    try {
      const res  = await fetch(`${BASE}/radio/channels/${channel.id}/messages?limit=30&before=${oldestTs}`, { headers: withUserToken(H) });
      const data = await res.json();
      if (data.messages && data.messages.length > 0) {
        setMessages(prev => [...data.messages, ...prev]);
        setHasMore(!!data.hasMore);
        // preserve scroll position after prepending
        requestAnimationFrame(() => {
          if (scroller) scroller.scrollTop = scroller.scrollHeight - prevScrollHeight;
        });
      } else {
        setHasMore(false);
      }
    } catch {}
    setLoadingMore(false);
  }, [channel.id, hasMore, loadingMore, messages]);

  // Heartbeat: announce presence every 30s
  useEffect(() => {
    if (!userEmail || !channel.id) return;
    const beat = () => fetch(`${BASE}/radio/channels/${channel.id}/heartbeat`, {
      method: 'POST', headers: withUserToken(H),
      body: JSON.stringify({ userEmail, userName, userRole }),
    }).catch(() => {});
    beat();
    const t = setInterval(beat, 30_000);
    return () => clearInterval(t);
  }, [channel.id, userEmail, userName, userRole]);

  // Presence: poll online users every 10s
  useEffect(() => {
    if (!channel.id) return;
    const load = () => fetch(`${BASE}/radio/channels/${channel.id}/presence`, { headers: withUserToken(H) })
      .then(r => r.json())
      .then((data: { users?: any[] }) => { if (data.users) setOnline(data.users); })
      .catch(() => {});
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [channel.id]);

  // Mark radio as "seen" on mount/unmount
  useEffect(() => {
    localStorage.setItem('radio_last_seen', String(Date.now()));
    return () => { localStorage.setItem('radio_last_seen', String(Date.now())); };
  }, []);

  // Supabase Realtime: subscribe to kv_store inserts for this channel
  useEffect(() => {
    const wsUrl = `wss://${projectId}.supabase.co/realtime/v1/websocket?apikey=${publicAnonKey}&vsn=1.0.0`;
    const ws = new WebSocket(wsUrl);
    const channelRef = `radio:${channel.id}:${Date.now()}`;
    ws.onopen = () => {
      ws.send(JSON.stringify({ topic: `realtime:public:kv_store_4e36197a`, event: 'phx_join', payload: {
        config: { broadcast: { self: false }, presence: { key: '' }, postgres_changes: [
          { event: 'INSERT', schema: 'public', table: 'kv_store_4e36197a', filter: `key=like.ovora:radio:msg:${channel.id}:%` },
          { event: 'UPDATE', schema: 'public', table: 'kv_store_4e36197a', filter: `key=like.ovora:radio:msg:${channel.id}:%` },
          { event: 'DELETE', schema: 'public', table: 'kv_store_4e36197a', filter: `key=like.ovora:radio:msg:${channel.id}:%` },
        ]},
      }, ref: channelRef }));
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.event === 'postgres_changes') loadMessages();
      } catch {}
    };
    return () => { ws.close(); };
  }, [channel.id, loadMessages]);

  useEffect(() => { loadMessages(); }, [loadMessages]);
  useEffect(() => { const t = setInterval(loadMessages, 5_000); return () => clearInterval(t); }, [loadMessages]);
  useEffect(() => { if (atBottom) { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); setNewCount(0); } }, [messages.length, atBottom]);

  // Track scroll position
  useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    const onScroll = () => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      setAtBottom(near);
      if (near) setNewCount(0);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  /* Upload voice blob → get URL */
  const uploadVoice = async (b: Blob, _duration: number): Promise<string> => {
    const ext  = b.type.includes('ogg') ? 'ogg' : 'webm';
    const form = new FormData();
    form.append('file', b, `voice_${Date.now()}.${ext}`);
    form.append('userEmail', userEmail);
    const res  = await fetch(`${BASE}/radio/voice-upload`, {
      method: 'POST',
      headers: withUserToken({ Authorization: `Bearer ${publicAnonKey}`, [CSRF_HEADER]: CSRF_TOKEN }),
      body: form,
    });
    let data: any = {};
    try { data = await res.json(); } catch { /* non-JSON response */ }
    if (!res.ok) throw new Error(data.error || `Ошибка загрузки (${res.status})`);
    if (!data.audioUrl) throw new Error('Сервер не вернул URL аудио');
    return data.audioUrl as string;
  };

  const sendText = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    if (!userEmail) { toast.error('Необходима авторизация'); return; }
    setSending(true); setText('');
    const optimistic: Message = { id: `opt_${Date.now()}`, channelId: channel.id, userEmail, userName, userRole, type: 'text', text: trimmed, ts: Date.now(), createdAt: new Date().toISOString() };
    setMessages(prev => [...prev, optimistic]);
    try {
      const res  = await fetch(`${BASE}/radio/channels/${channel.id}/messages`, {
        method: 'POST', headers: withUserToken(H),
        body: JSON.stringify({ userEmail, userName, userRole, type: 'text', text: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await loadMessages();
    } catch (e: any) { toast.error(`Ошибка: ${e.message}`); setText(trimmed); setMessages(prev => prev.filter(m => m.id !== optimistic.id)); }
    finally { setSending(false); inputRef.current?.focus(); }
  };

  const sendVoice = async () => {
    if (!voice.blob || sending) return;
    if (!userEmail) { toast.error('Необходима авторизация'); return; }
    setSending(true);
    const duration = voice.seconds;
    const b = voice.blob;
    voice.clear();
    try {
      const audioUrl = await uploadVoice(b, duration);
      const res = await fetch(`${BASE}/radio/channels/${channel.id}/messages`, {
        method: 'POST', headers: withUserToken(H),
        body: JSON.stringify({ userEmail, userName, userRole, type: 'voice', audioUrl, audioDuration: duration }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await loadMessages();
    } catch (e: any) { toast.error(`Ошибка: ${e.message}`); }
    finally { setSending(false); }
  };

  const deleteMsg = async (msgId: string) => {
    if (!userEmail) return;
    setMessages(prev => prev.filter(m => m.id !== msgId));
    setActiveMenu(null);
    await fetch(`${BASE}/radio/channels/${channel.id}/messages/${msgId}`, {
      method: 'DELETE', headers: withUserToken(H), body: JSON.stringify({ userEmail }),
    }).catch(() => {});
  };

  const reactToMsg = async (msgId: string, emoji: string) => {
    if (!userEmail) return;
    setMessages(prev => prev.map(m => {
      if (m.id !== msgId) return m;
      const r = { ...(m.reactions || {}) };
      const users = r[emoji] || [];
      if (users.includes(userEmail)) { r[emoji] = users.filter(u => u !== userEmail); if (!r[emoji].length) delete r[emoji]; }
      else r[emoji] = [...users, userEmail];
      return { ...m, reactions: r };
    }));
    await fetch(`${BASE}/radio/channels/${channel.id}/messages/${msgId}/react`, {
      method: 'POST', headers: withUserToken(H), body: JSON.stringify({ userEmail, emoji }),
    }).catch(() => {});
  };

  const reportMsg = async (msgId: string) => {
    setActiveMenu(null);
    await fetch(`${BASE}/radio/channels/${channel.id}/messages/${msgId}/report`, {
      method: 'POST', headers: withUserToken(H), body: JSON.stringify({ userEmail, reason: 'spam/inappropriate' }),
    }).catch(() => {});
    toast.success('Жалоба отправлена');
  };

  const toggleMute = (email: string) => {
    setMutedUsers(prev => {
      const next = prev.includes(email) ? prev.filter(e => e !== email) : [...prev, email];
      localStorage.setItem('radio_muted', JSON.stringify(next));
      return next;
    });
    setActiveMenu(null);
  };

  // PTT: when blob ready and PTT was active → auto-send (or discard if < 1s)
  useEffect(() => {
    if (!voice.blob || !pttRef.current) return;
    pttRef.current = false;
    if (voice.seconds < 1) { voice.clear(); return; }
    sendVoice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.blob]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); }
  };

  /* Group by date */
  const grouped: { date: string; msgs: Message[] }[] = [];
  let lastDate = '';
  for (const m of messages) {
    const d = dateLine(m.ts);
    if (d !== lastDate) { grouped.push({ date: d, msgs: [] }); lastDate = d; }
    grouped[grouped.length - 1].msgs.push(m);
  }

  return (
    <div style={{ background: '#0b1420', height: '100dvh', display: 'flex', flexDirection: 'column', fontFamily: "'Sora',sans-serif", overflow: 'hidden', position: 'relative' }}>

      {/* ── Header ── */}
      <header style={{ background: '#080f1c', borderBottom: '1px solid #0d2035', padding: '0 16px', height: 60, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <button onClick={() => navigate(-1)} style={{ width: 36, height: 36, borderRadius: 11, background: '#0a1828', border: '1px solid #1a2d45', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
          <ArrowLeft style={{ width: 16, height: 16, color: '#7a9ab8' }} />
        </button>

        <div style={{ width: 38, height: 38, borderRadius: 12, background: `${channel.color}18`, border: `1px solid ${channel.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
          {channel.emoji}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 15, fontWeight: 800, color: '#e2e8f0', lineHeight: 1, marginBottom: 3 }}>{channel.name}</p>
          <p style={{ fontSize: 11, color: '#2a4060', display: 'flex', alignItems: 'center', gap: 5 }}>
            {connected
              ? <><Wifi style={{ width: 10, height: 10, color: '#22c55e' }} /><span style={{ color: '#22c55e' }}>Подключён</span></>
              : <><WifiOff style={{ width: 10, height: 10, color: '#ef4444' }} /><span style={{ color: '#ef4444' }}>Нет соединения</span></>
            }
            <span>· {online.length} в эфире</span>
          </p>
        </div>

        {/* Online count badge */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 100,
          background: online.length > 0 ? '#072418' : '#0a1828', border: `1px solid ${online.length > 0 ? '#0a4a2a' : '#1a2d45'}`, flexShrink: 0,
        }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: online.length > 0 ? '#22c55e' : '#2a4060', boxShadow: online.length > 0 ? '0 0 6px #22c55e' : 'none', animation: online.length > 0 ? 'pulse 2s infinite' : 'none' }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: online.length > 0 ? '#22c55e' : '#3a5070' }}>{online.length}</span>
        </div>
      </header>

      {/* ── Channel switcher ── */}
      <div style={{ background: '#080f1c', borderBottom: '1px solid #0d2035', overflowX: 'auto', flexShrink: 0, scrollbarWidth: 'none' }}>
        <div style={{ display: 'flex', gap: 8, padding: '8px 16px', width: 'max-content' }}>
          {channels.map(ch => {
            const active = ch.id === channel.id;
            return (
              <button key={ch.id} onClick={() => { setChannel(ch); setMessages([]); setHasMore(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 100, flexShrink: 0,
                  background: active ? `${ch.color}22` : '#0a1828',
                  border: `1px solid ${active ? ch.color + '66' : '#1a2d45'}`,
                  color: active ? ch.color : '#4a6a8a', fontSize: 12, fontWeight: active ? 700 : 500,
                  cursor: 'pointer', transition: 'all .15s', whiteSpace: 'nowrap',
                }}
              >
                <span>{ch.emoji}</span>
                <span>{ch.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Messages ── */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', WebkitOverflowScrolling: 'touch' as any }}>
        {hasMore && messages.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
            <button onClick={loadMore} disabled={loadingMore} style={{
              padding: '6px 16px', borderRadius: 100, background: '#0d1929', border: '1px solid #1a3560',
              color: '#5ba3f5', fontSize: 12, fontWeight: 600, cursor: loadingMore ? 'default' : 'pointer',
              opacity: loadingMore ? 0.6 : 1,
            }}>
              {loadingMore ? 'Загрузка…' : '↑ Загрузить ещё'}
            </button>
          </div>
        )}
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>{channel.emoji}</div>
            <p style={{ fontSize: 16, fontWeight: 700, color: '#c0d4e8', marginBottom: 8 }}>Канал пока пуст</p>
            <p style={{ fontSize: 13, color: '#3a5070', lineHeight: 1.5 }}>
              {isDriver ? 'Напишите первым — водители ждут!' : 'Тут общаются водители по России.'}
            </p>
          </div>
        )}

        {grouped.map(group => (
          <div key={group.date}>
            {/* Date divider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0 12px' }}>
              <div style={{ flex: 1, height: 1, background: '#0d2035' }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: '#2a4060', padding: '3px 10px', borderRadius: 100, background: '#080f1a', border: '1px solid #0d2035' }}>{group.date}</span>
              <div style={{ flex: 1, height: 1, background: '#0d2035' }} />
            </div>

            {group.msgs.filter(m => !mutedUsers.includes(m.userEmail)).map((msg, i, arr) => {
              const isMe        = msg.userEmail === userEmail;
              const isSameUser  = i > 0 && arr[i - 1].userEmail === msg.userEmail;
              const msgIsDriver = msg.userRole === 'driver';
              const menuOpen    = activeMenu === msg.id;
              const reactionEntries = Object.entries(msg.reactions || {});
              const EMOJIS = ['👍','⚠️','✅','🚛','❤️'];

              return (
                <motion.div key={msg.id}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }}
                  style={{ display: 'flex', flexDirection: isMe ? 'row-reverse' : 'row', gap: 8, marginBottom: isSameUser ? 3 : 10, alignItems: 'flex-end' }}
                >
                  {/* Avatar */}
                  {!isMe && !isSameUser && (
                    <div style={{ width: 30, height: 30, borderRadius: 10, flexShrink: 0, background: msgIsDriver ? 'linear-gradient(135deg,#1a47c8,#2f8fe0)' : 'linear-gradient(135deg,#047857,#34d399)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {msgIsDriver ? <Truck style={{ width: 13, height: 13, color: '#fff' }} /> : <Package style={{ width: 13, height: 13, color: '#fff' }} />}
                    </div>
                  )}
                  {!isMe && isSameUser && <div style={{ width: 30, flexShrink: 0 }} />}

                  <div style={{ maxWidth: '75%' }}>
                    {!isMe && !isSameUser && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: msgIsDriver ? '#5ba3f5' : '#34d399' }}>{msg.userName}</span>
                        <span style={{ fontSize: 10, color: '#2a4060', background: msgIsDriver ? '#0a1e40' : '#071a10', border: `1px solid ${msgIsDriver ? '#1a3560' : '#0a2a18'}`, borderRadius: 5, padding: '1px 6px' }}>
                          {msgIsDriver ? '🚛 Водитель' : '📦 Отправитель'}
                        </span>
                      </div>
                    )}
                    {/* Action menu */}
                    <AnimatePresence>
                      {menuOpen && (
                        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                          style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap', justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
                          {EMOJIS.map(e => (
                            <button key={e} onClick={() => { reactToMsg(msg.id, e); setActiveMenu(null); }}
                              style={{ fontSize: 16, background: 'none', border: '1px solid #1a2d45', borderRadius: 8, padding: '3px 7px', cursor: 'pointer' }}>
                              {e}
                            </button>
                          ))}
                          {isMe
                            ? <button onClick={() => deleteMsg(msg.id)} style={{ fontSize: 11, background: '#3a0a0a', border: '1px solid #6a1a1a', borderRadius: 8, padding: '3px 10px', color: '#f87171', cursor: 'pointer' }}>🗑 Удалить</button>
                            : <>
                                <button onClick={() => reportMsg(msg.id)} style={{ fontSize: 11, background: '#1a0a0a', border: '1px solid #4a1a1a', borderRadius: 8, padding: '3px 10px', color: '#fca5a5', cursor: 'pointer' }}>🚩 Жалоба</button>
                                <button onClick={() => toggleMute(msg.userEmail)} style={{ fontSize: 11, background: '#0d1929', border: '1px solid #1a2d45', borderRadius: 8, padding: '3px 10px', color: '#7ab0d4', cursor: 'pointer' }}>🔇 Мут</button>
                              </>
                          }
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <div
                      onClick={() => setActiveMenu(menuOpen ? null : msg.id)}
                      style={{
                        padding: '10px 13px', borderRadius: isMe ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
                        background: isMe ? 'linear-gradient(135deg,#1a47c8,#2566cc)' : '#0d1929',
                        border: isMe ? 'none' : '1px solid #1a2d45',
                        boxShadow: isMe ? '0 4px 16px #1a47c830' : 'none',
                        cursor: 'pointer',
                      }}>
                      {msg.type === 'voice' && msg.audioUrl
                        ? <VoiceBubble audioUrl={msg.audioUrl} duration={msg.audioDuration || 0} isMe={isMe} />
                        : <p style={{ fontSize: 14, color: isMe ? '#e8f4ff' : '#c0d4e8', lineHeight: 1.5, wordBreak: 'break-word' }}>{msg.text}</p>
                      }
                      <p style={{ fontSize: 10, color: isMe ? '#93c5fd60' : '#2a4060', marginTop: 4, textAlign: isMe ? 'right' : 'left' }}>{timeShort(msg.createdAt)}</p>
                    </div>

                    {/* Reactions */}
                    {reactionEntries.length > 0 && (
                      <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap', justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
                        {reactionEntries.map(([emoji, users]) => (
                          <button key={emoji} onClick={() => reactToMsg(msg.id, emoji)}
                            style={{
                              fontSize: 12, padding: '2px 7px', borderRadius: 100, cursor: 'pointer',
                              background: users.includes(userEmail) ? '#1a2d5a' : '#0d1929',
                              border: `1px solid ${users.includes(userEmail) ? '#2a4a8a' : '#1a2d45'}`,
                              color: '#c0d4e8',
                            }}>
                            {emoji} {users.length > 1 ? users.length : ''}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* ── Scroll-to-bottom button ── */}
      <AnimatePresence>
        {!atBottom && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}
            onClick={() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); setNewCount(0); }}
            style={{
              position: 'absolute', bottom: isDriver ? 140 : 90, right: 16, zIndex: 10,
              width: 44, height: 44, borderRadius: '50%',
              background: 'linear-gradient(135deg,#1a47c8,#2f8fe0)', border: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
              boxShadow: '0 4px 16px #1a47c850',
            }}
          >
            <span style={{ fontSize: 18, lineHeight: 1 }}>↓</span>
            {newCount > 0 && (
              <div style={{ position: 'absolute', top: -4, right: -4, background: '#ef4444', borderRadius: '50%', width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: '#fff' }}>
                {newCount > 9 ? '9+' : newCount}
              </div>
            )}
          </motion.button>
        )}
      </AnimatePresence>

      {/* ── Input zone ── */}
      {isDriver ? (
        <div style={{ background: '#080f1c', borderTop: '1px solid #0d2035', padding: '10px 16px', paddingBottom: 'calc(10px + env(safe-area-inset-bottom))', flexShrink: 0 }}>

          {/* Voice preview — after recording stopped */}
          <AnimatePresence>
            {voice.blob && !voice.recording && (
              <motion.div
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10, background: '#0d1929', border: '1px solid #1a3560', borderRadius: 14, padding: '10px 14px' }}
              >
                <Mic style={{ width: 14, height: 14, color: '#5ba3f5', flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: '#7ab0d4', flex: 1 }}>Голосовое · {fmtDur(voice.seconds)}</span>
                <button onClick={voice.clear} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                  <X style={{ width: 14, height: 14, color: '#3a5070' }} />
                </button>
                <button onClick={sendVoice} disabled={sending} style={{
                  padding: '6px 14px', borderRadius: 10, background: 'linear-gradient(135deg,#1a47c8,#2f8fe0)', border: 'none', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                }}>
                  Отправить
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Recording indicator with waveform */}
          <AnimatePresence>
            {voice.recording && (
              <motion.div
                initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
                style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10, background: '#1a0a0a', border: '1px solid #4a1a1a', borderRadius: 14, padding: '10px 14px' }}
              >
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 8px #ef4444', animation: 'pulse 1s infinite', flexShrink: 0 }} />
                {/* Waveform bars */}
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 2, height: 28 }}>
                  {voice.bars.map((v, i) => (
                    <div key={i} style={{
                      flex: 1, borderRadius: 2,
                      height: `${Math.max(4, v * 100)}%`,
                      background: `rgba(239,68,68,${0.4 + v * 0.6})`,
                      transition: 'height 0.05s ease',
                    }} />
                  ))}
                </div>
                <span style={{ fontSize: 12, color: '#f87171', flexShrink: 0 }}>{fmtDur(voice.seconds)}</span>
                <button onClick={voice.cancel} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                  <X style={{ width: 14, height: 14, color: '#6a2a2a' }} />
                </button>
                <button onClick={voice.stop} style={{
                  padding: '6px 14px', borderRadius: 10, background: '#7f1d1d', border: '1px solid #991b1b', color: '#fca5a5', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                }}>
                  <Square style={{ width: 10, height: 10, display: 'inline', marginRight: 4 }} />Стоп
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Role badge */}
          {!voice.recording && !voice.blob && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <div style={{ width: 20, height: 20, borderRadius: 6, background: 'linear-gradient(135deg,#1a47c8,#2f8fe0)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Truck style={{ width: 10, height: 10, color: '#fff' }} />
              </div>
              <span style={{ fontSize: 11, color: '#2a4060' }}>
                <strong style={{ color: '#4a7090' }}>{userName}</strong> · Водитель
              </span>
            </div>
          )}

          {/* Quick replies */}
          {!voice.recording && !voice.blob && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 2 }}>
              {['На связи 👍', 'Еду 🚛', 'Понял ✅', 'Стою 🅿️', 'Спасибо 🙏', 'Осторожно ⚠️'].map(q => (
                <button key={q} onClick={() => { setText(q); inputRef.current?.focus(); }}
                  style={{ flexShrink: 0, padding: '5px 11px', borderRadius: 100, background: '#0d1929', border: '1px solid #1a3560', color: '#7ab0d4', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Text + mic row */}
          {!voice.recording && !voice.blob && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <input
                ref={inputRef}
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Написать в канал…"
                maxLength={500}
                style={{ flex: 1, background: '#0d1929', border: '1px solid #1a2d45', borderRadius: 14, padding: '12px 14px', color: '#c0d4e8', fontSize: 14, outline: 'none', transition: 'border-color .15s', fontFamily: 'inherit' }}
                onFocus={e => { e.currentTarget.style.borderColor = '#2a5090'; }}
                onBlur={e => { e.currentTarget.style.borderColor = '#1a2d45'; }}
              />

              {/* PTT Mic button — hold to talk, release to send */}
              <button
                onPointerDown={(e) => { e.preventDefault(); pttRef.current = true; voice.start(); }}
                onPointerUp={() => { if (pttRef.current) voice.stop(); }}
                onPointerLeave={() => { if (pttRef.current && voice.recording) voice.stop(); }}
                onPointerCancel={() => { if (pttRef.current && voice.recording) voice.stop(); }}
                onContextMenu={(e) => e.preventDefault()}
                style={{
                  width: 46, height: 46, borderRadius: 14, flexShrink: 0,
                  background: '#0d1929', border: '1px solid #1a3560',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none',
                }}
                title="Зажмите для записи"
              >
                <Mic style={{ width: 17, height: 17, color: '#5ba3f5' }} />
              </button>

              {/* Send text button */}
              <button
                onClick={sendText}
                disabled={sending || !text.trim()}
                style={{
                  width: 46, height: 46, borderRadius: 14, flexShrink: 0,
                  background: text.trim() ? 'linear-gradient(135deg,#1a47c8,#2f8fe0)' : '#0a1828',
                  border: `1px solid ${text.trim() ? 'transparent' : '#1a2d45'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: text.trim() ? 'pointer' : 'default', transition: 'all .2s',
                  boxShadow: text.trim() ? '0 4px 16px #1a47c840' : 'none',
                }}
              >
                <Send style={{ width: 17, height: 17, color: text.trim() ? '#fff' : '#1a3050' }} />
              </button>
            </div>
          )}
        </div>
      ) : (
        /* Sender: read-only notice */
        <div style={{ background: '#080f1c', borderTop: '1px solid #0d2035', padding: '16px', paddingBottom: 'calc(16px + env(safe-area-inset-bottom))', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <MicOff style={{ width: 16, height: 16, color: '#2a4060' }} />
          <span style={{ fontSize: 13, color: '#3a5070' }}>Только водители могут писать в этот канал</span>
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
      `}</style>
    </div>
  );
}

export default RadioPage;
