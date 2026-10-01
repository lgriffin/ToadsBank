import {
  type Actor,
  DomainError,
  MAX_PARTS,
  type Part,
  type Snapshot,
  type Source,
  type TabDecision,
  TransportError,
  type ValidationIssue,
  applySnapshot,
  assembleParts,
  canUpload,
  decodeSnapshot,
  isAdmin,
  missingParts,
  nameFromLink,
  observedQuantities,
  parseParts,
  sourceKey,
  utf8Decode,
} from '@toadsbank/domain';
import { type Context, getSource } from './context';
import type { ImportSession, Receipt, Tx } from './ports';
import { sourceView } from './views';

export interface ImportProgress {
  exportId: string | null;
  received: number[];
  total: number | null;
  missing: number[];
  complete: boolean;
}

export interface PreviewTab {
  index: number;
  name: string;
  status: string;
  occupied: number;
  items: number;
  olderThanBaseline: boolean;
}

export interface Preview {
  snapshotId: string;
  source: { guild: string; realm: string; region: string };
  matchedSource: { id: string; name: string } | null;
  uploader: { name: string; realm: string };
  client: Snapshot['client'];
  capturedAt: number;
  completedAt: number;
  stable: boolean;
  tabs: PreviewTab[];
  warnings: string[];
  existingReceipt: Receipt | null;
}

function transportError(error: unknown): never {
  if (error instanceof TransportError) throw new DomainError('transport_error', error.message, { code: error.code });
  throw error;
}

/** ImportSnapshot: open a session, add pasted parts, preview, accept (TB-BM-06 to 10, TB-DM-07). */
export class ImportSnapshot {
  constructor(private readonly ctx: Context) {}

  open(actor: Actor): Promise<Pick<ImportSession, 'id' | 'openedAt' | 'expiresAt'>> {
    return this.ctx.run(async (tx) => {
      const now = this.ctx.now();
      const session: ImportSession = {
        id: this.ctx.id('imp'),
        openedBy: actor.memberId,
        openedAt: now,
        expiresAt: now + this.ctx.policy.importSessionSeconds,
        exportId: null,
        parts: [],
      };
      await tx.importSessions.put(session);
      return { id: session.id, openedAt: session.openedAt, expiresAt: session.expiresAt };
    });
  }

  async addParts(actor: Actor, sessionId: string, text: unknown): Promise<ImportProgress> {
    if (typeof text !== 'string' || text.length > 4 * 1024 * 1024) {
      throw new DomainError('bad_request', 'text must be a string of at most 4 MiB');
    }
    return this.ctx.run(async (tx) => {
      // Two pastes into one import must not both read the old part list and overwrite each other.
      await tx.lock([`import:${sessionId}`]);
      const session = await this.session(tx, actor, sessionId);
      let parts: Part[] = [];
      try {
        parts = parseParts(text);
      } catch (error) {
        transportError(error);
      }
      if (parts.length === 0)
        throw new DomainError('transport_error', 'no ToadsBank parts found in the text', { code: 'bad_header' });
      const byIndex = new Map(session.parts.map((p) => [p.index, p]));
      for (const part of parts) {
        const first = session.parts[0] ?? parts[0];
        if (part.exportId !== first?.exportId || part.total !== first.total || part.crc32 !== first.crc32) {
          throw new DomainError('transport_error', 'these parts belong to a different export than this import', {
            code: 'mixed_exports',
          });
        }
        const seen = byIndex.get(part.index);
        if (seen && seen.payload !== part.payload) {
          throw new DomainError('transport_error', `part ${part.index} was pasted twice with different content`, {
            code: 'conflicting_part',
          });
        }
        byIndex.set(part.index, part);
      }
      if (byIndex.size > MAX_PARTS)
        throw new DomainError('transport_error', `more than ${MAX_PARTS} parts`, { code: 'too_many_parts' });
      session.parts = [...byIndex.values()].sort((a, b) => a.index - b.index);
      session.exportId = session.parts[0]?.exportId ?? null;
      await tx.importSessions.put(session);
      return progress(session);
    });
  }

