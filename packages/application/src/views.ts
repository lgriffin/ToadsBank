import {
  type BankRequest,
  type FreshnessPolicy,
  type Source,
  type TabBaseline,
  freshness,
  outstanding,
} from '@toadsbank/domain';

export interface TabSummary {
  index: number;
  name: string;
  status: TabBaseline['lastStatus'];
  observedAt: number | null;
  capacity: number;
}

export interface SourceView extends Omit<Source, 'key' | 'createdAt'> {
  freshness: ReturnType<typeof freshness>;
  tabs: TabSummary[];
}

export function sourceView(
  source: Source,
  now: number,
  policy: FreshnessPolicy,
  baselines: TabBaseline[] = [],
): SourceView {
  const { key: _key, createdAt: _createdAt, ...rest } = source;
  return {
    ...rest,
    freshness: freshness(source, now, policy),
    tabs: [...baselines]
      .sort((a, b) => a.index - b.index)
      .map((b) => ({
        index: b.index,
        name: b.name,
        status: b.lastStatus,
        observedAt: b.observedAt,
        capacity: b.capacity,
      })),
  };
}

export interface RequestView extends BankRequest {
  outstanding: number;
  managers: string[];
}

export function requestView(request: BankRequest, managers: string[]): RequestView {
  return { ...request, outstanding: outstanding(request), managers };
}
