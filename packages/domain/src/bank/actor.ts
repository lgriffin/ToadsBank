export type Role = 'member' | 'officer' | 'admin';

/** Who is acting. The hub resolves it from its own login; the core only reads it. */
export interface Actor {
  memberId: string;
  name: string;
  roles: readonly Role[];
}

export const isAdmin = (actor: Actor) => actor.roles.includes('admin');
export const isOfficer = (actor: Actor) => isAdmin(actor) || actor.roles.includes('officer');
