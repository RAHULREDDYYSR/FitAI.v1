import React, { useState, useEffect, useRef, createContext, useContext, useMemo } from 'react';
import {
  Dumbbell,
  History,
  Settings,
  Plus,
  Trash2,
  ChevronRight,
  ChevronDown,
  Play,
  CheckCircle2,
  Mic,
  Brain,
  User as UserIcon,
  Calendar,
  Moon,
  Flame,
  ChevronLeft,
  Sparkles,
  Search,
  Timer,
  Clock,
  Share2,
  Library,
  ArrowLeft,
  Info,
  Loader2,
  Pencil,
  Check
} from 'lucide-react';
import { motion, AnimatePresence, Reorder, useDragControls } from 'motion/react';
import {
  format,
  subMonths,
  addMonths,
  startOfMonth,
  endOfMonth,
  endOfWeek,
  isSameMonth,
  eachDayOfInterval,
  isSameDay,
  isAfter,
  startOfWeek,
  startOfYear
} from 'date-fns';
import {
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
  User
} from 'firebase/auth';
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  serverTimestamp,
  orderBy,
  limit,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  updateDoc,
  onSnapshot,
  startAfter,
  type QueryDocumentSnapshot
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType, testFirestoreConnection } from './lib/firebase';
import { cn } from './lib/utils';
import { WorkoutLog, Routine, UserProfile, WorkoutExercise, Set as WorkoutSet } from './types';
import { EXERCISES } from './constants';
import { requestCoach, coachContext } from './lib/coach-api';
import { applyGoalProposal } from './lib/coach-store';
import type { CoachProposal } from './lib/coach-contract';
import { DEMO_UID, demoUser, readDemo, updateDemoProfile, saveDemoRoutine, deleteDemoRoutine, saveDemoWorkout } from './lib/demo';
import { safeNumber, getSetVolume, getWorkoutVolume, getWorkoutIntensity, getTimedOnlyActiveTime, formatSetPerformance } from './lib/workout-metrics';
import { createActiveWorkoutSession, saveActiveWorkoutSession, loadActiveWorkoutSession, clearActiveWorkoutSession, setTimerKey, type ActiveWorkoutExercise, type ActiveWorkoutSession } from './lib/active-workout';
import { validateManualRoutine, validateManualProfile, validateWorkout } from './lib/manual-validation';
import { useDialog } from './lib/use-dialog';


const Coach = React.lazy(() => import('./components/Coach').then(module => ({ default: module.Coach })));
const Dashboard = React.lazy(() => import('./components/Progress').then(module => ({ default: module.Dashboard })));

// --- Context & State ---
const AuthContext = createContext<{
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  demo: boolean;
  signIn: () => Promise<void>;
  signOutUser: () => Promise<void>;
  sheets: {
    connected: boolean;
    connect: () => Promise<string | null>;
    disconnect: () => void;
    createSheet: () => Promise<string | null>;
    spreadsheetId?: string;
    accessToken: string | null;
  };
  updateProfile: (data: Partial<UserProfile>) => Promise<void>;
} | null>(null);

function useAuth() {
  return useContext(AuthContext)!;
}

// --- Components ---

const LoadingScreen = () => (
  <div className="fixed inset-0 bg-[#0b1211] flex flex-col items-center justify-center space-y-4">
    <motion.div
      animate={{ rotate: 360 }}
      transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
    >
      <Dumbbell className="w-12 h-12 text-[#C6F36B]" />
    </motion.div>
    <div className="text-white font-mono text-xs tracking-widest uppercase opacity-50">Initializing FitAI</div>
  </div>
);

const LoginScreen = ({ onExplore }: { onExplore: () => void }) => {
  const { signIn } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <div className="landing-page">
    <header className="landing-nav"><a href="/" className="brand"><span className="brand-mark"><Dumbbell className="w-5 h-5" /></span>fitai<span className="brand-dot">.</span></a><span className="landing-note">A stronger you, one session at a time.</span></header>
    <main className="landing-grid">
      <section className="landing-copy"><p className="eyebrow text-[#C6F36B]">Your training, with a little more direction</p><h1>Less guesswork.<br />More <span>good reps.</span></h1><p className="landing-description">A thoughtful training partner for your everyday progress. Build your routine, track what matters, and make changes with confidence.</p>
        <div className="landing-actions"><button className="primary-button" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await signIn(); } catch (e: any) { setError(e.code === 'auth/popup-closed-by-user' ? 'Sign-in was closed. You can try again or explore the sample workspace.' : 'Could not sign in. Check your connection and try again.'); } finally { setBusy(false); } }}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserIcon className="w-4 h-4" />}Continue with Google<ChevronRight className="w-4 h-4" /></button><button className="secondary-button" disabled={busy} onClick={onExplore}>Explore sample workspace</button></div>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <p className="landing-footnote">Your routines. Your pace. You review every coach-suggested change.</p>
        <div className="landing-features"><div><Dumbbell className="w-4 h-4" /><span>Plans that fit your life</span></div><div><History className="w-4 h-4" /><span>Progress you can see</span></div><div><CheckCircle2 className="w-4 h-4" /><span>Changes you control</span></div></div>
      </section>
      <section className="landing-art" aria-label="Example training workspace">
        <div className="orbit orbit-one" /><div className="orbit orbit-two" /><span className="art-caption">Built for the long game.</span>
        <div className="training-preview"><div className="flex justify-between items-center"><span className="eyebrow text-zinc-400">Sample training plan</span><span className="preview-tag">Strength</span></div><h2>Find your rhythm.</h2><p>Three focused sessions. A little stronger each week.</p><div className="preview-days">{['M','T','W','T','F','S','S'].map((day,i)=><div key={i} className={[0,2,4].includes(i)?'training-day active':'training-day'}>{day}{[0,2,4].includes(i)?<Dumbbell className="w-4 h-4" />:<span>—</span>}</div>)}</div><div className="preview-session"><span className="coach-avatar"><Dumbbell className="w-5 h-5" /></span><div><strong>Upper body</strong><p>Controlled reps. Consistent progress.</p></div><Play className="w-4 h-4 ml-auto" /></div></div>
        <div className="review-float"><CheckCircle2 className="w-5 h-5 text-[#C6F36B]" /><div><strong>You have the final say.</strong><p>Preview your changes before saving.</p></div></div>
      </section>
    </main>
    <footer className="landing-footer"><span>Move with purpose.</span><span>FitAI · Train with intention</span></footer>
  </div>;
};

// --- Sub-screens ---

