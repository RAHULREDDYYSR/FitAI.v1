import test from 'node:test';
import assert from 'node:assert/strict';
import type { Routine, WorkoutExercise } from '../src/types';
import {
  createActiveWorkoutSession,
  loadActiveWorkoutSession,
  saveActiveWorkoutSession,
  setTimerKey,
} from '../src/lib/active-workout';
import {
  validateManualProfile,
  validateManualRoutine,
  validateWorkout,
} from '../src/lib/manual-validation';
import {
  getWorkoutActiveTime,
  getWorkoutIntensity,
  getWorkoutVolume,
} from '../src/lib/workout-metrics';

const fixedNow = 1_800_000_000_000;

function withBrowserState(run: (storage: Map<string, string>) => void) {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const originalNow = Date.now;
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, String(value)); },
      removeItem: (key: string) => { storage.delete(key); },
      clear: () => storage.clear(),
    },
  });
  Date.now = () => fixedNow;
  try {
    run(storage);
  } finally {
    Date.now = originalNow;
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else delete (globalThis as { localStorage?: Storage }).localStorage;
  }
}

const routine: Routine = {
  id: 'routine-1', userId: 'user-1', name: 'Strength', description: 'Keep this plan intact', createdAt: 'saved-date',
  exercises: [
    { exerciseId: 'squat', name: 'Squat', sets: [{ reps: 8, weight: 50, completed: true, timeTaken: 30 }] },
    { exerciseId: 'plank', name: 'Plank', sets: [{ reps: 0, weight: 0, completed: true, timeTaken: 45 }] },
  ],
};

test('starting a routine deep-copies it and assigns stable timer keys across reordering and deletion', () => {
  withBrowserState(() => {
    const before = structuredClone(routine);
    const session = createActiveWorkoutSession('user-1', routine);
    assert.deepEqual(routine, before);

    const squat = session.exercises[0];
    const squatSet = squat.sets[0];
    const key = setTimerKey(squat, squatSet);
    session.setStartTimes[key] = fixedNow - 5_000;

    session.exercises.reverse();
    session.exercises[0].sets.push({ reps: 3, weight: 1, completed: false, timeTaken: 0, sessionKey: 'extra-set' });
    session.exercises[1].sets.splice(0, 0, { reps: 1, weight: 2, completed: false, timeTaken: 0, sessionKey: 'inserted-set' });
    session.exercises[0].sets.pop();
    assert.equal(setTimerKey(squat, squatSet), key);
    assert.equal(session.setStartTimes[key], fixedNow - 5_000);
    assert.notEqual(key, '0-0');
  });
});

test('legacy index timers migrate to stable keys when loaded', () => {
  withBrowserState(storage => {
    const oldSession = {
      userId: 'user-1', name: 'Old session', startTime: fixedNow - 1_000,
      savedAt: fixedNow - 1_000, expiresAt: fixedNow + 60_000,
      setStartTimes: { '0-0': fixedNow - 500 },
      exercises: [{ exerciseId: 'squat', name: 'Squat', sets: [{ reps: 5, weight: 20, completed: false }] }],
    };
    storage.set('fitai_active_workout_user-1', JSON.stringify(oldSession));

    const loaded = loadActiveWorkoutSession('user-1');
    assert.ok(loaded);
    const key = setTimerKey(loaded.exercises[0], loaded.exercises[0].sets[0]);
    assert.equal(loaded.setStartTimes[key], fixedNow - 500);
    assert.equal(loaded.setStartTimes['0-0'], undefined);
  });
});

test('expired and corrupt active sessions are rejected and removed', () => {
  withBrowserState(storage => {
    storage.set('fitai_active_workout_user-1', JSON.stringify({
      userId: 'user-1', name: 'Expired', startTime: fixedNow - 2_000,
      expiresAt: fixedNow - 1, exercises: [],
    }));
    assert.equal(loadActiveWorkoutSession('user-1'), null);
    assert.equal(storage.has('fitai_active_workout_user-1'), false);

    storage.set('fitai_active_workout_user-1', '{broken json');
    assert.equal(loadActiveWorkoutSession('user-1'), null);
    assert.equal(storage.has('fitai_active_workout_user-1'), false);
  });
});

