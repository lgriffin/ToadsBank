import { AdministerSources } from './administerSources';
import { BrowseInventory } from './browseInventory';
import { Context, type Deps } from './context';
import { FulfilRequest } from './fulfilRequest';
import { Housekeeping } from './housekeeping';
import { ImportSnapshot } from './importSnapshot';
import { PlanRaid } from './planRaid';
import { ReconcileStock } from './reconcileStock';
import { RequestItems } from './requestItems';

export * from './administerSources';
export * from './browseInventory';
export * from './context';
export * from './fulfilRequest';
export * from './housekeeping';
export * from './importSnapshot';
export * from './memory';
export * from './planRaid';
export * from './ports';
export * from './reconcileStock';
export * from './requestItems';
export * from './views';

/** Every driving port over one set of driven ports: what a composition root hands to its adapters. */
export interface Bank {
  imports: ImportSnapshot;
  inventory: BrowseInventory;
  sources: AdministerSources;
  requests: RequestItems;
  fulfil: FulfilRequest;
  reconcile: ReconcileStock;
  raids: PlanRaid;
  housekeeping: Housekeeping;
}

export function createBank(deps: Deps): Bank {
  const ctx = new Context(deps);
  return {
    imports: new ImportSnapshot(ctx),
    inventory: new BrowseInventory(ctx),
    sources: new AdministerSources(ctx),
    requests: new RequestItems(ctx),
    fulfil: new FulfilRequest(ctx),
    reconcile: new ReconcileStock(ctx),
    raids: new PlanRaid(ctx),
    housekeeping: new Housekeeping(ctx),
  };
}
