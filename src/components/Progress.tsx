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
        "bg-surface rounded-2xl border transition-all cursor-pointer overflow-hidden",
        isExpanded ? "border-accent/50" : "border-border hover:border-accent/50"
      )}
    >
      <div className="p-5 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <button type="button" aria-expanded={isExpanded} aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${workout.name} workout details`} onClick={event => { event.stopPropagation(); setIsExpanded(!isExpanded); }} className="text-lg font-bold tracking-tight text-left">{workout.name}</button>
            <div className="text-xs text-muted font-mono italic">
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
              className="p-2 text-subtle hover:text-accent transition-colors"
              title="Share Workout"
            >
              <Share2 className="w-4 h-4" />
            </button>
            <div className="text-right">
              <div className="text-accent font-bold">{totalVolume} kg</div>
              <div className="text-[10px] text-muted font-mono">{Math.floor(workout.duration / 60)} mins</div>
            </div>
            {isExpanded ? (
              <ChevronDown className="w-5 h-5 text-subtle" />
            ) : (
              <ChevronRight className="w-5 h-5 text-subtle" />
            )}
          </div>
        </div>

        <div className="flex items-center space-x-4 py-2 border-y border-border/30">
          <div className="flex flex-col">
            <span className="text-[9px] text-muted uppercase font-mono">Intensity Score</span>
            <span className="text-xs font-bold text-accent">{intensity} <span className="text-[10px] font-normal opacity-50 uppercase font-mono">pts</span></span>
          </div>
          <div className="h-4 w-px bg-surface-hover" />
          <div className="flex flex-col">
            <span className="text-[9px] text-muted uppercase font-mono">Efficiency</span>
            <span className="text-xs font-bold text-fg">{efficiency} pts</span>
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
              <div className="space-y-4 pt-4 border-t border-border/30 mt-2">
                {workout.exercises.map((ex, exIdx) => (
                  <div key={exIdx} className="space-y-3">
                    <div className="text-xs font-bold text-fg-soft flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <span>{ex.name}</span>
                      </div>
                      <span className="text-[10px] text-muted font-mono bg-surface-hover px-2 py-0.5 rounded-full">
                        {ex.sets.length} {ex.sets.length === 1 ? 'Set' : 'Sets'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {ex.sets.map((set, sIdx) => (
                        <div key={sIdx} className="bg-surface-raised/50 border border-border p-2 rounded-lg flex flex-col justify-center">
                          <span className="text-[9px] font-mono text-subtle uppercase tracking-tighter">Set {sIdx + 1}</span>
                          <span className="text-xs font-bold text-muted">
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

const Dashboard = ({ workouts, profile, onUpdateProfile, historyComplete = true, loadingMore = false, onLoadMore }: {
  workouts: WorkoutLog[],
  profile: UserProfile | null,
  onUpdateProfile: (data: Partial<UserProfile>) => Promise<any>,
  historyComplete?: boolean,
  loadingMore?: boolean,
  onLoadMore?: () => Promise<void>
}) => {
  const [view, setView] = useState<'chart' | 'matrix'>('chart');
  const [showTimeMatrix, setShowTimeMatrix] = useState(false);
  const [filterType, setFilterType] = useState<'week' | 'month' | 'year' | 'custom' | 'all'>('all');
  const [customRange, setCustomRange] = useState({ start: '', end: '' });
  const [newWeight, setNewWeight] = useState('');
  const [isAddingWeight, setIsAddingWeight] = useState(false);
  const [weightError, setWeightError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const parsedWeight = newWeight.trim() ? Number(newWeight) : NaN;
  const validWeight = Number.isFinite(parsedWeight) && parsedWeight >= 20 && parsedWeight <= 500;

  const loadMoreHistory = async () => {
    if (!onLoadMore || loadingMore) return;
    setHistoryError('');
    try { await onLoadMore(); }
    catch { setHistoryError('Older sessions could not load. Check your connection and retry.'); }
  };

  const weightData = useMemo(() => {
    if (!profile?.weightHistory) return [];

    const now = new Date();
    return profile.weightHistory.filter(wh => {
      const date = new Date(wh.date);
      if (filterType === 'all') return true;
      if (filterType === 'week') return date >= startOfWeek(now);
      if (filterType === 'month') return date >= startOfMonth(now);
      if (filterType === 'year') return date >= startOfYear(now);
      if (filterType === 'custom') {
        const start = customRange.start ? new Date(`${customRange.start}T00:00:00`) : new Date(0);
        const end = customRange.end ? new Date(`${customRange.end}T00:00:00`) : new Date();
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
    if (!validWeight || isAddingWeight) return;
    setIsAddingWeight(true);
    setWeightError('');
    try {
      const weight = parsedWeight;
      const today = new Date().toISOString();
      const newHistory = [...(profile?.weightHistory || []), { date: today, weight }];
      await onUpdateProfile({
        weight,
        weightHistory: newHistory
      });
      setNewWeight('');
    } catch {
      setWeightError('Your weight could not be saved. Check your connection and retry.');
    } finally {
      setIsAddingWeight(false);
    }
  };

  const filteredWorkouts = useMemo(() => {
    const now = new Date();
    return workouts.filter(w => {
      const workoutDate = new Date(w.date.seconds * 1000);

      if (filterType === 'all') return true;
      if (filterType === 'week') return workoutDate >= startOfWeek(now);
      if (filterType === 'month') return workoutDate >= startOfMonth(now);
      if (filterType === 'year') return workoutDate >= startOfYear(now);
      if (filterType === 'custom') {
        const start = customRange.start ? new Date(`${customRange.start}T00:00:00`) : new Date(0);
        const end = customRange.end ? new Date(`${customRange.end}T00:00:00`) : new Date();
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
              aria-pressed={view === 'chart'}
              className={cn("min-h-11 min-w-11 text-[10px] font-mono uppercase tracking-widest px-3 py-2 rounded-xl", view === 'chart' ? "bg-accent text-on-accent" : "text-muted")}
            >
              Chart
            </button>
            <button
              onClick={() => setView('matrix')}
              aria-pressed={view === 'matrix'}
              className={cn("min-h-11 min-w-11 text-[10px] font-mono uppercase tracking-widest px-3 py-2 rounded-xl", view === 'matrix' ? "bg-accent text-on-accent" : "text-muted")}
            >
              Matrix
            </button>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          {view === 'matrix' && (
            <button
              onClick={() => setShowTimeMatrix(!showTimeMatrix)}
              aria-pressed={showTimeMatrix}
              className={cn(
                "min-h-11 px-3 py-2 rounded-full text-[10px] font-bold transition-all border",
                showTimeMatrix ? "bg-accent border-accent text-on-accent" : "bg-surface-raised border-border text-muted"
              )}
            >
              {showTimeMatrix ? 'Hide Time' : 'Show Time Matrix'}
            </button>
          )}
          <div className="bg-surface p-2 rounded-full">
            <Sparkles className="w-5 h-5 text-accent" />
          </div>
        </div>
      </header>

      {!historyComplete && <section className="bg-surface-raised p-4 rounded-2xl border border-accent/25 space-y-3" aria-label="Workout history status">
        <p className="text-sm text-fg-soft">Showing {workouts.length} loaded sessions. Date filters and charts cover this loaded history; older sessions have not loaded yet.</p>
        {historyError && <p className="inline-error" role="alert">{historyError}</p>}
        {onLoadMore && <button type="button" className="secondary-button min-h-11 w-full sm:w-auto" onClick={loadMoreHistory} disabled={loadingMore}>
          {loadingMore ? 'Loading older sessions…' : 'Load older sessions'}
        </button>}
      </section>}

      <div className="bg-surface p-4 rounded-2xl border border-border space-y-4 min-w-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1 bg-surface/50 p-1 rounded-xl max-w-full overflow-x-auto">
            {(['all', 'week', 'month', 'year', 'custom'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                aria-pressed={filterType === type}
                className={cn(
                  "shrink-0 min-h-11 px-3 py-2 rounded-lg text-[10px] font-bold uppercase transition-all",
                  filterType === type
                    ? "bg-accent text-on-accent"
                    : "text-muted hover:text-fg-soft"
                )}
              >
                {type === 'all' && !historyComplete ? 'All loaded' : type}
              </button>
            ))}
          </div>
          <div className="flex items-center space-x-2 text-[10px] text-muted font-mono uppercase shrink-0">
            <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
            <span>{filteredWorkouts.length} {historyComplete ? 'results' : 'loaded results'}</span>
          </div>
        </div>

        {filterType === 'custom' && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            className="grid grid-cols-2 gap-3 pt-2 border-t border-border"
          >
            <div className="flex-1">
              <label htmlFor="progress-date-start" className="block text-[8px] text-subtle uppercase font-mono mb-1">Start</label>
              <input
                id="progress-date-start"
                type="date"
                value={customRange.start}
                onChange={(e) => setCustomRange(prev => ({ ...prev, start: e.target.value }))}
                className="w-full min-w-0 bg-surface-raised border border-border rounded-lg p-2 text-xs text-fg outline-none focus:border-accent/50"
              />
            </div>
            <div className="flex-1">
              <label htmlFor="progress-date-end" className="block text-[8px] text-subtle uppercase font-mono mb-1">End</label>
              <input
                id="progress-date-end"
                type="date"
                value={customRange.end}
                onChange={(e) => setCustomRange(prev => ({ ...prev, end: e.target.value }))}
                className="w-full min-w-0 bg-surface-raised border border-border rounded-lg p-2 text-xs text-fg outline-none focus:border-accent/50"
              />
            </div>
          </motion.div>
        )}
      </div>

      {view === 'chart' ? (
        <div className="space-y-4">
          <div className="bg-surface rounded-2xl p-4 border border-border h-[240px]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-muted uppercase font-mono tracking-widest">Training Volume</span>
            </div>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="colorVolume" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-accent)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--color-accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" stroke="var(--color-muted)" fontSize={10} axisLine={false} tickLine={false} />
                <Tooltip
                  cursor={{ fill: 'var(--color-surface-hover)', stroke: 'var(--color-border)' }}
                  contentStyle={{ background: 'var(--color-surface-raised)', border: '1px solid var(--color-border)', borderRadius: '12px', color: 'var(--color-fg)' }}
                  labelStyle={{ color: 'var(--color-fg)' }}
                  itemStyle={{ color: 'var(--color-accent)' }}
                />
                <Area type="monotone" dataKey="volume" stroke="var(--color-accent)" fillOpacity={1} fill="url(#colorVolume)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-surface rounded-2xl p-4 border border-border space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center space-x-2">
                <span className="text-[10px] text-muted uppercase font-mono tracking-widest">Body Weight</span>
                <span className="text-xl font-bold">{profile?.weight || '-'} <span className="text-[10px] text-muted">kg</span></span>
              </div>
              <div className="flex items-center gap-2 ml-auto max-w-full">
                <label htmlFor="progress-todays-weight" className="sr-only">Today's body weight in kilograms</label>
                <input
                  id="progress-todays-weight"
                  type="number"
                  min={20}
                  max={500}
                  aria-invalid={Boolean(newWeight && !validWeight)}
                  aria-describedby={newWeight && !validWeight ? 'progress-weight-range' : weightError ? 'progress-weight-error' : undefined}
                  inputMode="decimal"
                  placeholder="Today's kg"
                  value={newWeight}
                  onChange={(e) => { setNewWeight(e.target.value); setWeightError(''); }}
                  className="w-[100px] min-w-0 bg-surface-raised border border-border rounded-lg p-2 text-xs text-fg outline-none focus:border-accent/50"
                  step="0.1"
                />
                <button
                  type="button"
                  aria-label="Save today's body weight"
                  onClick={handleAddWeight}
                  disabled={isAddingWeight || !validWeight}
                  className="min-h-11 min-w-11 grid place-items-center bg-accent text-on-accent rounded-lg disabled:opacity-50"
                >
                  {isAddingWeight ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {newWeight && !validWeight && <p id="progress-weight-range" className="text-xs text-danger" role="status">Enter a weight from 20 to 500 kg.</p>}
            {weightError && <p id="progress-weight-error" className="inline-error" role="alert">{weightError}</p>}

            <div className="h-[180px]">
              {weightData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={weightData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                    <XAxis dataKey="date" stroke="var(--color-muted)" fontSize={8} axisLine={false} tickLine={false} />
                    <YAxis hide domain={['dataMin - 5', 'dataMax + 5']} />
                    <Tooltip
                      cursor={{ stroke: 'var(--color-border)', strokeWidth: 1 }}
                      contentStyle={{ background: 'var(--color-surface-raised)', border: '1px solid var(--color-border)', borderRadius: '12px', fontSize: '10px', color: 'var(--color-fg)' }}
                      labelStyle={{ color: 'var(--color-fg)' }}
                      itemStyle={{ color: 'var(--color-secondary)' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="weight"
                      stroke="var(--color-secondary)"
                      strokeWidth={2}
                      dot={{ fill: 'var(--color-secondary)', stroke: 'var(--color-secondary)', r: 3 }}
                      activeDot={{ r: 5, fill: 'var(--color-surface)', stroke: 'var(--color-secondary)', strokeWidth: 2 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-subtle border border-dashed border-border rounded-xl">
                  <p className="text-[10px] uppercase font-mono">No weight data for this range</p>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-surface rounded-2x border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-surface-raised text-muted uppercase tracking-tighter">
                <tr>
                  <th className="p-3 border-b border-border">Session</th>
                  <th className="p-3 border-b border-border">Volume</th>
                  {showTimeMatrix && <th className="p-3 border-b border-border">Time</th>}
                  {showTimeMatrix && <th className="p-3 border-b border-border">Active</th>}
                  {showTimeMatrix && <th className="p-3 border-b border-border">Intensity</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {filteredWorkouts.slice(0, 10).map((w, i) => {
                  const totalActiveTime = getTimedOnlyActiveTime(w);
                  const totalVolume = getWorkoutVolume(w);
                  return (
                    <tr key={w.id || `${w.date.seconds}-${i}`} className="hover:bg-surface-hover/50 transition-colors">
                      <td className="p-3 font-bold">{format(new Date(w.date.seconds * 1000), 'MMM d')}</td>
                      <td className="p-3 text-accent font-bold">{totalVolume}kg</td>
                      {showTimeMatrix && <td className="p-3 text-muted">{Math.floor(w.duration / 60)}m</td>}
                      {showTimeMatrix && <td className="p-3 text-muted">{Math.floor(totalActiveTime / 60)}m</td>}
                      {showTimeMatrix && <td className="p-3 text-accent font-bold">{getWorkoutIntensity(w) || '-'}</td>}
                    </tr>
                  );
                })}
                {filteredWorkouts.length === 0 && <tr><td colSpan={showTimeMatrix ? 5 : 2} className="p-6 text-center text-muted">No sessions match this date range.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-surface rounded-2xl p-4 border border-border h-[300px] flex flex-col">
        <div className="flex items-center space-x-2 text-[10px] text-muted uppercase font-mono mb-4">
          <Sparkles className="w-3 h-3" />
          <span>Muscle Intelligence Radar</span>
        </div>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
            <PolarGrid stroke="var(--color-border)" />
            <PolarAngleAxis dataKey="subject" tick={{ fill: 'var(--color-muted)', fontSize: 10 }} />
            <PolarRadiusAxis axisLine={false} tick={false} domain={[0, 'auto']} />
            <Radar
              name="Volume"
              dataKey="value"
              stroke="var(--color-accent)"
              fill="var(--color-accent)"
              fillOpacity={0.3}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {[
          { label: historyComplete ? 'Total Logs' : 'Loaded Sessions', value: historyComplete ? filteredWorkouts.length : workouts.length, icon: History },
          { label: 'Avg Volume', value: Math.round(filteredWorkouts.reduce((acc, curr) => acc + getWorkoutVolume(curr), 0) / (filteredWorkouts.length || 1)), icon: Dumbbell },
        ].map((stat, i) => (
          <div key={i} className="bg-surface p-4 rounded-2xl border border-border">
            <stat.icon className="w-4 h-4 text-muted mb-2" />
            <div className="text-2xl font-bold tracking-tight">{stat.value}</div>
            <div className="text-[10px] text-muted uppercase font-mono tracking-wider">{stat.label}</div>
          </div>
        ))}
      </div>

      <div>
        <h3 className="text-lg font-bold mb-4 flex items-center space-x-2">
          <span>Recent Workouts</span>
          <History className="w-4 h-4 text-muted" />
        </h3>
        <div className="space-y-4">
          {workouts.length === 0 ? (
            <div className="bg-surface p-8 rounded-2xl border border-dashed border-border text-center">
              <p className="text-muted text-sm italic">No logs yet. Start your engine.</p>
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
