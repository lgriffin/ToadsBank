import { timingSafeEqual } from 'node:crypto';
import type { Bank, RequestScope } from '@toadsbank/application';
import { type Actor, DomainError, type DomainErrorCode, type Role } from '@toadsbank/domain';
import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export interface HealthProbe {
  /** True when the service's real dependency (the database, migrated) answers. */
  ready(): Promise<boolean>;
}

export interface HttpOptions {
  bank: Bank;
  health: HealthProbe;
  serviceToken: string;
  /** Called for unexpected errors; the response is a bare 500 either way. */
  onError?: (error: unknown) => void;
}

const STATUS: Record<DomainErrorCode, ContentfulStatusCode> = {
  bad_request: 400,
  validation_failed: 400,
  forbidden: 403,
  not_found: 404,
  stale_revision: 409,
  idempotency_conflict: 409,
  insufficient_stock: 409,
  snapshot_conflict: 409,
  invalid_transition: 409,
  over_allocated: 409,
  transport_error: 422,
  invalid_snapshot: 422,
  unknown_source: 422,
  import_expired: 422,
  incomplete: 422,
  source_stale: 423,
};

const ROLES: readonly Role[] = ['member', 'officer', 'admin'];
const MAX_BODY_BYTES = 6 * 1024 * 1024;

type Env = { Variables: { actor: Actor } };

