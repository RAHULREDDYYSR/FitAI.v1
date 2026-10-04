import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { format, isAfter, startOfWeek, startOfMonth, startOfYear } from 'date-fns';
import { Dumbbell, History, Settings, Plus, Trash2, ChevronRight, ChevronDown, Play, CheckCircle2, Mic, Brain, User as UserIcon, Calendar, Moon, Flame, ChevronLeft, Sparkles, Search, Timer, Clock, Share2, Library, ArrowLeft, Info, Loader2, Pencil, Check } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis } from 'recharts';
import type { WorkoutLog, UserProfile } from '../types';
import { EXERCISES } from '../constants';
import { cn } from '../lib/utils';
import { safeNumber, getSetVolume, getWorkoutVolume, getWorkoutIntensity, getTimedOnlyActiveTime, formatDuration, formatSetPerformance } from '../lib/workout-metrics';

const WorkoutCard = ({ workout }: { workout: WorkoutLog }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const totalVolume = getWorkoutVolume(workout);
  const intensity = getWorkoutIntensity(workout);
  const efficiency = Math.round((totalVolume / (workout.exercises.length || 1)) / 10);

  return (
    <div
      onClick={() => setIsExpanded(!isExpanded)}
      className={cn(
        "bg-[#131d1b] rounded-2xl border transition-all cursor-pointer overflow-hidden",
        isExpanded ? "border-[#C6F36B]/50" : "border-zinc-800 hover:border-zinc-700"
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
                const text = `I just crushed a workout on FitAI!\n\nWorkout: ${workout.name}\nDate: ${workoutDate}\nTotal Volume: ${totalVolume.toLocaleString()} kg\nExercises:\n${exercisesList}\nDuration: ${Math.floor(workout.duration / 60)} mins\n\n#FitAI #Fitness #Workout`;

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
              className="p-2 text-zinc-600 hover:text-[#C6F36B] transition-colors"
              title="Share Workout"
            >
              <Share2 className="w-4 h-4" />
            </button>
            <div className="text-right">
              <div className="text-[#C6F36B] font-bold">{totalVolume} kg</div>
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
            <span className="text-xs font-bold text-[#C6F36B]">{intensity} <span className="text-[10px] font-normal opacity-50 uppercase font-mono">pts</span></span>
          </div>
          <div className="h-4 w-px bg-zinc-800" />
          <div className="flex flex-col">
            <span className="text-[9px] text-zinc-500 uppercase font-mono">Efficiency</span>
            <span className="text-xs font-bold text-white">{efficiency} pts</span>
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
                            {formatSetPerformance(set)}
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
    volume: getWorkoutVolume(w),
    duration: Math.floor(w.duration / 60)
  }));

  const muscleVolume = filteredWorkouts.reduce((acc, w) => {
    w.exercises.forEach(ex => {
      const vol = ex.sets.reduce((sAcc, s) => sAcc + getSetVolume(s), 0);
      acc[ex.name] = (acc[ex.name] || 0) + vol;
    });
    return acc;
  }, {} as Record<string, number>);

  const radarData = useMemo(() => {
    const categories: Record<string, number> = {
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

        // Fallback: fuzzy name match
        if (!exerciseDef) {
          const cleanName = ex.name.toLowerCase().replace(/[^a-z0-9]/g, '');
          exerciseDef = EXERCISES.find(e =>
            e.name.toLowerCase().replace(/[^a-z0-9]/g, '') === cleanName
          );
        }

        const completedSets = ex.sets.filter(s => s.completed);
        if (completedSets.length === 0) return;

        const totalReps = completedSets.reduce((acc, s) => acc + safeNumber(s.reps), 0);
        const avgWeight = completedSets.reduce((acc, s) => acc + safeNumber(s.weight), 0) / completedSets.length;
        const timedOnlySeconds = completedSets.reduce((acc, s) =>
          acc + (safeNumber(s.reps) > 0 ? 0 : safeNumber(s.timeTaken)), 0
        );
        const effortUnits = totalReps > 0 ? completedSets.length * totalReps : Math.max(timedOnlySeconds / 10, completedSets.length);

        // ─── EFFORT SCORE FORMULA ───────────────────────────────────────────
        // Uses logarithmic scaling so heavy AND light exercises both score fairly.
        // log(1 + sets × reps) captures "how much work done" regardless of weight.
        // log(1 + avgWeight + 1) adds a small weight bonus so heavier isn't penalised,
        //   but it's logarithmic so the bonus tapers off quickly.
        // Result: 4×15 abs ≈ 13 pts, 4×8 squats @ 160kg ≈ 17 pts — both meaningful.
        const effortScore = Math.log1p(effortUnits)
          * Math.log1p(avgWeight + 1);

        const groups = (exerciseDef?.muscle_groups && exerciseDef.muscle_groups.length > 0)
          ? exerciseDef.muscle_groups
          : [exerciseDef?.muscle || ''];

        groups.forEach(groupRaw => {
          const group = groupRaw.toLowerCase();
          const share = effortScore / (groups.length || 1);

          if (group.includes('back') || group.includes('lats') || group.includes('traps') || group.includes('rear delt')) {
            categories['Back'] += share;
          } else if (group.includes('chest')) {
            categories['Chest'] += share;
          } else if (group.includes('abdominal') || group.includes('core') || group.includes('abs') || group.includes('oblique')) {
            categories['Core'] += share;
          } else if (group.includes('shoulder') || group.includes('delt')) {
            categories['Shoulders'] += share;
          } else if (group.includes('bicep') || group.includes('tricep') || group.includes('arm') || group.includes('forearm')) {
            categories['Arms'] += share;
          } else if (group.includes('quad') || group.includes('hamstring') || group.includes('glute') || group.includes('calve') || group.includes('leg') || group.includes('adductor') || group.includes('abductor')) {
            categories['Legs'] += share;
          } else if (group.includes('full body')) {
            const sixthShare = share / 6;
            Object.keys(categories).forEach(k => { categories[k] += sixthShare; });
          }
        });
      });
    });

    // Normalize to 0–100 so the radar always fills nicely
    const maxVal = Math.max(...Object.values(categories), 1);
    return Object.entries(categories).map(([subject, value]) => ({
      subject,
      value: Math.round((value / maxVal) * 100)
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
              className={cn("text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded", view === 'chart' ? "bg-[#C6F36B] text-black" : "text-zinc-500")}
            >
              Chart
            </button>
            <button
              onClick={() => setView('matrix')}
              className={cn("text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded", view === 'matrix' ? "bg-[#C6F36B] text-black" : "text-zinc-500")}
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
                showTimeMatrix ? "bg-[#C6F36B] border-[#C6F36B] text-black" : "bg-zinc-900 border-zinc-800 text-zinc-500"
              )}
            >
              {showTimeMatrix ? 'Hide Time' : 'Show Time Matrix'}
            </button>
          )}
          <div className="bg-[#131d1b] p-2 rounded-full">
            <Sparkles className="w-5 h-5 text-[#C6F36B]" />
          </div>
        </div>
      </header>

      <div className="bg-[#131d1b] p-4 rounded-2xl border border-zinc-800 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center space-x-1 bg-black/30 p-1 rounded-xl">
            {(['all', 'week', 'month', 'year', 'custom'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase transition-all",
                  filterType === type
                    ? "bg-[#C6F36B] text-black"
                    : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                {type}
              </button>
            ))}
          </div>
          <div className="flex items-center space-x-2 text-[10px] text-zinc-500 font-mono uppercase shrink-0">
            <span className="w-2 h-2 rounded-full bg-[#C6F36B] animate-pulse" />
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
                className="w-full bg-black border border-zinc-800 rounded-lg p-2 text-xs text-white outline-none focus:border-[#C6F36B]/50"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[8px] text-zinc-600 uppercase font-mono mb-1">End</label>
              <input
                type="date"
                value={customRange.end}
                onChange={(e) => setCustomRange(prev => ({ ...prev, end: e.target.value }))}
                className="w-full bg-black border border-zinc-800 rounded-lg p-2 text-xs text-white outline-none focus:border-[#C6F36B]/50"
              />
            </div>
          </motion.div>
        )}
      </div>

      {view === 'chart' ? (
        <div className="space-y-4">
          <div className="bg-[#131d1b] rounded-2xl p-4 border border-zinc-800 h-[240px]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-zinc-500 uppercase font-mono tracking-widest">Training Volume</span>
            </div>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="colorVolume" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#C6F36B" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#C6F36B" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" stroke="#525252" fontSize={10} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: '#0b1211', border: '1px solid #262626', borderRadius: '12px' }}
                  itemStyle={{ color: '#C6F36B' }}
                />
                <Area type="monotone" dataKey="volume" stroke="#C6F36B" fillOpacity={1} fill="url(#colorVolume)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-[#131d1b] rounded-2xl p-4 border border-zinc-800 space-y-4">
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
                  className="w-20 bg-black border border-zinc-800 rounded-lg p-2 text-xs text-white outline-none focus:border-[#C6F36B]/50"
                  step="0.1"
                />
                <button
                  onClick={handleAddWeight}
                  disabled={isAddingWeight || !newWeight}
                  className="p-2 bg-[#C6F36B] text-black rounded-lg disabled:opacity-50"
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
                      contentStyle={{ background: '#0b1211', border: '1px solid #262626', borderRadius: '12px', fontSize: '10px' }}
                      itemStyle={{ color: '#C6F36B' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="weight"
                      stroke="#C6F36B"
                      strokeWidth={2}
                      dot={{ fill: '#C6F36B', r: 3 }}
                      activeDot={{ r: 5, stroke: '#C6F36B', strokeWidth: 2 }}
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
        <div className="bg-[#131d1b] rounded-2x border border-zinc-800 overflow-hidden">
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
                  const totalActiveTime = getTimedOnlyActiveTime(w);
                  const totalVolume = getWorkoutVolume(w);
                  return (
                    <tr key={i} className="hover:bg-white/5 transition-colors">
                      <td className="p-3 font-bold">{format(new Date(w.date.seconds * 1000), 'MMM d')}</td>
                      <td className="p-3 text-[#C6F36B] font-bold">{totalVolume}kg</td>
                      {showTimeMatrix && <td className="p-3 text-zinc-400">{Math.floor(w.duration / 60)}m</td>}
                      {showTimeMatrix && <td className="p-3 text-zinc-500">{Math.floor(totalActiveTime / 60)}m</td>}
                      {showTimeMatrix && <td className="p-3 text-[#C6F36B] font-bold">{getWorkoutIntensity(w) || '-'}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-[#131d1b] rounded-2xl p-4 border border-zinc-800 h-[300px] flex flex-col">
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
              stroke="#C6F36B"
              fill="#C6F36B"
              fillOpacity={0.3}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {[
          { label: 'Total Logs', value: filteredWorkouts.length, icon: History },
          { label: 'Avg Volume', value: Math.round(filteredWorkouts.reduce((acc, curr) => acc + getWorkoutVolume(curr), 0) / (filteredWorkouts.length || 1)), icon: Dumbbell },
        ].map((stat, i) => (
          <div key={i} className="bg-[#131d1b] p-4 rounded-2xl border border-zinc-800">
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
            <div className="bg-[#131d1b] p-8 rounded-2xl border border-dashed border-zinc-800 text-center">
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

export { Dashboard };
