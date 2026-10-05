import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, ChevronDown, Dumbbell, History, Loader2, Mic, Plus, ShieldCheck, Sparkles, X } from 'lucide-react';
import type { User } from 'firebase/auth';
import { addDoc, collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { db } from '../lib/firebase';
import { coachContext, freshCoachContext, requestCoach } from '../lib/coach-api';
import { coachEndpoint } from '../lib/coach-endpoint';
import { applyCoachProposal } from '../lib/coach-store';
import { applyDemoProposal } from '../lib/demo';
import { proposalSchema, sameSnapshot, type CoachProposal, type CoachResponse } from '../lib/coach-contract';
import type { Routine, UserProfile, WorkoutLog } from '../types';

type Message = { role: 'user' | 'bot'; text: string; basis?: CoachResponse['basis'] };
const welcome: Message = { role: 'bot', text: 'Let’s make training work for you. I can review your recent sessions, build a routine, or help you change one. You’ll review every change before it’s saved.' };
const sampleKey = 'fitai_sample_chat_v1';
function sampleChat(): { messages: Message[]; pending: CoachProposal | null } {
  try {
    const data = JSON.parse(localStorage.getItem(sampleKey) || 'null');
    if (Array.isArray(data?.messages)) return { messages: data.messages.slice(-40), pending: data.pending ? proposalSchema.parse(data.pending) : null };
  } catch { /* Reset invalid sample state. */ }
  return { messages: [welcome], pending: null };
}

function ChangePreview({ proposal, busy, expired, onApply, onDiscard }: {
  proposal: CoachProposal; busy: boolean; expired: boolean; onApply: () => void; onDiscard: () => void;
}) {
  const after = proposal.after;
  const before = proposal.before;
  const removed = before?.exercises.filter(e => !after?.exercises.some(a => a.exerciseId === e.exerciseId)) || [];
  return <section className="change-preview" aria-label="Change preview">
    <div className="flex items-start justify-between gap-4">
      <div><p className="eyebrow text-[#C6F36B]">Review before saving</p><h3 className="text-xl font-semibold mt-2">{proposal.kind === 'delete' ? 'Delete this routine?' : after?.name || 'Update your profile'}</h3></div>
      <span className="preview-tag">{proposal.kind === 'create' ? 'New routine' : proposal.kind === 'delete' ? 'Deletion' : 'Suggested edit'}</span>
    </div>
    <p className="text-sm text-zinc-400 mt-3">{proposal.summary}</p>
    {before && proposal.kind === 'edit' && before.name !== after?.name && <p className="text-sm text-zinc-400 mt-3">Name: <del>{before.name}</del> → {after?.name}</p>}
    {after && <>
      {after.description && <p className="text-sm text-zinc-400 mt-3">{after.description}</p>}
      <div className="divide-y divide-white/10 mt-5">
        {after.exercises.map((e, i) => {
          const original = before?.exercises.find(b => b.exerciseId === e.exerciseId);
          const changed = before && !sameSnapshot(original, e);
          return <div key={e.exerciseId} className="py-3 flex items-start gap-3">
            <span className="exercise-index">{String(i + 1).padStart(2, '0')}</span>
            <div className="flex-1 min-w-0"><p className="font-medium text-sm">{e.name} {changed && <span className="ml-2 text-[#C6F36B] text-xs">{original ? 'Changed' : 'Added'}</span>}</p>
              <p className="text-xs text-zinc-400 mt-1">{e.sets.length} sets · {e.sets.map(s => s.reps || `${s.timeTaken || 0}s`).join(' / ')} reps · {e.sets.every(s => s.weight === 0) ? 'Choose load or use bodyweight' : e.sets.map(s => `${s.weight} kg`).join(' / ')}</p>
              {changed && original && <p className="text-xs text-zinc-500 mt-1">Previously: {original.sets.length} sets · {original.sets.map(s => s.reps).join(' / ')} reps · {original.sets.map(s => `${s.weight} kg`).join(' / ')}</p>}
            </div>
          </div>;
        })}
        {removed.map(e => <div key={e.exerciseId} className="py-3 text-sm text-red-300"><span className="mr-2">Removed</span><del>{e.name}</del></div>)}
      </div>
    </>}
    {proposal.kind === 'profile' && <dl className="mt-4 space-y-3">{Object.entries(proposal.profilePatch || {}).map(([key, value]) => <div key={key} className="text-sm"><dt className="text-zinc-400 capitalize">{key.replace(/([A-Z])/g, ' $1')}</dt><dd className="mt-1"><span className="text-zinc-500">{String(proposal.beforeProfile?.[key] ?? 'Not set')}</span> → {String(value)}</dd></div>)}</dl>}
    <div className="flex flex-wrap gap-3 mt-5">
      <button className={proposal.kind === 'delete' ? 'danger-button' : 'primary-button'} disabled={busy || expired} onClick={onApply}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{proposal.kind === 'delete' ? 'Confirm deletion' : 'Apply changes'}</button>
      <button className="secondary-button" disabled={busy} onClick={onDiscard}>Discard preview</button>
    </div>
    <p className="text-xs text-zinc-500 mt-3">{expired ? 'This preview expired. Ask for a fresh one.' : 'Only this preview will be applied. You can ask for another change first.'}</p>
  </section>;
}

export function Coach({ user, preview, profile, routines, workouts, onDataChanged }: {
  user: User; preview: boolean; profile: UserProfile | null; routines: Routine[]; workouts: WorkoutLog[]; onDataChanged: () => Promise<void>;
}) {
  const sample = useRef(preview ? sampleChat() : { messages: [welcome], pending: null });
  const [messages, setMessages] = useState<Message[]>(sample.current.messages);
  const [pending, setPending] = useState<CoachProposal | null>(sample.current.pending);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Array<{ id: string; title: string }>>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [recording, setRecording] = useState(false);
  const [now, setNow] = useState(Date.now());
  const lock = useRef(false);
  const request = useRef<AbortController | null>(null);
  const recognition = useRef<any>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    fetch(coachEndpoint('status')).then(r => r.ok ? r.json() : Promise.reject()).then(d => { if (mounted.current) setConfigured(Boolean(d.configured)); }).catch(() => { if (mounted.current) setConfigured(false); });
    return () => { mounted.current = false; request.current?.abort(); recognition.current?.abort(); };
  }, []);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(timer); }, []);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages, pending, busy]);
  useEffect(() => { if (preview) localStorage.setItem(sampleKey, JSON.stringify({ messages, pending })); }, [preview, messages, pending]);
  useEffect(() => {
    if (preview) return;
    return onSnapshot(query(collection(db, 'users', user.uid, 'conversations'), orderBy('updatedAt', 'desc'), limit(20)),
      snap => setConversations(snap.docs.map(d => ({ id: d.id, title: d.data().title }))),
      () => setError('Conversation history could not be loaded. Check your connection and retry.'));
  }, [preview, user.uid]);

  const persistMessage = async (id: string, message: Message, proposal?: CoachProposal | null) => {
    const batch = writeBatch(db);
    batch.set(doc(collection(db, 'users', user.uid, 'conversations', id, 'messages')), { role: message.role, text: message.text, timestamp: serverTimestamp() });
    batch.update(doc(db, 'users', user.uid, 'conversations', id), { lastMessage: message.text.slice(0, 6000), updatedAt: serverTimestamp(), ...(proposal ? { pendingProposal: proposal } : {}) });
    await batch.commit();
  };
  const send = async (text = input) => {
    if (!text.trim() || lock.current || saving) return;
    lock.current = true; setBusy(true); setError('');
    const controller = new AbortController(); request.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 65000);
    const userMessage: Message = { role: 'user', text: text.trim() };
    setInput('');
    try {
      let id = conversationId;
      if (!preview && !id) {
        const result = await addDoc(collection(db, 'users', user.uid, 'conversations'), { userId: user.uid, title: text.slice(0, 80), updatedAt: serverTimestamp(), pendingProposal: null });
        id = result.id; if (mounted.current) setConversationId(id);
      }
      if (!preview) await persistMessage(id!, userMessage);
      if (!mounted.current) return;
      setMessages(prev => [...prev, userMessage]);
      const context = preview ? coachContext(profile, routines, workouts) : await freshCoachContext(user.uid);
      if (!mounted.current) return;
      const result = await requestCoach(user, preview, { message: userMessage.text,
        history: messages.slice(-12).map(m => ({ role: m.role, text: m.text.slice(0, 6000) })),
        context, pending }, controller.signal);
      if (!mounted.current) return;
      const botMessage: Message = { role: 'bot', text: result.text, basis: result.basis };
      if (!preview) {
        await persistMessage(id!, botMessage, result.proposal);
      }
      if (!mounted.current) return;
      setMessages(prev => [...prev, botMessage]);
      if (result.proposal) setPending(result.proposal);
    } catch (e: any) {
      if (mounted.current) { setError(e.name === 'AbortError' ? 'The coach took too long to reply. Nothing changed. Try a shorter request.' : e.message || 'The request failed. Nothing has changed.'); setInput(text); }
    } finally { clearTimeout(timer); lock.current = false; if (mounted.current) setBusy(false); }
  };
  const apply = async () => {
    if (!pending || lock.current) return;
    lock.current = true; setSaving(true); setError('');
    try {
      const text = preview ? applyDemoProposal(pending) : await applyCoachProposal(user.uid, conversationId!, pending);
      setPending(null); setMessages(prev => [...prev, { role: 'bot', text: preview ? text + ' This change is saved only in your sample workspace.' : text, basis: preview ? 'preview' : 'saved_data' }]);
      try { await onDataChanged(); } catch { setError('The change was saved, but the view could not refresh. Reload to see the latest data.'); }
    } catch (e: any) {
      setError(e.message || 'This change could not be saved. The preview is still available.');
      if (/changed since|no longer current|no longer exists|preview expired/i.test(e.message || '')) {
        setPending(null);
        try { await onDataChanged(); } catch { /* Keep the actionable stale-data error. */ }
      }
    }
    finally { lock.current = false; setSaving(false); }
  };
  const discard = async () => {
    if (lock.current) return;
    lock.current = true; setSaving(true); setError('');
    try {
      if (!preview && conversationId) await updateDoc(doc(db, 'users', user.uid, 'conversations', conversationId), { pendingProposal: null });
      setPending(null);
    } catch { setError('Could not discard the preview. Check your connection and retry.'); }
    finally { lock.current = false; setSaving(false); }
  };
  const openConversation = async (id: string) => {
    if (lock.current || saving) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const [chat, snap] = await Promise.all([getDoc(doc(db, 'users', user.uid, 'conversations', id)), getDocs(query(collection(db, 'users', user.uid, 'conversations', id, 'messages'), orderBy('timestamp', 'desc'), limit(40)))]);
      if (!mounted.current) return;
      setMessages(snap.docs.map(d => ({ role: d.data().role, text: d.data().text } as Message)).reverse());
      setPending(chat.data()?.pendingProposal ? proposalSchema.parse(chat.data()!.pendingProposal) : null);
      setConversationId(id); setShowHistory(false);
    } catch { setError('Could not open this conversation. Please retry.'); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const dictate = () => {
    if (recording) { recognition.current?.stop(); return; }
    const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Recognition) { setError('Voice input is not supported in this browser. You can type your message below.'); return; }
    const speech = new Recognition(); recognition.current = speech; speech.lang = navigator.language || 'en-US';
    speech.onresult = (event: any) => setInput(prev => (prev + ' ' + event.results[0][0].transcript).trim());
    speech.onerror = () => { setError('Voice input could not start. Check microphone access or type your message.'); setRecording(false); };
    speech.onend = () => setRecording(false);
    try { speech.start(); setRecording(true); } catch { setError('Voice input is already in use. Please type your message.'); }
  };

  const suggestions = preview ? ['List my routines', 'Show workout history', 'Change Upper Body to 4 sets'] : ['List my routines', 'Help me plan a full-body workout', 'Review my recent workouts'];
  return <div className="coach-workspace">
    <header className="coach-header">
      <div className="flex items-center gap-3"><span className="coach-avatar"><Sparkles className="w-5 h-5" /></span><div><h1 className="font-semibold">Your training partner</h1><p className="text-xs text-zinc-400 mt-1">{preview ? 'Sample replies · local data only' : configured === true ? 'Personalized coaching · you approve every change' : configured === null ? 'Checking coach connection…' : 'AI not connected · saved-data questions still work'}</p></div></div>
      <div className="flex gap-2"><button className="icon-button" aria-label="Conversation history" disabled={busy || saving} onClick={() => setShowHistory(!showHistory)}><History className="w-5 h-5" /></button><button className="icon-button" aria-label="New conversation" disabled={busy || saving} onClick={() => { setConversationId(null); setMessages([welcome]); setPending(null); setError(''); }}><Plus className="w-5 h-5" /></button></div>
    </header>
    {showHistory && <section className="conversation-panel" aria-label="Conversation history"><div className="flex justify-between items-center"><h2 className="font-semibold">Recent conversations</h2><button className="icon-button" aria-label="Close history" onClick={() => setShowHistory(false)}><X className="w-4 h-4" /></button></div>{preview ? <p className="text-sm text-zinc-400 py-4">Sample chat stays on this device. Sign in to keep conversations across sessions.</p> : conversations.length ? conversations.map(c => <button key={c.id} className="conversation-row" onClick={() => openConversation(c.id)}>{c.title}<ChevronDown className="w-4 h-4 -rotate-90" /></button>) : <p className="text-sm text-zinc-400 py-4">Your conversations will appear here.</p>}</section>}
    <div className="coach-scroll" role="log" aria-label="Coach conversation" aria-live="polite" aria-relevant="additions">
      <div className="coach-thread">
        {messages.length <= 1 && <div className="coach-intro"><div className="eyebrow text-[#C6F36B]">A little direction. A lot of progress.</div><h2>What are we<br />working on today?</h2><p>Build a plan that fits your life.<br />Keep the final say on every change.</p><div className="prompt-grid">{suggestions.map((text, i) => <button key={text} disabled={busy || saving} onClick={() => send(text)}><span>{i === 0 ? <Dumbbell className="w-4 h-4" /> : i === 1 ? <History className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}</span>{text}<ArrowUp className="w-4 h-4 rotate-45 text-zinc-500" /></button>)}</div></div>}
        {messages.length > 1 && messages.map((m, i) => <article key={i} className={m.role === 'user' ? 'user-message' : 'coach-message'}>
          {m.role === 'bot' && <div className="message-label"><Sparkles className="w-3.5 h-3.5" />FitAI{m.basis && <span>{m.basis === 'saved_data' ? 'From your saved data' : m.basis === 'preview' ? 'Sample reply' : m.basis === 'draft' ? 'Preview only' : 'General guidance · no live research'}</span>}</div>}
          <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: props => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>{m.text}</ReactMarkdown></div>
        </article>)}
        {busy && <div className="flex items-center gap-3 text-sm text-zinc-400 py-4" role="status"><Loader2 className="w-4 h-4 animate-spin text-[#C6F36B]" />Preparing your response…</div>}
        {pending && <ChangePreview proposal={pending} busy={saving || busy} expired={pending.expiresAt < now} onApply={apply} onDiscard={discard} />}
        <div ref={bottom} />
      </div>
    </div>
    <div className="coach-composer">
      {error && <div className="inline-error" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError('')}><X className="w-4 h-4" /></button></div>}
      <form onSubmit={e => { e.preventDefault(); send(); }} className="composer-field">
        <textarea aria-label="Message your coach" placeholder="Ask a question or describe a change…" value={input} maxLength={2000} rows={2} disabled={saving} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
        <div className="composer-actions"><button type="button" aria-label={recording ? 'Stop voice input' : 'Dictate message'} className={'icon-button ' + (recording ? 'text-red-400' : '')} onClick={dictate} disabled={busy || saving}><Mic className="w-5 h-5" /></button><button type="submit" aria-label="Send message" className="send-button" disabled={busy || saving || !input.trim()}><ArrowUp className="w-5 h-5" /></button></div>
      </form>
      <p className="composer-note"><ShieldCheck className="w-3 h-3" />{preview ? 'Sample workspace. No real account or AI requests.' : 'Coach suggestions can be imperfect. Check the preview before saving.'}</p>
    </div>
  </div>;
}