function tokensMatch(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The IdentityProvider adapter for a hub-hosted bank (docs/adr/0002): the Toads hub signs members in with Discord,
 * then calls this API with the shared service token and names the member in X-Toads-* headers.
 */
export function hubIdentity(c: Context, serviceToken: string): Actor | undefined {
  const auth = c.req.header('authorization') ?? '';
  if (!auth.startsWith('Bearer ') || !serviceToken || !tokensMatch(auth.slice(7), serviceToken)) return undefined;
  const memberId = c.req.header('x-toads-member') ?? '';
  if (!/^\d{1,20}$/.test(memberId)) return undefined;
  let name = memberId;
  try {
    name = decodeURIComponent(c.req.header('x-toads-name') ?? memberId).slice(0, 64) || memberId;
  } catch {
    // A malformed name falls back to the id.
  }
  const roles = (c.req.header('x-toads-roles') ?? 'member')
    .split(',')
    .map((r) => r.trim())
    .filter((r): r is Role => ROLES.includes(r as Role));
  return { memberId, name, roles: roles.length ? roles : ['member'] };
}

function key(c: Context): string {
  const value = c.req.header('idempotency-key');
  if (!value || value.length > 128)
    throw new DomainError('bad_request', 'an Idempotency-Key header of 1 to 128 characters is required');
  return value;
}

async function body(c: Context): Promise<Record<string, unknown>> {
  try {
    const parsed = await c.req.json();
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch {
    throw new DomainError('bad_request', 'the body must be a JSON object');
  }
}

export function createApp(options: HttpOptions): Hono<Env> {
  const { bank } = options;
  const app = new Hono<Env>();

  app.get('/health', async (c) => {
    const ok = await options.health.ready();
    return c.json({ ok }, ok ? 200 : 503);
  });

  app.use('/v1/*', async (c, next) => {
    const actor = hubIdentity(c, options.serviceToken);
    if (!actor)
      return c.json({ error: { code: 'unauthorised', message: 'a valid service token and member are required' } }, 401);
    c.set('actor', actor);
    await next();
  });

  // The limit counts the bytes actually read, so a chunked body or a false Content-Length cannot get past it.
  app.use(
    '/v1/*',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: () => {
        throw new DomainError('bad_request', 'request body is too large');
      },
    }),
  );

  app.onError((error, c) => {
    if (error instanceof DomainError) {
      return c.json(
        {
          error: {
            code: error.code,
            message: error.message,
            details: error.details ?? null,
            current: error.current ?? null,
          },
        },
        STATUS[error.code],
      );
    }
    options.onError?.(error);
    return c.json({ error: { code: 'internal', message: 'something went wrong' } }, 500);
  });

  const actor = (c: Context<Env>) => c.get('actor');

  // Imports
  app.post('/v1/imports', async (c) => c.json(await bank.imports.open(actor(c)), 201));
  app.post('/v1/imports/:id/parts', async (c) =>
    c.json(await bank.imports.addParts(actor(c), c.req.param('id'), (await body(c)).text)),
  );
  app.get('/v1/imports/:id/preview', async (c) => c.json(await bank.imports.preview(actor(c), c.req.param('id'))));
  app.post('/v1/imports/:id/accept', async (c) =>
    c.json(await bank.imports.accept(actor(c), c.req.param('id'), key(c))),
  );

  // Sources and inventory
  app.get('/v1/sources', async (c) => c.json(await bank.inventory.sources(actor(c))));
  app.post('/v1/sources', async (c) => c.json(await bank.sources.create(actor(c), await body(c), key(c)), 201));
  app.patch('/v1/sources/:id', async (c) =>
    c.json(await bank.sources.update(actor(c), c.req.param('id'), await body(c), key(c))),
  );
  app.get('/v1/sources/:id/replica', async (c) => c.json(await bank.inventory.replica(actor(c), c.req.param('id'))));
  app.get('/v1/inventory', async (c) =>
    c.json(
      await bank.inventory.inventory(actor(c), {
        q: c.req.query('q') ?? undefined,
        sourceId: c.req.query('sourceId') ?? undefined,
      }),
    ),
  );

  // Requests
  app.post('/v1/requests', async (c) => c.json(await bank.requests.create(actor(c), await body(c), key(c)), 201));
  app.get('/v1/requests', async (c) => {
    const scope = (c.req.query('scope') ?? 'mine') as RequestScope;
    if (!['mine', 'queue', 'all'].includes(scope))
      throw new DomainError('bad_request', 'scope must be mine, queue or all');
    return c.json(await bank.requests.list(actor(c), scope, c.req.query('status') ?? undefined));
  });
  app.post('/v1/requests/:id/cancel', async (c) =>
    c.json(await bank.requests.cancel(actor(c), c.req.param('id'), (await body(c)).expectedRevision, key(c))),
  );
  app.post('/v1/requests/:id/approve', async (c) => {
    const b = await body(c);
    return c.json(await bank.fulfil.approve(actor(c), c.req.param('id'), b.expectedRevision, b.note, key(c)));
  });
  app.post('/v1/requests/:id/reject', async (c) => {
    const b = await body(c);
    return c.json(await bank.fulfil.reject(actor(c), c.req.param('id'), b.expectedRevision, b.note, key(c)));
  });
  app.post('/v1/requests/:id/deliveries', async (c) => {
    const b = await body(c);
    return c.json(
      await bank.fulfil.recordDelivery(actor(c), c.req.param('id'), b.expectedRevision, b.quantity, key(c)),
    );
  });

  // Reconciliation
  app.get('/v1/reviews', async (c) =>
    c.json(
      await bank.reconcile.reviews(actor(c), {
        sourceId: c.req.query('sourceId') ?? undefined,
        open: c.req.query('open') === 'true',
      }),
    ),
  );
  app.post('/v1/reviews/:id/resolve', async (c) =>
    c.json(await bank.reconcile.resolve(actor(c), c.req.param('id'), (await body(c)).resolution, key(c))),
  );

  // Raids
  app.get('/v1/raid-profiles', async (c) => c.json(await bank.raids.profiles()));
  app.post('/v1/raid-profiles', async (c) =>
    c.json(await bank.raids.createProfile(actor(c), await body(c), key(c)), 201),
  );
  app.post('/v1/raid-profiles/:id/occurrences', async (c) =>
    c.json(await bank.raids.createOccurrence(actor(c), c.req.param('id'), await body(c), key(c)), 201),
  );
  app.get('/v1/occurrences', async (c) =>
    c.json(await bank.raids.occurrences({ profileId: c.req.query('profileId') ?? undefined })),
  );
  app.get('/v1/occurrences/:id', async (c) => c.json(await bank.raids.view(actor(c), c.req.param('id'))));
  app.post('/v1/occurrences/:id/allocations', async (c) =>
    c.json(await bank.raids.allocate(actor(c), c.req.param('id'), await body(c), key(c)), 201),
  );
  app.post('/v1/occurrences/:id/allocations/:allocationId/release', async (c) =>
    c.json(
      await bank.raids.release(
        actor(c),
        c.req.param('id'),
        c.req.param('allocationId'),
        (await body(c)).quantity,
        key(c),
      ),
    ),
  );

  return app;
}
