// ONE SALE, STOP BY STOP: the Moonbeam Studio's sale tour (its 17 stops, `tutorial-stop:<id>`) paired 1:1 with the SDK. Each stop
// has exactly one SDK call that does or reads it. The Studio shows this table; its field names are stable.

/** What a stop's call needs: nothing (offline, in this package), the shared free rate (public; a key lifts it), or your key. */
export type StopNeeds = 'offline' | 'free' | 'key';
/** How the Studio's tour says a stop runs today, as its knowledge reads it (null where it says nothing). */
export type StopHop = 'live' | 'partial' | 'missing' | null;
export type SaleStop = {
  /** the stop's id; the Studio's node is `tutorial-stop:<id>` */
  id: string;
  /** its place in the sale, 1 to 17 */
  order: number;
  /** the Studio's own label */
  label: string;
  /** the Studio command or the layer op the tour runs at this stop */
  studio: string;
  /** the one SDK call: `market.<fn>`, `resale.<fn>`, or the CLI line for the first stop */
  call: string;
  /** the module the call is exported from (`cli`: the `moonbeam` command of this package) */
  module: 'market' | 'resale' | 'cli';
  /** the export (or the CLI subcommand) */
  fn: string;
  /** the layer route the call uses, or null when it runs offline */
  route: string | null;
  needs: StopNeeds;
  hop: StopHop;
};

const stop = (order: number, id: string, label: string, studio: string, call: string, route: string | null, needs: StopNeeds, hop: StopHop): SaleStop => {
  const [module, fn] = call.startsWith('npx moonbeam ') ? ['cli', call.slice('npx moonbeam '.length)] : call.split('.') as [string, string];
  return Object.freeze({ id, order, label, studio, call, module: module as SaleStop['module'], fn: fn!, route, needs, hop });
};

/** The 17 stops of one sale, in order, each with its one SDK call. */
export const SALE_STOPS: readonly SaleStop[] = Object.freeze([
  stop(1, 'studio', 'The Studio', 'page /acp/studio', 'npx moonbeam workflows', null, 'offline', null),
  stop(2, 'offer-in', 'A seller comes in', '/find 3', 'market.searchSellers', 'GET /match/search', 'free', 'live'),
  stop(3, 'classify', 'Checked and classed', 'POST /v1/handshake', 'market.checkAgent', 'POST /onboard/diagnose', 'key', 'live'),
  stop(4, 'listed', 'Listed', '/onboard 1', 'market.publishListing', 'POST /agent-listings/:id/publish', 'key', 'live'),
  stop(5, 'quote', 'The terms', 'POST /v1/pools/quote', 'resale.quoteSale', null, 'offline', 'live'),
  stop(6, 'edges', 'Your listings', '/edges', 'market.layerListings', 'GET /listings', 'free', 'live'),
  stop(7, 'hired', 'Hired', 'POST /v1/exchanges/:edge_id/call', 'market.hirePlan', 'POST /settle', 'key', 'partial'),
  stop(8, 'delivered', 'Delivered', '/sell', 'market.handOver', 'POST /handshake', 'key', 'live'),
  stop(9, 'graded', 'Graded', 'assurance', 'market.composeGrade', 'POST /judge/compose', 'key', 'live'),
  stop(10, 'settled', 'Settled', 'POST /v1/settle', 'market.jobRecord', 'GET /settle/:id', 'free', 'live'),
  stop(11, 'legs', 'Who gets what', '/sell', 'resale.legsByName', null, 'offline', 'live'),
  stop(12, 'accrued', 'Booked', 'GET /v1/resale', 'market.saleLedger', 'GET /resale', 'free', 'live'),
  stop(13, 'split', 'Added up each week', 'GET /v1/pipe/queues', 'market.payoutQueues', 'GET /pipe/queues', 'free', 'partial'),
  stop(14, 'vault', 'The vault', 'GET /v1/vault/policy', 'market.vaultPolicy', 'GET /vault/policy', 'free', 'missing'),
  stop(15, 'paid', 'Paid', 'GET /v1/vault/policy', 'market.claimablePayouts', 'GET /pipe/claimable', 'free', 'missing'),
  stop(16, 'recorded', 'Recorded', 'GET /v1/root', 'market.saleRecord', 'GET /root', 'free', 'live'),
  stop(17, 'usage', 'What it cost', 'Settings → Usage', 'market.keyStanding', 'GET /access/key', 'key', null),
]);
/** One stop by its id (`offer-in`) or the Studio's node id (`tutorial-stop:offer-in`). */
export const saleStop = (id: string): SaleStop | null => SALE_STOPS.find((s) => s.id === id.replace(/^tutorial-stop:/, '')) ?? null;
