import { DomainError, holdsStock, outstanding } from '@toadsbank/domain';
import type { OccurrenceDoc, Tx } from './ports';

/** TB-RL-05: what a raid request may still draw from one allocation: committed stock minus open raid requests. */
export async function raidAvailable(tx: Tx, occurrenceId: string, sourceId: string, itemId: number): Promise<number> {
  await activeOccurrence(tx, occurrenceId);
  const [allocation] = await tx.allocations.find({ occurrenceId, sourceId, itemId });
  const committed = allocation?.quantity ?? 0;
  const requests = await tx.requests.find({ occurrenceId, sourceId, itemId });
  const drawn = requests.filter(holdsStock).reduce((n, r) => n + outstanding(r), 0);
  return Math.max(0, committed - drawn);
}

/** The raid night, which must exist and still be active. */
export async function activeOccurrence(tx: Tx, occurrenceId: string): Promise<OccurrenceDoc> {
  const occurrence = await tx.occurrences.get(occurrenceId);
  if (!occurrence) throw new DomainError('not_found', `no raid ${occurrenceId}`);
  if (occurrence.status !== 'active') throw new DomainError('invalid_transition', 'this raid has expired');
  return occurrence;
}

export async function raidManagers(tx: Tx, occurrenceId: string): Promise<string[]> {
  const occurrence = await tx.occurrences.get(occurrenceId);
  const profile = occurrence ? await tx.raidProfiles.get(occurrence.profileId) : undefined;
  return profile?.managers ?? [];
}
