import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { assertApplicable, mergeRoutineEdit, profileSnapshot, proposalSchema, routineSnapshot, sameSnapshot, type CoachProposal } from './coach-contract';
import { proposalResult } from './demo';

export async function applyCoachProposal(uid: string, conversationId: string, raw: CoachProposal): Promise<string> {
  const proposal = proposalSchema.parse(raw);
  const conversation = doc(db, 'users', uid, 'conversations', conversationId);
  // An immutable chat message is also the write receipt, using existing Firestore rules.
  const receipt = doc(db, 'users', uid, 'conversations', conversationId, 'messages', `change-${proposal.id}`);
  const target = proposal.kind === 'profile' ? doc(db, 'users', uid) : doc(db, 'routines', proposal.kind === 'create' ? proposal.id : proposal.targetId!);
  return runTransaction(db, async tx => {
    const previous = await tx.get(receipt);
    if (previous.exists()) return previous.data().text as string;
    const chat = await tx.get(conversation);
    if (!chat.exists() || !sameSnapshot(chat.data().pendingProposal, proposal)) throw new Error('This preview is no longer current. Ask the coach for a fresh preview.');
    // Existing rules allow reads only for owned, existing routine documents.
    // Do not read a new UUID path: the immutable receipt + current preview
    // make creation idempotent, and rules reject overwriting existing data.
    const snapshot = proposal.kind === 'create' ? null : await tx.get(target);
    if (proposal.kind === 'create') {
      assertApplicable(proposal, null);
    } else {
      if (!snapshot!.exists()) throw new Error('The original data no longer exists. Refresh before applying changes.');
      const data = snapshot!.data();
      if ((proposal.kind === 'profile' ? data.uid : data.userId) !== uid) throw new Error('You can only change your own data.');
      assertApplicable(proposal, proposal.kind === 'profile' ? profileSnapshot(data) : routineSnapshot({ ...data, id: snapshot!.id }));
    }
    const text = proposalResult(proposal);
    if (proposal.kind === 'create') tx.set(target, { ...proposal.after!, userId: uid, createdAt: serverTimestamp() });
    else if (proposal.kind === 'edit') tx.update(target, { ...mergeRoutineEdit(snapshot!.data(), proposal.after!), updatedAt: serverTimestamp() });
    else if (proposal.kind === 'delete') tx.delete(target);
    else tx.update(target, { ...proposal.profilePatch!, updatedAt: serverTimestamp() });
    tx.set(receipt, { role: 'bot', text, timestamp: serverTimestamp() });
    tx.update(conversation, { pendingProposal: null, lastMessage: text, updatedAt: serverTimestamp() });
    return text;
  });
}

export async function applyGoalProposal(uid: string, raw: CoachProposal, patch: Record<string, unknown>) {
  const proposal = proposalSchema.parse(raw);
  const keys = Object.keys(patch);
  if (proposal.kind !== 'profile' || keys.length !== 1 || !['shortTermGoal', 'longTermGoal'].includes(keys[0]) || patch[keys[0]] !== proposal.profilePatch?.[keys[0]]) throw new Error('Invalid goal preview. Ask for a fresh suggestion.');
  const ref = doc(db, 'users', uid);
  await runTransaction(db, async tx => {
    const current = await tx.get(ref);
    if (!current.exists() || current.data().uid !== uid) throw new Error('Your profile could not be verified.');
    if (current.data()[keys[0]] === patch[keys[0]]) return;
    assertApplicable(proposal, profileSnapshot(current.data()));
    tx.update(ref, patch);
  });
}