const CustomExerciseModal = ({ onSave, onCancel }: { onSave: (e: typeof EXERCISES[0]) => void | Promise<void>, onCancel: () => void }) => {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const [error, setError] = useState('');
  const [selectedMuscleGroups, setSelectedMuscleGroups] = useState<string[]>([]);
  const [selectedEquipmentList, setSelectedEquipmentList] = useState<string[]>([]);
  const requestCancel = () => { if (!saveLock.current) onCancel(); };
  const dialogRef = useDialog<HTMLDivElement>(requestCancel);
  const trimmedName = name.trim();

  const allMuscleGroups = Array.from(new Set(EXERCISES.flatMap(e => e.muscle_groups))).sort();
  const allEquipmentItems = Array.from(new Set(EXERCISES.flatMap(e => e.equipment_list))).sort();

  const toggleMuscle = (m: string) => {
    setSelectedMuscleGroups(prev =>
      prev.includes(m) ? prev.filter(item => item !== m) : [...prev, m]
    );
  };

  const toggleEquipment = (e: string) => {
    setSelectedEquipmentList(prev =>
      prev.includes(e) ? prev.filter(item => item !== e) : [...prev, e]
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed inset-0 z-[70] bg-black flex flex-col sm:inset-4 sm:rounded-3xl sm:border sm:border-zinc-800"
      role="dialog" aria-modal="true" aria-labelledby="custom-exercise-title" tabIndex={-1} ref={dialogRef}
    >
      <header className="flex items-center justify-between p-4 border-b border-zinc-900">
        <button onClick={requestCancel} disabled={saving} aria-label="Cancel adding exercise" className="p-2 text-zinc-400">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h2 id="custom-exercise-title" className="text-lg font-bold">New Exercise</h2>
        <button
          onClick={async () => {
            if (saveLock.current || !trimmedName || selectedMuscleGroups.length === 0 || selectedEquipmentList.length === 0) return;
            saveLock.current = true;
            setSaving(true); setError('');
            try {
              await onSave({
                id: `custom-${Date.now()}`,
                name: trimmedName,
                muscle: selectedMuscleGroups[0],
                muscle_groups: selectedMuscleGroups,
                category: 'Custom',
                equipment: selectedEquipmentList[0],
                equipment_list: selectedEquipmentList
              });
            } catch (e: unknown) {
              setError(e instanceof Error ? e.message : 'Exercise could not be saved. Try again.');
            } finally { saveLock.current = false; setSaving(false); }
          }}
          disabled={saving || !trimmedName || selectedMuscleGroups.length === 0 || selectedEquipmentList.length === 0}
          className="bg-[#C6F36B] text-black px-4 py-1.5 rounded-full text-xs font-bold disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto no-scrollbar p-4 sm:p-6 space-y-8">
        <div className="space-y-2">
          <label className="text-[10px] uppercase font-bold text-zinc-500 tracking-widest">Exercise Name</label>
          <input
            type="text"
            value={name}
            maxLength={150}
            aria-label="Exercise name"
            disabled={saving}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Incline Machine Press"
            className="w-full bg-[#131d1b] border-none rounded-2xl p-4 text-white placeholder:text-zinc-700 focus:ring-1 focus:ring-[#C6F36B] outline-none text-lg font-bold"
            autoFocus
          />
        </div>

        {error && <p className="inline-error" role="alert">{error}</p>}

        <div className="space-y-2">
          <label className="text-[10px] uppercase font-bold text-zinc-500 tracking-widest">Muscle Groups (Select all that apply)</label>
          <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-2">
            {allMuscleGroups.map(m => (
              <button
                key={m}
                type="button"
                aria-pressed={selectedMuscleGroups.includes(m)}
                disabled={saving}
                onClick={() => toggleMuscle(m)}
                className={cn(
                  "p-3 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition-all text-left flex items-center justify-between",
                  selectedMuscleGroups.includes(m) ? "bg-[#C6F36B] text-black border-[#C6F36B]" : "bg-zinc-900 text-zinc-400 border-zinc-800"
                )}
              >
                <span>{m}</span>
                {selectedMuscleGroups.includes(m) && <CheckCircle2 className="w-3 h-3" />}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] uppercase font-bold text-zinc-500 tracking-widest">Equipment (Select all that apply)</label>
          <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-2">
            {allEquipmentItems.map(e => (
              <button
                key={e}
                type="button"
                aria-pressed={selectedEquipmentList.includes(e)}
                disabled={saving}
                onClick={() => toggleEquipment(e)}
                className={cn(
                  "p-3 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition-all text-left flex items-center justify-between",
                  selectedEquipmentList.includes(e) ? "bg-[#C6F36B] text-black border-[#C6F36B]" : "bg-zinc-900 text-zinc-400 border-zinc-800"
                )}
              >
                <span>{e}</span>
                {selectedEquipmentList.includes(e) && <CheckCircle2 className="w-3 h-3" />}
              </button>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
};

const ProfileSection = ({ profile: savedProfile, workouts, onUpdate, onSignOut, forceExitEdit, onEditModeChange, historyComplete = true }: { historyComplete?: boolean, profile: UserProfile | null, workouts: WorkoutLog[], onUpdate: (data: Partial<UserProfile>, proposal?: CoachProposal) => Promise<void>, onSignOut: () => void, forceExitEdit?: number, onEditModeChange?: (editing: boolean) => void }) => {
  const { sheets, user, demo } = useAuth();
  const [suggestedGoal, setSuggestedGoal] = useState<{ key: "shortTermGoal" | "longTermGoal"; value: string; proposal?: CoachProposal } | null>(null);
  const [goalError, setGoalError] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<UserProfile>>({});
  const [profileError, setProfileError] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [applyingGoal, setApplyingGoal] = useState(false);
  const profile = savedProfile ? { ...savedProfile, ...(isEditing ? draft : {}) } : null;
  const changeProfile = (patch: Partial<UserProfile>) => { setDraft(current => ({ ...current, ...patch })); setProfileError(''); };
  const cancelProfileEdit = () => { setDraft({}); setProfileError(''); setIsEditing(false); };

  // Exit edit mode when parent triggers back button
  useEffect(() => {
    if (forceExitEdit && forceExitEdit > 0 && !savingProfile) cancelProfileEdit();
  }, [forceExitEdit]);

  // Notify parent of edit mode changes
  useEffect(() => {
    onEditModeChange?.(isEditing);
  }, [isEditing]);
  const [isRefiningShort, setIsRefiningShort] = useState(false);
  const [isRefiningLong, setIsRefiningLong] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const calendarDialogRef = useDialog<HTMLDivElement>(() => setShowCalendar(false), showCalendar);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [isCreatingSheet, setIsCreatingSheet] = useState(false);

  const handleCreateSheet = async () => {
    setIsCreatingSheet(true);
    try {
      await sheets.createSheet();
    } finally {
      setIsCreatingSheet(false);
    }
  };

  const workoutDays = workouts.map(w => format(new Date(w.date.seconds * 1000), 'yyyy-MM-dd'));

  const getDaysInMonth = (date: Date) => {
    const start = startOfWeek(startOfMonth(date));
    const end = endOfWeek(endOfMonth(date));
    return eachDayOfInterval({ start, end });
  };

  const days = getDaysInMonth(currentMonth);

  return (
    <div className="profile-section space-y-8 pb-24">
      <header className="profile-header flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="profile-avatar w-16 h-16 shrink-0 bg-[#C6F36B] rounded-full flex items-center justify-center text-black font-bold text-2xl uppercase">
            {(profile?.name || profile?.displayName || 'You')[0]}
          </div>
          <div className="min-w-0">
            <h2 className="text-2xl font-bold break-words">{profile?.name || profile?.displayName || 'Your profile'}</h2>
            <p className="text-zinc-500 text-xs font-mono lowercase break-all">{profile?.email}</p>
          </div>
        </div>
        <div className="flex space-x-2">
          <button
            onClick={() => setShowCalendar(true)}
            aria-label="Open workout calendar"
            className="p-3 bg-zinc-900 border border-zinc-800 rounded-2xl hover:border-[#C6F36B]/50 transition-colors"
          >
            <Calendar className="w-5 h-5 text-[#C6F36B]" />
          </button>
          <button
            disabled={savingProfile || applyingGoal || !savedProfile}
            aria-label={isEditing ? 'Save profile' : 'Edit profile'}
            onClick={async () => {
              if (!isEditing) { setDraft({}); setProfileError(''); setIsEditing(true); return; }
              setSavingProfile(true); setProfileError('');
              try { const patch = validateManualProfile(draft); if (Object.keys(patch).length) await onUpdate(patch); setIsEditing(false); setDraft({}); }
              catch (e: any) { setProfileError(e.message || 'Your profile could not be saved. Your edits are still here.'); }
              finally { setSavingProfile(false); }
            }}
            className={cn(
              "p-2 rounded-xl border transition-all flex items-center space-x-1.5",
              isEditing
                ? "bg-[#C6F36B] text-black border-[#C6F36B] font-bold shadow-lg shadow-[#C6F36B]/20"
                : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700"
            )}
            title={isEditing ? "Save Profile" : "Edit Profile"}
          >
            {isEditing ? (
              <>
                <Check className="w-4 h-4 stroke-[2.5]" />
                <span className="text-xs font-mono uppercase tracking-wider pr-1">{savingProfile ? 'Saving…' : 'Save'}</span>
              </>
            ) : (
              <>
                <Pencil className="w-4 h-4" />
                <span className="text-xs font-mono uppercase tracking-wider pr-1">Edit</span>
              </>
            )}
          </button>
        </div>
      </header>

      {isEditing && <button className="secondary-button" aria-label="Cancel profile edit" onClick={cancelProfileEdit} disabled={savingProfile}>Cancel edits</button>}
      {profileError && <p className="inline-error" role="alert">{profileError}</p>}

      {goalError && <p className="inline-error" role="alert">{goalError}</p>}
      {suggestedGoal && <section className="change-preview"><p className="eyebrow text-[#C6F36B]">{demo ? 'Sample suggestion' : 'Review before saving'}</p><h3 className="text-lg font-semibold mt-2">Suggested goal</h3><p className="mt-3">{suggestedGoal.value}</p><div className="flex flex-wrap gap-3 mt-4"><button className="primary-button" disabled={applyingGoal || isEditing} onClick={async () => { setApplyingGoal(true); try { await onUpdate({ [suggestedGoal.key]: suggestedGoal.value }, suggestedGoal.proposal); setSuggestedGoal(null); setGoalError(''); } catch (e: any) { setGoalError(e.message || 'Your goal could not be saved. Try again.'); } finally { setApplyingGoal(false); } }}>{applyingGoal ? 'Saving…' : 'Apply goal'}</button><button className="secondary-button" disabled={applyingGoal} onClick={() => setSuggestedGoal(null)}>Discard</button></div></section>}
      {/* Goal & Measurements */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-[#131d1b] p-6 rounded-3xl border border-zinc-800 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 font-mono">My Vision &amp; Goals</h3>
            <div className="flex items-center space-x-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-[#C6F36B] animate-pulse" />
              <p className="text-[9px] text-zinc-500 uppercase font-mono tracking-wider">Goals you control</p>
            </div>
          </div>

          {/* Short-term Goal */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-zinc-500 uppercase font-mono tracking-widest">
                Short-term <span className="normal-case text-zinc-700 font-normal">(next few months)</span>
              </p>
              <button
                disabled={isEditing || isRefiningShort || isRefiningLong || applyingGoal}
                onClick={async () => {
                  const aim = profile?.aim || profile?.shortTermGoal || '';
                  if (!aim) { alert("Add your aim or short-term goal first."); return; }
                  setIsRefiningShort(true);
                  try {
                    if (demo) {
                      setSuggestedGoal({ key: 'shortTermGoal', value: 'Train consistently three times a week' });
                    } else {
                      const response = await requestCoach(user!, false, { message: 'Refine my shortTermGoal into a concise realistic goal, using my stated aim. Propose only this profile field.', history: [], context: coachContext(profile, [], []), pending: null });
                      const value = response.proposal?.profilePatch?.shortTermGoal;
                      if (!value) throw new Error(response.text || 'No goal suggestion was returned.');
                      setSuggestedGoal({ key: 'shortTermGoal', value, proposal: response.proposal! });
                    }
                  } catch (e: any) { setGoalError(e.message || 'Goal refinement is unavailable.'); }
                  finally { setIsRefiningShort(false); }
                }}
                className={cn("p-1.5 rounded-lg border transition-all flex items-center space-x-1",
                  isRefiningShort ? "border-[#C6F36B]/50 text-[#C6F36B] animate-pulse" : "border-zinc-800 text-zinc-500 hover:text-[#C6F36B] hover:border-[#C6F36B]/40"
                )}
                title="Refine short-term goal with AI"
                aria-label="Refine short-term goal with AI"
              >
                {isRefiningShort ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                <span className="text-[9px] font-mono uppercase tracking-wider">Refine</span>
              </button>
            </div>
            {isEditing ? (
              <input
                className="bg-zinc-900 border border-zinc-800 px-4 py-2.5 rounded-xl w-full text-white focus:border-[#C6F36B]/50 outline-none transition-colors text-sm"
                aria-label="Short-term goal" maxLength={500} disabled={savingProfile}
                value={profile?.shortTermGoal || ''}
                placeholder="e.g. Gain 5kg lean muscle by August"
                onChange={(e) => changeProfile({ shortTermGoal: e.target.value })}
              />
            ) : (
              <p className="text-lg font-bold">{profile?.shortTermGoal || <span className="text-zinc-600 font-normal italic text-sm">No short-term goal set yet</span>}</p>
            )}
          </div>

          {/* Long-term Goal */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-zinc-500 uppercase font-mono tracking-widest">
                Long-term <span className="normal-case text-zinc-700 font-normal">(1 year+)</span>
              </p>
              <button
                disabled={isEditing || isRefiningShort || isRefiningLong || applyingGoal}
                onClick={async () => {
                  const aim = profile?.aim || profile?.longTermGoal || '';
                  if (!aim) { alert("Add your aim or long-term goal first."); return; }
                  setIsRefiningLong(true);
                  try {
                    if (demo) {
                      setSuggestedGoal({ key: 'longTermGoal', value: 'Build a sustainable strength and mobility habit' });
                    } else {
                      const response = await requestCoach(user!, false, { message: 'Refine my longTermGoal into a concise realistic goal, using my stated aim. Propose only this profile field.', history: [], context: coachContext(profile, [], []), pending: null });
                      const value = response.proposal?.profilePatch?.longTermGoal;
                      if (!value) throw new Error(response.text || 'No goal suggestion was returned.');
                      setSuggestedGoal({ key: 'longTermGoal', value, proposal: response.proposal! });
                    }
                  } catch (e: any) { setGoalError(e.message || 'Goal refinement is unavailable.'); }
                  finally { setIsRefiningLong(false); }
                }}
                className={cn("p-1.5 rounded-lg border transition-all flex items-center space-x-1",
                  isRefiningLong ? "border-[#C6F36B]/50 text-[#C6F36B] animate-pulse" : "border-zinc-800 text-zinc-500 hover:text-[#C6F36B] hover:border-[#C6F36B]/40"
                )}
                title="Refine long-term goal with AI"
                aria-label="Refine long-term goal with AI"
              >
                {isRefiningLong ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                <span className="text-[9px] font-mono uppercase tracking-wider">Refine</span>
              </button>
            </div>
            {isEditing ? (
              <input
                className="bg-zinc-900 border border-zinc-800 px-4 py-2.5 rounded-xl w-full text-white focus:border-[#C6F36B]/50 outline-none transition-colors text-sm"
                aria-label="Long-term goal" maxLength={500} disabled={savingProfile}
                value={profile?.longTermGoal || ''}
                placeholder="e.g. Compete in Men's Physique by 2026"
                onChange={(e) => changeProfile({ longTermGoal: e.target.value })}
              />
            ) : (
              <p className="text-base font-semibold text-zinc-200">{profile?.longTermGoal || <span className="text-zinc-600 font-normal italic text-sm">No long-term goal set yet</span>}</p>
            )}
          </div>

          {/* Detailed Aim */}
          <div className="space-y-1.5">
            <p className="text-[10px] text-zinc-500 uppercase font-mono tracking-widest">Detailed Aim &amp; Vision</p>
            {isEditing ? (
              <textarea
                className="bg-zinc-900 border border-zinc-800 px-4 py-3 rounded-xl w-full text-white text-xs resize-none h-20 focus:border-[#C6F36B]/50 outline-none transition-colors"
                aria-label="Detailed aim" maxLength={2000} disabled={savingProfile}
                value={profile?.aim || ''}
                placeholder="Describe what you want to achieve, your motivation, and your ultimate vision..."
                onChange={(e) => changeProfile({ aim: e.target.value })}
              />
            ) : (
              <p className="text-sm text-zinc-400 italic">"{profile?.aim || 'Describe your vision here...'}"</p>
            )}
          </div>
        </div>

        <div className="bg-[#101010] p-6 rounded-3xl border border-zinc-800 space-y-6">
          <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 font-mono">Vital Stats &amp; Measurements</h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-6">
            {[
              { label: 'Age', key: 'age', unit: 'yrs', type: 'number' },
              { label: 'Sex', key: 'sex', unit: '', type: 'select', options: ['male', 'female', 'other'] },
              { label: 'Weight', key: 'weight', unit: 'kg', type: 'number' },
              { label: 'Height', key: 'height', unit: 'cm', type: 'number' },

            ].map((m) => (
              <div key={m.key} className="space-y-1">
                <p className="text-[10px] text-zinc-600 uppercase font-mono">{m.label}</p>
                {isEditing ? (
                  m.type === 'select' ? (
                    <select
                      className="bg-zinc-900 border border-zinc-800 px-2 py-1 rounded w-full text-white font-bold"
                      aria-label={m.label} disabled={savingProfile}
                      value={profile?.[m.key as keyof UserProfile] || ''}
                      onChange={(e) => changeProfile({ [m.key]: e.target.value })}
                    >
                      <option value="">Select</option>
                      {m.options?.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input
                      type="number" aria-label={m.unit ? `${m.label} (${m.unit})` : m.label} disabled={savingProfile}
                      className="bg-zinc-900 border border-zinc-800 px-2 py-1 rounded w-full text-white font-bold"
                      value={profile?.[m.key as keyof UserProfile] || ''}
                      onChange={(e) => changeProfile({ [m.key]: e.target.value === '' ? undefined : Number(e.target.value) })}
                    />
                  )
                ) : (
                  <p className="text-lg font-bold">
                    {profile?.[m.key as keyof UserProfile] || '-'}
                    {m.unit && <span className="text-[10px] text-zinc-500 ml-1 uppercase">{m.unit}</span>}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="bg-[#131d1b] p-6 rounded-3xl border border-zinc-800 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 font-mono">Google Sheets</h3>
            <div className="flex items-center space-x-2">
              {sheets.connected && (
                <button
                  onClick={sheets.disconnect}
                  className="text-[10px] text-zinc-600 hover:text-red-500 uppercase font-mono tracking-tighter"
                >
                  Disconnect
                </button>
              )}
              <div className={cn("w-2 h-2 rounded-full", sheets.connected ? "bg-[#C6F36B]" : "bg-red-500")} />
            </div>
          </div>

          {!sheets.connected ? (
            <button
              onClick={sheets.connect}
              className="w-full py-3 bg-white text-black font-bold rounded-xl text-xs uppercase tracking-widest hover:bg-zinc-200 transition-all"
            >
              Connect Google Sheets
            </button>
          ) : !sheets.spreadsheetId ? (
            <button
              disabled={isCreatingSheet}
              onClick={handleCreateSheet}
              className="w-full py-3 bg-[#C6F36B] text-black font-bold rounded-xl text-xs uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
            >
              {isCreatingSheet ? 'Creating Sheet...' : 'Create Logging Sheet'}
            </button>
          ) : (
            <div className="space-y-2">
              <div className="bg-black/30 p-4 rounded-2xl border border-zinc-800">
                <p className="text-[10px] text-zinc-500 font-mono uppercase mb-1">Spreadsheet Connected</p>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-mono text-zinc-300 truncate mr-4">ID: {sheets.spreadsheetId.slice(0, 8)}...{sheets.spreadsheetId.slice(-4)}</p>
                  <a
                    href={`https://docs.google.com/spreadsheets/d/${sheets.spreadsheetId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#C6F36B] hover:underline text-[10px] uppercase font-bold"
                  >
                    Open
                  </a>
                </div>
              </div>
              <p className="text-[9px] text-zinc-600 italic">Workouts will automatically sync to this sheet.</p>
            </div>
          )}
        </div>
      </div>

      {/* Calendar Overlay */}
      <AnimatePresence>
        {showCalendar && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-3 sm:p-6"
          >
            <div ref={calendarDialogRef} role="dialog" aria-modal="true" aria-labelledby="workout-calendar-title" tabIndex={-1} className="bg-[#131d1b] w-full max-w-md max-h-[95dvh] overflow-y-auto rounded-3xl border border-zinc-800 shadow-2xl">
              <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
                <button aria-label="Previous month" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}><ChevronLeft /></button>
                <h3 id="workout-calendar-title" className="font-bold">Workout calendar, {format(currentMonth, 'MMMM yyyy')}</h3>
                <button aria-label="Next month" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}><ChevronRight /></button>
              </div>
              <div className="p-3 sm:p-6">
                {!historyComplete && <p className="text-xs text-zinc-400 mb-4">This calendar shows loaded sessions. Load older sessions in Progress to include earlier history.</p>}
                <div className="grid grid-cols-7 gap-2 mb-4">
                  {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => (
                    <div key={i} aria-label={d} className="text-center text-[10px] text-zinc-600 font-bold">{d[0]}</div>
                  ))}
                  {days.map((day, i) => {
                    const dateStr = format(day, 'yyyy-MM-dd');
                    const isToday = isSameDay(day, new Date());
                    const workedOut = workoutDays.includes(dateStr);

                    return (
                      <div
                        key={i}
                        className={cn(
                          "aspect-square flex flex-col items-center justify-center rounded-xl relative",
                          isToday && "ring-1 ring-[#C6F36B]",
                          !isSameMonth(day, currentMonth) && 'opacity-30'
                        )}
                      >
                        <span className="text-[10px] text-zinc-500 mb-1">{format(day, 'd')}</span>
                        {workedOut ? (
                          <span className="text-lg">🔥</span>
                        ) : (
                          <span className="text-lg opacity-40">🌙</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              <button
                onClick={() => setShowCalendar(false)}
                aria-label="Close workout calendar"
                  className="w-full bg-[#C6F36B] text-black font-bold py-3 rounded-2xl mt-4"
                >
                  Close
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        onClick={onSignOut}
        className="text-zinc-600 font-bold flex items-center justify-center w-full py-4 border border-zinc-800 rounded-3xl hover:bg-red-500/10 hover:text-red-500 transition-colors"
      >
        Sign Out
      </button>
    </div>
  );
};

const RoutinesManager = ({ routines, onStart, onEdit, onCreate, onDelete }: {
  routines: Routine[],
  onStart: (r: Routine) => void,
  onEdit: (r: Routine) => void,
  onCreate: () => void,
  onDelete: (id: string) => void
}) => {
  return (
    <div className="space-y-6 pb-24">
      <header className="flex items-center justify-between">
        <div>
          <p className="eyebrow text-[#C6F36B] mb-2">Your training, organized</p>
          <h2 className="text-3xl font-semibold tracking-tight">Your workouts</h2>
          <p className="text-zinc-400 text-sm mt-2">Routines for showing up, feeling good, and getting stronger.</p>
        </div>
        <button
          onClick={onCreate}
          className="primary-button"
          aria-label="Create routine"
        >
          <Plus className="w-4 h-4" /><span className="hidden sm:inline">New routine</span>
        </button>
      </header>

      <div className="routine-grid">
        {routines.length === 0 ? (
          <div className="bg-[#131d1b] p-12 rounded-3xl border border-dashed border-zinc-800 text-center flex flex-col items-center">
            <Dumbbell className="w-12 h-12 text-zinc-700 mb-4" />
            <p className="text-zinc-500 text-sm mb-6">No routines found. Create your first split to speed up your logs.</p>
            <button
              onClick={onCreate}
              className="bg-white text-black font-bold px-8 py-3 rounded-full text-sm hover:opacity-90 transition-all"
            >
              Create New Routine
            </button>
          </div>
        ) : (
          routines.map((r, i) => (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              key={r.id || i}
              className="routine-card group"
            >
              <div className="flex items-start justify-between">
                <button onClick={() => onEdit(r)} className="text-left flex-1 min-w-0" aria-label={`Edit ${r.name}`}>
                  <span className="routine-number">{String(i + 1).padStart(2, '0')}</span>
                  <h3 className="text-xl font-semibold group-hover:text-[#C6F36B] transition-colors mt-5">{r.name}</h3>
                  <p className="text-sm text-zinc-400 mt-2 line-clamp-2">{r.description || r.exercises.map(e => e.name).join(', ')}</p>
                </button>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (r.id) onDelete(r.id);
                    }}
                    className="p-3 text-zinc-600 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all relative z-10"
                    title="Delete Routine"
                    aria-label={`Delete ${r.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onStart(r);
                    }}
                    className="bg-[#C6F36B] text-black p-3 rounded-xl hover:scale-105 active:scale-95 transition-all shadow-lg shadow-[#C6F36B]/5 relative z-10"
                    aria-label={`Start ${r.name}`}
                  >
                    <Play className="w-4 h-4 fill-current" />
                  </button>
                </div>
              </div>
              <div className="routine-footer"><span><Dumbbell className="w-3.5 h-3.5" />{r.exercises.length} exercises</span><span>{r.exercises.reduce((n, e) => n + e.sets.length, 0)} sets</span><button onClick={() => onEdit(r)} className="ml-auto text-[#C6F36B]" aria-label={`View ${r.name}`}>View plan<ChevronRight className="w-4 h-4" /></button></div>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
};

const ExerciseSelector = ({ onSelect, onCancel }: { onSelect: (e: typeof EXERCISES[0]) => void, onCancel: () => void }) => {
  const { profile, updateProfile } = useAuth();
  const [selectedEquip, setSelectedEquip] = useState("All Equipment");
  const [selectedMuscle, setSelectedMuscle] = useState("All Muscles");
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'equip' | 'muscle' | null>(null);
  const [showCustomModal, setShowCustomModal] = useState(false);
  const selectorDialogRef = useDialog<HTMLDivElement>(onCancel);
  const filterDialogRef = useDialog<HTMLDivElement>(() => setActiveFilter(null), !!activeFilter);
  const [savingCustom, setSavingCustom] = useState(false);

  const allExercises = useMemo(() => {
    return [...EXERCISES, ...(profile?.customExercises || [])];
  }, [profile?.customExercises]);

  // Extract unique values for filters and normalize them
  const allEquipment = useMemo(() => {
    const equip = new Set<string>();
    equip.add("All Equipment");
    allExercises.forEach(e => {
      if (e.equipment_list) {
        e.equipment_list.forEach(item => {
          const normalized = (item.toLowerCase().includes('bodyweight') || item.toLowerCase() === 'none') ? 'Bodyweight' : item;
          equip.add(normalized);
        });
      } else if (e.equipment) {
        const item = e.equipment;
        const normalized = (item.toLowerCase().includes('bodyweight') || item.toLowerCase() === 'none') ? 'Bodyweight' : item;
        equip.add(normalized);
      }
    });
    return Array.from(equip).sort();
  }, [allExercises]);

  const allMuscles = useMemo(() => {
    const muscles = new Set<string>();
    muscles.add("All Muscles");
    allExercises.forEach(e => {
      if (e.muscle_groups) {
        e.muscle_groups.forEach(m => muscles.add(m));
      } else if (e.muscle) {
        muscles.add(e.muscle);
      }
    });
    return Array.from(muscles).sort();
  }, [allExercises]);

  const filtered = useMemo(() => allExercises.filter(e => {
    const name = e.name || '';
    const muscle = e.muscle || '';
    const muscleGroups = e.muscle_groups || [muscle];
    const equipList = (e.equipment_list || [e.equipment || '']).map(it =>
      (it.toLowerCase().includes('bodyweight') || it.toLowerCase() === 'none') ? 'Bodyweight' : it
    );

    const matchSearch = name.toLowerCase().includes(search.toLowerCase()) ||
      muscleGroups.some(m => m.toLowerCase().includes(search.toLowerCase()));

    const matchEquip = selectedEquip === "All Equipment" || equipList.includes(selectedEquip);
    const matchMuscle = selectedMuscle === "All Muscles" || muscleGroups.includes(selectedMuscle);

    return matchSearch && matchEquip && matchMuscle;
  }).sort((a, b) => a.name.localeCompare(b.name)), [allExercises, search, selectedEquip, selectedMuscle]);

  const suggestedExercises = useMemo(() => allExercises.slice(0, 5), [allExercises]);

  const handleSaveCustom = async (exercise: typeof EXERCISES[0]) => {
    if (savingCustom) return;
    setSavingCustom(true);
    const currentCustom = profile?.customExercises || [];
    try {
      await updateProfile({ customExercises: [...currentCustom, exercise] });
      setShowCustomModal(false);
      onSelect(exercise);
    } finally { setSavingCustom(false); }
  };

  return (
    <div ref={selectorDialogRef} role="dialog" aria-modal="true" aria-labelledby="exercise-selector-title" tabIndex={-1} className="fixed inset-0 bg-black z-50 flex flex-col overflow-hidden">
      <header className="flex items-center justify-between p-4 border-b border-zinc-900">
        <button onClick={onCancel} aria-label="Close exercise selector" className="p-2 text-zinc-400">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h2 id="exercise-selector-title" className="text-lg font-bold">Exercises</h2>
        <button
          onClick={() => setShowCustomModal(true)}
          aria-label="Add custom exercise"
          className="p-2 text-[#C6F36B]"
          title="Add Custom Exercise"
        >
          <Plus className="w-6 h-6" />
        </button>
      </header>

      <div className="p-4 space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input
              type="text"
              aria-label="Search exercises"
            placeholder="Search exercise"
            className="w-full bg-[#131d1b] border-none rounded-lg py-2.5 pl-10 pr-4 text-sm focus:ring-1 focus:ring-[#C6F36B]"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setActiveFilter('equip')}
            aria-label={`Filter by equipment: ${selectedEquip}`}
            className={cn(
              "py-2.5 rounded-md text-[10px] font-bold flex items-center justify-center space-x-1 border transition-all",
              selectedEquip !== "All Equipment" ? "bg-[#C6F36B] text-black border-[#C6F36B]" : "bg-zinc-900 text-zinc-300 border-zinc-800"
            )}
          >
            <span className="truncate max-w-[80px]">{selectedEquip}</span>
            <ChevronDown className="w-3 h-3" />
          </button>
          <button
            onClick={() => setActiveFilter('muscle')}
            aria-label={`Filter by muscle: ${selectedMuscle}`}
            className={cn(
              "py-2.5 rounded-md text-[10px] font-bold flex items-center justify-center space-x-1 border transition-all",
              selectedMuscle !== "All Muscles" ? "bg-[#C6F36B] text-black border-[#C6F36B]" : "bg-zinc-900 text-zinc-300 border-zinc-800"
            )}
          >
            <span className="truncate max-w-[80px]">{selectedMuscle}</span>
            <ChevronDown className="w-3 h-3" />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {showCustomModal && (
          <CustomExerciseModal
            onSave={handleSaveCustom}
            onCancel={() => setShowCustomModal(false)}
          />
        )}
      </AnimatePresence>

      <div className="flex-1 overflow-y-auto px-4 pb-20 no-scrollbar">
        {search === '' && selectedEquip === "All Equipment" && selectedMuscle === "All Muscles" && (
          <div className="mb-6">
            <h3 className="text-zinc-500 text-xs font-bold mb-4 uppercase tracking-wider">Suggested exercises</h3>
            <div className="divide-y divide-zinc-900">
              {suggestedExercises.map((e) => (
                <button
                  key={`recent-${e.id}`}
                  onClick={() => onSelect(e)}
                  className="w-full py-4 text-left flex items-center justify-between group"
                >
                  <div className="flex items-center space-x-4">
                    <div>
                      <div className="font-bold text-[15px]">{e.name}</div>
                      <div className="text-xs text-zinc-500">{e.muscle}</div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-zinc-800 group-hover:text-zinc-600" />
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <h3 className="text-zinc-500 text-xs font-bold mb-4 uppercase tracking-wider">
            {filtered.length} {filtered.length === 1 ? 'Exercise' : 'Exercises'}
          </h3>
          <div className="divide-y divide-zinc-900">
            {filtered.map((e) => (
              <button
                key={e.id}
                onClick={() => onSelect(e)}
                className="w-full py-4 text-left flex items-center justify-between group"
              >
                <div className="flex items-center space-x-4">
                  <div>
                    <div className="font-bold text-[15px]">{e.name}</div>
                    <div className="text-[10px] text-zinc-500 uppercase font-mono tracking-tighter">
                      {e.muscle_groups && e.muscle_groups.length > 0 ? e.muscle_groups.join(', ') : e.muscle}
                      <span className="mx-1">•</span>
                      {(e.equipment_list && e.equipment_list.length > 0 ? e.equipment_list[0] : (e.equipment || 'Bodyweight'))}
                    </div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-zinc-800 group-hover:text-zinc-600" />
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 && (
          <div className="py-20 text-center flex flex-col items-center">
            <Info className="w-8 h-8 text-zinc-800 mb-2" />
            <p className="text-zinc-500 italic">No matches found for this filter.</p>
            <button
              onClick={() => { setSelectedEquip("All Equipment"); setSelectedMuscle("All Muscles"); setSearch(''); }}
              className="mt-4 text-[#C6F36B] text-sm font-bold"
            >
              Reset Filters
            </button>
          </div>
        )}
      </div>

      {/* Filter Selection Overlay */}
      <AnimatePresence>
        {activeFilter && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-sm flex items-end justify-center"
            onClick={() => setActiveFilter(null)}
          >
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="bg-[#131d1b] w-full max-h-[70vh] rounded-t-[32px] border-t border-zinc-800 overflow-hidden flex flex-col shadow-2xl"
              ref={filterDialogRef} role="dialog" aria-modal="true" aria-labelledby="exercise-filter-title" tabIndex={-1}
              onClick={e => e.stopPropagation()}
            >
              <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
                <h3 id="exercise-filter-title" className="text-lg font-bold">Select {activeFilter === 'equip' ? 'Equipment' : 'Muscle Group'}</h3>
                <button
                  onClick={() => setActiveFilter(null)}
                  aria-label="Close filter options"
                  className="p-1 text-zinc-500 hover:text-white"
                >
                  <ChevronDown className="w-6 h-6" />
                </button>
              </div>
              <div className="overflow-y-auto flex-1 p-2 space-y-1 no-scrollbar">
                {(activeFilter === 'equip' ? allEquipment : allMuscles).map((item) => (
                  <button
                    key={item}
                    onClick={() => {
                      if (activeFilter === 'equip') setSelectedEquip(item);
                      else setSelectedMuscle(item);
                      setActiveFilter(null);
                    }}
                    className={cn(
                      "w-full text-left p-4 rounded-2xl transition-all flex items-center justify-between",
                      (activeFilter === 'equip' ? selectedEquip : selectedMuscle) === item
                        ? "bg-[#C6F36B] text-black font-bold"
                        : "hover:bg-zinc-800 text-zinc-300"
                    )}
                  >
                    <span>{item}</span>
                    {(activeFilter === 'equip' ? selectedEquip : selectedMuscle) === item && <CheckCircle2 className="w-5 h-5" />}
                  </button>
                ))}
              </div>
              <div className="p-6 bg-zinc-900/50">
                <button
                  onClick={() => setActiveFilter(null)}
                  className="w-full bg-white text-black font-bold py-4 rounded-2xl"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const RoutineEditor = ({ routine, onSave, onCancel }: {
  routine?: Routine,
  onSave: (r: Partial<Routine>) => Promise<void>,
  onCancel: () => void
}) => {
  const [exercises, setExercises] = useState<WorkoutExercise[]>(() => structuredClone(routine?.exercises || []));
  const [name, setName] = useState(routine?.name || 'New Routine');
  const [description, setDescription] = useState(routine?.description || '');
  const [showExerciseSelector, setShowExerciseSelector] = useState(false);
  const saveLock = useRef(false);
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const addExercise = (exercise: typeof EXERCISES[0]) => {
    if (exercises.some(e => e.exerciseId === exercise.id)) { setShowExerciseSelector(false); setSaveError('This exercise is already in the routine. Add sets to it instead.'); return; }
    setExercises([...exercises, {
      exerciseId: exercise.id,
      name: exercise.name,
      sets: [{ reps: 0, weight: 0, completed: false }]
    }]);
    setShowExerciseSelector(false);
  };

  const addSet = (idx: number) => {
    setExercises(current => current.map((ex, i) => i === idx ? { ...ex, sets: [...ex.sets, { reps: 0, weight: 0, completed: false }] } : ex));
  };

  const updateSet = (exIdx: number, setIdx: number, field: keyof WorkoutSet, value: any) => {
    setExercises(current => current.map((ex, i) => i === exIdx ? { ...ex, sets: ex.sets.map((set, j) => j === setIdx ? { ...set, [field]: value } : set) } : ex));
  };

  if (showExerciseSelector) {
    return <ExerciseSelector onSelect={addExercise} onCancel={() => setShowExerciseSelector(false)} />;
  }

  return (
    <div className="routine-editor editor-screen flex flex-col min-h-screen bg-[#0b1211] p-6 pb-32">
      <header className="flex items-center justify-between mb-8">
        <button disabled={isSaving} onClick={onCancel} className="text-zinc-500 font-bold">Cancel</button>
        <h2 className="text-lg font-bold">Edit Routine</h2>
        <button
          disabled={isSaving || !name.trim() || !exercises.length}
          onClick={async () => { if (saveLock.current) return; setSaveError(''); let data; try { data = validateManualRoutine({ name, description, exercises }); } catch (error) { setSaveError(error.message); return; } saveLock.current = true; setIsSaving(true); try { await onSave(data as Partial<Routine>); } catch { setSaveError('The routine could not be saved. Your edits are still here; check your connection and retry.'); } finally { saveLock.current = false; setIsSaving(false); } }}
          className="text-[#C6F36B] font-bold"
        >
          {isSaving ? 'Saving…' : 'Save'}
        </button>
      </header>
      {saveError && <p className="inline-error" role="alert">{saveError}</p>}

      <div className="space-y-6">
        <div className="space-y-1">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full text-3xl font-bold bg-transparent border-none focus:ring-0 p-0 placeholder:text-zinc-800"
            placeholder="Routine Name" aria-label="Routine name" maxLength={100} disabled={isSaving}
          />
          <input
            type="text"
            value={description}
            onChange={e => setDescription(e.target.value)}
            className="w-full text-sm text-zinc-500 bg-transparent border-none focus:ring-0 p-0 placeholder:text-zinc-800"
            placeholder="Description (Optional)" aria-label="Routine description" maxLength={1000} disabled={isSaving}
          />
        </div>

        <div className="space-y-8">
          {exercises.map((ex, exIdx) => (
            <div key={exIdx} className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <h3 className="text-lg font-bold text-[#C6F36B]">{ex.name}</h3>
                </div>
                <button
                  aria-label={`Remove ${ex.name}`} disabled={isSaving} onClick={() => setExercises(exercises.filter((_, i) => i !== exIdx))}
                  className="text-zinc-700"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-2">
                <div className="grid grid-cols-4 gap-4 px-2 text-[10px] font-mono text-zinc-600 uppercase tracking-widest text-center">
                  <div>Set</div>
                  <div>kg</div>
                  <div>Reps</div>
                  <div></div>
                </div>
                {ex.sets.map((set, sIdx) => (
                  <div key={sIdx} className="grid grid-cols-4 gap-4 bg-zinc-900/50 p-2 rounded-xl items-center">
                    <div className="text-center font-mono text-xs py-2">{sIdx + 1}</div>
                    <input
                      type="number" min={0} max={1000} step="any" aria-label={`${ex.name} set ${sIdx + 1} weight (kg)`} disabled={isSaving}
                      value={set.weight || ''}
                      onChange={e => updateSet(exIdx, sIdx, 'weight', safeNumber(parseFloat(e.target.value)))}
                      className="bg-transparent border-none text-center focus:ring-0 font-bold"
                    />
                    <input
                      type="number" min={0} max={100} step={1} aria-label={`${ex.name} set ${sIdx + 1} reps`} disabled={isSaving}
                      value={set.reps || ''}
                      onChange={e => updateSet(exIdx, sIdx, 'reps', safeNumber(parseFloat(e.target.value)))}
                      className="bg-transparent border-none text-center focus:ring-0 font-bold"
                    />
                    <button
                      onClick={() => {
                        setExercises(current => current.map((exercise, i) => i === exIdx ? { ...exercise, sets: exercise.sets.filter((_, j) => j !== sIdx) } : exercise));
                      }}
                      disabled={isSaving || ex.sets.length === 1} aria-label={`Remove ${ex.name} set ${sIdx + 1}`} className="flex justify-center text-zinc-700 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <button
                  disabled={isSaving || ex.sets.length >= 20} onClick={() => addSet(exIdx)}
                  className="w-full py-2 border border-dashed border-zinc-800 rounded-xl text-[10px] text-zinc-600 font-mono uppercase tracking-widest"
                >
                  Add Base Set
                </button>
              </div>
            </div>
          ))}

          <button
            disabled={isSaving || exercises.length >= 50} onClick={() => setShowExerciseSelector(true)}
            className="w-full py-4 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center space-x-2 text-white font-bold"
          >
            <Plus className="w-5 h-5 text-[#C6F36B]" />
            <span>Add Exercises</span>
          </button>
        </div>
      </div>
    </div>
  );
};

const ExerciseItem = ({ ex, exIdx, exercises, setExercises, getPrevPerformance, updateSet, toggleSetComplete,
  startSetTimer, formatTimeTaken, parseTimeTaken, setStartTimes, addSet, now, disabled }: any) => {
  const dragControls = useDragControls();
  const moveExercise = (direction: number) => {
    const next = [...exercises];
    const target = exIdx + direction;
    if (target < 0 || target >= next.length) return;
    [next[exIdx], next[target]] = [next[target], next[exIdx]];
    setExercises(next);
  };
  return (
    <Reorder.Item value={ex} dragListener={false} dragControls={dragControls} className="space-y-4 bg-[#0b1211]">
      <div className="exercise-heading">
        <button disabled={disabled} aria-label={`Drag ${ex.name} to reorder`} onPointerDown={e => !disabled && dragControls.start(e)} className="cursor-grab touch-none p-2 text-zinc-400"><span aria-hidden="true">⠿</span></button>
        <h3 className="text-lg font-bold text-[#C6F36B] flex-1 min-w-0 break-words">{ex.name}</h3>
        <button disabled={disabled || exIdx === 0} aria-label={`Move ${ex.name} up`} onClick={() => moveExercise(-1)} className="exercise-action">↑</button>
        <button disabled={disabled || exIdx === exercises.length - 1} aria-label={`Move ${ex.name} down`} onClick={() => moveExercise(1)} className="exercise-action">↓</button>
        <button disabled={disabled} aria-label={`Remove ${ex.name}`} onClick={() => setExercises(exercises.filter((_: any, i: number) => i !== exIdx))} className="exercise-action"><Trash2 className="w-4 h-4" /></button>
      </div>
      <div className="space-y-2">
        <div className="set-grid set-grid-heading text-[10px] uppercase text-zinc-400"><span>Set</span><span>kg</span><span>Reps</span><span>Time</span><span>Done</span></div>
        {ex.sets.map((set: any, sIdx: number) => {
          const key = setTimerKey(ex, set);
          const running = Boolean(setStartTimes[key]);
          const duration = safeNumber(set.timeTaken) + (running ? Math.max(0, Math.floor((now - setStartTimes[key]) / 1000)) : 0);
          return <div key={set.sessionKey} className={cn('set-row rounded-xl border p-2', set.completed ? 'bg-[#C6F36B]/10 border-[#C6F36B]/30' : 'bg-zinc-900 border-zinc-800')}>
            <div className="set-grid">
              <span className="text-center text-sm">{sIdx + 1}</span>
              <input disabled={disabled} type="number" min={0} max={1000} step="any" value={set.weight || ''} placeholder="0" aria-label={`${ex.name} set ${sIdx + 1} weight (kg)`} onChange={e => updateSet(exIdx, sIdx, 'weight', safeNumber(parseFloat(e.target.value)))} />
              <input disabled={disabled} type="number" min={0} max={100} step={1} value={set.reps || ''} placeholder="0" aria-label={`${ex.name} set ${sIdx + 1} reps`} onChange={e => updateSet(exIdx, sIdx, 'reps', safeNumber(parseFloat(e.target.value)))} />
              <input disabled={disabled || running} type="text" value={formatTimeTaken(duration)} placeholder="0:00" aria-label={`${ex.name} set ${sIdx + 1} time (minutes:seconds)`} onChange={e => updateSet(exIdx, sIdx, 'timeTaken', parseTimeTaken(e.target.value))} className={running ? 'text-[#C6F36B]' : ''} />
              <button disabled={disabled} aria-label={`${set.completed ? 'Undo' : 'Complete'} ${ex.name} set ${sIdx + 1}`} aria-pressed={set.completed} onClick={() => toggleSetComplete(exIdx, sIdx)} className="set-complete">{set.completed ? <CheckCircle2 className="w-6 h-6 text-[#C6F36B]" /> : <span className="w-6 h-6 rounded-md border-2 border-zinc-500" />}</button>
            </div>
            <div className="set-detail"><span>Previous: {getPrevPerformance(ex.name, sIdx)}</span><div className="flex gap-2">
              {!set.completed && <button disabled={disabled || running} onClick={() => startSetTimer(exIdx, sIdx)} aria-label={`Start ${ex.name} set ${sIdx + 1} timer`}>{running ? 'Timing…' : 'Start timer'}</button>}
              <button disabled={disabled || ex.sets.length === 1} aria-label={`Remove ${ex.name} set ${sIdx + 1}`} onClick={() => setExercises(exercises.map((exercise: any, i: number) => i === exIdx ? { ...exercise, sets: exercise.sets.filter((_: any, j: number) => j !== sIdx) } : exercise))}><Trash2 className="w-4 h-4" /></button>
            </div></div>
          </div>;
        })}
        <button disabled={disabled || ex.sets.length >= 30} onClick={() => addSet(exIdx)} className="w-full py-3 rounded-xl border border-zinc-800 text-zinc-400 text-xs">Add Set</button>
      </div>
    </Reorder.Item>
  );
};

const WorkoutLogger = ({
  routine,
  workouts,
  initialSession,
  onComplete,
  onMinimize,
  onCancel
}: {
  routine?: Routine,
  workouts: WorkoutLog[],
  initialSession?: ActiveWorkoutSession | null,
  onComplete: () => void,
  onMinimize?: () => void,
  onCancel: () => void
}) => {
  const { user, profile, sheets } = useAuth();
  const currentUserId = user?.uid || auth.currentUser?.uid || 'anonymous';
  const [exercises, setExercises] = useState<ActiveWorkoutExercise[]>(
    () => initialSession?.exercises || createActiveWorkoutSession(currentUserId, routine).exercises
  );
  const [name, setName] = useState(initialSession?.name || routine?.name || 'Morning Session');
  const [startTime] = useState(initialSession?.startTime || Date.now());
  const [elapsed, setElapsed] = useState(() => Math.max(0, Math.floor((Date.now() - startTime) / 1000)));
  const saveLock = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [isComplete, setIsComplete] = useState(false);
  const [finalVolume, setFinalVolume] = useState(0);
  const [finalIntensity, setFinalIntensity] = useState(0);
  const [showExerciseSelector, setShowExerciseSelector] = useState(false);
  const [setStartTimes, setSetStartTimes] = useState<Record<string, number>>(initialSession?.setStartTimes || {});

  const getPrevPerformance = (exerciseName: string, setIdx: number) => {
    // Search backwards through history
    for (const workout of workouts) {
      const ex = workout.exercises.find(e => e.name === exerciseName);
      if (ex && ex.sets[setIdx] && ex.sets[setIdx].completed !== false) {
        return formatSetPerformance(ex.sets[setIdx]);
      }
    }
    return '-';
  };

  useEffect(() => {
    if (isComplete) return;
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [startTime, isComplete]);

  useEffect(() => {
    if (!currentUserId || currentUserId === 'anonymous' || isComplete) return;
    try { saveActiveWorkoutSession({
      userId: currentUserId,
      routineId: initialSession?.routineId || routine?.id,
      name,
      exercises,
      startTime,
      setStartTimes,
      savedAt: Date.now(),
      expiresAt: Date.now() + 2 * 60 * 60 * 1000
    }); } catch { setSaveError('Your browser could not keep a recovery copy. Keep this tab open until you finish saving.'); }
  }, [currentUserId, exercises, initialSession?.routineId, isComplete, name, routine?.id, setStartTimes, startTime]);

  const formatTime = (seconds: number) => {
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  const addExercise = (exercise: typeof EXERCISES[0]) => {
    setExercises([...exercises, {
      sessionKey: crypto.randomUUID(),
      exerciseId: exercise.id,
      name: exercise.name,
      sets: [{ sessionKey: crypto.randomUUID(), reps: 0, weight: 0, completed: false }]
    }]);
    setShowExerciseSelector(false);
  };

  const addSet = (idx: number) => {
    setExercises(current => current.map((ex, i) => i === idx ? { ...ex, sets: [...ex.sets, { sessionKey: crypto.randomUUID(), reps: 0, weight: 0, completed: false }] } : ex));
  };

  const updateSet = (exIdx: number, setIdx: number, field: string, value: any) => {
    const normalizedValue = ['weight', 'reps', 'timeTaken'].includes(field) ? safeNumber(value) : value;
    setExercises(current => current.map((ex, i) => i === exIdx ? { ...ex, sets: ex.sets.map((set, j) => j === setIdx ? { ...set, [field]: normalizedValue } : set) } : ex));
  };

  const toggleSetComplete = (exIdx: number, setIdx: number) => {
    const exercise = exercises[exIdx];
    const set = exercise.sets[setIdx];
    const key = setTimerKey(exercise, set);
    const extraTime = !set.completed && setStartTimes[key] ? Math.max(0, Math.floor((Date.now() - setStartTimes[key]) / 1000)) : 0;
    setExercises(current => current.map((ex, i) => i === exIdx ? { ...ex, sets: ex.sets.map((item, j) => j === setIdx ? { ...item, completed: !item.completed, timeTaken: safeNumber(item.timeTaken) + extraTime } : item) } : ex));
    setSetStartTimes(current => { const next = { ...current }; delete next[key]; return next; });
  };

  const startSetTimer = (exIdx: number, setIdx: number) => {
    const key = setTimerKey(exercises[exIdx], exercises[exIdx].sets[setIdx]);
    setSetStartTimes(current => current[key] ? current : { ...current, [key]: Date.now() });
  };

  const formatTimeTaken = (seconds: number | undefined): string => {
    const totalSeconds = safeNumber(seconds);
    if (!totalSeconds) return '';
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const parseTimeTaken = (value: string): number => {
    if (!value) return 0;
    if (!value.includes(':')) {
      const num = parseInt(value);
      return isNaN(num) ? 0 : num;
    }
    const parts = value.split(':');
    const mins = parseInt(parts[0]) || 0;
    const secs = parseInt(parts[1]) || 0;
    return (mins * 60) + secs;
  };

  const saveWorkout = async () => {
    if (saveLock.current) return;
    setSaveError('');
    try { validateWorkout(name, exercises); } catch (error) { setSaveError(error.message); return; }
    saveLock.current = true;
    setIsSaving(true);
    const duration = Math.floor((Date.now() - startTime) / 1000);
    const sanitizedExercises = exercises.map(({ sessionKey, ...exercise }) => ({
      ...exercise,
      sets: exercise.sets.map(({ sessionKey: _setKey, ...set }) => ({
        ...set,
        weight: safeNumber(set.weight),
        reps: safeNumber(set.reps),
        timeTaken: safeNumber(set.timeTaken),
        completed: Boolean(set.completed)
      }))
    }));
    const totalVolume = sanitizedExercises.reduce((acc, ex) =>
      acc + ex.sets.reduce((sAcc, s) => sAcc + getSetVolume(s), 0), 0
    );

    const timedOnlyActiveTime = getTimedOnlyActiveTime({ exercises: sanitizedExercises });
    const volumeIntensity = Math.round((totalVolume / (duration || 1)) * 0.1 * 100);
    const timedOnlyIntensity = Math.round((timedOnlyActiveTime / (duration || 1)) * 100);
    const intensity = volumeIntensity + timedOnlyIntensity;

    try {
      const workoutData = {
        userId: currentUserId,
        name: name.trim(),
        date: serverTimestamp(),
        duration,
        totalVolume,
        intensity,
        exercises: sanitizedExercises,
        createdAt: serverTimestamp()
      };

      if (currentUserId === DEMO_UID && sessionStorage.getItem('fitai_sample_mode') === 'true') saveDemoWorkout(workoutData);
      else await addDoc(collection(db, 'workouts'), workoutData);

      // Log to Google Sheets if connected
      if (sheets.accessToken && profile?.spreadsheetId) {
        await logToGoogleSheets({ ...workoutData, date: new Date().toISOString() } as any, profile.spreadsheetId, sheets.accessToken);
      }

      setFinalVolume(totalVolume);
      setFinalIntensity(intensity);
      clearActiveWorkoutSession(currentUserId);
      setIsComplete(true);
    } catch (e) {
      setSaveError('Your workout could not be saved. Your session is still here; check your connection and retry.');
      saveLock.current = false;
      setIsSaving(false);
    }
  };

  const logToGoogleSheets = async (workout: WorkoutLog, spreadsheetId: string, token: string) => {
    try {
      const date = typeof workout.date === 'string' ? workout.date : new Date().toISOString();
      const rows = workout.exercises.flatMap(ex =>
        ex.sets.map((set, i) => [
          date,
          workout.name,
          ex.name,
          i + 1,
          safeNumber(set.weight),
          safeNumber(set.reps),
          safeNumber(set.timeTaken),
          workout.duration,
          getWorkoutVolume(workout),
          getWorkoutIntensity(workout)
        ])
      );

      const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A1:append?valueInputOption=USER_ENTERED`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          values: rows
        })
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('Sheets API Error:', error);
        // If 401, token might be expired
        if (response.status === 401) {
          sheets.disconnect();
          alert('Your Google Sheets session has expired. Please reconnect in the Stats/Profile section.');
        }
      }
    } catch (e) {
      console.error('Failed to log to Google Sheets:', e);
    }
  };

  const discardWorkout = () => {
    if (!window.confirm('Discard this session? Your unsaved sets will be lost.')) return;
    clearActiveWorkoutSession(currentUserId);
    onCancel();
  };

  if (showExerciseSelector) {
    return <ExerciseSelector onSelect={addExercise} onCancel={() => setShowExerciseSelector(false)} />;
  }

  if (isComplete) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0b1211] p-6 text-center text-white">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="space-y-8 max-w-sm w-full"
        >
          <div className="w-24 h-24 bg-[#C6F36B] rounded-full flex items-center justify-center mx-auto shadow-[0_0_50px_rgba(204,255,0,0.3)]">
            <CheckCircle2 className="w-12 h-12 text-black" />
          </div>
          <div>
            <h2 className="text-4xl font-bold mb-2">Crushed It.</h2>
            <p className="text-zinc-500 font-mono text-xs uppercase tracking-widest">Workout Session Logged</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-zinc-900/50 p-4 rounded-3xl border border-zinc-800">
              <div className="text-2xl font-bold text-[#C6F36B]">{finalVolume} <span className="text-xs font-normal opacity-50 uppercase">kg</span></div>
              <div className="text-[10px] text-zinc-500 uppercase font-mono">Total Volume</div>
            </div>
            <div className="bg-zinc-900/50 p-4 rounded-3xl border border-zinc-800">
              <div className="text-2xl font-bold text-white">{finalIntensity} <span className="text-xs font-normal opacity-50 uppercase">pts</span></div>
              <div className="text-[10px] text-zinc-500 uppercase font-mono">Intensity</div>
            </div>
          </div>

          <div className="space-y-3">
            <button
              onClick={() => {
                const text = `I just crushed a workout on FitAI!\n\nWorkout: ${name}\nTotal Volume: ${finalVolume.toLocaleString()} kg\nIntensity: ${finalIntensity} pts\nDuration: ${formatTime(elapsed)}\n\n#FitAI #Fitness #Workout`;
                if (navigator.share) {
                  navigator.share({
                    title: 'My FitAI Workout',
                    text: text,
                    url: window.location.href
                  }).catch(console.error);
                } else {
                  navigator.clipboard.writeText(text);
                  alert("Workout summary copied to clipboard!");
                }
              }}
              className="w-full bg-[#C6F36B] text-black font-bold py-4 rounded-2xl flex items-center justify-center space-x-2"
            >
              <Share2 className="w-5 h-5" />
              <span>Share Achievement</span>
            </button>
            <button
              onClick={onComplete}
              className="w-full bg-zinc-900 text-zinc-400 font-bold py-4 rounded-2xl border border-zinc-800"
            >
              View progress
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="workout-logger editor-screen flex flex-col min-h-screen bg-[#0b1211] pb-32">
      <header className="sticky top-0 z-30 px-6 py-4 bg-[#0b1211]/95 backdrop-blur-sm border-b border-zinc-800/50">
        <input
          type="text" aria-label="Workout name" maxLength={100} disabled={isSaving}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="text-lg font-bold bg-transparent border-none focus:ring-0 p-0 w-full break-words"
        />
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center space-x-2 text-[#C6F36B] font-mono text-xs">
            <Timer className="w-3 h-3" />
            <span>{formatTime(elapsed)}</span>
          </div>
          <div className="flex gap-2 flex-wrap justify-end">
            {onMinimize && <button onClick={onMinimize} disabled={isSaving} className="text-zinc-400 font-bold px-2 text-sm" aria-label="Minimize workout">Minimize</button>}
            <button onClick={discardWorkout} disabled={isSaving} className="text-zinc-600 font-bold px-4">Discard</button>
            <button
              onClick={saveWorkout}
              disabled={isSaving}
              className="bg-[#C6F36B] text-black font-bold px-6 py-2 rounded-full text-sm shadow-lg shadow-[#C6F36B]/10 disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Finish'}
            </button>
          </div>
        </div>
      </header>

      {saveError && <p className="inline-error mx-6 mt-4" role="alert">{saveError}</p>}

      <Reorder.Group axis="y" values={exercises} onReorder={setExercises} className="flex-1 space-y-8 px-6 pt-6">
        {exercises.map((ex, exIdx) => (
          <ExerciseItem
            key={ex.sessionKey}
            ex={ex}
            exIdx={exIdx}
            exercises={exercises}
            setExercises={setExercises}
            getPrevPerformance={getPrevPerformance}
            updateSet={updateSet}
            toggleSetComplete={toggleSetComplete}
            startSetTimer={startSetTimer}
            formatTimeTaken={formatTimeTaken}
            parseTimeTaken={parseTimeTaken}
            setStartTimes={setStartTimes}
            now={startTime + elapsed * 1000} disabled={isSaving}
            addSet={addSet}
          />
        ))}

        <button
          disabled={isSaving || exercises.length >= 50} onClick={() => setShowExerciseSelector(true)}
          className="w-full py-4 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center space-x-2 text-[#C6F36B] font-bold hover:bg-zinc-800 transition-colors"
        >
          <Plus className="w-5 h-5" />
          <span>Add Exercise</span>
        </button>
      </Reorder.Group>
    </div>
  );
};


// --- Main App ---

export default function App() {
  const [demoMode, setDemoMode] = useState(sessionStorage.getItem('fitai_sample_mode') === 'true');
  const [initialSampleSession] = useState(() => demoMode ? loadActiveWorkoutSession(DEMO_UID) : null);
  const [appError, setAppError] = useState('');
  const [user, setUser] = useState<User | null>(() => demoMode ? demoUser as User : null);
  const [profile, setProfile] = useState<UserProfile | null>(() => demoMode ? readDemo().profile : null);
  const [googleAccessToken, setGoogleAccessToken] = useState<string | null>(sessionStorage.getItem('google_sheets_token'));

  useEffect(() => {
    const verifyToken = async () => {
      if (!googleAccessToken) return;
      try {
        const res = await fetch('https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + googleAccessToken);
        if (!res.ok) {
          console.warn('Verifying Google token failed, clearing session');
          setGoogleAccessToken(null);
          sessionStorage.removeItem('google_sheets_token');
        }
      } catch (e) {
        console.error('Token verification error:', e);
      }
    };
    verifyToken();
  }, [googleAccessToken]);
  const [loading, setLoading] = useState(!demoMode);
  const [activeTab, setActiveTab] = useState<'dash' | 'ai' | 'routines' | 'profile'>('routines');
  const [isLogging, setIsLogging] = useState(Boolean(initialSampleSession));
  const [editingRoutine, setEditingRoutine] = useState<Routine | null | 'new'>(null);
  const [activeRoutine, setActiveRoutine] = useState<Routine | null>(null);
  const [activeWorkoutSession, setActiveWorkoutSession] = useState<ActiveWorkoutSession | null>(initialSampleSession);
  const [workouts, setWorkouts] = useState<WorkoutLog[]>(() => demoMode ? readDemo().workouts : []);
  const [routines, setRoutines] = useState<Routine[]>(() => demoMode ? readDemo().routines : []);
  const [workoutCursor, setWorkoutCursor] = useState<QueryDocumentSnapshot | null>(null);
  const [historyComplete, setHistoryComplete] = useState(demoMode);
  const [loadingMore, setLoadingMore] = useState(false);

  // Back button + floating workout bubble state
  const [isWorkoutMinimized, setIsWorkoutMinimized] = useState(Boolean(initialSampleSession));
  const [workoutStartTime, setWorkoutStartTime] = useState<number | null>(initialSampleSession?.startTime ?? null);
  const [workoutElapsed, setWorkoutElapsed] = useState(initialSampleSession ? Math.floor((Date.now() - initialSampleSession.startTime) / 1000) : 0);
  const [profileForceExit, setProfileForceExit] = useState(0);
  const [profileIsEditing, setProfileIsEditing] = useState(false);
  const authUidRef = useRef(user?.uid ?? null);

  // Refs for popstate handler (so it always has latest values without re-registering)
  const activeTabRef = useRef(activeTab);
  const isLoggingRef = useRef(isLogging);
  const editingRoutineRef = useRef(editingRoutine);
  const isWorkoutMinimizedRef = useRef(isWorkoutMinimized);
  const profileIsEditingRef = useRef(profileIsEditing);

  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);
  useEffect(() => { isLoggingRef.current = isLogging; }, [isLogging]);
  useEffect(() => { editingRoutineRef.current = editingRoutine; }, [editingRoutine]);
  useEffect(() => { isWorkoutMinimizedRef.current = isWorkoutMinimized; }, [isWorkoutMinimized]);
  useEffect(() => { profileIsEditingRef.current = profileIsEditing; }, [profileIsEditing]);

  const restoreWorkoutSession = (uid: string) => {
    const restored = loadActiveWorkoutSession(uid);
    setActiveWorkoutSession(restored);
    setActiveRoutine(null);
    setIsLogging(Boolean(restored));
    setIsWorkoutMinimized(Boolean(restored));
    setWorkoutStartTime(restored?.startTime ?? null);
    setWorkoutElapsed(restored ? Math.floor((Date.now() - restored.startTime) / 1000) : 0);
  };

  // Browser back button handler
  useEffect(() => {
    window.history.pushState({ app: true }, '');

    const handlePopState = () => {
      // Priority 1: If editing a routine, close editor
      if (editingRoutineRef.current) {
        setEditingRoutine(null);
        window.history.pushState({ app: true }, '');
        return;
      }

      // Priority 2: If logging workout (not minimized), minimize it
      if (isLoggingRef.current && !isWorkoutMinimizedRef.current) {
        setIsWorkoutMinimized(true);
        setActiveTab('routines');
        window.history.pushState({ app: true }, '');
        return;
      }

      // Priority 3: If on profile and editing, exit edit mode
      if (activeTabRef.current === 'profile' && profileIsEditingRef.current) {
        setProfileForceExit(prev => prev + 1);
        window.history.pushState({ app: true }, '');
        return;
      }

      // Priority 4: If on any non-home tab, go to home
      if (activeTabRef.current !== 'routines') {
        setActiveTab('routines');
        window.history.pushState({ app: true }, '');
        return;
      }

      // Priority 5: Already on home, push state to prevent app exit
      window.history.pushState({ app: true }, '');
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Timer for minimized workout bubble
  useEffect(() => {
    if (!isWorkoutMinimized || !workoutStartTime) return;
    const timer = setInterval(() => {
      setWorkoutElapsed(Math.floor((Date.now() - workoutStartTime) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [isWorkoutMinimized, workoutStartTime]);

  const formatBubbleTime = (seconds: number) => {
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    if (demoMode) {
      setHistoryComplete(true);
      setWorkoutCursor(null);
      restoreWorkoutSession(DEMO_UID);
      return;
    }
    testFirestoreConnection();
    let latestAuthEvent = 0;
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      const eventId = ++latestAuthEvent;
      authUidRef.current = u?.uid ?? null;
      setUser(u);
      try {
      if (u) {
        const profileRef = doc(db, 'users', u.uid);
        const snap = await getDoc(profileRef);
        if (eventId !== latestAuthEvent) return;
        if (snap.exists()) {
          setProfile(snap.data() as UserProfile);
        } else {
          const newProfile = {
            uid: u.uid,
            email: u.email || '',
            displayName: u.displayName || '',
            photoURL: u.photoURL || '',
            createdAt: serverTimestamp()
          };
          await setDoc(profileRef, newProfile);
          if (eventId !== latestAuthEvent) return;
          setProfile(newProfile as UserProfile);
        }
        await Promise.all([
          fetchWorkouts(u.uid, () => eventId === latestAuthEvent),
          fetchRoutines(u.uid, () => eventId === latestAuthEvent)
        ]);
        if (eventId !== latestAuthEvent) return;
        restoreWorkoutSession(u.uid);
      } else {
        setProfile(null); setWorkouts([]); setRoutines([]);
        setActiveWorkoutSession(null); setActiveRoutine(null); setIsLogging(false); setIsWorkoutMinimized(false);
        setWorkoutStartTime(null); setWorkoutElapsed(0);
      }
      } catch { if (eventId === latestAuthEvent) setAppError('Your saved data could not load. Check your connection and reload.'); }
      finally { if (eventId === latestAuthEvent) setLoading(false); }
    });
    return () => { latestAuthEvent++; unsubscribe(); };
  }, [demoMode]);

  const fetchWorkouts = async (uid: string, shouldApply: () => boolean = () => true) => {
    if (demoMode) { setWorkouts(readDemo().workouts); setWorkoutCursor(null); setHistoryComplete(true); return; }
    const q = query(
      collection(db, 'workouts'),
      where('userId', '==', uid),
      orderBy('date', 'desc'),
      limit(100)
    );
    const snap = await getDocs(q);
    if (!shouldApply()) return;
    setWorkouts(snap.docs.map(d => ({ id: d.id, ...d.data() } as WorkoutLog)));
    setWorkoutCursor(snap.docs.length === 100 ? snap.docs[snap.docs.length - 1] : null);
    setHistoryComplete(snap.docs.length < 100);
  };

  const loadMoreWorkouts = async () => {
    if (!user || demoMode || !workoutCursor || historyComplete || loadingMore) return;
    setLoadingMore(true);
    try {
      const q = query(
        collection(db, 'workouts'),
        where('userId', '==', user.uid),
        orderBy('date', 'desc'),
        startAfter(workoutCursor),
        limit(100)
      );
      const snap = await getDocs(q);
      if (authUidRef.current !== user.uid) return;
      const nextPage = snap.docs.map(d => ({ id: d.id, ...d.data() } as WorkoutLog));
      setWorkouts(previous => {
        const known = new Set(previous.map(w => w.id));
        return [...previous, ...nextPage.filter(w => !known.has(w.id))];
      });
      setWorkoutCursor(snap.docs.length === 100 ? snap.docs[snap.docs.length - 1] : null);
      setHistoryComplete(snap.docs.length < 100);
    } finally { setLoadingMore(false); }
  };

  const fetchRoutines = async (uid: string, shouldApply: () => boolean = () => true) => {
    if (demoMode) { setRoutines(readDemo().routines); return; }
    const q = query(
      collection(db, 'routines'),
      where('userId', '==', uid),
      orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    if (!shouldApply()) return;
    setRoutines(snap.docs.map(d => ({ id: d.id, ...d.data() } as Routine)));
  };

  const saveRoutine = async (data: Partial<Routine>) => {
    if (!user) return;
    try {
      if (demoMode) { saveDemoRoutine(data, editingRoutine && editingRoutine !== 'new' ? editingRoutine.id : undefined); setRoutines(readDemo().routines); setEditingRoutine(null); return; }
      if (editingRoutine && editingRoutine !== 'new' && editingRoutine.id) {
        // Update existing
        await updateDoc(doc(db, 'routines', editingRoutine.id), {
          ...data,
          userId: user.uid,
          updatedAt: serverTimestamp(),
        });
      } else {
        // Create new
        await addDoc(collection(db, 'routines'), {
          ...data,
          userId: user.uid,
          createdAt: serverTimestamp()
        });
      }
      setEditingRoutine(null);
      try { await fetchRoutines(user.uid); } catch { setAppError('Your routine was saved, but the library could not refresh. Reload to see it.'); }
    } catch (e) {
      throw e;
    }
  };

  const deleteRoutine = async (id: string) => {
    if (!user || !window.confirm('Delete this routine? Your completed workout history will be kept.')) return;
    if (demoMode) { deleteDemoRoutine(id); setRoutines(readDemo().routines); return; }
    try {
      await deleteDoc(doc(db, 'routines', id));
      try { await fetchRoutines(user.uid); } catch { setAppError('The routine was deleted, but the library could not refresh. Reload to see the latest data.'); }
    } catch (e) {
      setAppError('The routine could not be deleted. Check your connection and retry.');
    }
  };

  const signIn = async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  const connectGoogleSheets = async () => {
    if (demoMode) { setAppError('Google Sheets is available after you sign in with a real account. The sample workspace stays local.'); return null; }
    const provider = new GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/spreadsheets');
    // Ensure we always prompt for account if needed
    provider.setCustomParameters({
      prompt: 'select_account'
    });
    try {
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        console.log('Google Sheets token acquired');
        setGoogleAccessToken(credential.accessToken);
        sessionStorage.setItem('google_sheets_token', credential.accessToken);
        return credential.accessToken;
      }
    } catch (e: any) {
      if (e.code === 'auth/popup-closed-by-user') {
        alert('Google Sign-in popup was closed before completion. Please try again.');
      } else {
        console.error('Google Sheets connection failed:', e);
        alert('Failed to connect to Google Sheets: ' + e.message);
      }
    }
    return null;
  };

  const createGoogleSheet = async (token: string) => {
    if (demoMode) return null;
    try {
      const response = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          properties: { title: 'FitAI Workout Log' },
          sheets: [{
            properties: {
              title: 'Sheet1',
              gridProperties: { rowCount: 1000, columnCount: 10 }
            }
          }]
        })
      });

      if (response.status === 401) {
        console.error('Invalid or expired Google Sheets token');
        setGoogleAccessToken(null);
        sessionStorage.removeItem('google_sheets_token');
        alert('Your Google Sheets session has expired. Please click "Connect Google Sheets" again.');
        return null;
      }

      const data = await response.json();
      if (data.spreadsheetId) {
        // Initial headers
        const headerResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${data.spreadsheetId}/values/Sheet1!A1:J1?valueInputOption=USER_ENTERED`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            values: [['Date', 'Workout', 'Exercise', 'Set', 'Weight (kg)', 'Reps', 'Set Time (s)', 'Total Duration (s)', 'Volume', 'Intensity Score']]
          })
        });

        if (!headerResponse.ok) {
          console.warn('Failed to set headers, but sheet was created:', await headerResponse.text());
        }

        await updateProfile({ spreadsheetId: data.spreadsheetId });
        alert('FitAI Workout Log sheet created successfully in your Google Drive!');
        return data.spreadsheetId;
      } else {
        console.error('Sheet creation response:', data);
        alert('Failed to create sheet: ' + (data.error?.message || 'Unknown error'));
      }
    } catch (e) {
      console.error('Failed to create sheet:', e);
      alert('Failed to create sheet. check console for details.');
    }
    return null;
  };

  const signOutUser = async () => {
    try {
      if (demoMode) { sessionStorage.removeItem('fitai_sample_mode'); setDemoMode(false); setUser(null); setWorkouts([]); setRoutines([]); }
      else await signOut(auth);
      closeActiveWorkout(false);
      setProfile(null);
      setActiveWorkoutSession(null);
    } catch {
      setAppError('You could not be signed out. Check your connection and try again.');
    }
  };

  const updateProfile = async (data: Partial<UserProfile>, proposal?: CoachProposal) => {
    if (!user) throw new Error('Sign in before saving profile changes.');
    if (demoMode) { updateDemoProfile(data); setProfile(readDemo().profile); return; }
    try {
      const profileRef = doc(db, 'users', user.uid);
      if (proposal) await applyGoalProposal(user.uid, proposal, data);
      else await setDoc(profileRef, data, { merge: true });
      setProfile(prev => prev ? { ...prev, ...data } : null);
    } catch (e) {
      console.error(e);
      throw e;
    }
  };

  const startWorkout = (routine: Routine) => {
    if (!user) return;
    if (isLogging) {
      setAppError('A workout is already in progress. Resume or finish it before starting another.');
      return;
    }
    const session = createActiveWorkoutSession(user.uid, routine);
    saveActiveWorkoutSession(session);
    setActiveWorkoutSession(session);
    setActiveRoutine(routine);
    setIsLogging(true);
    setIsWorkoutMinimized(false);
    setWorkoutStartTime(session.startTime);
    setWorkoutElapsed(0);
  };

  const closeActiveWorkout = (clearSession: boolean) => {
    if (clearSession && user) {
      clearActiveWorkoutSession(user.uid);
    }
    setIsLogging(false);
    setIsWorkoutMinimized(false);
    setActiveRoutine(null);
    setActiveWorkoutSession(null);
    setWorkoutStartTime(null);
    setWorkoutElapsed(0);
  };

  if (loading) return <LoadingScreen />;

  const sheetsContextValue = {
    connected: !!googleAccessToken,
    connect: connectGoogleSheets,
    disconnect: () => {
      setGoogleAccessToken(null);
      sessionStorage.removeItem('google_sheets_token');
    },
    createSheet: () => googleAccessToken && createGoogleSheet(googleAccessToken),
    spreadsheetId: profile?.spreadsheetId,
    accessToken: googleAccessToken
  };

  const contextValue = {
    user,
    profile,
    loading,
    demo: demoMode,
    signIn,
    signOutUser,
    sheets: sheetsContextValue,
    updateProfile
  };

  if (!user) return (
    <AuthContext.Provider value={contextValue}>
      <LoginScreen onExplore={() => { sessionStorage.setItem('fitai_sample_mode', 'true'); const data = readDemo(); setDemoMode(true); setUser(demoUser as User); setProfile(data.profile); setWorkouts(data.workouts); setRoutines(data.routines); setHistoryComplete(true); setWorkoutCursor(null); restoreWorkoutSession(DEMO_UID); setLoading(false); setAppError(''); }} />
    </AuthContext.Provider>
  );

  const renderContent = () => {
    if (editingRoutine) {
      return (
        <RoutineEditor
          routine={editingRoutine === 'new' ? undefined : editingRoutine}
          onSave={saveRoutine}
          onCancel={() => setEditingRoutine(null)}
        />
      );
    }

    return (
      <>
        {/* WorkoutLogger: stays mounted when minimized to preserve timer + state */}
        {isLogging && (
          <div className={isWorkoutMinimized ? 'hidden' : ''}>
            <WorkoutLogger
              routine={activeRoutine || undefined}
              workouts={workouts}
              initialSession={activeWorkoutSession}
              onMinimize={() => { setIsWorkoutMinimized(true); setActiveTab('routines'); }}
              onComplete={async () => {
                closeActiveWorkout(true);
                setActiveTab('dash');
                try { await fetchWorkouts(user.uid); }
                catch { setAppError('Workout saved, but progress could not refresh. Reload to see the latest history.'); }
              }}
              onCancel={() => {
                closeActiveWorkout(true);
              }}
            />
          </div>
        )}

        {/* Normal tab content: shown when not logging OR when minimized */}
        {(!isLogging || isWorkoutMinimized) && (
          <div className="app-shell text-white">
            <header className={cn("workspace-topbar", isWorkoutMinimized && isLogging && "has-active-workout")}><a href="/" className="brand"><span className="brand-mark"><Dumbbell className="w-5 h-5" /></span>fitai<span className="brand-dot">.</span></a><div className="flex items-center gap-3">{isWorkoutMinimized && isLogging && <button type="button" onClick={() => setIsWorkoutMinimized(false)} aria-label="Resume workout" className="resume-workout inline-flex min-h-11 items-center gap-2 rounded-full border border-[#C6F36B]/50 px-3 text-sm font-semibold text-[#C6F36B] hover:bg-[#C6F36B]/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C6F36B]"><Dumbbell className="h-4 w-4" /><span className="hidden sm:inline">Resume workout</span><span className="sm:hidden">Resume</span><span aria-label={`Elapsed ${formatBubbleTime(workoutElapsed)}`} className="font-mono text-xs">{formatBubbleTime(workoutElapsed)}</span></button>}<span className="workspace-badge">{demoMode ? 'Sample workspace · local only' : 'Your training workspace'}</span><span className="workspace-user">{(profile?.displayName || profile?.name || 'You').slice(0, 1)}</span></div></header>
            {appError && <div className="workspace-alert inline-error" role="alert">{appError}<button onClick={() => setAppError('')} aria-label="Dismiss notification">×</button></div>}
            <main className={cn("workspace-main", activeTab === 'ai' ? 'coach-main' : 'training-main')}>
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.2 }}
                  className={activeTab === 'ai' ? 'h-full' : 'training-content'}
                >
                  {activeTab === 'dash' && <React.Suspense fallback={<p className="text-zinc-400 py-8" role="status">Loading your progress…</p>}><Dashboard workouts={workouts} profile={profile} onUpdateProfile={updateProfile} historyComplete={historyComplete} loadingMore={loadingMore} onLoadMore={loadMoreWorkouts} /></React.Suspense>}
                  {activeTab === 'ai' && (
                    <React.Suspense fallback={<p className="text-zinc-400 p-8" role="status">Opening your coach…</p>}><Coach user={user} preview={demoMode} workouts={workouts} profile={profile} routines={routines}
                      onDataChanged={async () => { await Promise.all([fetchWorkouts(user.uid), fetchRoutines(user.uid)]); if (demoMode) setProfile(readDemo().profile); else { const snap = await getDoc(doc(db, 'users', user.uid)); if (snap.exists()) setProfile(snap.data() as UserProfile); } }} /></React.Suspense>
                  )}
                  {activeTab === 'routines' && (
                    <RoutinesManager
                      routines={routines}
                      onStart={startWorkout}
                      onEdit={(r) => setEditingRoutine(r)}
                      onCreate={() => setEditingRoutine('new')}
                      onDelete={deleteRoutine}
                    />
                  )}
                  {activeTab === 'profile' && (
                    <ProfileSection
                      profile={profile}
                      workouts={workouts}
                      onUpdate={updateProfile}
                      onSignOut={signOutUser}
                      historyComplete={historyComplete}
                      forceExitEdit={profileForceExit}
                      onEditModeChange={setProfileIsEditing}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </main>

            <nav className="workspace-nav" aria-label="Main navigation">
              <div className="sidebar-heading"><span className="eyebrow">Your space</span><p>Make every session count.</p></div>
              {[
                { id: 'routines', icon: Library, label: 'Workouts' },
                { id: 'ai', icon: Brain, label: 'Coach' },
                { id: 'dash', icon: History, label: 'Progress' },
                { id: 'profile', icon: UserIcon, label: 'Profile' },
              ].map((tab) => (
                <div key={tab.id} className="relative flex-1 sm:flex-none">
                  <button
                    aria-current={activeTab === tab.id ? 'page' : undefined}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={cn(
                      "workspace-nav-item w-full",
                      activeTab === tab.id ? "text-[#C6F36B]" : "text-zinc-500"
                    )}
                  >
                    <tab.icon className="w-5 h-5" />
                    <span>{tab.label}</span>
                  </button>
                </div>
              ))}
              <div className="sidebar-note"><Sparkles className="w-5 h-5 text-[#C6F36B]" /><p>A plan is a starting point.<br />You set the pace.</p><span>{demoMode ? 'Sample data, real interactions.' : 'Small steps. Lasting progress.'}</span></div>
            </nav>
          </div>
        )}
      </>
    );
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {renderContent()}
    </AuthContext.Provider>
  );
}