  preview(actor: Actor, sessionId: string): Promise<Preview> {
    return this.ctx.run(async (tx) => {
      const session = await this.session(tx, actor, sessionId);
      const { snapshot } = this.decode(session);
      const source = await findSource(tx, snapshot);
      const baselines = source
        ? new Map((await tx.baselines.find({ sourceId: source.id })).map((b) => [b.index, b]))
        : new Map();
      const existing = await tx.snapshots.get(snapshot.snapshotId);
      const warnings: string[] = [];
      if (!snapshot.stable) warnings.push('the bank changed during the scan; some tabs may be marked unstable');
      if (!source)
        warnings.push(
          isAdmin(actor)
            ? 'this bank is not registered yet; accepting registers it'
            : 'this bank is not registered; ask an admin to accept it',
        );
      const tabs = snapshot.tabs.map((tab) => {
        const baseline = baselines.get(tab.index);
        const olderThanBaseline =
          tab.status === 'observed' && baseline?.observedAt != null && baseline.observedAt > tab.observedAt;
        if (tab.status !== 'observed')
          warnings.push(`tab ${tab.index} was not read (${tab.status}) and keeps its previous observation`);
        if (olderThanBaseline)
          warnings.push(`tab ${tab.index} is older than what the site already has and is kept as history`);
        return {
          index: tab.index,
          name: tab.name,
          status: tab.status,
          occupied: tab.slots.length,
          items: new Set(tab.slots.map((s) => s.itemId)).size,
          olderThanBaseline,
        };
      });
      return {
        snapshotId: snapshot.snapshotId,
        source: { guild: snapshot.source.guild, realm: snapshot.source.realm, region: snapshot.source.region },
        matchedSource: source ? { id: source.id, name: source.name } : null,
        uploader: snapshot.uploader,
        client: snapshot.client,
        capturedAt: snapshot.capturedAt,
        completedAt: snapshot.completedAt,
        stable: snapshot.stable,
        tabs,
        warnings,
        existingReceipt: existing ? existing.receipt : null,
      };
    });
  }

  accept(actor: Actor, sessionId: string, idempotencyKey: string): Promise<Receipt> {
    return this.ctx.run((tx) =>
      this.ctx.once(tx, actor, idempotencyKey, 'import.accept', { sessionId }, async () => {
        await tx.lock([`import:${sessionId}`]);
        const session = await this.session(tx, actor, sessionId);
        const { snapshot, canonical } = this.decode(session);
        // The bank's key and the snapshot id are locked before anything is read, so two first imports of one bank
        // register it once and the same export accepted twice at once is stored once (TB-BM-07, TB-BM-10).
        await tx.lock([`sourceKey:${sourceKey(snapshot.source)}`, `snapshot:${snapshot.snapshotId}`]);
        const existing = await tx.snapshots.get(snapshot.snapshotId);
        if (existing) {
          // TB-BM-07: the same export again returns the earlier receipt; different content under its id is refused.
          if (existing.canonical !== canonical) {
            throw new DomainError(
              'snapshot_conflict',
              `snapshot ${snapshot.snapshotId} was already imported with different content`,
            );
          }
          await tx.importSessions.delete(session.id);
          return { ...existing.receipt, duplicate: true };
        }
        const found = (await findSource(tx, snapshot)) ?? (await this.register(tx, actor, snapshot));
        await tx.lock([`source:${found.id}`]);
        // Read the bank again under its lock: a rename or a manager change may have committed since.
        const source = await getSource(tx, found.id);
        if (!canUpload(source, actor))
          throw new DomainError('forbidden', `you may not upload snapshots of ${source.name}`);
        const receipt = await this.applyToSource(tx, actor, source, snapshot);
        await tx.snapshots.put({
          id: snapshot.snapshotId,
          sourceId: source.id,
          canonical,
          capturedAt: snapshot.capturedAt,
          acceptedAt: receipt.acceptedAt,
          acceptedBy: actor.memberId,
          receipt,
        });
        await tx.importSessions.delete(session.id);
        const fresh = (await tx.sources.get(source.id)) as Source;
        await this.ctx.emit(tx, 'snapshot.accepted', {
          source: sourceView(fresh, this.ctx.now(), this.ctx.policy.freshness),
          receipt,
          uploader: snapshot.uploader,
        });
        return receipt;
      }),
    );
  }

