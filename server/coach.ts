import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { EXERCISES } from '../src/constants';
import {
  chatRequestSchema, planSchema, profileSchema, sameSnapshot,
  type CoachRequest, type CoachResponse, type CoachProposal, type CoachRoutine,
} from '../src/lib/coach-contract';

const editSchema = z.object({
  name: z.string().min(1).max(100).nullable(),
  description: z.string().max(1000).nullable(),
  operations: z.array(z.object({
    op: z.enum(['add', 'remove', 'replace', 'sets']),
    exerciseId: z.string().max(128),
    replacementId: z.string().max(128).nullable(),
    sets: z.array(z.object({ weight: z.number().min(0).max(1000), reps: z.number().int().min(1).max(100) }).strict()).min(1).max(10).nullable(),
  }).strict()).max(20),
}).strict();
export const decisionSchema = z.object({
  mode: z.enum(['answer', 'clarify', 'list_routines', 'routine_details', 'workout_history', 'workout_details', 'create', 'edit', 'delete', 'profile']),
  text: z.string().max(4000),
  targetId: z.string().nullable(),
  routine: planSchema.nullable(),
  edit: editSchema.nullable(),
  profilePatch: z.object({
    displayName: z.string().max(100).nullable(), age: z.number().int().min(13).max(100).nullable(),
    weight: z.number().min(20).max(500).nullable(), goal: z.string().max(500).nullable(),
    shortTermGoal: z.string().max(500).nullable(), longTermGoal: z.string().max(500).nullable(), aim: z.string().max(2000).nullable(),
  }).strict().nullable(),
}).strict();
export type Decision = z.infer<typeof decisionSchema>;
export type DecisionProvider = (request: CoachRequest, repair?: string, signal?: AbortSignal) => Promise<unknown>;

export class CoachError extends Error {
  constructor(public code: string, message: string, public status = 422) { super(message); }
}

const catalog = new Map(EXERCISES.map(e => [e.id, e]));
const cell = (s: string) => s.replace(/[|\n\r]/g, ' ');
const reply = (text: string, basis: CoachResponse['basis'] = 'saved_data'): CoachResponse => ({ text, proposal: null, basis });
const table = (routine: CoachRoutine | NonNullable<CoachProposal['after']>) =>
  `**${cell(routine.name)}**\n\n| Exercise | Sets | Reps | Load (kg) |\n|---|---:|---|---|\n` + routine.exercises.map(e =>
    `| ${cell(e.name)} | ${e.sets.length} | ${e.sets.map(s => s.reps || 'Timed').join(', ')} | ${e.sets.map(s => s.weight || 'Choose load / bodyweight').join(', ')} |`).join('\n');

