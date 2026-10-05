import type { Routine, Set as WorkoutSet, WorkoutExercise } from '../types';
import { safeNumber } from './workout-metrics';

export type ActiveWorkoutSet = WorkoutSet & { sessionKey: string };
export type ActiveWorkoutExercise = Omit<WorkoutExercise, 'sets'> & { sessionKey: string; sets: ActiveWorkoutSet[] };
export type ActiveWorkoutSession = {
  userId: string; routineId?: string; name: string; exercises: ActiveWorkoutExercise[];
  startTime: number; setStartTimes: Record<string, number>; savedAt: number; expiresAt: number;
};
const TTL = 2 * 60 * 60 * 1000;
const storageKey = (uid: string) => `fitai_active_workout_${uid}`;
export const setTimerKey = (exercise: ActiveWorkoutExercise, set: ActiveWorkoutSet) => `${exercise.sessionKey}:${set.sessionKey}`;

export function createActiveWorkoutSession(userId: string, routine?: Routine | null): ActiveWorkoutSession {
  const now = Date.now();
  return {
    userId, routineId: routine?.id, name: routine?.name || 'Morning Session', startTime: now,
    setStartTimes: {}, savedAt: now, expiresAt: now + TTL,
    exercises: (routine?.exercises || []).map(exercise => ({ ...exercise, sessionKey: crypto.randomUUID(),
      sets: exercise.sets.map(set => ({ ...set, sessionKey: crypto.randomUUID(), weight: safeNumber(set.weight),
        reps: safeNumber(set.reps), timeTaken: 0, completed: false })) })),
  };
}
export function saveActiveWorkoutSession(session: ActiveWorkoutSession) {
  localStorage.setItem(storageKey(session.userId), JSON.stringify({ ...session, savedAt: Date.now(), expiresAt: Date.now() + TTL }));
}
export function clearActiveWorkoutSession(uid: string) { localStorage.removeItem(storageKey(uid)); }

export function loadActiveWorkoutSession(uid: string): ActiveWorkoutSession | null {
  try {
    const raw = localStorage.getItem(storageKey(uid));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.userId !== uid || !Number.isFinite(data.expiresAt) || data.expiresAt < Date.now() ||
      !Number.isFinite(data.startTime) || typeof data.name !== 'string' || !Array.isArray(data.exercises)) throw new Error('Invalid session');
    const timers: Record<string, number> = {};
    const exercises: ActiveWorkoutExercise[] = data.exercises.map((exercise: any, exIndex: number) => {
      if (!Array.isArray(exercise.sets)) throw new Error('Invalid sets');
      const next = { ...exercise, sessionKey: exercise.sessionKey || crypto.randomUUID(), sets: [] } as ActiveWorkoutExercise;
      next.sets = exercise.sets.map((set: any, setIndex: number) => {
        const result: ActiveWorkoutSet = { ...set, sessionKey: set.sessionKey || crypto.randomUUID(),
          weight: safeNumber(set.weight), reps: safeNumber(set.reps), timeTaken: safeNumber(set.timeTaken), completed: Boolean(set.completed) };
        // Migrate older index-based timers once, keeping their original set.
        const timer = data.setStartTimes?.[setTimerKey(next, result)] ?? data.setStartTimes?.[`${exIndex}-${setIndex}`];
        if (Number.isFinite(timer) && timer > 0 && timer <= Date.now() && !result.completed) timers[setTimerKey(next, result)] = timer;
        return result;
      });
      return next;
    });
    return { ...data, exercises, setStartTimes: timers };
  } catch { clearActiveWorkoutSession(uid); return null; }
}
