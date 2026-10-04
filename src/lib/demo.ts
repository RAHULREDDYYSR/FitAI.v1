import { EXERCISES } from '../constants';
import type { Routine, UserProfile, WorkoutLog } from '../types';
import { assertApplicable, mergeRoutineEdit, profileSnapshot, routineSnapshot, type CoachProposal } from './coach-contract';

export const DEMO_UID = 'fitai-sample';
export const demoUser = { uid: DEMO_UID, displayName: 'Alex', email: 'sample@fitai.local' };
const key = 'fitai_sample_workspace_v1';
type Workspace = { profile: UserProfile; routines: Routine[]; workouts: WorkoutLog[]; applied: Record<string, string> };
const sets = (weight: number, reps: number, completed = false) => Array.from({ length: 3 }, () => ({ weight, reps, completed }));
const exercise = (id: string, weight: number, reps: number) => {
  const e = EXERCISES.find(e => e.id === id)!;
  return { exerciseId: id, name: e.name, sets: sets(weight, reps) };
};
function initialWorkspace(): Workspace {
  const now = new Date();
  const upper = [exercise('chest-1', 20, 8), exercise('shoulders-1', 8, 10), exercise('chest-7', 0, 12)];
  const pull = EXERCISES.find(e => e.muscle === 'Back') || EXERCISES[40];
  return {
    profile: { uid: DEMO_UID, email: demoUser.email, displayName: 'Alex', name: 'Alex', weight: 72, height: 175, age: 28,
      goal: 'Build strength consistently', shortTermGoal: 'Train three times a week', longTermGoal: 'Build a sustainable strength habit',
      aim: 'Feel stronger, move better, and enjoy training.', createdAt: { seconds: now.getTime() / 1000 },
      weightHistory: Array.from({ length: 6 }, (_, i) => ({ date: new Date(now.getTime() - (5 - i) * 7 * 86400000).toISOString(), weight: 71 + i * .2 })) },
    routines: [{ id: 'sample-upper', userId: DEMO_UID, name: 'Upper Body', description: 'A balanced push session. Leave two reps in reserve.', exercises: upper, createdAt: { seconds: now.getTime() / 1000 } },
      { id: 'sample-pull', userId: DEMO_UID, name: 'Pull & posture', description: 'Build a stronger back with controlled reps.', exercises: [exercise(pull.id, 10, 10), exercise('shoulders-2', 10, 12)], createdAt: { seconds: now.getTime() / 1000 } }],
    workouts: Array.from({ length: 5 }, (_, i) => ({ id: `sample-session-${i}`, userId: DEMO_UID, name: i % 2 ? 'Pull & posture' : 'Upper Body',
      date: { seconds: (now.getTime() - (i * 2 + 1) * 86400000) / 1000 }, duration: 2400 + i * 90,
      exercises: upper.map(e => ({ ...e, sets: e.sets.map(s => ({ ...s, completed: true })) })),
      totalVolume: upper.reduce((sum, e) => sum + e.sets.reduce((n, s) => n + s.reps * s.weight, 0), 0), createdAt: { seconds: now.getTime() / 1000 } })),
    applied: {},
  };
}
export function readDemo(): Workspace {
  const raw = localStorage.getItem(key);
  if (raw) {
    try {
      const data = JSON.parse(raw);
      if (data.profile?.uid === DEMO_UID && Array.isArray(data.routines) && Array.isArray(data.workouts) && data.applied) return data;
    } catch { /* A damaged sample can be safely reset. */ }
  }
  const data = initialWorkspace(); writeDemo(data); return data;
}
export function writeDemo(data: Workspace) { localStorage.setItem(key, JSON.stringify(data)); }
export function updateDemoProfile(patch: Partial<UserProfile>) { const d = readDemo(); d.profile = { ...d.profile, ...patch }; writeDemo(d); }
export function saveDemoRoutine(data: Partial<Routine>, id?: string) {
  const d = readDemo();
  if (id) d.routines = d.routines.map(r => r.id === id ? { ...r, ...data } : r);
  else d.routines.unshift({ ...data, id: crypto.randomUUID(), userId: DEMO_UID, createdAt: { seconds: Date.now() / 1000 } } as Routine);
  writeDemo(d);
}
export function deleteDemoRoutine(id: string) { const d = readDemo(); d.routines = d.routines.filter(r => r.id !== id); writeDemo(d); }
export function saveDemoWorkout(data: Partial<WorkoutLog>) {
  const d = readDemo(); d.workouts.unshift({ ...data, id: crypto.randomUUID(), userId: DEMO_UID, date: { seconds: Date.now() / 1000 }, createdAt: { seconds: Date.now() / 1000 } } as WorkoutLog); writeDemo(d);
}
export function proposalResult(proposal: CoachProposal) {
  const name = proposal.after?.name || proposal.before?.name;
  if (proposal.kind === 'create') return `Saved “${name}” to your library.`;
  if (proposal.kind === 'edit') return `Updated “${name}”. Your other exercises and workout history were kept.`;
  if (proposal.kind === 'delete') return `Deleted “${name}” from your library. Workout history was kept.`;
  return 'Saved the reviewed profile changes.';
}
export function applyDemoProposal(p: CoachProposal): string {
  const d = readDemo();
  if (d.applied[p.id]) return d.applied[p.id];
  const existing = d.routines.find(r => r.id === p.targetId);
  assertApplicable(p, p.kind === 'profile' ? profileSnapshot(d.profile) : existing ? routineSnapshot(existing) : null);
  if (p.kind === 'create') d.routines.unshift({ ...p.after!, id: p.id, userId: DEMO_UID, createdAt: { seconds: Date.now() / 1000 } } as Routine);
  else if (p.kind === 'edit') d.routines = d.routines.map(r => r.id === p.targetId ? { ...r, ...mergeRoutineEdit(r, p.after!) } as Routine : r);
  else if (p.kind === 'delete') d.routines = d.routines.filter(r => r.id !== p.targetId);
  else d.profile = { ...d.profile, ...p.profilePatch };
  const text = proposalResult(p); d.applied[p.id] = text; writeDemo(d); return text;
}