test('saved active workout round-trips without sharing mutable data', () => {
  withBrowserState(storage => {
    const session = createActiveWorkoutSession('user-1', routine);
    saveActiveWorkoutSession(session);
    const loaded = loadActiveWorkoutSession('user-1');
    assert.ok(loaded);
    assert.deepEqual(loaded.exercises.map(e => e.name), ['Squat', 'Plank']);
    loaded.exercises[0].sets[0].reps = 99;
    loaded.exercises.pop();
    const loadedAgain = loadActiveWorkoutSession('user-1');
    assert.ok(loadedAgain);
    assert.equal(loadedAgain.exercises[0].sets[0].reps, 8);
    assert.equal(loadedAgain.exercises.length, 2);
  });
});

const manualRoutineInput = () => ({
  id: 'manual-1', userId: 'user-1', createdAt: 'created', name: '  Custom day  ', description: 'My notes',
  exercises: [{ exerciseId: 'row', name: 'Row', equipment: 'cable',
    sets: [{ reps: 8, weight: 30, completed: false, note: 'slow eccentric' }] }],
});

test('manual routine validation rejects invalid numbers, duplicate exercises, and more than 20 sets', () => {
  for (const reps of [-1, Number.NaN, 2.5]) {
    const input = manualRoutineInput();
    input.exercises[0].sets[0].reps = reps;
    assert.throws(() => validateManualRoutine(input));
  }
  const duplicate = manualRoutineInput();
  duplicate.exercises.push(structuredClone(duplicate.exercises[0]));
  assert.throws(() => validateManualRoutine(duplicate), /already in the routine/i);

  const tooManySets = manualRoutineInput();
  tooManySets.exercises[0].sets = Array.from({ length: 21 }, () => ({ reps: 1, weight: 0, completed: false, note: '' }));
  assert.throws(() => validateManualRoutine(tooManySets), /20 sets or fewer/i);
});

test('manual routine keeps valid metadata and editable text', () => {
  const input = manualRoutineInput();
  const result = validateManualRoutine(input as any);
  assert.equal(result.name, 'Custom day');
  assert.equal(result.description, 'My notes');
  assert.equal((result.exercises[0] as any).equipment, 'cable');
  assert.equal((result.exercises[0].sets[0] as any).note, 'slow eccentric');
});

test('manual profile enforces profile field bounds', () => {
  assert.throws(() => validateManualProfile({ age: 12 }));
  assert.throws(() => validateManualProfile({ age: 101 }));
  assert.throws(() => validateManualProfile({ height: 261 }));
  assert.throws(() => validateManualProfile({ weight: 19 }));
  assert.deepEqual(validateManualProfile({ age: 35, height: 175, weight: 72, sex: 'other' }), {
    age: 35, height: 175, weight: 72, sex: 'other',
  });
});

test('finishing a workout requires a completed set and reps or a recorded duration', () => {
  const exercise: WorkoutExercise = { exerciseId: 'plank', name: 'Plank', sets: [{ reps: 0, weight: 0, completed: false }] };
  assert.throws(() => validateWorkout('Session', [exercise]), /complete at least one set/i);
  assert.throws(() => validateWorkout('Session', [{ ...exercise, sets: [{ reps: 0, weight: 0, completed: true }] }]), /needs reps or a recorded duration/i);
  assert.doesNotThrow(() => validateWorkout('Session', [{ ...exercise, sets: [{ reps: 8, weight: 0, completed: true }] }]));
  assert.doesNotThrow(() => validateWorkout('Session', [{ ...exercise, sets: [{ reps: 0, weight: 0, completed: true, timeTaken: 30 }] }]));
});

test('incomplete timed sets do not add active time, intensity, or volume', () => {
  const workout = {
    duration: 100,
    exercises: [{ exerciseId: 'plank', name: 'Plank', sets: [
      { reps: 0, weight: 0, completed: false, timeTaken: 50 },
      { reps: 0, weight: 0, completed: true, timeTaken: 20 },
      { reps: 5, weight: 10, completed: false, timeTaken: 15 },
    ] }],
  };
  assert.equal(getWorkoutActiveTime(workout), 20);
  assert.equal(getWorkoutVolume(workout), 0);
  assert.equal(getWorkoutIntensity(workout), 20);
});
