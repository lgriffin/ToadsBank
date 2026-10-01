import { Base64Error, base64Decode, base64Encode } from './base64';
import { crc32Hex } from './crc32';

/**
 * Transport grammar TOADSBANK/1 (contracts/transport.md). A snapshot's canonical JSON bytes are cut into chunks of
 * PART_PAYLOAD_BYTES, a multiple of 3, so every part's base64 stands alone and only the last part carries padding.
 */
export const TRANSPORT_VERSION = 1;
export const PART_PAYLOAD_BYTES = 1269;
export const MAX_PART_CHARS = 1800;
export const MAX_PARTS = 800;
export const MAX_DECODED_BYTES = 1024 * 1024;
export const EXPORT_ID_PATTERN = /^[A-Za-z0-9-]{8,48}$/;

const HEADER = /^TOADSBANK\/(\d+) export=([A-Za-z0-9-]{8,48}) part=(\d{1,4})\/(\d{1,4}) crc32=([0-9a-f]{8})$/;

export interface Part {
  exportId: string;
  index: number;
  total: number;
  crc32: string;
  payload: string;
}

export class TransportError extends Error {
  constructor(
    readonly code:
      | 'bad_header'
      | 'unsupported_version'
      | 'bad_part_number'
      | 'too_many_parts'
      | 'mixed_exports'
      | 'conflicting_part'
      | 'missing_parts'
      | 'bad_base64'
      | 'crc_mismatch'
      | 'too_large',
    message: string,
  ) {
    super(message);
  }
}

export function partHeader(part: Omit<Part, 'payload'>): string {
  return `TOADSBANK/${TRANSPORT_VERSION} export=${part.exportId} part=${part.index}/${part.total} crc32=${part.crc32}`;
}

export function formatPart(part: Part): string {
  return `${partHeader(part)}\n${part.payload}`;
}

/** Cut a payload into parts; each formatted part fits MAX_PART_CHARS including its header. */
export function encodeParts(bytes: Uint8Array, exportId: string): Part[] {
  if (!EXPORT_ID_PATTERN.test(exportId)) throw new TransportError('bad_header', `bad export id ${exportId}`);
  const crc = crc32Hex(bytes);
  const total = Math.max(1, Math.ceil(bytes.length / PART_PAYLOAD_BYTES));
  if (total > MAX_PARTS) throw new TransportError('too_many_parts', `${total} parts exceeds ${MAX_PARTS}`);
  const parts: Part[] = [];
  for (let index = 1; index <= total; index++) {
    const chunk = bytes.subarray((index - 1) * PART_PAYLOAD_BYTES, index * PART_PAYLOAD_BYTES);
    parts.push({ exportId, index, total, crc32: crc, payload: base64Encode(chunk) });
  }
  return parts;
}

/**
 * Pull every part out of pasted text. Tolerates Discord code fences, quote markers, CRLF and blank lines, and a
 * payload wrapped over several lines. Text before the first header is ignored.
 */
export function parseParts(text: string): Part[] {
  const parts: Part[] = [];
  let current: Part | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw
      .replace(/^\s*>\s?/, '')
      .replace(/`/g, '')
      .trim();
    if (line === '') continue;
    if (line.startsWith('TOADSBANK/')) {
      const match = HEADER.exec(line);
      if (!match) throw new TransportError('bad_header', `unreadable part header: ${line.slice(0, 80)}`);
      const [, version, exportId, index, total, crc] = match as unknown as [
        string,
        string,
        string,
        string,
        string,
        string,
      ];
      if (Number(version) !== TRANSPORT_VERSION) {
        throw new TransportError('unsupported_version', `transport version ${version} is not supported`);
      }
      const n = Number(index);
      const of = Number(total);
      if (of < 1 || n < 1 || n > of) throw new TransportError('bad_part_number', `part ${n}/${of} is out of range`);
      if (of > MAX_PARTS) throw new TransportError('too_many_parts', `${of} parts exceeds ${MAX_PARTS}`);
      current = { exportId, index: n, total: of, crc32: crc, payload: '' };
      parts.push(current);
    } else if (current) {
      current.payload += line.replace(/\s+/g, '');
    }
  }
  return parts;
}

/** Reassemble parts in any order, check completeness and the CRC32, and return the payload bytes (TB-BM-06). */
export function assembleParts(parts: readonly Part[]): Uint8Array {
  const first = parts[0];
  if (!first) throw new TransportError('missing_parts', 'no parts');
  const byIndex = new Map<number, Part>();
  for (const part of parts) {
    if (part.exportId !== first.exportId || part.total !== first.total || part.crc32 !== first.crc32) {
      throw new TransportError('mixed_exports', 'parts come from different exports');
    }
    const seen = byIndex.get(part.index);
    if (seen && seen.payload !== part.payload) {
      throw new TransportError('conflicting_part', `part ${part.index} was pasted twice with different content`);
    }
    byIndex.set(part.index, part);
  }
  const missing = missingParts(first.total, byIndex.keys());
  if (missing.length > 0) throw new TransportError('missing_parts', `missing parts ${missing.join(', ')}`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let index = 1; index <= first.total; index++) {
    let chunk: Uint8Array;
    try {
      chunk = base64Decode((byIndex.get(index) as Part).payload);
    } catch (error) {
      if (error instanceof Base64Error) throw new TransportError('bad_base64', `part ${index}: ${error.message}`);
      throw error;
    }
    size += chunk.length;
    if (size > MAX_DECODED_BYTES) throw new TransportError('too_large', `payload exceeds ${MAX_DECODED_BYTES} bytes`);
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (crc32Hex(bytes) !== first.crc32) throw new TransportError('crc_mismatch', 'the CRC32 does not match the payload');
  return bytes;
}

export function missingParts(total: number, present: Iterable<number>): number[] {
  const have = new Set(present);
  const missing: number[] = [];
  for (let index = 1; index <= total; index++) if (!have.has(index)) missing.push(index);
  return missing;
}
