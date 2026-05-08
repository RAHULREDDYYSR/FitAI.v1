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
  Loader2
} from 'lucide-react';
import { motion, AnimatePresence, Reorder, useDragControls } from 'motion/react';
import {
  format,
  subMonths,
  addMonths,
  startOfMonth,
  endOfMonth,
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
  onSnapshot
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType, testFirestoreConnection } from './lib/firebase';
import { cn } from './lib/utils';
import { WorkoutLog, Routine, UserProfile, WorkoutExercise, Set as WorkoutSet, ChatMessage, ChatSummary, Conversation } from './types';
import { EXERCISES } from './constants';
import OpenAI from 'openai';
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { StateGraph, Annotation } from "@langchain/langgraph";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { LangChainTracer } from "@langchain/core/tracers/tracer_langchain";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis
} from 'recharts';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// --- Context & State ---
const AuthContext = createContext<{
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
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
  <div className="fixed inset-0 bg-[#0A0A0A] flex flex-col items-center justify-center space-y-4">
    <motion.div
      animate={{ rotate: 360 }}
      transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
    >
      <Dumbbell className="w-12 h-12 text-[#CCFF00]" />
    </motion.div>
    <div className="text-white font-mono text-xs tracking-widest uppercase opacity-50">Initializing FitAI</div>
  </div>
);

const LoginScreen = () => {
  const { signIn } = useAuth();
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#0A0A0A] p-6 text-white text-center">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-12"
      >
        <Dumbbell className="w-20 h-20 text-[#CCFF00] mx-auto mb-6" />
        <h1 className="text-6xl font-bold tracking-tighter mb-2">FitAI</h1>
        <p className="text-zinc-400 max-w-[280px] mx-auto text-lg leading-tight">
          Personalized muscle intelligence for the modern athlete.
        </p>
      </motion.div>

      <button
        onClick={signIn}
        className="w-full max-w-[280px] bg-white text-black font-bold py-4 rounded-full flex items-center justify-center space-x-3 hover:bg-zinc-200 transition-colors"
      >
        <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
        <span>Continue with Google</span>
      </button>
    </div>
  );
};

// --- Sub-screens ---

