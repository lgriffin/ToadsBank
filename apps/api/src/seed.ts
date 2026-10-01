import type { Bank } from '@toadsbank/application';
import { type Actor, type Json, canonicalJson, encodeParts, formatPart, utf8Encode } from '@toadsbank/domain';

const ITEMS: Array<[number, string, number]> = [
  [22832, 'Super Mana Potion', 60],
  [22829, 'Super Healing Potion', 45],
  [22838, 'Haste Potion', 20],
  [22854, 'Flask of Relentless Assault', 12],
  [22861, 'Flask of Blinding Light', 8],
  [21886, 'Primal Life', 30],
];

/** Dev and demo data: the Toads organisation with one scanned guild bank (compose.dev.yaml runs this). */
export async function seed(bank: Bank, now: number, adminId = '0'): Promise<string> {
  const admin: Actor = { memberId: adminId, name: 'Seed', roles: ['member', 'officer', 'admin'] };
  const existing = await bank.inventory.sources(admin);
  if (existing.length > 0) return 'already seeded';
  const slots = ITEMS.map(([itemId, name, count], i) => ({
    slot: i + 1,
    itemId,
    count,
    link: `|cffffffff|Hitem:${itemId}::::::::70:::::|h[${name}]|h|r`,
  }));
  const snapshot = {
    schema: 'toadsbank.snapshot',
    schemaVersion: 1,
    snapshotId: `seed-toads-${now}`,
    addon: { version: '0.0.0-seed' },
    client: { flavour: 'forever', build: '0.0.0', interface: 0 },
    source: { kind: 'guildBank', guild: 'Toads', realm: 'Spineshatter', region: 'EU' },
    uploader: { name: 'Seedalt', realm: 'Spineshatter' },
    capturedAt: now - 60,
    completedAt: now - 30,
    stable: true,
    money: 12_345_678,
    tabs: [
      {
        index: 1,
        name: 'Consumables',
        status: 'observed',
        capacity: 98,
        observedAt: now - 50,
        slots: slots.slice(0, 5),
      },
      {
        index: 2,
        name: 'Mats',
        status: 'observed',
        capacity: 98,
        observedAt: now - 40,
        slots: slots.slice(5).map((s, i) => ({ ...s, slot: i + 1 })),
      },
      { index: 3, name: 'Officers', status: 'unknown', capacity: 98, observedAt: now - 30, slots: [] },
    ],
  };
  const session = await bank.imports.open(admin);
  const text = encodeParts(utf8Encode(canonicalJson(snapshot as Json)), snapshot.snapshotId)
    .map(formatPart)
    .join('\n\n');
  await bank.imports.addParts(admin, session.id, text);
  const receipt = await bank.imports.accept(admin, session.id, `seed-${now}`);
  return `seeded ${receipt.sourceId}`;
}
