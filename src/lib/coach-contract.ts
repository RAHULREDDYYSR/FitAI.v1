import { z } from 'zod';

export const setSchema = z.object({
  weight: z.number().finite().min(0).max(1000),
  reps: z.number().int().min(1).max(100),
  completed: z.boolean().default(false),
}).strict();
export const planSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1000).default(''),
  exercises: z.array(z.object({
    exerciseId: z.string().min(1).max(128),
    name: z.string().min(1).max(150),
    sets: z.array(setSchema).min(1).max(10),
  }).strict()).min(1).max(20),
}).strict();
export type CoachPlan = z.infer<typeof planSchema>;

export const profileSchema = z.object({
  displayName: z.string().max(100).optional(),
  age: z.number().int().min(13).max(100).optional(),
  weight: z.number().min(20).max(500).optional(),
  height: z.number().min(50).max(260).optional(),
  goal: z.string().max(500).optional(),
  shortTermGoal: z.string().max(500).optional(),
  longTermGoal: z.string().max(500).optional(),
  aim: z.string().max(2000).optional(),
}).strict();
export type CoachProfile = z.infer<typeof profileSchema>;

export const routineContextSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  name: z.string().max(100),
  description: z.string().max(1000).default(''),
  // Existing timed and custom exercises can be displayed without rewriting them.
  exercises: z.array(z.object({
    exerciseId: z.string().max(128), name: z.string().max(150),
    sets: z.array(z.object({
      weight: z.number().finite().min(0).max(1000),
      reps: z.number().int().min(0).max(100),
      completed: z.boolean().default(false),
      timeTaken: z.number().min(0).max(86400).optional(),
    }).strict()).max(20),
  }).strict()).max(50),
}).strict();
export type CoachRoutine = z.infer<typeof routineContextSchema>;

export const proposalSchema = z.object({
  id: z.string().uuid(), kind: z.enum(['create', 'edit', 'delete', 'profile']),
  targetId: z.string().nullable(),
  before: routineContextSchema.nullable(),
  after: routineContextSchema.omit({ id: true }).nullable(),
  profilePatch: profileSchema.nullable(),
  beforeProfile: profileSchema.nullable(),
  summary: z.string().max(1000),
  expiresAt: z.number().int(),
}).strict();
export type CoachProposal = z.infer<typeof proposalSchema>;

export const chatRequestSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  history: z.array(z.object({ role: z.enum(['user', 'bot']), text: z.string().max(6000) }).strict()).max(12),
  context: z.object({
    profile: profileSchema.nullable(),
    routines: z.array(routineContextSchema).max(100),
    workouts: z.array(z.object({
      id: z.string().max(128), name: z.string().max(100),
      date: z.string().max(40), duration: z.number().min(0),
      exercises: z.array(z.object({
        name: z.string().max(150),
        sets: z.array(z.object({ weight: z.number().min(0), reps: z.number().min(0) }).strict()).max(30),
      }).strict()).max(50),
    }).strict()).max(15),
  }).strict(),
  pending: proposalSchema.nullable().default(null),
}).strict();
export type CoachRequest = z.infer<typeof chatRequestSchema>;
export type CoachResponse = {
  text: string;
  proposal: CoachProposal | null;
  basis: 'saved_data' | 'general_guidance' | 'draft' | 'preview';
};

// Stable snapshots deliberately exclude timestamps and server-owned fields.
export function routineSnapshot(raw: any): CoachRoutine {
  return routineContextSchema.parse({
    id: raw.id, name: raw.name, description: raw.description || '',
    exercises: (raw.exercises || []).map((e: any) => ({
      exerciseId: e.exerciseId, name: e.name,
      sets: (e.sets || []).map((s: any) => ({
        weight: s.weight, reps: s.reps, completed: Boolean(s.completed),
        ...(s.timeTaken !== undefined ? { timeTaken: s.timeTaken } : {}),
      })),
    })),
  });
}

export function profileSnapshot(raw: any): CoachProfile {
  const data: Record<string, unknown> = {};
  for (const key of Object.keys(profileSchema.shape)) {
    if (raw?.[key] !== undefined) data[key] = raw[key];
  }
  return profileSchema.parse(data);
}

export function sameSnapshot(a: unknown, b: unknown): boolean {
  const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

export function assertApplicable(proposal: CoachProposal, current: CoachRoutine | CoachProfile | null, now = Date.now()) {
  if (proposal.expiresAt < now) throw new Error('This preview expired. Ask the coach for a fresh one.');
  const before = proposal.kind === 'profile' ? proposal.beforeProfile : proposal.before;
  if (proposal.kind !== 'create' && !sameSnapshot(before, current)) {
    throw new Error('Your saved data changed since this preview. Refresh the preview before applying it.');
  }
}

// Merge validated changes into the transaction's original objects. Unknown legacy
// fields and notes on exercises/sets survive edits to other values.
export function mergeRoutineEdit(raw: any, after: NonNullable<CoachProposal['after']>) {
  return { name: after.name, description: after.description, exercises: after.exercises.map(e => {
    const previous = raw.exercises.find((old: any) => old.exerciseId === e.exerciseId);
    if (!previous) return e;
    return { ...previous, ...e, sets: e.sets.map((s, i) => ({ ...(previous.sets[i] || {}), ...s })) };
  }) };
}
