import type { IDataObject, IExecuteSingleFunctions, IHttpRequestOptions, IN8nHttpFullResponse, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { LIST_MARKETS, LIST_MARKET_NAMES } from '../sdk.generated';
import { AGENT_REF, LISTING_ID, asItems, failed, needKey, param, refuse, show } from './shared';

const MARKET_NAMES = LIST_MARKET_NAMES;

/** listOn(): an agent on Base and one or more of the list step's markets. */
async function listOnBody(this: IExecuteSingleFunctions, requestOptions: IHttpRequestOptions): Promise<IHttpRequestOptions> {
	const agent = param(this, 'listOnAgent');
	if (!AGENT_REF.test(agent)) refuse(this, `An agent here is 8453:<its ERC-8004 id>, not "${agent}"`);
	const markets = (this.getNodeParameter('markets', []) as string[]) ?? [];
	const bad = markets.filter((m) => !LIST_MARKETS.includes(m));
	if (!markets.length || bad.length) refuse(this, `The list step lists on ${LIST_MARKETS.join(', ')}${bad.length ? `, not ${bad.join(', ')}` : ''}`);
	return { ...requestOptions, body: { agent, markets: [...new Set(markets)] } };
}
async function listOut(this: IExecuteSingleFunctions, _items: INodeExecutionData[], response: IN8nHttpFullResponse): Promise<INodeExecutionData[]> {
	const j = (response.body ?? {}) as IDataObject;
	if (response.statusCode >= 400 || j.ok === false) failed(this, response, 'POST /list');
	const list = j.list as IDataObject | undefined;
	if (!list || typeof list.id !== 'string' || !list.markets) refuse(this, 'Moonbeam did not answer a list step');
	return asItems([list]);
}

/** pauseListing() / resumeListing() / delistListing(): one agent listing by its al_ id. */
async function listingUrl(this: IExecuteSingleFunctions, requestOptions: IHttpRequestOptions): Promise<IHttpRequestOptions> {
	const id = param(this, 'listingId');
	if (!LISTING_ID.test(id)) refuse(this, `Not an agent listing id (al_ and 16 hex): "${id}"`);
	const op = this.getNodeParameter('operation', '') as string;
	if (op === 'delist' && param(this, 'confirm') !== id) refuse(this, 'Delisting is for good: repeat the listing id in Confirm');
	const url = op === 'resume' ? `/agent-listings/${id}/publish` : `/agent-listings/${id}`;
	const body = op === 'resume' ? {} : { status: op === 'delist' ? 'archived' : 'paused' };
	return { ...requestOptions, url, body };
}
async function listingOut(this: IExecuteSingleFunctions, _items: INodeExecutionData[], response: IN8nHttpFullResponse): Promise<INodeExecutionData[]> {
	const j = (response.body ?? {}) as IDataObject;
	if (response.statusCode >= 400 || j.ok === false) failed(this, response, 'POST /agent-listings/:id');
	const listing = j.listing as IDataObject | undefined;
	if (!listing || typeof listing.id !== 'string') refuse(this, 'Moonbeam did not answer a listing');
	return asItems([j]);
}

const keyed = (preSend: (this: IExecuteSingleFunctions, r: IHttpRequestOptions) => Promise<IHttpRequestOptions>) => ({ preSend: [needKey, preSend] });

export const listingOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['listing'] } },
		options: [
			{
				name: 'Delist',
				value: 'delist',
				action: 'Delist an agent listing for good',
				description: 'Delist for good: the listing is kept for the record and never sold again. Plan key.',
				routing: {
					request: { method: 'POST', url: '/agent-listings', ignoreHttpStatusErrors: true, returnFullResponse: true },
					send: keyed(listingUrl),
					output: { postReceive: [listingOut] },
				},
			},
			{
				name: 'Go Live',
				value: 'resume',
				action: 'Put an agent listing live again',
				description: 'Go live again: one graded task per job, and each job it passes is sold again. Plan key.',
				routing: {
					request: { method: 'POST', url: '/agent-listings', ignoreHttpStatusErrors: true, returnFullResponse: true },
					send: keyed(listingUrl),
					output: { postReceive: [listingOut] },
				},
			},
			{
				name: 'List on Markets',
				value: 'listOn',
				action: 'List an agent on the markets where agents are found',
				description:
					'The list step: the agent\'s ERC-8004 record on Base, the MCP Registry and the A2A Registry. Part of the plan, no per-listing price. Asking again returns the same record, read anew. Plan key.',
				routing: {
					request: { method: 'POST', url: '/list', ignoreHttpStatusErrors: true, returnFullResponse: true },
					send: keyed(listOnBody),
					output: { postReceive: [listOut] },
				},
			},
			{
				name: 'Pause',
				value: 'pause',
				action: 'Pause an agent listing',
				description: 'Pause a live listing: it is not sold until it goes live again. Plan key.',
				routing: {
					request: { method: 'POST', url: '/agent-listings', ignoreHttpStatusErrors: true, returnFullResponse: true },
					send: keyed(listingUrl),
					output: { postReceive: [listingOut] },
				},
			},
		],
		default: 'listOn',
	},
	{
		displayName: 'Agent',
		name: 'listOnAgent',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. 8453:1170141',
		description: 'The agent as 8453:&lt;its ERC-8004 ID&gt;; its card names the class it sells',
		displayOptions: show('listing', ['listOn']),
	},
	{
		displayName: 'Markets',
		name: 'markets',
		type: 'multiOptions',
		default: [...LIST_MARKETS],
		required: true,
		options: LIST_MARKETS.map((m) => ({ name: MARKET_NAMES[m] ?? m, value: m })).sort((a, b) => a.name.localeCompare(b.name)),
		description: 'Where to list it; all three by default',
		displayOptions: show('listing', ['listOn']),
	},
	{
		displayName: 'Listing ID',
		name: 'listingId',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. al_0123456789abcdef',
		description: 'The agent listing (al_ and 16 hex)',
		displayOptions: show('listing', ['pause', 'resume', 'delist']),
	},
	{
		displayName: 'Confirm',
		name: 'confirm',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. al_0123456789abcdef',
		description: 'Repeat the listing ID: delisting is for good',
		displayOptions: show('listing', ['delist']),
	},
];
