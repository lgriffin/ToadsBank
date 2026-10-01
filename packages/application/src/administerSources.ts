import { type Actor, type Audience, DomainError, type Source, isAdmin, sourceKey } from '@toadsbank/domain';
import { type Context, checkRevision, getSource, requireString } from './context';
import { type SourceView, sourceView } from './views';

export interface SourceInput {
  name?: unknown;
  guild?: unknown;
  realm?: unknown;
  region?: unknown;
  audience?: unknown;
  raidDay?: unknown;
  managers?: unknown;
}

/** AdministerSources: register banks, set who sees and manages them (TB-BM-10). Admins only. */
export class AdministerSources {
  constructor(private readonly ctx: Context) {}

  create(actor: Actor, input: SourceInput, idempotencyKey: string): Promise<SourceView> {
    requireAdmin(actor);
    return this.ctx.run((tx) =>
      this.ctx.once(tx, actor, idempotencyKey, 'source.create', input, async () => {
        const bank = {
          guild: requireString(input.guild, 'guild', 1, 64),
          realm: requireString(input.realm, 'realm', 1, 64),
          region: typeof input.region === 'string' ? requireString(input.region, 'region', 0, 8) : '',
        };
        const key = sourceKey(bank);
        await tx.lock([`sourceKey:${key}`]);
        if ((await tx.sources.find({ key })).length > 0) {
          throw new DomainError('validation_failed', `${bank.guild} on ${bank.realm} is already registered`);
        }
        const source: Source = {
          id: this.ctx.id('src'),
          key,
          revision: 1,
          name: requireString(input.name ?? `${bank.guild} bank`, 'name', 1, 64),
          kind: 'guildBank',
          ...bank,
          audience: audience(input.audience ?? 'members'),
          raidDay: raidDay(input.raidDay ?? null),
          managers: managers(input.managers ?? []),
          lastObservedAt: null,
          createdAt: this.ctx.now(),
        };
        await tx.sources.put(source);
        await this.ctx.audit(tx, actor.memberId, 'source.registered', { sourceId: source.id });
        return sourceView(source, this.ctx.now(), this.ctx.policy.freshness);
      }),
    );
  }

  update(
    actor: Actor,
    id: string,
    input: SourceInput & { expectedRevision?: unknown },
    idempotencyKey: string,
  ): Promise<SourceView> {
    requireAdmin(actor);
    return this.ctx.run((tx) =>
      this.ctx.once(tx, actor, idempotencyKey, 'source.update', { id, input }, async () => {
        await tx.lock([`source:${id}`]);
        const source = await getSource(tx, id);
        checkRevision('the bank', source, input.expectedRevision);
        const next: Source = {
          ...source,
          revision: source.revision + 1,
          name: input.name === undefined ? source.name : requireString(input.name, 'name', 1, 64),
          audience: input.audience === undefined ? source.audience : audience(input.audience),
          raidDay: input.raidDay === undefined ? source.raidDay : raidDay(input.raidDay),
          managers: input.managers === undefined ? source.managers : managers(input.managers),
        };
        await tx.sources.put(next);
        await this.ctx.audit(tx, actor.memberId, 'source.updated', { sourceId: id });
        return sourceView(next, this.ctx.now(), this.ctx.policy.freshness, await tx.baselines.find({ sourceId: id }));
      }),
    );
  }
}

function requireAdmin(actor: Actor): void {
  if (!isAdmin(actor)) throw new DomainError('forbidden', 'only admins manage banks');
}

function audience(value: unknown): Audience {
  if (value !== 'members' && value !== 'officers')
    throw new DomainError('validation_failed', 'audience must be members or officers');
  return value;
}

function raidDay(value: unknown): string | null {
  if (value === null) return null;
  return requireString(value, 'raidDay', 1, 32);
}

function managers(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 20 ||
    !value.every((m) => typeof m === 'string' && /^\d{1,20}$/.test(m))
  ) {
    throw new DomainError('validation_failed', 'managers must be up to 20 Discord ids');
  }
  return [...new Set(value as string[])];
}
