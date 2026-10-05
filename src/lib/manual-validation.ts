import { z } from 'zod';
import type { Routine, UserProfile, WorkoutExercise } from '../types';
import { profileSchema } from './coach-contract';

const set = z.object({
  weight: z.number().finite().min(0, 'Weight cannot be negative.').max(1000, 'Weight must be 1000 kg or less.'),
  reps: z.number().int('Reps must be a whole number.').min(0, 'Reps cannot be negative.').max(100, 'Reps must be 100 or less.'),
  completed: z.boolean(), timeTaken: z.number().finite().min(0).max(86400).optional(),
}).passthrough();
const exercise = z.object({ exerciseId: z.string().min(1), name: z.string().min(1).max(150), sets: z.array(set).min(1, 'Keep at least one set per exercise.').max(30, 'Use 30 sets or fewer per exercise.') }).passthrough();
const routine = z.object({ name: z.string().trim().min(1, 'Enter a routine name.').max(100, 'Keep the name under 100 characters.'),
  description: z.string().max(1000, 'Keep the description under 1000 characters.'), exercises: z.array(exercise).min(1, 'Add an exercise.').max(50, 'Use 50 exercises or fewer.') });
function parse<T>(schema: z.ZodType<T, any, any>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(result.error.issues[0].message);
  return result.data;
}
export function validateManualRoutine(data: Partial<Routine>) {
  const result = parse(routine, data);
  if (result.exercises.some(e => e.sets.length > 20)) throw new Error('Use 20 sets or fewer per routine exercise.');
  const ids = result.exercises.map(e => e.exerciseId);
  if (new Set(ids).size !== ids.length) throw new Error('This exercise is already in the routine. Add sets to it instead.');
  return result;
}
export function validateWorkout(name: string, exercises: WorkoutExercise[]) {
  const result = parse(routine, { name, description: '', exercises });
  const completed = result.exercises.flatMap(e => e.sets).filter(s => s.completed);
  if (!completed.length) throw new Error('Complete at least one set before finishing your workout.');
  if (completed.some(s => s.reps === 0 && !(s.timeTaken && s.timeTaken > 0))) throw new Error('Each completed set needs reps or a recorded duration.');
  return result;
}
const manualProfile = profileSchema.extend({ sex: z.enum(['male', 'female', 'other']).optional() });
export function validateManualProfile(data: Partial<UserProfile>) {
  for (const [key, value] of Object.entries(data)) if (value === undefined) throw new Error(`Enter a valid ${key} before saving.`);
  return parse(manualProfile, data);
}
