import type { User } from 'firebase/auth';
import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { db } from './firebase';
import type { Routine, UserProfile, WorkoutLog } from '../types';
import { coachEndpoint } from './coach-endpoint';
import { chatRequestSchema, proposalSchema, profileSnapshot, routineSnapshot, type CoachRequest, type CoachResponse } from './coach-contract';

export function coachContext(profile: UserProfile | null, routines: Routine[], workouts: WorkoutLog[]): CoachRequest['context'] {
  return {
    profile: profile ? profileSnapshot(profile) : null,
    routines: routines.slice(0, 100).map(routineSnapshot),
    workouts: workouts.slice(0, 15).map(w => ({ id: w.id || '', name: w.name,
      date: w.date?.seconds ? new Date(w.date.seconds * 1000).toISOString().slice(0, 10) : 'Unknown date',
      duration: w.duration || 0, exercises: w.exercises.map(e => ({ name: e.name, sets: e.sets.filter(s => s.completed).map(s => ({ weight: s.weight, reps: s.reps })) })),
    })),
  };
}
export async function freshCoachContext(uid: string): Promise<CoachRequest['context']> {
  const [profile, routines, workouts] = await Promise.all([
    getDoc(doc(db, 'users', uid)),
    getDocs(query(collection(db, 'routines'), where('userId', '==', uid), orderBy('createdAt', 'desc'), limit(100))),
    getDocs(query(collection(db, 'workouts'), where('userId', '==', uid), orderBy('date', 'desc'), limit(10))),
  ]);
  return coachContext(profile.exists() ? profile.data() as UserProfile : null,
    routines.docs.map(d => ({ ...d.data(), id: d.id } as Routine)), workouts.docs.map(d => ({ ...d.data(), id: d.id } as WorkoutLog)));
}
export async function requestCoach(user: User, preview: boolean, input: CoachRequest, signal?: AbortSignal): Promise<CoachResponse> {
  const body = chatRequestSchema.parse(input);
  const token = preview ? null : await user.getIdToken();
  const response = await fetch(coachEndpoint(preview ? 'preview/chat' : 'chat'), {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body), signal: signal || AbortSignal.timeout(65000),
  });
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('The coach API is not connected. Check the deployment API URL. Nothing has changed.');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The coach is unavailable. Please retry.');
  if (typeof data.text !== 'string') throw new Error('The coach returned an invalid response. Nothing has changed.');
  return { ...data, proposal: data.proposal ? proposalSchema.parse(data.proposal) : null };
}
