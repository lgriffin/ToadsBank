/**
 * Stock of one item in one source. `available` is what general requests and new raid allocations may still take:
 * observed - pending outgoing - raid held - direct reserved, never below zero (TB-GM-02).
 */
export interface StockLine {
  observed: number;
  pendingOutgoing: number;
  raidHeld: number;
  directReserved: number;
  available: number;
}

export function stockLine(parts: Omit<StockLine, 'available'>): StockLine {
  return {
    ...parts,
    available: Math.max(0, parts.observed - parts.pendingOutgoing - parts.raidHeld - parts.directReserved),
  };
}

export function addLines(a: StockLine, b: StockLine): StockLine {
  return {
    observed: a.observed + b.observed,
    pendingOutgoing: a.pendingOutgoing + b.pendingOutgoing,
    raidHeld: a.raidHeld + b.raidHeld,
    directReserved: a.directReserved + b.directReserved,
    available: a.available + b.available,
  };
}

export const EMPTY_LINE: StockLine = { observed: 0, pendingOutgoing: 0, raidHeld: 0, directReserved: 0, available: 0 };