const CustomExerciseModal = ({ onSave, onCancel }: { onSave: (e: typeof EXERCISES[0]) => void, onCancel: () => void }) => {
  const [name, setName] = useState('');
  const [selectedMuscleGroups, setSelectedMuscleGroups] = useState<string[]>([]);
  const [selectedEquipmentList, setSelectedEquipmentList] = useState<string[]>([]);

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
    >
      <header className="flex items-center justify-between p-4 border-b border-zinc-900">
        <button onClick={onCancel} className="p-2 text-zinc-400">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h2 className="text-lg font-bold">New Exercise</h2>
        <button
          onClick={() => {
            if (name && selectedMuscleGroups.length > 0 && selectedEquipmentList.length > 0) {
              onSave({
                id: `custom-${Date.now()}`,
                name,
                muscle: selectedMuscleGroups[0],
                muscle_groups: selectedMuscleGroups,
                category: 'Custom',
                equipment: selectedEquipmentList[0],
                equipment_list: selectedEquipmentList
              });
            }
          }}
          disabled={!name || selectedMuscleGroups.length === 0 || selectedEquipmentList.length === 0}
          className="bg-[#CCFF00] text-black px-4 py-1.5 rounded-full text-xs font-bold disabled:opacity-50"
        >
          Save
        </button>
      </header>

      <div className="flex-1 overflow-y-auto no-scrollbar p-6 space-y-8">
        <div className="space-y-2">
          <label className="text-[10px] uppercase font-bold text-zinc-500 tracking-widest">Exercise Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Incline Machine Press"
            className="w-full bg-[#1A1A1A] border-none rounded-2xl p-4 text-white placeholder:text-zinc-700 focus:ring-1 focus:ring-[#CCFF00] outline-none text-lg font-bold"
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <label className="text-[10px] uppercase font-bold text-zinc-500 tracking-widest">Muscle Groups (Select all that apply)</label>
          <div className="grid grid-cols-2 gap-2">
            {allMuscleGroups.map(m => (
              <button
                key={m}
                onClick={() => toggleMuscle(m)}
                className={cn(
                  "p-3 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition-all text-left flex items-center justify-between",
                  selectedMuscleGroups.includes(m) ? "bg-[#CCFF00] text-black border-[#CCFF00]" : "bg-zinc-900 text-zinc-400 border-zinc-800"
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
          <div className="grid grid-cols-2 gap-2">
            {allEquipmentItems.map(e => (
              <button
                key={e}
                onClick={() => toggleEquipment(e)}
                className={cn(
                  "p-3 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition-all text-left flex items-center justify-between",
                  selectedEquipmentList.includes(e) ? "bg-[#CCFF00] text-black border-[#CCFF00]" : "bg-zinc-900 text-zinc-400 border-zinc-800"
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

const ProfileSection = ({ profile, workouts, onUpdate, onSignOut, forceExitEdit, onEditModeChange }: { profile: UserProfile | null, workouts: WorkoutLog[], onUpdate: (data: Partial<UserProfile>) => void, onSignOut: () => void, forceExitEdit?: number, onEditModeChange?: (editing: boolean) => void }) => {
  const { sheets } = useAuth();
  const [isEditing, setIsEditing] = useState(false);

  // Exit edit mode when parent triggers back button
  useEffect(() => {
    if (forceExitEdit && forceExitEdit > 0) setIsEditing(false);
  }, [forceExitEdit]);

  // Notify parent of edit mode changes
  useEffect(() => {
    onEditModeChange?.(isEditing);
  }, [isEditing]);
  const [isRefining, setIsRefining] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
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
    const start = startOfMonth(date);
    const end = endOfMonth(date);
    return eachDayOfInterval({ start, end });
  };

  const days = getDaysInMonth(currentMonth);

  return (
    <div className="space-y-8 pb-24">
      <header className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="w-16 h-16 bg-[#CCFF00] rounded-full flex items-center justify-center text-black font-bold text-2xl uppercase">
            {profile?.name?.[0] || 'U'}
          </div>
          <div>
            <h2 className="text-2xl font-bold">{profile?.name}</h2>
            <p className="text-zinc-500 text-xs font-mono lowercase">{profile?.email}</p>
          </div>
        </div>
        <div className="flex space-x-2">
          <button
            onClick={() => setShowCalendar(true)}
            className="p-3 bg-zinc-900 border border-zinc-800 rounded-2xl hover:border-[#CCFF00]/50 transition-colors"
          >
            <Calendar className="w-5 h-5 text-[#CCFF00]" />
          </button>
          <button
            onClick={() => setIsEditing(!isEditing)}
            className="p-3 bg-zinc-900 border border-zinc-800 rounded-2xl"
          >
            <UserIcon className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Goal & Measurements */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-[#1A1A1A] p-6 rounded-3xl border border-zinc-800 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 font-mono">My Vision & Goal</h3>
            <button
              disabled={isRefining}
              onClick={async () => {
                if (!profile?.aim) {
                  alert("Please describe your goal or aim first in the text area below.");
                  return;
                }
                setIsRefining(true);
                try {
                  const model = new ChatOpenAI({
                    modelName: "gpt-5.4-mini",
                    openAIApiKey: process.env.OPENAI_API_KEY,
                    configuration: { dangerouslyAllowBrowser: true }
                  });

                  const prompt = `Act as an expert fitness strategist. Refine the following user's fitness vision and aim into a professional, high-impact, and motivating primary goal.
                  
                  User's vision and aim: "${profile.aim}"
                  Current Goal: "${profile.goal || 'None'}"
                  
                  Rules:
                  - Keep it under 10 words
                  - Use powerful, athletic language
                  - Direct alignment with their motivation
                  
                  Refined Primary Goal:`;

                  const response = await model.invoke(prompt, {
                    callbacks: process.env.LANGCHAIN_TRACING_V2 === "true" ? [
                      new LangChainTracer({
                        projectName: process.env.LANGCHAIN_PROJECT,
                        apiKey: process.env.LANGCHAIN_API_KEY,
                      })
                    ] : []
                  });
                  const refined = response.content.toString() || "";
                  onUpdate({ goal: refined.trim().replace(/^"|"$/g, '') });
                } catch (e: any) {
                  console.error("AI Refinement Error:", e);
                  alert(`AI Refinement failed: ${e.message || "Unknown error"}. Please try again.`);
                } finally {
                  setIsRefining(false);
                }
              }}
              className={cn(
                "p-2 bg-zinc-900 border border-zinc-800 rounded-xl transition-all",
                isRefining ? "animate-pulse text-[#CCFF00]" : "hover:text-[#CCFF00]"
              )}
              title="Refine with AI"
            >
              {isRefining ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            </button>
          </div>
          <div className="space-y-4">
            <div>
              <p className="text-[10px] text-zinc-600 uppercase font-mono mb-1">Primary Goal</p>
              {isEditing ? (
                <input
                  className="bg-zinc-900 border border-zinc-800 px-4 py-3 rounded-xl w-full text-white"
                  value={profile?.goal || ''}
                  placeholder="e.g. Hypertrophy & Strength"
                  onChange={(e) => onUpdate({ goal: e.target.value })}
                />
              ) : (
                <p className="text-xl font-bold">{profile?.goal || 'No goal set yet.'}</p>
              )}
            </div>
            <div>
              <p className="text-[10px] text-zinc-600 uppercase font-mono mb-1">Detailed Aim</p>
              {isEditing ? (
                <textarea
                  className="bg-zinc-900 border border-zinc-800 px-4 py-3 rounded-xl w-full text-white text-xs resize-none h-24"
                  value={profile?.aim || ''}
                  placeholder="Describe what you want to achieve, your motivation, and your ultimate vision..."
                  onChange={(e) => onUpdate({ aim: e.target.value })}
                />
              ) : (
                <p className="text-sm text-zinc-400 italic">"{profile?.aim || 'Describe your vision here...'}"</p>
              )}
            </div>
            <div className="flex items-center space-x-1.5 pt-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[#CCFF00] animate-pulse" />
              <p className="text-[9px] text-zinc-500 uppercase font-mono tracking-wider">Coach AI prioritizing this goal</p>
            </div>
          </div>
        </div>

        <div className="bg-[#101010] p-6 rounded-3xl border border-zinc-800 space-y-6">
          <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-500 font-mono">Vital Stats & Measurements</h3>
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
                      value={profile?.[m.key as keyof UserProfile] || ''}
                      onChange={(e) => onUpdate({ [m.key]: e.target.value })}
                    >
                      <option value="">Select</option>
                      {m.options?.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input
                      type="number"
                      className="bg-zinc-900 border border-zinc-800 px-2 py-1 rounded w-full text-white font-bold"
                      value={profile?.[m.key as keyof UserProfile] || ''}
                      onChange={(e) => onUpdate({ [m.key]: parseFloat(e.target.value) })}
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

        <div className="bg-[#1A1A1A] p-6 rounded-3xl border border-zinc-800 space-y-4">
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
              <div className={cn("w-2 h-2 rounded-full", sheets.connected ? "bg-[#CCFF00]" : "bg-red-500")} />
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
              className="w-full py-3 bg-[#CCFF00] text-black font-bold rounded-xl text-xs uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
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
                    className="text-[#CCFF00] hover:underline text-[10px] uppercase font-bold"
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
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-6"
          >
            <div className="bg-[#1A1A1A] w-full max-w-md rounded-3xl border border-zinc-800 overflow-hidden shadow-2xl">
              <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
                <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}><ChevronLeft /></button>
                <h3 className="font-bold">{format(currentMonth, 'MMMM yyyy')}</h3>
                <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}><ChevronRight /></button>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-7 gap-2 mb-4">
                  {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                    <div key={i} className="text-center text-[10px] text-zinc-600 font-bold">{d}</div>
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
                          isToday && "ring-1 ring-[#CCFF00]"
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
                  className="w-full bg-[#CCFF00] text-black font-bold py-3 rounded-2xl mt-4"
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

const WorkoutCard = ({ workout }: { workout: WorkoutLog }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const intensity = workout.intensity || Math.round(workout.totalVolume / (workout.duration / 60 || 1));

  return (
    <div
      onClick={() => setIsExpanded(!isExpanded)}
      className={cn(
        "bg-[#1A1A1A] rounded-2xl border transition-all cursor-pointer overflow-hidden",
        isExpanded ? "border-[#CCFF00]/50" : "border-zinc-800 hover:border-zinc-700"
      )}
    >
      <div className="p-5 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-lg font-bold tracking-tight">{workout.name}</div>
            <div className="text-xs text-zinc-500 font-mono italic">
              {format(new Date(workout.date.seconds * 1000), 'EEEE, MMMM d')}
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={(e) => {
                e.stopPropagation();
                const workoutDate = format(new Date(workout.date.seconds * 1000), 'EEEE, MMMM d');
                const exercisesList = workout.exercises.map(ex => `- ${ex.name}: ${ex.sets.length} sets`).join('\n');
                const text = `I just crushed a workout on FitAI!\n\nWorkout: ${workout.name}\nDate: ${workoutDate}\nTotal Volume: ${workout.totalVolume.toLocaleString()} kg\nExercises:\n${exercisesList}\nDuration: ${Math.floor(workout.duration / 60)} mins\n\n#FitAI #Fitness #Workout`;

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
              className="p-2 text-zinc-600 hover:text-[#CCFF00] transition-colors"
              title="Share Workout"
            >
              <Share2 className="w-4 h-4" />
            </button>
            <div className="text-right">
              <div className="text-[#CCFF00] font-bold">{workout.totalVolume} kg</div>
              <div className="text-[10px] text-zinc-500 font-mono">{Math.floor(workout.duration / 60)} mins</div>
            </div>
            {isExpanded ? (
              <ChevronDown className="w-5 h-5 text-zinc-600" />
            ) : (
              <ChevronRight className="w-5 h-5 text-zinc-600" />
            )}
          </div>
        </div>

        <div className="flex items-center space-x-4 py-2 border-y border-zinc-800/30">
          <div className="flex flex-col">
            <span className="text-[9px] text-zinc-500 uppercase font-mono">Intensity Score</span>
            <span className="text-xs font-bold text-[#CCFF00]">{intensity} <span className="text-[10px] font-normal opacity-50 uppercase font-mono">pts</span></span>
          </div>
          <div className="h-4 w-px bg-zinc-800" />
          <div className="flex flex-col">
            <span className="text-[9px] text-zinc-500 uppercase font-mono">Efficiency</span>
            <span className="text-xs font-bold text-white">{Math.round((workout.totalVolume / (workout.exercises.length || 1)) / 10)} pts</span>
          </div>
        </div>

        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="space-y-4 pt-4 border-t border-zinc-800/30 mt-2">
                {workout.exercises.map((ex, exIdx) => (
                  <div key={exIdx} className="space-y-3">
                    <div className="text-xs font-bold text-zinc-300 flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <span>{ex.name}</span>
                      </div>
                      <span className="text-[10px] text-zinc-500 font-mono bg-zinc-800 px-2 py-0.5 rounded-full">
                        {ex.sets.length} {ex.sets.length === 1 ? 'Set' : 'Sets'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {ex.sets.map((set, sIdx) => (
                        <div key={sIdx} className="bg-zinc-900/50 border border-zinc-800 p-2 rounded-lg flex flex-col justify-center">
                          <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-tighter">Set {sIdx + 1}</span>
                          <span className="text-xs font-bold text-zinc-400">
                            {set.weight} <span className="text-[10px] font-normal opacity-50">kg</span> × {set.reps} <span className="text-[10px] font-normal opacity-50">reps</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

const Dashboard = ({ workouts, profile, onUpdateProfile }: {
  workouts: WorkoutLog[],
  profile: UserProfile | null,
  onUpdateProfile: (data: Partial<UserProfile>) => Promise<any>
}) => {
  const [view, setView] = useState<'chart' | 'matrix'>('chart');
  const [showTimeMatrix, setShowTimeMatrix] = useState(false);
  const [filterType, setFilterType] = useState<'week' | 'month' | 'year' | 'custom' | 'all'>('all');
  const [customRange, setCustomRange] = useState({ start: '', end: '' });
  const [newWeight, setNewWeight] = useState('');
  const [isAddingWeight, setIsAddingWeight] = useState(false);

  const weightData = useMemo(() => {
    if (!profile?.weightHistory) return [];

    const now = new Date();
    return profile.weightHistory.filter(wh => {
      const date = new Date(wh.date);
      if (filterType === 'all') return true;
      if (filterType === 'week') return isAfter(date, startOfWeek(now));
      if (filterType === 'month') return isAfter(date, startOfMonth(now));
      if (filterType === 'year') return isAfter(date, startOfYear(now));
      if (filterType === 'custom') {
        const start = customRange.start ? new Date(customRange.start) : new Date(0);
        const end = customRange.end ? new Date(customRange.end) : new Date();
        end.setHours(23, 59, 59, 999);
        return date >= start && date <= end;
      }
      return true;
    }).sort((a, b) => a.date.localeCompare(b.date)).map(wh => ({
      date: format(new Date(wh.date), 'MMM d'),
      weight: wh.weight
    }));
  }, [profile?.weightHistory, filterType, customRange]);

  const handleAddWeight = async () => {
    if (!newWeight || isNaN(parseFloat(newWeight))) return;
    setIsAddingWeight(true);
    try {
      const weight = parseFloat(newWeight);
      const today = new Date().toISOString();
      const newHistory = [...(profile?.weightHistory || []), { date: today, weight }];
      await onUpdateProfile({
        weight,
        weightHistory: newHistory
      });
      setNewWeight('');
    } finally {
      setIsAddingWeight(false);
    }
  };

  const filteredWorkouts = useMemo(() => {
    const now = new Date();
    return workouts.filter(w => {
      const workoutDate = new Date(w.date.seconds * 1000);

      if (filterType === 'all') return true;
      if (filterType === 'week') return isAfter(workoutDate, startOfWeek(now));
      if (filterType === 'month') return isAfter(workoutDate, startOfMonth(now));
      if (filterType === 'year') return isAfter(workoutDate, startOfYear(now));
      if (filterType === 'custom') {
        const start = customRange.start ? new Date(customRange.start) : new Date(0);
        const end = customRange.end ? new Date(customRange.end) : new Date();
        end.setHours(23, 59, 59, 999);
        return workoutDate >= start && workoutDate <= end;
      }
      return true;
    });
  }, [workouts, filterType, customRange]);

  const data = filteredWorkouts.slice().reverse().map(w => ({
    date: format(new Date(w.date.seconds * 1000), 'MMM d'),
    volume: w.totalVolume,
    duration: Math.floor(w.duration / 60)
  }));

  const muscleVolume = filteredWorkouts.reduce((acc, w) => {
    w.exercises.forEach(ex => {
      const vol = ex.sets.reduce((sAcc, s) => sAcc + (s.weight * s.reps), 0);
      acc[ex.name] = (acc[ex.name] || 0) + vol;
    });
    return acc;
  }, {} as Record<string, number>);

  const radarData = useMemo(() => {
    const categories = {
      'Back': 0,
      'Chest': 0,
      'Core': 0,
      'Shoulders': 0,
      'Arms': 0,
      'Legs': 0
    };

    filteredWorkouts.forEach(w => {
      w.exercises.forEach(ex => {
        let exerciseDef = EXERCISES.find(e => e.id === ex.exerciseId);
        
        // Fallback: If no ID match, try fuzzy name match
        if (!exerciseDef) {
          const cleanName = ex.name.toLowerCase().replace(/[^a-z0-9]/g, '');
          exerciseDef = EXERCISES.find(e => 
            e.name.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanName
          );
        }

        const volume = ex.sets.reduce((acc, s) => acc + (s.weight * s.reps), 0);

        // Use muscle_groups if available, fallback to legacy muscle field
        const groups = (exerciseDef?.muscle_groups && exerciseDef.muscle_groups.length > 0)
          ? exerciseDef.muscle_groups
          : [exerciseDef?.muscle || ''];

        groups.forEach(groupRaw => {
          const group = groupRaw.toLowerCase();
          const weightedVolume = volume / (groups.length || 1); // Distribute volume across groups

          if (group.includes('back') || group.includes('lats') || group.includes('traps') || group.includes('rear delt')) {
            categories['Back'] += weightedVolume;
          } else if (group.includes('chest')) {
            categories['Chest'] += weightedVolume;
          } else if (group.includes('abdominal') || group.includes('core') || group.includes('abs') || group.includes('oblique')) {
            categories['Core'] += weightedVolume;
          } else if (group.includes('shoulder') || group.includes('delt')) {
            categories['Shoulders'] += weightedVolume;
          } else if (group.includes('bicep') || group.includes('tricep') || group.includes('arm') || group.includes('forearm')) {
            categories['Arms'] += weightedVolume;
          } else if (group.includes('quad') || group.includes('hamstring') || group.includes('glute') || group.includes('calve') || group.includes('leg') || group.includes('adductor') || group.includes('abductor')) {
            categories['Legs'] += weightedVolume;
          } else if (group.includes('full body')) {
            const share = weightedVolume / 6;
            categories['Back'] += share;
            categories['Chest'] += share;
            categories['Core'] += share;
            categories['Shoulders'] += share;
            categories['Arms'] += share;
            categories['Legs'] += share;
          }
        });
      });
    });

    return Object.entries(categories).map(([subject, value]) => ({
      subject,
      value: Math.round(value)
    }));
  }, [filteredWorkouts]);

  return (
    <div className="space-y-6 pb-24">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold">Progress</h2>
          <div className="flex items-center space-x-2 mt-1">
            <button
              onClick={() => setView('chart')}
              className={cn("text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded", view === 'chart' ? "bg-[#CCFF00] text-black" : "text-zinc-500")}
            >
              Chart
            </button>
            <button
              onClick={() => setView('matrix')}
              className={cn("text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded", view === 'matrix' ? "bg-[#CCFF00] text-black" : "text-zinc-500")}
            >
              Matrix
            </button>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          {view === 'matrix' && (
            <button
              onClick={() => setShowTimeMatrix(!showTimeMatrix)}
              className={cn(
                "px-3 py-1 rounded-full text-[10px] font-bold transition-all border",
                showTimeMatrix ? "bg-[#CCFF00] border-[#CCFF00] text-black" : "bg-zinc-900 border-zinc-800 text-zinc-500"
              )}
            >
              {showTimeMatrix ? 'Hide Time' : 'Show Time Matrix'}
            </button>
          )}
          <div className="bg-[#1A1A1A] p-2 rounded-full">
            <Sparkles className="w-5 h-5 text-[#CCFF00]" />
          </div>
        </div>
      </header>

      <div className="bg-[#1A1A1A] p-4 rounded-2xl border border-zinc-800 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center space-x-1 bg-black/30 p-1 rounded-xl">
            {(['all', 'week', 'month', 'year', 'custom'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all",
                  filterType === type
                    ? "bg-[#CCFF00] text-black"
                    : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                {type}
              </button>
            ))}
          </div>
          <div className="flex items-center space-x-2 text-[10px] text-zinc-500 font-mono uppercase shrink-0">
            <span className="w-2 h-2 rounded-full bg-[#CCFF00] animate-pulse" />
            <span>{filteredWorkouts.length} Results</span>
          </div>
        </div>

        {filterType === 'custom' && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            className="flex items-center space-x-2 pt-2 border-t border-zinc-800"
          >
            <div className="flex-1">
              <label className="block text-[8px] text-zinc-600 uppercase font-mono mb-1">Start</label>
              <input
                type="date"
                value={customRange.start}
                onChange={(e) => setCustomRange(prev => ({ ...prev, start: e.target.value }))}
                className="w-full bg-black border border-zinc-800 rounded-lg p-2 text-xs text-white outline-none focus:border-[#CCFF00]/50"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[8px] text-zinc-600 uppercase font-mono mb-1">End</label>
              <input
                type="date"
                value={customRange.end}
                onChange={(e) => setCustomRange(prev => ({ ...prev, end: e.target.value }))}
                className="w-full bg-black border border-zinc-800 rounded-lg p-2 text-xs text-white outline-none focus:border-[#CCFF00]/50"
              />
            </div>
          </motion.div>
        )}
      </div>

      {view === 'chart' ? (
        <div className="space-y-4">
          <div className="bg-[#1A1A1A] rounded-2xl p-4 border border-zinc-800 h-[240px]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-zinc-500 uppercase font-mono tracking-widest">Training Volume</span>
            </div>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="colorVolume" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#CCFF00" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#CCFF00" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" stroke="#525252" fontSize={10} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: '#0A0A0A', border: '1px solid #262626', borderRadius: '12px' }}
                  itemStyle={{ color: '#CCFF00' }}
                />
                <Area type="monotone" dataKey="volume" stroke="#CCFF00" fillOpacity={1} fill="url(#colorVolume)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-[#1A1A1A] rounded-2xl p-4 border border-zinc-800 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="text-[10px] text-zinc-500 uppercase font-mono tracking-widest">Body Weight</span>
                <span className="text-xl font-bold">{profile?.weight || '-'} <span className="text-[10px] text-zinc-500">kg</span></span>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  placeholder="Today's kg"
                  value={newWeight}
                  onChange={(e) => setNewWeight(e.target.value)}
                  className="w-20 bg-black border border-zinc-800 rounded-lg p-2 text-xs text-white outline-none focus:border-[#CCFF00]/50"
                  step="0.1"
                />
                <button
                  onClick={handleAddWeight}
                  disabled={isAddingWeight || !newWeight}
                  className="p-2 bg-[#CCFF00] text-black rounded-lg disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="h-[180px]">
              {weightData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={weightData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#262626" />
                    <XAxis dataKey="date" stroke="#525252" fontSize={8} axisLine={false} tickLine={false} />
                    <YAxis hide domain={['dataMin - 5', 'dataMax + 5']} />
                    <Tooltip
                      contentStyle={{ background: '#0A0A0A', border: '1px solid #262626', borderRadius: '12px', fontSize: '10px' }}
                      itemStyle={{ color: '#CCFF00' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="weight"
                      stroke="#CCFF00"
                      strokeWidth={2}
                      dot={{ fill: '#CCFF00', r: 3 }}
                      activeDot={{ r: 5, stroke: '#CCFF00', strokeWidth: 2 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-zinc-600 border border-dashed border-zinc-800 rounded-xl">
                  <p className="text-[10px] uppercase font-mono">No weight data for this range</p>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-[#1A1A1A] rounded-2x border border-zinc-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-zinc-900 text-zinc-500 uppercase tracking-tighter">
                <tr>
                  <th className="p-3 border-b border-zinc-800">Session</th>
                  <th className="p-3 border-b border-zinc-800">Volume</th>
                  {showTimeMatrix && <th className="p-3 border-b border-zinc-800">Time</th>}
                  {showTimeMatrix && <th className="p-3 border-b border-zinc-800">Active</th>}
                  {showTimeMatrix && <th className="p-3 border-b border-zinc-800">Intensity</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {workouts.slice(0, 10).map((w, i) => {
                  const totalActiveTime = w.exercises.reduce((acc, ex) =>
                    acc + ex.sets.reduce((sAcc, s) => sAcc + (s.timeTaken || 0), 0), 0
                  );
                  return (
                    <tr key={i} className="hover:bg-white/5 transition-colors">
                      <td className="p-3 font-bold">{format(new Date(w.date.seconds * 1000), 'MMM d')}</td>
                      <td className="p-3 text-[#CCFF00] font-bold">{w.totalVolume}kg</td>
                      {showTimeMatrix && <td className="p-3 text-zinc-400">{Math.floor(w.duration / 60)}m</td>}
                      {showTimeMatrix && <td className="p-3 text-zinc-500">{Math.floor(totalActiveTime / 60)}m</td>}
                      {showTimeMatrix && <td className="p-3 text-[#CCFF00] font-bold">{w.intensity || '-'}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-[#1A1A1A] rounded-2xl p-4 border border-zinc-800 h-[300px] flex flex-col">
        <div className="flex items-center space-x-2 text-[10px] text-zinc-500 uppercase font-mono mb-4">
          <Sparkles className="w-3 h-3" />
          <span>Muscle Intelligence Radar</span>
        </div>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
            <PolarGrid stroke="#262626" />
            <PolarAngleAxis dataKey="subject" tick={{ fill: '#525252', fontSize: 10 }} />
            <PolarRadiusAxis axisLine={false} tick={false} domain={[0, 'auto']} />
            <Radar
              name="Volume"
              dataKey="value"
              stroke="#CCFF00"
              fill="#CCFF00"
              fillOpacity={0.3}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {[
          { label: 'Total Logs', value: filteredWorkouts.length, icon: History },
          { label: 'Avg Volume', value: Math.round(filteredWorkouts.reduce((acc, curr) => acc + curr.totalVolume, 0) / (filteredWorkouts.length || 1)), icon: Dumbbell },
        ].map((stat, i) => (
          <div key={i} className="bg-[#1A1A1A] p-4 rounded-2xl border border-zinc-800">
            <stat.icon className="w-4 h-4 text-zinc-500 mb-2" />
            <div className="text-2xl font-bold tracking-tight">{stat.value}</div>
            <div className="text-[10px] text-zinc-500 uppercase font-mono tracking-wider">{stat.label}</div>
          </div>
        ))}
      </div>

      <div>
        <h3 className="text-lg font-bold mb-4 flex items-center space-x-2">
          <span>Recent Workouts</span>
          <History className="w-4 h-4 text-zinc-500" />
        </h3>
        <div className="space-y-4">
          {workouts.length === 0 ? (
            <div className="bg-[#1A1A1A] p-8 rounded-2xl border border-dashed border-zinc-800 text-center">
              <p className="text-zinc-500 text-sm italic">No logs yet. Start your engine.</p>
            </div>
          ) : (
            workouts.slice(0, 3).map((w, idx) => (
              <WorkoutCard key={idx} workout={w} />
            ))
          )}
        </div>
      </div>
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
          <h2 className="text-3xl font-bold">Library</h2>
          <p className="text-zinc-500 font-mono text-xs uppercase">Your Routines</p>
        </div>
        <button
          onClick={onCreate}
          className="bg-[#CCFF00] text-black p-2 rounded-full shadow-lg shadow-[#CCFF00]/10"
        >
          <Plus className="w-6 h-6" />
        </button>
      </header>

      <div className="space-y-4">
        {routines.length === 0 ? (
          <div className="bg-[#1A1A1A] p-12 rounded-3xl border border-dashed border-zinc-800 text-center flex flex-col items-center">
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
              className="bg-[#1A1A1A] p-5 rounded-2xl border border-zinc-800 space-y-4 group hover:border-[#CCFF00]/30 transition-all relative overflow-hidden"
            >
              <div className="flex items-start justify-between">
                <div onClick={() => onEdit(r)} className="cursor-pointer flex-1">
                  <h3 className="text-lg font-bold group-hover:text-[#CCFF00] transition-colors">{r.name}</h3>
                  <p className="text-xs text-zinc-500 line-clamp-1">{r.exercises.map(e => e.name).join(', ')}</p>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (r.id) onDelete(r.id);
                    }}
                    className="p-3 text-zinc-600 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all relative z-10"
                    title="Delete Routine"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onStart(r);
                    }}
                    className="bg-[#CCFF00] text-black p-3 rounded-xl hover:scale-105 active:scale-95 transition-all shadow-lg shadow-[#CCFF00]/5 relative z-10"
                  >
                    <Play className="w-4 h-4 fill-current" />
                  </button>
                </div>
              </div>
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

  const recentExercises = useMemo(() => allExercises.slice(0, 5), [allExercises]); // Mocking recent for now

  const handleSaveCustom = async (exercise: typeof EXERCISES[0]) => {
    const currentCustom = profile?.customExercises || [];
    await updateProfile({
      customExercises: [...currentCustom, exercise]
    });
    setShowCustomModal(false);
    onSelect(exercise);
  };

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col overflow-hidden">
      <header className="flex items-center justify-between p-4 border-b border-zinc-900">
        <button onClick={onCancel} className="p-2 text-zinc-400">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <h2 className="text-lg font-bold">Exercises</h2>
        <button
          onClick={() => setShowCustomModal(true)}
          className="p-2 text-[#CCFF00]"
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
            placeholder="Search exercise"
            className="w-full bg-[#1A1A1A] border-none rounded-lg py-2.5 pl-10 pr-4 text-sm focus:ring-1 focus:ring-[#CCFF00]"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setActiveFilter('equip')}
            className={cn(
              "py-2.5 rounded-md text-[10px] font-bold flex items-center justify-center space-x-1 border transition-all",
              selectedEquip !== "All Equipment" ? "bg-[#CCFF00] text-black border-[#CCFF00]" : "bg-zinc-900 text-zinc-300 border-zinc-800"
            )}
          >
            <span className="truncate max-w-[80px]">{selectedEquip}</span>
            <ChevronDown className="w-3 h-3" />
          </button>
          <button
            onClick={() => setActiveFilter('muscle')}
            className={cn(
              "py-2.5 rounded-md text-[10px] font-bold flex items-center justify-center space-x-1 border transition-all",
              selectedMuscle !== "All Muscles" ? "bg-[#CCFF00] text-black border-[#CCFF00]" : "bg-zinc-900 text-zinc-300 border-zinc-800"
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
            <h3 className="text-zinc-500 text-xs font-bold mb-4 uppercase tracking-wider">Recent Exercises</h3>
            <div className="divide-y divide-zinc-900">
              {recentExercises.map((e) => (
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
              className="mt-4 text-[#CCFF00] text-sm font-bold"
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
              className="bg-[#1A1A1A] w-full max-h-[70vh] rounded-t-[32px] border-t border-zinc-800 overflow-hidden flex flex-col shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
                <h3 className="text-lg font-bold">Select {activeFilter === 'equip' ? 'Equipment' : 'Muscle Group'}</h3>
                <button
                  onClick={() => setActiveFilter(null)}
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
                        ? "bg-[#CCFF00] text-black font-bold"
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
  const [exercises, setExercises] = useState<WorkoutExercise[]>(routine?.exercises || []);
  const [name, setName] = useState(routine?.name || 'New Routine');
  const [description, setDescription] = useState(routine?.description || '');
  const [showExerciseSelector, setShowExerciseSelector] = useState(false);
  const [search, setSearch] = useState('');

  const addExercise = (exercise: typeof EXERCISES[0]) => {
    setExercises([...exercises, {
      exerciseId: exercise.id,
      name: exercise.name,
      sets: [{ reps: 0, weight: 0, completed: false }]
    }]);
    setShowExerciseSelector(false);
  };

  const addSet = (idx: number) => {
    const newEx = [...exercises];
    newEx[idx].sets.push({ reps: 0, weight: 0, completed: false });
    setExercises(newEx);
  };

  const updateSet = (exIdx: number, setIdx: number, field: keyof WorkoutSet, value: any) => {
    const newEx = [...exercises];
    newEx[exIdx].sets[setIdx] = { ...newEx[exIdx].sets[setIdx], [field]: value };
    setExercises(newEx);
  };

  if (showExerciseSelector) {
    return <ExerciseSelector onSelect={addExercise} onCancel={() => setShowExerciseSelector(false)} />;
  }

  return (
    <div className="flex flex-col min-h-screen bg-[#0A0A0A] p-6 pb-32">
      <header className="flex items-center justify-between mb-8">
        <button onClick={onCancel} className="text-zinc-500 font-bold">Cancel</button>
        <h2 className="text-lg font-bold">Edit Routine</h2>
        <button
          onClick={() => onSave({ name, description, exercises })}
          className="text-[#CCFF00] font-bold"
        >
          Save
        </button>
      </header>

      <div className="space-y-6">
        <div className="space-y-1">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full text-3xl font-bold bg-transparent border-none focus:ring-0 p-0 placeholder:text-zinc-800"
            placeholder="Routine Name"
          />
          <input
            type="text"
            value={description}
            onChange={e => setDescription(e.target.value)}
            className="w-full text-sm text-zinc-500 bg-transparent border-none focus:ring-0 p-0 placeholder:text-zinc-800"
            placeholder="Description (Optional)"
          />
        </div>

        <div className="space-y-8">
          {exercises.map((ex, exIdx) => (
            <div key={exIdx} className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <h3 className="text-lg font-bold text-[#CCFF00]">{ex.name}</h3>
                </div>
                <button
                  onClick={() => setExercises(exercises.filter((_, i) => i !== exIdx))}
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
                      type="number"
                      value={set.weight || ''}
                      onChange={e => updateSet(exIdx, sIdx, 'weight', parseFloat(e.target.value))}
                      className="bg-transparent border-none text-center focus:ring-0 font-bold"
                    />
                    <input
                      type="number"
                      value={set.reps || ''}
                      onChange={e => updateSet(exIdx, sIdx, 'reps', parseInt(e.target.value))}
                      className="bg-transparent border-none text-center focus:ring-0 font-bold"
                    />
                    <button
                      onClick={() => {
                        const newEx = [...exercises];
                        newEx[exIdx].sets = newEx[exIdx].sets.filter((_, i) => i !== sIdx);
                        setExercises(newEx);
                      }}
                      className="flex justify-center text-zinc-700 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => addSet(exIdx)}
                  className="w-full py-2 border border-dashed border-zinc-800 rounded-xl text-[10px] text-zinc-600 font-mono uppercase tracking-widest"
                >
                  Add Base Set
                </button>
              </div>
            </div>
          ))}

          <button
            onClick={() => setShowExerciseSelector(true)}
            className="w-full py-4 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center space-x-2 text-white font-bold"
          >
            <Plus className="w-5 h-5 text-[#CCFF00]" />
            <span>Add Exercises</span>
          </button>
        </div>
      </div>
    </div>
  );
};

const ExerciseItem = ({ 
  ex, 
  exIdx, 
  exercises, 
  setExercises, 
  getPrevPerformance, 
  updateSet, 
  toggleSetComplete, 
  startSetTimer, 
  formatTimeTaken, 
  parseTimeTaken, 
  setStartTimes, 
  addSet 
}: any) => {
  const dragControls = useDragControls();

  return (
    <Reorder.Item 
      key={ex.sessionKey} 
      value={ex} 
      dragListener={false}
      dragControls={dragControls}
      className="space-y-4 bg-[#0A0A0A] select-none"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div 
            onPointerDown={(e) => dragControls.start(e)}
            className="cursor-grab active:cursor-grabbing p-2 opacity-50 hover:opacity-100 touch-none"
          >
            <div className="flex space-x-1">
              <div className="w-1 h-4 bg-zinc-700 rounded-full" />
              <div className="w-1 h-4 bg-zinc-700 rounded-full" />
              <div className="w-1 h-4 bg-zinc-700 rounded-full" />
            </div>
          </div>
          <h3 className="text-xl font-bold text-[#CCFF00]">{ex.name}</h3>
        </div>
        <button
          onClick={() => setExercises(exercises.filter((_: any, i: number) => i !== exIdx))}
          className="text-zinc-600 hover:text-red-500 transition-colors p-2"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-2">
        <div className="grid grid-cols-6 gap-2 px-2 text-[8px] font-mono text-zinc-600 uppercase tracking-widest">
          <div className="text-center">Set</div>
          <div className="text-center">Prev</div>
          <div className="text-center">kg</div>
          <div className="text-center">Reps</div>
          <div className="text-center">Sec</div>
          <div className="text-right pr-2">Done</div>
        </div>

        {ex.sets.map((set: any, sIdx: number) => {
          const setKey = `${exIdx}-${sIdx}`;
          const isTimerRunning = !!setStartTimes[setKey];

          return (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              key={sIdx}
              className={cn(
                "grid grid-cols-6 gap-2 items-center p-2 rounded-xl transition-all duration-300",
                set.completed ? "bg-[#CCFF00]/10 border border-[#CCFF00]/30 shadow-inner" : "bg-zinc-900 border border-transparent"
              )}
            >
              <div className="font-mono text-sm text-center bg-zinc-800 py-1 rounded-md">{sIdx + 1}</div>
              <div className="text-center text-[9px] text-zinc-500 font-mono font-bold">{getPrevPerformance(ex.name, sIdx)}</div>
              <input
                type="number"
                value={set.weight || ''}
                placeholder="0"
                onChange={(e) => updateSet(exIdx, sIdx, 'weight', parseFloat(e.target.value))}
                className="bg-transparent border-none text-center focus:ring-0 p-0 text-sm font-bold w-full"
              />
              <input
                type="number"
                value={set.reps || ''}
                placeholder="0"
                onChange={(e) => updateSet(exIdx, sIdx, 'reps', parseInt(e.target.value))}
                className="bg-transparent border-none text-center focus:ring-0 p-0 text-sm font-bold w-full"
              />
              <div className="relative group">
                <input
                  type="text"
                  value={formatTimeTaken(set.timeTaken)}
                  placeholder="0:00"
                  onChange={(e) => updateSet(exIdx, sIdx, 'timeTaken', parseTimeTaken(e.target.value))}
                  className={cn(
                    "bg-transparent border-none text-center focus:ring-0 p-0 text-sm font-mono w-full",
                    isTimerRunning ? "text-[#CCFF00] animate-pulse" : ""
                  )}
                />
                {!set.completed && !isTimerRunning && (
                  <button
                    onClick={() => startSetTimer(exIdx, sIdx)}
                    className="absolute inset-0 bg-zinc-800/80 rounded opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                  >
                    <Play className="w-3 h-3 text-[#CCFF00]" />
                  </button>
                )}
              </div>
              <div className="flex items-center justify-end space-x-2 pr-1">
                <button
                  onClick={() => toggleSetComplete(exIdx, sIdx)}
                  className={cn(
                    "flex items-center justify-center p-1 rounded-lg transition-transform active:scale-90",
                    set.completed ? "text-[#CCFF00]" : "text-zinc-700"
                  )}
                >
                  {set.completed ? (
                    <CheckCircle2 className="w-6 h-6 fill-current bg-black rounded-full" />
                  ) : (
                    <div className="w-6 h-6 rounded-md border-2 border-zinc-700" />
                  )}
                </button>
                <button
                  onClick={() => {
                    const newEx = [...exercises];
                    newEx[exIdx].sets = newEx[exIdx].sets.filter((_: any, i: number) => i !== sIdx);
                    setExercises(newEx);
                  }}
                  className="text-zinc-700 hover:text-red-500 transition-colors p-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </motion.div>
          );
        })}

        <button
          onClick={() => addSet(exIdx)}
          className="w-full py-2 rounded-xl border border-zinc-800 text-zinc-500 font-mono text-xs uppercase tracking-widest hover:bg-zinc-900 transition-colors"
        >
          Add Set
        </button>
      </div>
    </Reorder.Item>
  );
};

const WorkoutLogger = ({ routine, workouts, onComplete, onCancel }: { routine?: Routine, workouts: WorkoutLog[], onComplete: () => void, onCancel: () => void }) => {
  const { profile, sheets } = useAuth();
  const [exercises, setExercises] = useState<WorkoutExercise[]>(routine?.exercises.map(e => ({
    ...e,
    sessionKey: Math.random().toString(36).substr(2, 9),
    sets: e.sets.map(s => ({ ...s, completed: false }))
  })) || []);
  const [name, setName] = useState(routine?.name || 'Morning Session');
  const [startTime] = useState(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [finalVolume, setFinalVolume] = useState(0);
  const [finalIntensity, setFinalIntensity] = useState(0);
  const [showExerciseSelector, setShowExerciseSelector] = useState(false);
  const [setStartTimes, setSetStartTimes] = useState<Record<string, number>>({});

  const getPrevPerformance = (exerciseName: string, setIdx: number) => {
    // Search backwards through history
    for (const workout of workouts) {
      const ex = workout.exercises.find(e => e.name === exerciseName);
      if (ex && ex.sets[setIdx]) {
        return `${ex.sets[setIdx].weight}/${ex.sets[setIdx].reps}`;
      }
    }
    return '-';
  };

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [startTime]);

  const formatTime = (seconds: number) => {
    const min = Math.floor(seconds / 60);
    const sec = seconds % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  const addExercise = (exercise: typeof EXERCISES[0]) => {
    setExercises([...exercises, {
      sessionKey: Math.random().toString(36).substr(2, 9),
      exerciseId: exercise.id,
      name: exercise.name,
      sets: [{ reps: 0, weight: 0, completed: false }]
    }]);
    setShowExerciseSelector(false);
  };

  const addSet = (idx: number) => {
    const newEx = [...exercises];
    newEx[idx].sets.push({ reps: 0, weight: 0, completed: false });
    setExercises(newEx);
  };

  const updateSet = (exIdx: number, setIdx: number, field: string, value: any) => {
    const newEx = [...exercises];
    newEx[exIdx].sets[setIdx] = { ...newEx[exIdx].sets[setIdx], [field]: value };
    setExercises(newEx);
  };

  const toggleSetComplete = (exIdx: number, setIdx: number) => {
    const newEx = [...exercises];
    const set = newEx[exIdx].sets[setIdx];
    const setKey = `${exIdx}-${setIdx}`;

    if (!set.completed) {
      // Completing the set
      const startTimeRef = setStartTimes[setKey];
      if (startTimeRef) {
        const timeTaken = Math.floor((Date.now() - startTimeRef) / 1000);
        set.timeTaken = (set.timeTaken || 0) + timeTaken;
      }
      set.completed = true;
      // Clear start time
      const nextStartTimes = { ...setStartTimes };
      delete nextStartTimes[setKey];
      setSetStartTimes(nextStartTimes);
    } else {
      // Uncompleting - potentially restart timer? 
      // For now just toggle
      set.completed = false;
    }

    setExercises(newEx);
  };

  const startSetTimer = (exIdx: number, setIdx: number) => {
    const setKey = `${exIdx}-${setIdx}`;
    if (!setStartTimes[setKey]) {
      setSetStartTimes({ ...setStartTimes, [setKey]: Date.now() });
    }
  };

  const formatTimeTaken = (seconds: number | undefined): string => {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
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
    if (exercises.length === 0 || isSaving) return;
    setIsSaving(true);
    const duration = Math.floor((Date.now() - startTime) / 1000);
    const totalVolume = exercises.reduce((acc, ex) =>
      acc + ex.sets.reduce((sAcc, s) => sAcc + (s.weight * s.reps), 0), 0
    );

    // Calculate intensity
    const totalActiveTime = exercises.reduce((acc, ex) =>
      acc + ex.sets.reduce((sAcc, s) => sAcc + (s.timeTaken || 0), 0), 0
    );
    // Intensity = (Volume / Duration) * (Active Ratio) * Factor
    const activeRatio = totalActiveTime / duration;
    const intensity = Math.round((totalVolume / (duration || 1)) * (activeRatio || 0.1) * 100);

    try {
      const workoutData = {
        userId: auth.currentUser?.uid,
        name,
        date: serverTimestamp(),
        duration,
        totalVolume,
        intensity,
        exercises,
        createdAt: serverTimestamp()
      };

      const docRef = await addDoc(collection(db, 'workouts'), workoutData);

      // Log to Google Sheets if connected
      if (sheets.accessToken && profile?.spreadsheetId) {
        await logToGoogleSheets({ ...workoutData, date: new Date().toISOString() } as any, profile.spreadsheetId, sheets.accessToken);
      }

      setFinalVolume(totalVolume);
      setFinalIntensity(intensity);
      setIsComplete(true);
    } catch (e) {
      console.error(e);
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
          set.weight,
          set.reps,
          set.timeTaken || 0,
          workout.duration,
          workout.totalVolume,
          workout.intensity || 0
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

  if (showExerciseSelector) {
    return <ExerciseSelector onSelect={addExercise} onCancel={() => setShowExerciseSelector(false)} />;
  }

  if (isComplete) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#0A0A0A] p-6 text-center text-white">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="space-y-8 max-w-sm w-full"
        >
          <div className="w-24 h-24 bg-[#CCFF00] rounded-full flex items-center justify-center mx-auto shadow-[0_0_50px_rgba(204,255,0,0.3)]">
            <CheckCircle2 className="w-12 h-12 text-black" />
          </div>
          <div>
            <h2 className="text-4xl font-bold mb-2">Crushed It.</h2>
            <p className="text-zinc-500 font-mono text-xs uppercase tracking-widest">Workout Session Logged</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-zinc-900/50 p-4 rounded-3xl border border-zinc-800">
              <div className="text-2xl font-bold text-[#CCFF00]">{finalVolume} <span className="text-xs font-normal opacity-50 uppercase">kg</span></div>
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
              className="w-full bg-[#CCFF00] text-black font-bold py-4 rounded-2xl flex items-center justify-center space-x-2"
            >
              <Share2 className="w-5 h-5" />
              <span>Share Achievement</span>
            </button>
            <button
              onClick={onComplete}
              className="w-full bg-zinc-900 text-zinc-400 font-bold py-4 rounded-2xl border border-zinc-800"
            >
              Back to Dashboard
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-[#0A0A0A] pb-32">
      <header className="sticky top-0 z-30 px-6 py-4 bg-[#0A0A0A]/95 backdrop-blur-sm border-b border-zinc-800/50">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="text-lg font-bold bg-transparent border-none focus:ring-0 p-0 w-full break-words"
        />
        <div className="flex items-center justify-between mt-2">
          <div className="flex items-center space-x-2 text-[#CCFF00] font-mono text-xs">
            <Timer className="w-3 h-3" />
            <span>{formatTime(elapsed)}</span>
          </div>
          <div className="flex space-x-2 shrink-0">
            <button onClick={onCancel} disabled={isSaving} className="text-zinc-600 font-bold px-4">Discard</button>
            <button
              onClick={saveWorkout}
              disabled={isSaving}
              className="bg-[#CCFF00] text-black font-bold px-6 py-2 rounded-full text-sm shadow-lg shadow-[#CCFF00]/10 disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Finish'}
            </button>
          </div>
        </div>
      </header>

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
            addSet={addSet}
          />
        ))}

        <button
          onClick={() => setShowExerciseSelector(true)}
          className="w-full py-4 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center space-x-2 text-[#CCFF00] font-bold hover:bg-zinc-800 transition-colors"
        >
          <Plus className="w-5 h-5" />
          <span>Add Exercise</span>
        </button>
      </Reorder.Group>
    </div>
  );
};


const AIAssistant = ({
  workouts,
  profile,
  routines,
  onCreateRoutine,
  onUpdateRoutine,
  onDeleteRoutine,
  onUpdateProfile
}: {
  workouts: WorkoutLog[],
  profile: UserProfile | null,
  routines: Routine[],
  onCreateRoutine: (data: any) => Promise<any>,
  onUpdateRoutine: (id: string, data: any) => Promise<any>,
  onDeleteRoutine: (id: string) => Promise<any>,
  onUpdateProfile: (data: any) => Promise<any>
}) => {
  const { user } = useAuth();
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [summary, setSummary] = useState<string>('');
  const [isTyping, setIsTyping] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [chatTheme, setChatTheme] = useState<'dark' | 'light'>('dark');
  const [responseTimer, setResponseTimer] = useState(0);

  useEffect(() => {
    let interval: any;
    if (isTyping) {
      const start = Date.now();
      interval = setInterval(() => {
        setResponseTimer(Number(((Date.now() - start) / 1000).toFixed(1)));
      }, 100);
    } else {
      setResponseTimer(0);
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [isTyping]);

  // Load conversation list
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'users', user.uid, 'conversations'),
      orderBy('updatedAt', 'desc')
    );
    const path = `users/${user.uid}/conversations`;
    const unsubscribe = onSnapshot(q, (snap) => {
      setConversations(snap.docs.map(d => ({ id: d.id, ...d.data() } as Conversation)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });
    return () => unsubscribe();
  }, [user?.uid]);

  // Load messages for current conversation
  useEffect(() => {
    if (!user) return;
    if (!currentConversationId) {
      setMessages([{ role: 'bot', text: "Yo! I'm FitAI, your personal coach. Ready to crush today's workout?", timestamp: new Date() }]);
      setIsLoadingHistory(false);
      return;
    }

    setIsLoadingHistory(true);
    const q = query(
      collection(db, 'users', user.uid, 'conversations', currentConversationId, 'messages'),
      orderBy('timestamp', 'asc'),
      limit(100)
    );

    const path = `users/${user.uid}/conversations/${currentConversationId}/messages`;
    const unsubscribe = onSnapshot(q, (snap) => {
      const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() } as ChatMessage));
      if (msgs.length > 0) {
        setMessages(msgs);
      }
      setIsLoadingHistory(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
      setIsLoadingHistory(false);
    });

    return () => unsubscribe();
  }, [user?.uid, currentConversationId]);

  // Load summary once
  useEffect(() => {
    if (!user) return;
    const loadSummary = async () => {
      const summaryDoc = await getDoc(doc(db, 'users', user.uid, 'chat_summary', 'main'));
      if (summaryDoc.exists()) {
        setSummary(summaryDoc.data().summary);
      }
    };
    loadSummary();
  }, [user?.uid]);

  const startNewChat = () => {
    setCurrentConversationId(null);
    setMessages([{ role: 'bot', text: "Yo! I'm FitAI, your personal coach. Ready to crush today's workout?", timestamp: new Date() }]);
    setShowHistory(false);
  };

  const saveMessage = async (role: 'user' | 'bot', text: string, convId: string) => {
    if (!user) return;
    const path = `users/${user.uid}/conversations/${convId}/messages`;
    try {
      const msg: ChatMessage = { role, text, timestamp: serverTimestamp() };
      await addDoc(collection(db, 'users', user.uid, 'conversations', convId, 'messages'), msg);
      await updateDoc(doc(db, 'users', user.uid, 'conversations', convId), {
        lastMessage: text,
        updatedAt: serverTimestamp()
      });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, path);
    }
  };

  const createConversation = async (firstMessage: string) => {
    if (!user) return null;
    const convData = {
      userId: user.uid,
                      title: firstMessage.slice(0, 30) + (firstMessage.length > 30 ? '...' : ''),
      lastMessage: firstMessage,
      updatedAt: serverTimestamp()
    };
    const docRef = await addDoc(collection(db, 'users', user.uid, 'conversations'), convData);
    return docRef.id;
  };

  const summarizeConversation = async (msgs: ChatMessage[]) => {
    if (!user) return;
    try {
      const model = new ChatOpenAI({
        modelName: "gpt-5.4-mini",
        openAIApiKey: process.env.OPENAI_API_KEY,
        configuration: { dangerouslyAllowBrowser: true }
      });

      const promptText = `Analyze the following chat history and update the "Neural Memory".
      
Existing Memory (Chat History Summary):
${summary}

New Messages:
${msgs.map(m => `${m.role.toUpperCase()}: ${m.text}`).join('\n')}

Rules:
- Synthesize key information (new goals, preferences, physical issues)
- Keep it under 200 words
- Maintain a structured, informative tone

New Neural Memory:`;

      const response = await model.invoke(promptText, {
        callbacks: process.env.LANGCHAIN_TRACING_V2 === "true" ? [
          new LangChainTracer({
            projectName: process.env.LANGCHAIN_PROJECT,
            apiKey: process.env.LANGCHAIN_API_KEY,
          })
        ] : []
      });
      const newSummary = (response.content.toString() || summary).trim();
      
      setSummary(newSummary);
      await setDoc(doc(db, 'users', user.uid, 'chat_summary', 'main'), {
        userId: user.uid,
        summary: newSummary,
        lastUpdated: serverTimestamp()
      });
    } catch (e) {
      console.error("Summarization failed:", e);
    }
  };



  const toggleListening = async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('file', audioBlob, 'audio.webm');
        formData.append('model', 'whisper-1');

        try {
          const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: formData
          });
          const data = await response.json();
          if (data.text) {
            setPrompt(prev => prev + ' ' + data.text);
          }
        } catch (error) {
          console.error("Whisper transcription failed:", error);
        }
        
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error("Microphone access denied:", error);
    }
  };

  const MESSAGE_LIMIT = 5;

  const askAI = async () => {
    if (!prompt.trim() || !user) return;
    const userMsg = prompt;
    const startTime = Date.now();

    let convId = currentConversationId;
    if (!convId) {
      convId = await createConversation(userMsg);
      if (convId) setCurrentConversationId(convId);
    }

    if (!convId) return;

    const newMsg: ChatMessage = { role: 'user', text: userMsg, timestamp: new Date() };

    setMessages(prev => [...prev, newMsg]);
    setPrompt('');
    setIsTyping(true);
    await saveMessage('user', userMsg, convId);

    const profileContext = profile ? `
USER PROFILE:
- Name: ${profile.name || 'Unknown'}
- Gender: ${profile.gender || 'Not set'}
- Age: ${profile.age || 'Not set'}
- Weight: ${profile.weight ? `${profile.weight}kg` : 'Not set'}
- Height: ${profile.height ? `${profile.height}cm` : 'Not set'}
- Primary Goal: ${profile.goal || 'Not set'}
- Detailed Aim: ${profile.aim || 'Not set'}
` : "No profile data available.";

    const workoutContext = workouts.map(w => {
      const date = format(new Date(w.date.seconds * 1000), 'MMM d');
      return `[${date}] ${w.name} (${w.totalVolume}kg)`;
    }).join('\n');

    const exerciseListText = EXERCISES.map(e => `${e.id}: ${e.name}`).join('\n');

    const systemInstruction = `You are FitAI. Background data for context — use only when relevant:
${profileContext}
RECENT WORKOUTS:
${workoutContext}
AVAILABLE EXERCISES:
${exerciseListText}`;

    try {
      // 1. Models
      const model = new ChatOpenAI({
        modelName: "gpt-5.4-mini",
        openAIApiKey: process.env.OPENAI_API_KEY,
        configuration: { dangerouslyAllowBrowser: true }
      });

      // 2. Tools
      const createRoutineTool = tool(async (args) => {
        await onCreateRoutine(args);
        return "Routine created successfully.";
      }, {
        name: "create_routine",
        description: "Create a new workout routine",
        schema: z.object({
          name: z.string(),
          exercises: z.array(z.object({
            exerciseId: z.string(),
            name: z.string(),
            sets: z.array(z.object({ weight: z.number(), reps: z.number() }))
          }))
        })
      });

      const updateRoutineTool = tool(async (args) => {
        // @ts-ignore
        await onUpdateRoutine(args.id, args);
        return "Routine updated successfully.";
      }, {
        name: "update_routine",
        description: "Update an existing routine",
        schema: z.object({
          id: z.string(),
          name: z.string().optional(),
          exercises: z.array(z.object({
            exerciseId: z.string(),
            name: z.string(),
            sets: z.array(z.object({ weight: z.number(), reps: z.number() }))
          })).optional()
        })
      });

      const deleteRoutineTool = tool(async (args) => {
        // @ts-ignore
        await onDeleteRoutine(args.id);
        return "Routine deleted successfully.";
      }, {
        name: "delete_routine",
        description: "Delete an existing routine",
        schema: z.object({ id: z.string() })
      });

      const updateProfileTool = tool(async (args) => {
        await onUpdateProfile(args);
        return "Profile updated successfully.";
      }, {
        name: "update_profile",
        description: "Update user profile",
        schema: z.object({ goal: z.string().optional(), weight: z.number().optional() })
      });

      const tavilySearchTool = tool(async ({ query }) => {
        const response = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, search_depth: 'basic' })
        });
        const data = await response.json();
        return JSON.stringify(data.results.map((r: any) => ({ title: r.title, content: r.content })));
      }, {
        name: "tavily_search",
        description: "Search web for fitness info",
        schema: z.object({ query: z.string() })
      });

      // 3. LangGraph Nodes
      const StateAnnotation = Annotation.Root({
        messages: Annotation<any[]>({ reducer: (x, y) => x.concat(y) }),
      });

      const superiorAgent = async (state: typeof StateAnnotation.State) => {
        const lastMsg = state.messages[state.messages.length - 1];
        const justFinishedTools = lastMsg instanceof ToolMessage;
        const goal = profile?.goal || 'Crush it';

        const prompt = `You are FitAI. A real person texting back — not a bot, not a coach giving lectures.

USER:
- Name: ${profile?.name || 'Unknown'} | Gender: ${profile?.gender || '?'} | Age: ${profile?.age || '?'}
- Weight: ${profile?.weight ? `${profile.weight}kg` : '?'} | Height: ${profile?.height ? `${profile.height}cm` : '?'}
- Goal: ${goal} | Aim: ${profile?.aim || 'Not set'}

VIBE — read the message, match the energy exactly, stay 1 step above:
- "hi" → just say hi back. maybe one chill line. NOTHING ELSE.
- casual chat → be casual, funny, sharp. don't bring up fitness unless they do.
- they go deep on training → go deep, be the expert.
- they flirt or get playful → match it, keep it fun and confident.
- they swear → you can too, naturally, don't force it.
- they're serious → be direct and precise.
- emojis only if the vibe calls for it. never force them.
- NEVER volunteer fitness plans, goals, or data unless they ask. read the room.

FORMAT — match the message length:
- short message → short reply. 1-3 lines max for casual stuff.
- fitness question → answer it properly. use Markdown tables only for structured plans/routines.
- after tools finish: 1 line confirmation + emoji. done.

ROUTING — fire whenever needed, no hesitation:
- anything about creating/editing/deleting a routine or profile → DELEGATE_TO_CRUD
- user confirms a plan ("do it", "yes", "save", "add", "ok", "go", "sure") → DELEGATE_TO_CRUD immediately, no re-asking
- need outside info, research, supplements, science → DELEGATE_TO_SEARCH
- no plan shown yet → show it first, ask "want me to save this?" → on yes → DELEGATE_TO_CRUD

${justFinishedTools ? '✅ Tools just ran. Send 1 short confirmation line with emoji. Nothing more.' : ''}`;

        const response = await model.invoke([new SystemMessage(prompt), ...state.messages], { tags: ["superior_response"] });
        return { messages: [response] };
      };

      const crudAgent = async (state: typeof StateAnnotation.State) => {
        const crudModel = model.bindTools([createRoutineTool, updateRoutineTool, deleteRoutineTool, updateProfileTool]);
        const response = await crudModel.invoke([
          new SystemMessage(`You are the CRUD Agent. Execute the requested action immediately and precisely.

USER STATS (use for weight calibration):
- Body Weight: ${profile?.weight ? `${profile.weight}kg` : 'Unknown'}
- Goal: ${profile?.goal || 'General fitness'}

INTELLIGENCE:
- Scan HISTORY before writing. For each exercise, use the MOST RECENT weight logged.
- Exercise not in history → assign smart starter weights relative to the user's body weight and goal.
- Always use correct exerciseId from the exercise list. Be exact with kg values.
- Execute the tool call. No explanation needed — the Superior Agent handles communication.

HISTORY:
${workoutContext}`),
          ...state.messages.filter(m => !(m instanceof AIMessage && m.content.toString().includes("DELEGATE_TO_CRUD")))
        ]);
        return { messages: [response] };
      };

      const searchAgent = async (state: typeof StateAnnotation.State) => {
        const searchModel = model.bindTools([tavilySearchTool]);
        const response = await searchModel.invoke([
          new SystemMessage(`You are the Search Agent. Find the answer, return it clean.
Use tavily_search with a precise query. Return only what's directly relevant to the user's question.
User goal context: ${profile?.goal || 'General fitness'}. Tailor what you pull back to that context.
No padding, no filler — the Superior Agent will handle the final response to the user.`),
          ...state.messages.filter(m => !(m instanceof AIMessage && m.content.toString().includes("DELEGATE_TO_SEARCH")))
        ]);
        return { messages: [response] };
      };

      const toolNode = async (state: typeof StateAnnotation.State) => {
        const lastMsg = state.messages[state.messages.length - 1];
        const results = [];
        for (const call of lastMsg.tool_calls || []) {
          const t = [createRoutineTool, updateRoutineTool, deleteRoutineTool, updateProfileTool, tavilySearchTool].find(x => x.name === call.name);
          if (t) results.push(await t.invoke(call));
        }
        return { messages: results };
      };

      // 4. Graph Construction
      const workflow = new StateGraph(StateAnnotation)
        .addNode("superior", superiorAgent)
        .addNode("crud", crudAgent)
        .addNode("search", searchAgent)
        .addNode("tools", toolNode)
        .addEdge("__start__", "superior")
        .addConditionalEdges("superior", (state) => {
          const content = state.messages[state.messages.length - 1].content.toString();
          if (content.includes("DELEGATE_TO_CRUD")) return "crud";
          if (content.includes("DELEGATE_TO_SEARCH")) return "search";
          return "__end__";
        })
        .addConditionalEdges("crud", (state) => state.messages[state.messages.length - 1].tool_calls?.length ? "tools" : "__end__")
        .addConditionalEdges("search", (state) => state.messages[state.messages.length - 1].tool_calls?.length ? "tools" : "__end__")
        .addEdge("tools", "superior");

      const app = workflow.compile();

      // 5. Execute with Streaming
      const history = [
        new SystemMessage(systemInstruction),
        ...messages.slice(-8).map(m => m.role === 'bot' ? new AIMessage(m.text) : new HumanMessage(m.text)),
        new HumanMessage(userMsg)
      ];

      let finalContent = "";
      const eventStream = app.streamEvents({ messages: history }, { version: "v2" });

      for await (const event of eventStream) {
        if (event.event === "on_chat_model_stream" && event.tags?.includes("superior_response")) {
          const chunk = event.data.chunk.content;
          if (chunk) {
            const potential = finalContent + chunk;
            if (potential.includes("DELEGATE_TO_")) {
              finalContent = potential;
              continue;
            }
            finalContent = potential;
            setMessages(prev => {
              const last = prev[prev.length - 1];
              // Use startTime to ensure we update the correct "new" bot message
              if (last && last.role === 'bot' && last.timestamp.getTime() >= startTime) {
                const newMsgs = [...prev];
                newMsgs[newMsgs.length - 1] = { ...last, text: finalContent };
                return newMsgs;
              }
              return [...prev, { role: 'bot', text: finalContent, timestamp: new Date(startTime) }];
            });
          }
        } else if (event.event === "on_chain_end" && event.name === "LangGraph") {
          const finalState = event.data.output;
          const lastMsg = finalState.messages[finalState.messages.length - 1];
          finalContent = lastMsg.content.toString();
        }
      }

      if (convId) await saveMessage('bot', finalContent, convId);

      if (messages.length + 2 > MESSAGE_LIMIT) {
        summarizeConversation([...messages, newMsg, { role: 'bot', text: finalContent, timestamp: new Date() }]);
      }
    } catch (e: any) {
      console.error("Coach Error:", e);
      setMessages(prev => [...prev, { role: 'bot', text: `Coach Error: ${e.message}`, timestamp: new Date() }]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className={cn(
      "flex flex-col h-full relative transition-colors duration-300",
      chatTheme === 'light' ? "bg-white text-zinc-900" : "bg-black text-white"
    )}>
      <header className={cn(
        "flex items-center justify-between p-4 rounded-3xl border transition-colors mx-4 mt-4 mb-2",
        chatTheme === 'light' ? "bg-zinc-50 border-zinc-200" : "bg-zinc-900/50 border-zinc-800"
      )}>
        <div className="flex items-center space-x-3">
          <div className={cn(
            "p-2 rounded-2xl",
            chatTheme === 'light' ? "bg-zinc-200" : "bg-zinc-800"
          )}>
            <Brain className="w-5 h-5 text-lime-400" />
          </div>
          <div>
            <h2 className="font-bold text-sm tracking-tight">Coach FitAI</h2>
            <div className="flex items-center space-x-1">
              <div className="w-1.5 h-1.5 rounded-full bg-lime-500 animate-pulse" />
              <span className="text-[10px] uppercase tracking-widest opacity-50 font-medium">Neural Engine Active (v1.1)</span>
            </div>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setChatTheme(prev => prev === 'dark' ? 'light' : 'dark')}
            className={cn(
              "p-2 rounded-full transition-colors",
              chatTheme === 'light' ? "bg-zinc-200 text-zinc-600" : "bg-zinc-800 text-zinc-400"
            )}
            title="Toggle Theme"
          >
            {chatTheme === 'light' ? <Moon className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
          </button>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className={cn(
              "p-2 rounded-full transition-colors",
              showHistory ? "bg-[#CCFF00] text-black" : (chatTheme === 'light' ? "bg-zinc-200 text-zinc-600" : "bg-zinc-800 text-zinc-400")
            )}
            title="Chat History"
          >
            <History className="w-5 h-5" />
          </button>
          <button
            onClick={startNewChat}
            className={cn(
              "p-2 rounded-full transition-colors",
              chatTheme === 'light' ? "bg-zinc-200 text-zinc-600" : "bg-zinc-800 text-zinc-400"
            )}
            title="New Chat"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
      </header>

      <AnimatePresence>
        {showHistory && (
          <motion.div
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 50 }}
            className="absolute inset-0 z-50 bg-black/95 backdrop-blur-md p-4 rounded-3xl"
          >
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-sm font-bold uppercase tracking-widest text-[#CCFF00]">Chat History</h3>
              <button onClick={() => setShowHistory(false)} className="text-zinc-500 hover:text-white">
                <ChevronLeft className="w-6 h-6 rotate-180" />
              </button>
            </div>
            <div className="space-y-3 overflow-y-auto max-h-[70%] no-scrollbar px-1">
              <button
                onClick={startNewChat}
                className="w-full flex items-center space-x-3 p-4 rounded-2xl bg-[#CCFF00]/10 border border-[#CCFF00]/20 text-[#CCFF00] font-bold text-sm"
              >
                <Plus className="w-4 h-4" />
                <span>Start New Conversation</span>
              </button>
              {conversations.length === 0 ? (
                <div className="text-center py-12 text-zinc-600">
                  <Clock className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p className="text-xs">No past conversations yet</p>
                </div>
              ) : (
                conversations.map(conv => (
                  <button
                    key={conv.id}
                    onClick={() => {
                      setCurrentConversationId(conv.id);
                      setShowHistory(false);
                    }}
                    className={cn(
                      "w-full text-left p-4 rounded-2xl border transition-all",
                      currentConversationId === conv.id
                        ? "bg-[#CCFF00] border-[#CCFF00] text-black"
                        : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold truncate pr-2">{conv.title}</span>
                      <span className="text-[8px] opacity-60 font-mono">
                        {conv.updatedAt?.seconds ? format(new Date(conv.updatedAt.seconds * 1000), 'MMM d') : 'Recent'}
                      </span>
                    </div>
                    <p className={cn(
                      "text-[10px] truncate",
                      currentConversationId === conv.id ? "text-black/70" : "text-zinc-600"
                    )}>
                      {conv.lastMessage}
                    </p>
                  </button>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 overflow-y-auto space-y-6 scroll-smooth px-4 pt-2 pb-40 no-scrollbar">
        {isLoadingHistory && (
          <div className="text-center p-8">
            <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 2, ease: "linear" }}>
              <Brain className="w-8 h-8 text-[#CCFF00] mx-auto opacity-50" />
            </motion.div>
            <p className="text-[10px] text-zinc-500 uppercase font-mono mt-4 tracking-widest">Accessing Neural Patterns...</p>
          </div>
        )}

        <AnimatePresence mode="popLayout" initial={false}>
          {messages.map((m, i) => (
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              key={i}
              className={cn(
                "p-4 rounded-3xl text-sm shadow-md",
                m.role === 'user'
                  ? cn("max-w-[85%] ml-auto rounded-tr-none", chatTheme === 'light' ? "bg-[#CCFF00] text-black border border-[#CCFF00]/20" : "bg-zinc-800 text-white border border-zinc-700 shadow-white/5")
                  : cn("max-w-full rounded-tl-none", chatTheme === 'light' ? "bg-zinc-900 text-white border border-zinc-800" : "bg-[#1A1A1A] text-white border border-zinc-800 shadow-lg shadow-black/20")
              )}
            >
              <div className={cn(
                "prose prose-sm max-w-none overflow-x-auto",
                "prose-headings:font-bold prose-headings:mt-3 prose-headings:mb-1",
                "prose-p:leading-relaxed prose-p:my-1",
                "prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5",
                "prose-table:text-xs prose-table:w-full prose-th:px-3 prose-th:py-1.5 prose-th:border prose-th:border-zinc-700 prose-td:px-3 prose-td:py-1.5 prose-td:border prose-td:border-zinc-700",
                "prose-blockquote:border-l-2 prose-blockquote:border-[#CCFF00] prose-blockquote:pl-3 prose-blockquote:italic prose-blockquote:my-2",
                "prose-code:text-[#CCFF00] prose-code:bg-zinc-800/50 prose-code:px-1 prose-code:rounded prose-code:text-xs",
                "prose-strong:font-bold",
                m.role === 'bot' ? "prose-invert" : (chatTheme === 'light' ? "text-black prose-p:text-black prose-headings:text-black prose-strong:text-black prose-code:text-black prose-code:bg-black/10" : "text-white prose-invert")
              )}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {isTyping && (
          <div className="flex flex-col space-y-2 p-4">
            <div className="flex items-center space-x-4">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                className={cn(
                  "p-2 rounded-xl",
                  chatTheme === 'light' ? "bg-zinc-100 border border-zinc-200 shadow-sm" : "bg-zinc-900 border border-zinc-800"
                )}
              >
                <Dumbbell className={cn("w-5 h-5", chatTheme === 'light' ? "text-zinc-600" : "text-[#CCFF00]")} />
              </motion.div>
              <div className="space-y-1">
                <div className="flex space-x-1">
                  <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1 }} className="w-1.5 h-1.5 bg-[#CCFF00] rounded-full" />
                  <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-1.5 h-1.5 bg-[#CCFF00] rounded-full" />
                  <motion.div animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-1.5 h-1.5 bg-[#CCFF00] rounded-full" />
                </div>
                <div className="text-[10px] font-mono opacity-50 uppercase tracking-widest">
                  Processing... {responseTimer}s
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="fixed bottom-20 left-0 right-0 px-4 pb-2 z-50" style={{ background: chatTheme === 'light' ? 'white' : 'black' }}>
        <div className="relative flex items-center max-w-2xl mx-auto shadow-2xl">
          <input
            type="text"
            placeholder="Plan a leg day split..."
            className={cn(
              "w-full rounded-2xl py-4 pl-4 pr-28 focus:outline-none transition-all border",
              chatTheme === 'light'
                ? "bg-white border-zinc-200 text-black focus:border-[#CCFF00]"
                : "bg-[#1A1A1A] border-zinc-800 text-white focus:border-[#CCFF00]"
            )}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && askAI()}
          />
          <div className="absolute right-3 flex items-center space-x-1">
            <button
              onClick={toggleListening}
              className={cn(
                "p-2 rounded-lg transition-all duration-300",
                isRecording 
                  ? "bg-red-500 text-white shadow-lg shadow-red-500/40 scale-110 animate-pulse" 
                  : (chatTheme === 'light' ? "text-zinc-400 hover:text-black" : "text-zinc-500 hover:text-white")
              )}
            >
              <Mic className={cn("w-5 h-5", isRecording && "animate-bounce")} />
            </button>
            <button
              onClick={askAI}
              disabled={!prompt.trim() || isTyping}
              className="p-2 bg-[#CCFF00] text-black rounded-xl disabled:opacity-50 shadow-lg shadow-[#CCFF00]/10 hover:scale-105 active:scale-95 transition-all"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Main App ---

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
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
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'dash' | 'ai' | 'routines' | 'profile'>('dash');
  const [isLogging, setIsLogging] = useState(false);
  const [editingRoutine, setEditingRoutine] = useState<Routine | null | 'new'>(null);
  const [activeRoutine, setActiveRoutine] = useState<Routine | null>(null);
  const [workouts, setWorkouts] = useState<WorkoutLog[]>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);

  // Back button + floating workout bubble state
  const [isWorkoutMinimized, setIsWorkoutMinimized] = useState(false);
  const [workoutStartTime, setWorkoutStartTime] = useState<number | null>(null);
  const [workoutElapsed, setWorkoutElapsed] = useState(0);
  const [profileForceExit, setProfileForceExit] = useState(0);
  const [profileIsEditing, setProfileIsEditing] = useState(false);

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
      if (activeTabRef.current !== 'dash') {
        setActiveTab('dash');
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
    testFirestoreConnection();
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const profileRef = doc(db, 'users', u.uid);
        const snap = await getDoc(profileRef);
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
          setProfile(newProfile as UserProfile);
        }
        fetchWorkouts(u.uid);
        fetchRoutines(u.uid);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const fetchWorkouts = async (uid: string) => {
    const q = query(
      collection(db, 'workouts'),
      where('userId', '==', uid),
      orderBy('date', 'desc'),
      limit(10)
    );
    const snap = await getDocs(q);
    setWorkouts(snap.docs.map(d => ({ id: d.id, ...d.data() } as WorkoutLog)));
  };

  const fetchRoutines = async (uid: string) => {
    const q = query(
      collection(db, 'routines'),
      where('userId', '==', uid),
      orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    setRoutines(snap.docs.map(d => ({ id: d.id, ...d.data() } as Routine)));
  };

  const saveRoutine = async (data: Partial<Routine>) => {
    if (!user) return;
    try {
      if (editingRoutine && editingRoutine !== 'new' && editingRoutine.id) {
        // Update existing
        await setDoc(doc(db, 'routines', editingRoutine.id), {
          ...data,
          userId: user.uid,
          updatedAt: serverTimestamp(),
          createdAt: editingRoutine.createdAt // Keep original
        }, { merge: true });
      } else {
        // Create new
        await addDoc(collection(db, 'routines'), {
          ...data,
          userId: user.uid,
          createdAt: serverTimestamp()
        });
      }
      setEditingRoutine(null);
      fetchRoutines(user.uid);
    } catch (e) {
      console.error(e);
    }
  };

  const deleteRoutine = async (id: string) => {
    if (!user) return;
    try {
      console.log('Attempting to delete routine:', id);
      await deleteDoc(doc(db, 'routines', id));
      console.log('Successfully deleted routine:', id);
      fetchRoutines(user.uid);
    } catch (e) {
      console.error('Error deleting routine:', e);
    }
  };

  const signIn = async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  const connectGoogleSheets = async () => {
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
    await signOut(auth);
    setProfile(null);
  };

  const updateProfile = async (data: Partial<UserProfile>) => {
    if (!user) return;
    try {
      const profileRef = doc(db, 'users', user.uid);
      await setDoc(profileRef, data, { merge: true });
      setProfile(prev => prev ? { ...prev, ...data } : null);
    } catch (e) {
      console.error(e);
    }
  };

  const aiCreateRoutine = async (data: any) => {
    if (!user) return;
    try {
      const docRef = await addDoc(collection(db, 'routines'), {
        ...data,
        userId: user.uid,
        createdAt: serverTimestamp()
      });
      fetchRoutines(user.uid);
      return { id: docRef.id, success: true };
    } catch (e) {
      console.error(e);
      throw e;
    }
  };

  const aiUpdateRoutine = async (id: string, data: any) => {
    if (!user) return;
    try {
      // Remove id from data to avoid saving it as a field
      const { id: _, ...updateData } = data;
      await setDoc(doc(db, 'routines', id), {
        ...updateData,
        userId: user.uid,
        updatedAt: serverTimestamp()
      }, { merge: true });
      fetchRoutines(user.uid);
      return { success: true };
    } catch (e) {
      console.error(e);
      throw e;
    }
  };

  const aiDeleteRoutine = async (id: string) => {
    if (!user) return;
    try {
      await deleteDoc(doc(db, 'routines', id));
      fetchRoutines(user.uid);
      return { success: true };
    } catch (e) {
      console.error(e);
      throw e;
    }
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
    signIn,
    signOutUser,
    sheets: sheetsContextValue,
    updateProfile
  };

  if (!user) return (
    <AuthContext.Provider value={contextValue}>
      <LoginScreen />
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
              onComplete={() => {
                setIsLogging(false);
                setIsWorkoutMinimized(false);
                setActiveRoutine(null);
                setWorkoutStartTime(null);
                fetchWorkouts(user.uid);
              }}
              onCancel={() => {
                setIsLogging(false);
                setIsWorkoutMinimized(false);
                setActiveRoutine(null);
                setWorkoutStartTime(null);
              }}
            />
          </div>
        )}

        {/* Normal tab content: shown when not logging OR when minimized */}
        {(!isLogging || isWorkoutMinimized) && (
          <div className="min-h-screen bg-[#0A0A0A] text-white">
            <main className={cn("h-[calc(100vh-5rem)]", activeTab === 'ai' ? 'overflow-hidden' : 'overflow-y-auto pb-20')}>
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.2 }}
                  className={activeTab === 'ai' ? 'h-full' : 'p-6'}
                >
                  {activeTab === 'dash' && <Dashboard workouts={workouts} profile={profile} onUpdateProfile={updateProfile} />}
                  {activeTab === 'ai' && (
                    <AIAssistant
                      workouts={workouts}
                      profile={profile}
                      routines={routines}
                      onCreateRoutine={aiCreateRoutine}
                      onUpdateRoutine={aiUpdateRoutine}
                      onDeleteRoutine={aiDeleteRoutine}
                      onUpdateProfile={updateProfile}
                    />
                  )}
                  {activeTab === 'routines' && (
                    <RoutinesManager
                      routines={routines}
                      onStart={(r) => { setActiveRoutine(r); setIsLogging(true); setIsWorkoutMinimized(false); setWorkoutStartTime(Date.now()); }}
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
                      forceExitEdit={profileForceExit}
                      onEditModeChange={setProfileIsEditing}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </main>

            <nav className="fixed bottom-0 left-0 right-0 bg-[#0A0A0A]/80 backdrop-blur-xl border-t border-zinc-800 px-6 py-4 pb-8 flex items-center justify-between z-40">
              {[
                { id: 'dash', icon: History, label: 'Stats' },
                { id: 'routines', icon: Library, label: 'Library' },
                { id: 'ai', icon: Brain, label: 'Coach' },
                { id: 'profile', icon: UserIcon, label: 'Me' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={cn(
                    "flex flex-col items-center space-y-1 transition-all flex-1 relative",
                    activeTab === tab.id ? "text-[#CCFF00]" : "text-zinc-500"
                  )}
                >
                  {/* Floating workout bubble — above the Me icon */}
                  {tab.id === 'profile' && isWorkoutMinimized && isLogging && (
                    <motion.div
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      onClick={(e) => { e.stopPropagation(); setIsWorkoutMinimized(false); }}
                      className="absolute -top-14 left-1/2 -translate-x-1/2 z-50"
                    >
                      <div className="relative">
                        {/* Pulsing ring */}
                        <motion.div
                          animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0, 0.5] }}
                          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                          className="absolute inset-0 rounded-full bg-[#CCFF00]/30"
                        />
                        {/* Bubble body */}
                        <div className="w-12 h-12 rounded-full bg-[#CCFF00] flex items-center justify-center shadow-lg shadow-[#CCFF00]/30 border-2 border-[#CCFF00]/50">
                          <div className="text-center">
                            <Dumbbell className="w-4 h-4 text-black mx-auto" />
                            <span className="text-[7px] font-mono font-bold text-black leading-none">
                              {formatBubbleTime(workoutElapsed)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                  <tab.icon className={cn("w-6 h-6", activeTab === tab.id && "fill-current")} />
                  <span className="text-[10px] font-mono uppercase tracking-widest">{tab.label}</span>
                </button>
              ))}
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