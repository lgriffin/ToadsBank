/** Ordered schema migrations. Append a new entry for every change; never edit one that has shipped. */
export interface Migration {
  id: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [];
