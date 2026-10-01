/**
 * `uploader` and `manager` are delegations the hub vouches for on one call (docs/api.md): the hub has already checked
 * that the member may upload or manage the bank the call touches. Neither carries officer or admin powers.
 */
export type Role = 'member' | 'officer' | 'admin' | 'uploader' | 'manager';

/** Who is acting. The hub resolves it from its own login; the core only reads it. */
export interface Actor {
  memberId: string;
  name: string;
  roles: readonly Role[];
  /**
   * The banks (source ids) the hub vouches for on this call (X-Toads-Banks). The `uploader` and `manager` roles act
   * only on these: a delegation never reaches a bank the hub did not name (TB-BM-17).
   */
  banks?: readonly string[];
}

export const isAdmin = (actor: Actor) => actor.roles.includes('admin');
export const isOfficer = (actor: Actor) => isAdmin(actor) || actor.roles.includes('officer');
/** TB-BM-17: the hub vouches that this member uploads or manages the bank this call touches. */
export const isDelegatedUploader = (actor: Actor) => actor.roles.includes('uploader');
export const isDelegatedManager = (actor: Actor) => actor.roles.includes('manager');
/** Whether the hub named this bank on this call (TB-BM-17). */
export const vouchedFor = (actor: Actor, sourceId: string) => actor.banks?.includes(sourceId) ?? false;