export function deterministicReply(request: CoachRequest): CoachResponse | null {
  const text = request.message.toLowerCase().trim();
  if (/\b(chest pain|fainting|fainted|cannot breathe|can.t breathe)\b/.test(text)) {
    return reply('Stop exercising. Chest pain, fainting, or trouble breathing need urgent medical attention. I cannot diagnose the cause or recommend a workout through these symptoms.', 'general_guidance');
  }
  if (/^(hi|hello|hey|hey coach)[!. ]*$/.test(text)) {
    return reply('Hi! I can help you plan a session, review your logged workouts, or change a saved routine. Any change will appear as a preview for you to review first.', 'general_guidance');
  }
  if (request.pending && /\b(do not approve|don.t approve|not yet|save it later|do not save|don.t save)\b/.test(text)) {
    return reply('No changes have been applied. The preview will stay here until you choose to apply or discard it.', 'draft');
  }
  if (/\b(approve|save it|go ahead|confirm)\b/.test(text) && request.pending) {
    return reply('Use **Apply changes** on the preview to save this exact version. Chat messages never apply or delete your data.', 'draft');
  }
  if ((/^(list|show|view|what|how many).*(my |saved |planned |library).*(routines?|workouts?|plans?)|^(list|show|view) (routines?|plans?)$/.test(text)
    || /^(what|which) (routines?|workouts?|plans?) do i have|^how many (routines?|workouts?|plans?).*(saved|planned|library)/.test(text)) && !/\b(history|logged|completed|performed|did|details)\b/.test(text)) {
    const routines = request.context.routines;
    if (!routines.length) return reply('You have no saved routines in your library. Ask me to draft a workout, or create one in the Library.');
    return reply(`Your library has **${routines.length} saved routine${routines.length === 1 ? '' : 's'}** in the available snapshot.${routines.length === 100 ? ' This view is limited to 100 routines; your library may contain more.' : ''}\n\n| Routine | Exercises | Sets |\n|---|---:|---:|\n` + routines.map(r => `| ${cell(r.name)} | ${r.exercises.length} | ${r.exercises.reduce((n, e) => n + e.sets.length, 0)} |`).join('\n'));
  }
  const profileFact = text.match(/^(?:what(?:'s| is)|show)(?: me)? my (age|weight|height|goal|short[- ]term goal|long[- ]term goal)\??$/);
  if (profileFact) {
    const key = ({ 'short-term goal': 'shortTermGoal', 'short term goal': 'shortTermGoal', 'long-term goal': 'longTermGoal', 'long term goal': 'longTermGoal' } as Record<string, string>)[profileFact[1]] || profileFact[1];
    const value = request.context.profile?.[key];
    return value === undefined ? reply(`Your ${profileFact[1]} is not set in your profile. You can add it in Profile.`)
      : reply(`Your saved ${profileFact[1]} is **${value}${key === 'weight' ? ' kg' : key === 'height' ? ' cm' : ''}**.`);
  }
  if (/\b(history|logged workouts|completed workouts|how many workouts|last workout)\b/.test(text)) {
    const workouts = request.context.workouts;
    if (!workouts.length) return reply('There are no logged workouts in the history available to me. Saved routines are plans, not completed sessions.');
    return reply(`Here ${workouts.length === 1 ? 'is' : 'are'} the **${workouts.length} most recent logged session${workouts.length === 1 ? '' : 's'}** available to me. This is not an all-time total.\n\n| Date | Session | Completed sets | Duration |\n|---|---|---:|---|\n` + workouts.map(w => `| ${cell(w.date)} | ${cell(w.name)} | ${w.exercises.reduce((n, e) => n + e.sets.length, 0)} | ${Math.round(w.duration / 60)} min |`).join('\n'));
  }
  return null;
}

function findTarget(request: CoachRequest, id: string | null): CoachRoutine {
  const r = request.context.routines.find(r => r.id === id);
  if (!r) throw new CoachError('UNKNOWN_ROUTINE', 'I could not match that routine to your library. Which saved routine do you mean?');
  const duplicates = request.context.routines.filter(other => other.name.toLowerCase() === r.name.toLowerCase());
  if (duplicates.length > 1 && !request.message.includes(r.id)) {
    throw new CoachError('AMBIGUOUS_ROUTINE', `You have multiple routines named “${r.name}”. Open the one you want in the Library, or specify its ID.`);
  }
  return r;
}

function validateLoads(request: CoachRequest, exercises: NonNullable<CoachProposal['after']>['exercises'], before?: CoachRoutine) {
  // New loads need an explicit user value or evidence for that exercise in history.
  const stated = [...request.message.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:kg|kilograms?)\b/gi)].map(m => Number(m[1]));
  for (const e of exercises) {
    const known = [
      ...(before?.exercises.find(x => x.exerciseId === e.exerciseId)?.sets.map(s => s.weight) || []),
      ...request.context.workouts.flatMap(w => w.exercises.filter(x => x.name === e.name).flatMap(x => x.sets.map(s => s.weight))),
    ];
    if (e.sets.some(s => s.weight > 0 && !stated.includes(s.weight) && !known.includes(s.weight))) {
      throw new CoachError('UNSUPPORTED_LOAD', 'I do not know your working weight for that exercise. Tell me a load in kg, or start with an unweighted draft and choose a comfortable load.');
    }
  }
}

function validateCatalog(plan: NonNullable<CoachProposal['after']>, before?: CoachRoutine) {
  const seen = new Set<string>();
  for (const e of plan.exercises) {
    const saved = before?.exercises.find(x => x.exerciseId === e.exerciseId);
    const match = catalog.get(e.exerciseId);
    if (!match && !saved) throw new CoachError('UNKNOWN_EXERCISE', 'The generated exercise was not in the exercise library. Nothing has been saved.');
    if (seen.has(e.exerciseId)) throw new CoachError('DUPLICATE_EXERCISE', 'The draft repeated an exercise. Nothing has been saved.');
    seen.add(e.exerciseId);
    if (match) e.name = match.name;
    else if (saved) e.name = saved.name;
    // Keep unchanged sets byte-for-byte, including timed sets, during edits.
    if (!saved || !sameSnapshot(saved.sets, e.sets)) {
      if (e.sets.some(s => s.reps < 1 || s.reps > 100 || s.weight < 0)) throw new CoachError('INVALID_SETS', 'The draft contained invalid sets. Nothing has been saved.');
      e.sets.forEach(s => { s.completed = false; });
    }
  }
  if (!plan.exercises.length || plan.exercises.length > 20) throw new CoachError('INVALID_PLAN', 'A routine must have 1–20 exercises. Nothing has been saved.');
}

export function resolveDecision(request: CoachRequest, raw: unknown, now = Date.now()): CoachResponse {
  const d = decisionSchema.parse(raw);
  const proposal = (p: Omit<CoachProposal, 'id' | 'expiresAt'>): CoachResponse => ({
    text: p.summary + ' Review the preview below; nothing has been saved.',
    basis: 'draft', proposal: { ...p, id: randomUUID(), expiresAt: now + 30 * 60 * 1000 },
  });
  const empty = { targetId: null, before: null, after: null, profilePatch: null, beforeProfile: null };
  if (d.mode === 'list_routines') return deterministicReply({ ...request, message: 'list my routines' })!;
  if (d.mode === 'workout_history') return deterministicReply({ ...request, message: 'workout history' })!;
  if (d.mode === 'routine_details') return reply(table(findTarget(request, d.targetId)));
  if (d.mode === 'workout_details') {
    const w = request.context.workouts.find(w => w.id === d.targetId);
    if (!w) throw new CoachError('UNKNOWN_WORKOUT', 'That session is not in the logged history available to me. Which session do you mean?');
    return reply(`**${cell(w.name)} — ${cell(w.date)}**\n\n` + w.exercises.map(e => `- ${cell(e.name)}: ${e.sets.map(s => `${s.weight} kg × ${s.reps} reps`).join('; ') || 'No completed sets'}`).join('\n'));
  }
  if (d.mode === 'answer' || d.mode === 'clarify') {
    if (!d.text.trim()) throw new CoachError('EMPTY_RESPONSE', 'The coach returned an empty reply. Try a more specific question.');
    if (/https?:\/\/|\[[^\]]+\]\(|\b((?:i|we) (?:have )?(?:saved|deleted|updated|created|added|removed|modified|searched)|successfully (?:saved|deleted|updated)|sources?:|references?:)\b/i.test(d.text)) {
      throw new CoachError('UNSUPPORTED_CLAIM', 'The coach returned an unverified source or completion claim. Nothing has been changed.');
    }
    if (d.mode === 'answer' && /\b(my|i|me)\b/i.test(request.message) && /\b(routines?|workouts?|history|logged|lifted|sets?|reps?|weight|age|height|profile|goal|progress|personal record|pr)\b/i.test(request.message) && /\b(what|how many|how much did|when did|show|list|review|summarize)\b/i.test(request.message)) {
      // A model cannot bypass the fact renderers by choosing free-form text.
      return reply('I can show the routines, profile fields, and recent sessions actually saved in your workspace. Which saved item would you like to review? I will not estimate missing personal records or history.');
    }
    return reply(d.text, 'general_guidance');
  }
  if (d.mode === 'create') {
    if (!d.routine) throw new CoachError('MISSING_PLAN', 'I need a complete draft before proposing a routine.');
    const plan = structuredClone(d.routine);
    validateCatalog(plan); validateLoads(request, plan.exercises);
    return proposal({ ...empty, kind: 'create', after: plan, summary: `Drafted “${plan.name}” with ${plan.exercises.length} exercises.` });
  }
  if (d.mode === 'delete') {
    const before = findTarget(request, d.targetId);
    if (!/\b(delete|remove|discard)\b/i.test(request.message)) throw new CoachError('UNREQUESTED_DELETE', 'Please explicitly ask to delete a routine before I prepare a deletion preview.');
    return proposal({ ...empty, kind: 'delete', before, targetId: before.id, summary: `Delete “${before.name}” from your library. Workout history will be kept.` });
  }
  if (d.mode === 'edit') {
    if (!d.edit) throw new CoachError('MISSING_EDIT', 'What would you like to change?');
    const pending = request.pending;
    const editingDraft = pending && (pending.kind === 'create' || pending.kind === 'edit') && pending.after && (!d.targetId || d.targetId === pending.targetId);
    if (editingDraft && pending.expiresAt < now) throw new CoachError('EXPIRED_DRAFT', 'That preview expired. Ask for a fresh draft.');
    const before = editingDraft ? pending.before : findTarget(request, d.targetId);
    if (before && editingDraft && !sameSnapshot(before, request.context.routines.find(r => r.id === before.id))) throw new CoachError('STALE_DRAFT', 'This routine changed since the preview. Ask for a fresh preview.');
    const source = editingDraft ? pending.after! : before!;
    const after = structuredClone({ name: source.name, description: source.description, exercises: source.exercises });
    if (d.edit.name !== null) after.name = d.edit.name;
    if (d.edit.description !== null) after.description = d.edit.description;
    const changed = new Set<string>();
    for (const op of d.edit.operations) {
      if (changed.has(op.exerciseId)) throw new CoachError('CONFLICTING_EDIT', 'The draft contains conflicting changes to the same exercise.');
      changed.add(op.exerciseId);
      const indices = after.exercises.map((e, i) => e.exerciseId === op.exerciseId ? i : -1).filter(i => i >= 0);
      const index = indices[0];
      if (op.op !== 'add' && indices.length !== 1) throw new CoachError('UNKNOWN_EDIT_TARGET', 'I could not identify exactly one exercise to change. Specify the exercise in your routine.');
      if (op.op === 'remove') after.exercises.splice(index, 1);
      else if (op.op === 'sets') {
        if (!op.sets) throw new CoachError('MISSING_SETS', 'Specify the sets, reps, or load you want.');
        after.exercises[index].sets = op.sets.map(s => ({ ...s, completed: false }));
      } else {
        const id = op.op === 'replace' ? op.replacementId : op.exerciseId;
        const exercise = id ? catalog.get(id) : null;
        if (!exercise) throw new CoachError('UNKNOWN_EXERCISE', 'That exercise is not in the exercise library.');
        if (!op.sets) throw new CoachError('MISSING_SETS', 'The proposed exercise needs sets and reps.');
        const replacement = { exerciseId: exercise.id, name: exercise.name, sets: op.sets.map(s => ({ ...s, completed: false })) };
        if (op.op === 'add') after.exercises.push(replacement);
        else after.exercises[index] = replacement;
      }
    }
    validateCatalog(after, before || undefined); validateLoads(request, after.exercises, { ...source, id: before?.id || 'draft' });
    if (sameSnapshot(after, source)) throw new CoachError('NO_CHANGE', 'This would not change the routine. What would you like to adjust?');
    return proposal({ ...empty, kind: editingDraft ? pending.kind as 'create' | 'edit' : 'edit', before: before || null,
      targetId: before?.id || null, after, summary: `${editingDraft ? 'Revised the draft for' : 'Prepared changes to'} “${after.name}”.` });
  }
  const patch = profileSchema.parse(Object.fromEntries(Object.entries(d.profilePatch || {}).filter(([, v]) => v !== null)));
  if (!Object.keys(patch).length) throw new CoachError('EMPTY_PROFILE_EDIT', 'Which profile field would you like to change?');
  return proposal({ ...empty, kind: 'profile', profilePatch: patch, beforeProfile: request.context.profile || {}, summary: `Prepared an update to ${Object.keys(patch).join(', ')}.` });
}

export async function runCoach(raw: unknown, provider: DecisionProvider, signal?: AbortSignal): Promise<CoachResponse> {
  const request = chatRequestSchema.parse(raw);
  const direct = deterministicReply(request);
  if (direct) return direct;
  signal?.throwIfAborted();
  try { return resolveDecision(request, await provider(request, undefined, signal)); }
  catch (error) {
    // One bounded repair for malformed output, never an unbounded agent/tool loop.
    if (error instanceof z.ZodError || error instanceof CoachError && ['UNKNOWN_EXERCISE', 'UNSUPPORTED_CLAIM', 'DUPLICATE_EXERCISE'].includes(error.code)) {
      signal?.throwIfAborted();
      return resolveDecision(request, await provider(request, error instanceof CoachError ? error.message : 'Output failed schema validation. Use the exact output schema and valid bounds.', signal));
    }
    throw error;
  }
}

export async function runPreviewCoach(raw: unknown): Promise<CoachResponse> {
  const request = chatRequestSchema.parse(raw);
  const direct = deterministicReply(request);
  if (direct) return { ...direct, basis: 'preview' };
  const decision: Decision = { mode: 'clarify', text: '', targetId: null, routine: null, edit: null, profilePatch: null };
  const lower = request.message.toLowerCase();
  if (/\b(plan|create|draft|build)\b/.test(lower) && /\b(workout|routine|session)\b/.test(lower)) {
    decision.mode = 'create';
    const exercises = [catalog.get('chest-7')!, EXERCISES.find(e => /squat/i.test(e.name))!, EXERCISES.find(e => e.muscle === 'Back') || EXERCISES.find(e => /row/i.test(e.name))!];
    decision.routine = { name: 'Full-body starter', description: 'Sample routine. Choose a comfortable load; stop if an exercise causes pain.',
      exercises: exercises.map(e => ({ exerciseId: e.id, name: e.name, sets: Array.from({ length: 3 }, () => ({ weight: 0, reps: 8, completed: false })) })) };
  } else if (/\b(sets|reps)\b/.test(lower) && /\b(change|make|update|edit)\b/.test(lower)) {
    const source = request.pending?.after || request.context.routines.find(r => lower.includes(r.name.toLowerCase()));
    const exercise = source?.exercises.find(e => lower.includes(e.name.toLowerCase())) || source?.exercises[0];
    const match = lower.match(/\b([1-9]|10)\s*sets?\b/);
    if (!source || !exercise || !match) return reply('In this sample workspace, try “Change Upper Body to 4 sets”. Full coaching is available after sign-in and server configuration.', 'preview');
    decision.mode = 'edit'; decision.targetId = request.pending ? request.pending.targetId : request.context.routines.find(r => r.name === source.name)!.id;
    decision.edit = { name: null, description: null, operations: [{ op: 'sets', exerciseId: exercise.exerciseId, replacementId: null, sets: Array.from({ length: Number(match[1]) }, (_, i) => ({ weight: exercise.sets[Math.min(i, exercise.sets.length - 1)].weight, reps: exercise.sets[Math.min(i, exercise.sets.length - 1)].reps })) }] };
  } else {
    return reply('This is a sample workspace, not a live AI reply. Try “List my routines”, “Show workout history”, or “Change Upper Body to 4 sets”. Sign in to use personalized coaching with your own data.', 'preview');
  }
  return { ...resolveDecision(request, decision), basis: 'preview' };
}