  private async applyToSource(tx: Tx, actor: Actor, source: Source, snapshot: Snapshot): Promise<Receipt> {
    const now = this.ctx.now();
    const current = new Map((await tx.baselines.find({ sourceId: source.id })).map((b) => [b.index, b]));
    const before = observedQuantities(current.values());
    const decisions = applySnapshot(source.id, snapshot, current);
    for (const decision of decisions) {
      if (decision.outcome !== 'keptAsHistory')
        await tx.baselines.put({ id: `${source.id}:${decision.index}`, ...decision.baseline });
    }
    const updated = decisions.filter((d) => d.outcome === 'updated');
    const latest = Math.max(source.lastObservedAt ?? 0, ...updated.map((d) => d.baseline.observedAt ?? 0));
    await tx.sources.put({
      ...source,
      revision: source.revision + 1,
      lastObservedAt: latest > 0 ? latest : source.lastObservedAt,
    });
    await this.learnNames(tx, snapshot);
    const counted = [...current.values()].filter((b) => b.observedAt !== null).map((b) => b.index);
    const covering = coversEveryTab(decisions, counted);
    const after = observedQuantities((await tx.baselines.find({ sourceId: source.id })).values());
    await this.reconcile(tx, source.id, snapshot, covering, before, after);
    await this.ctx.audit(tx, actor.memberId, 'snapshot.accepted', {
      sourceId: source.id,
      snapshotId: snapshot.snapshotId,
    });
    return {
      snapshotId: snapshot.snapshotId,
      sourceId: source.id,
      acceptedAt: now,
      tabsUpdated: updated.map((d) => d.index),
      tabsKeptAsHistory: decisions.filter((d) => d.outcome === 'keptAsHistory').map((d) => d.index),
      tabsNotRead: decisions.filter((d) => d.outcome === 'notRead').map((d) => d.index),
      duplicate: false,
    };
  }

  /**
   * TB-BM-14/15: a covering observation captured after a delivery clears that pending outgoing. A drop in quantity
   * that matches the cleared deliveries is labelled consistent with reported movement; any other drop is flagged for
   * review. Neither says who was fulfilled.
   */
  private async reconcile(
    tx: Tx,
    sourceId: string,
    snapshot: Snapshot,
    covering: boolean,
    before: Map<number, number>,
    after: Map<number, number>,
  ) {
    const reported = new Map<number, number>();
    if (covering) {
      for (const delivery of await tx.deliveries.find({ sourceId, cleared: false })) {
        if (delivery.deliveredAt > snapshot.capturedAt) continue;
        reported.set(delivery.itemId, (reported.get(delivery.itemId) ?? 0) + delivery.quantity);
        await tx.deliveries.put({ ...delivery, cleared: true, clearedBySnapshot: snapshot.snapshotId });
      }
    }
    const items = new Set([...before.keys(), ...reported.keys()]);
    for (const itemId of items) {
      const was = before.get(itemId) ?? 0;
      const now = after.get(itemId) ?? 0;
      const moved = reported.get(itemId) ?? 0;
      if (was <= now && moved === 0) continue;
      const drop = Math.max(0, was - now);
      await tx.reconciliations.put({
        id: this.ctx.id('rec'),
        sourceId,
        itemId,
        snapshotId: snapshot.snapshotId,
        before: was,
        after: now,
        reported: moved,
        label: drop === moved ? 'consistent_with_reported_movement' : 'unexplained_decrease',
        resolved: drop === moved,
        resolvedBy: null,
        resolution: null,
        createdAt: this.ctx.now(),
      });
    }
  }

