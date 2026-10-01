import { type Actor, isAdmin, isDelegatedManager, isDelegatedUploader, isOfficer } from './actor';

export type Audience = 'members' | 'officers';
export type Freshness = 'fresh' | 'warn' | 'stale' | 'never';

/** One physical bank, whoever uploads it (TB-BM-10). Guild banks are keyed by guild, realm and region. */
export interface Source {
  id: string;
  /** sourceKey(guild, realm, region): how exports from any uploader find this bank. */
  key: string;
  revision: number;
  name: string;
  kind: 'guildBank';
  guild: string;
  realm: string;
  region: string;
  audience: Audience;
  raidDay: string | null;
  managers: string[];
  lastObservedAt: number | null;
  createdAt: number;
}

export interface FreshnessPolicy {
  warnAfterSeconds: number;
  blockAfterSeconds: number;
}

export const DEFAULT_FRESHNESS: FreshnessPolicy = { warnAfterSeconds: 24 * 3600, blockAfterSeconds: 72 * 3600 };

export function sourceKey(bank: { guild: string; realm: string; region: string }): string {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  return `guildBank|${norm(bank.guild)}|${norm(bank.realm)}|${norm(bank.region)}`;
}

export function freshness(source: Pick<Source, 'lastObservedAt'>, now: number, policy = DEFAULT_FRESHNESS): Freshness {
  if (source.lastObservedAt === null) return 'never';
  const age = now - source.lastObservedAt;
  if (age > policy.blockAfterSeconds) return 'stale';
  if (age > policy.warnAfterSeconds) return 'warn';
  return 'fresh';
}

/** TB-GM-08: no new holds against a source whose latest observation is past the block threshold. */
export function blocksReservations(source: Pick<Source, 'lastObservedAt'>, now: number, policy = DEFAULT_FRESHNESS) {
  const state = freshness(source, now, policy);
  return state === 'stale' || state === 'never';
}

/** TB-GM-04: sources a member may not see stay out of everything shown to them. */
export function canSee(source: Pick<Source, 'audience' | 'managers'>, actor: Actor): boolean {
  return source.audience === 'members' || isOfficer(actor) || source.managers.includes(actor.memberId);
}

/** TB-BM-17: a hub-vouched `manager` manages the bank its call touches, like one of the source's managers. */
export function canManage(source: Pick<Source, 'managers'>, actor: Actor): boolean {
  return isAdmin(actor) || isDelegatedManager(actor) || source.managers.includes(actor.memberId);
}

/** TB-BM-17: a hub-vouched `uploader` uploads the bank its call touches, like an officer. */
export function canUpload(source: Pick<Source, 'managers'>, actor: Actor): boolean {
  return isOfficer(actor) || isDelegatedUploader(actor) || source.managers.includes(actor.memberId);
}
