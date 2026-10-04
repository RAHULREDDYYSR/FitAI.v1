import type { WorkoutLog, Set as WorkoutSet } from '../types';

export const safeNumber = (value: any, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

export const getSetVolume = (set: Partial<WorkoutSet>) =>
  set.completed === false ? 0 : safeNumber(set.weight) * safeNumber(set.reps);

export const getWorkoutVolume = (workout: Partial<WorkoutLog>) => {
  const storedVolume = safeNumber(workout.totalVolume, Number.NaN);
  if (Number.isFinite(storedVolume)) return storedVolume;
  return (workout.exercises || []).reduce((total, exercise) =>
    total + exercise.sets.reduce((setTotal, set) => setTotal + getSetVolume(set), 0), 0
  );
};

export const getWorkoutActiveTime = (workout: Partial<WorkoutLog>) =>
  (workout.exercises || []).reduce((total, exercise) =>
    total + exercise.sets.reduce((setTotal, set) => setTotal + safeNumber(set.timeTaken), 0), 0
  );

export const getTimedOnlyActiveTime = (workout: Partial<WorkoutLog>) =>
  (workout.exercises || []).reduce((total, exercise) =>
    total + exercise.sets.reduce((setTotal, set) =>
      setTotal + (safeNumber(set.reps) > 0 ? 0 : safeNumber(set.timeTaken)), 0
    ), 0
  );

export const getWorkoutIntensity = (workout: Partial<WorkoutLog>) => {
  const storedIntensity = safeNumber(workout.intensity, Number.NaN);
  if (Number.isFinite(storedIntensity) && storedIntensity > 0) return storedIntensity;

  const duration = Math.max(safeNumber(workout.duration), 1);
  const totalVolume = getWorkoutVolume(workout);
  const timedOnlyActiveTime = getTimedOnlyActiveTime(workout);
  const volumeIntensity = Math.round((totalVolume / duration) * 0.1 * 100);
  const timedOnlyIntensity = Math.round((timedOnlyActiveTime / duration) * 100);
  return volumeIntensity + timedOnlyIntensity;
};

export const formatDuration = (seconds?: number) => {
  const totalSeconds = safeNumber(seconds);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export const formatSetPerformance = (set: Partial<WorkoutSet>) => {
  const weight = safeNumber(set.weight);
  const reps = safeNumber(set.reps);
  const timeTaken = safeNumber(set.timeTaken);
  const parts: string[] = [];

  if (weight > 0 || reps > 0) {
    parts.push(`${weight > 0 ? `${weight} kg` : 'Bodyweight'} x ${reps} reps`);
  }

  if (reps <= 0 && timeTaken > 0) {
    parts.push(formatDuration(timeTaken));
  }

  return parts.length > 0 ? parts.join(' | ') : 'Timed/bodyweight set';
};