  private async learnNames(tx: Tx, snapshot: Snapshot): Promise<void> {
    const names = new Map<number, string>();
    for (const tab of snapshot.tabs) {
      for (const slot of tab.slots) {
        const name = nameFromLink(slot.link);
        if (name) names.set(slot.itemId, name);
      }
    }
    for (const [itemId, name] of names) {
      const known = await tx.items.get(String(itemId));
      if (known?.name !== name) await tx.items.put({ id: String(itemId), itemId, name });
    }
  }

  private async register(tx: Tx, actor: Actor, snapshot: Snapshot): Promise<Source> {
    if (!isAdmin(actor)) {
      throw new DomainError(
        'unknown_source',
        `${snapshot.source.guild} on ${snapshot.source.realm} is not a registered bank; an admin must accept its first import`,
      );
    }
    const source: Source = {
      id: this.ctx.id('src'),
      key: sourceKey(snapshot.source),
      revision: 1,
      name: `${snapshot.source.guild} bank`,
      kind: 'guildBank',
      guild: snapshot.source.guild,
      realm: snapshot.source.realm,
      region: snapshot.source.region,
      audience: 'members',
      raidDay: null,
      managers: [actor.memberId],
      lastObservedAt: null,
      createdAt: this.ctx.now(),
    };
    await tx.sources.put(source);
    await this.ctx.audit(tx, actor.memberId, 'source.registered', { sourceId: source.id, via: 'import' });
    return source;
  }

  private async session(tx: Tx, actor: Actor, id: string): Promise<ImportSession> {
    const session = await tx.importSessions.get(id);
    if (!session || session.openedBy !== actor.memberId) throw new DomainError('not_found', `no import ${id}`);
    if (session.expiresAt <= this.ctx.now()) {
      await tx.importSessions.delete(id);
      throw new DomainError('import_expired', 'this import expired; open a new one and paste the parts again');
    }
    return session;
  }

  private decode(session: ImportSession): { snapshot: Snapshot; canonical: string } {
    const first = session.parts[0];
    if (!first) throw new DomainError('incomplete', 'no parts yet', { missing: [] });
    const missing = missingParts(
      first.total,
      session.parts.map((p) => p.index),
    );
    if (missing.length > 0) throw new DomainError('incomplete', `missing parts ${missing.join(', ')}`, { missing });
    let bytes: Uint8Array;
    try {
      bytes = assembleParts(session.parts);
    } catch (error) {
      transportError(error);
    }
    const result = decodeSnapshot(bytes, this.ctx.now());
    if (!result.ok)
      throw new DomainError('invalid_snapshot', 'the snapshot failed validation', {
        issues: result.issues satisfies ValidationIssue[],
      });
    return { snapshot: result.snapshot, canonical: utf8Decode(bytes) };
  }
}

/**
 * TB-BM-14: only an observation that read every tab of the bank, each one newer than what was there, can show that a
 * pending outgoing has left. `countedTabs` are the tabs whose slots the stock already counts (observed at least once);
 * a scan with no tabs, or one that skipped or could not read any of them, covers nothing.
 */
export function coversEveryTab(decisions: readonly TabDecision[], countedTabs: Iterable<number>): boolean {
  if (decisions.length === 0 || !decisions.every((d) => d.outcome === 'updated')) return false;
  const seen = new Set(decisions.map((d) => d.index));
  for (const index of countedTabs) if (!seen.has(index)) return false;
  return true;
}

async function findSource(tx: Tx, snapshot: Snapshot): Promise<Source | undefined> {
  return (await tx.sources.find({ key: sourceKey(snapshot.source) }))[0];
}

function progress(session: ImportSession): ImportProgress {
  const total = session.parts[0]?.total ?? null;
  const received = session.parts.map((p) => p.index);
  const missing = total === null ? [] : missingParts(total, received);
  return { exportId: session.exportId, received, total, missing, complete: total !== null && missing.length === 0 };
}
