import type { IDataObject, IExecuteSingleFunctions, IHttpRequestOptions, IN8nHttpFullResponse, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { JOURNEY_SCHEMA, VENUES } from '../sdk.generated';
import { AGENT_REF, JOURNEY_REF, asItems, failed, listIdOf, param, refuse, show } from './shared';

/** journey(): the agent ref is checked before anything is sent. */
async function journeyRef(this: IExecuteSingleFunctions, requestOptions: IHttpRequestOptions): Promise<IHttpRequestOptions> {
	const ref = param(this, 'agent');
	if (!JOURNEY_REF.test(ref)) refuse(this, `Not an agent ref: "${ref}". Use 8453:<ERC-8004 id>, erc8004:<chain>:<id>, x402:host:<host>, or x402: / virtuals: / bitagent: / near: / olas: and 12 hex`);
	return requestOptions;
}

/** journeyOf(): the answer is listed.journey.v1 with a row for every venue, or it is refused. Then the chosen output. */
async function journeyOut(this: IExecuteSingleFunctions, _items: INodeExecutionData[], response: IN8nHttpFullResponse): Promise<INodeExecutionData[]> {
	const j = (response.body ?? {}) as IDataObject;
	if (response.statusCode >= 400 || j.ok === false) failed(this, response, 'GET /listed');
	const rows = Array.isArray(j.venues) ? (j.venues as IDataObject[]) : null;
	if (j.schema !== JOURNEY_SCHEMA || !rows || !j.agent || !j.checks) refuse(this, `Moonbeam did not answer ${JOURNEY_SCHEMA}`);
	const by = new Map(rows.map((v) => [String(v.venue_id), v]));
	const missing = VENUES.filter((v) => !by.get(v.id)?.leds).map((v) => v.id);
	if (missing.length) refuse(this, `The journey has no row for ${missing.join(', ')}`);
	const output = param(this, 'output') || 'journey';
	const agent = (j.agent as IDataObject).ref as string;
	const row = (id: string): IDataObject => ({ agent, read_at: j.read_at as string, ...by.get(id)! });
	if (output === 'venues') return asItems(VENUES.map((v) => row(v.id)));
	if (output === 'venue') return asItems([row(param(this, 'venue'))]);
	return asItems([j]);
}

/** listStatus(): the list step's id is derived from the agent; never listed answers list: null. */
async function listStatusUrl(this: IExecuteSingleFunctions, requestOptions: IHttpRequestOptions): Promise<IHttpRequestOptions> {
	const ref = param(this, 'listAgent');
	if (!AGENT_REF.test(ref)) refuse(this, `An agent here is 8453:<its ERC-8004 id>, not "${ref}"`);
	return { ...requestOptions, url: `/list/${listIdOf(ref)}` };
}
async function listStatusOut(this: IExecuteSingleFunctions, _items: INodeExecutionData[], response: IN8nHttpFullResponse): Promise<INodeExecutionData[]> {
	const ref = param(this, 'listAgent');
	if (response.statusCode === 404) return asItems([{ agent: ref, list: null }]);
	const j = (response.body ?? {}) as IDataObject;
	if (response.statusCode >= 400 || j.ok === false) failed(this, response, 'GET /list/:id');
	const list = j.list as IDataObject | undefined;
	if (!list || typeof list.id !== 'string' || !list.markets) refuse(this, 'Moonbeam did not answer a list step');
	return asItems([{ agent: ref, list }]);
}

export const standingOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['standing'] } },
		options: [
			{
				name: 'Get Journey',
				value: 'journey',
				action: 'Get where an agent is listed',
				description:
					'One agent on every venue Moonbeam lists on: its standing, five lights (offer, hire, list, read back, paid) with why and what would move each, and the one next step. Free.',
				routing: {
					request: { method: 'GET', url: '/listed', qs: { view: 'journey' }, ignoreHttpStatusErrors: true, returnFullResponse: true },
					send: { preSend: [journeyRef] },
					output: { postReceive: [journeyOut] },
				},
			},
			{
				name: 'Get List Status',
				value: 'listStatus',
				action: 'Get the list step of an agent',
				description: 'Where an agent stands on each market of the list step (ERC-8004, the MCP Registry, the A2A Registry). Never listed answers list: null. Free.',
				routing: {
					request: { method: 'GET', url: '/list', ignoreHttpStatusErrors: true, returnFullResponse: true },
					send: { preSend: [listStatusUrl] },
					output: { postReceive: [listStatusOut] },
				},
			},
		],
		default: 'journey',
	},
	{
		displayName: 'Agent',
		name: 'agent',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. 8453:1170141',
		description: 'The agent: 8453:&lt;its ERC-8004 ID&gt;, erc8004:&lt;chain&gt;:&lt;ID&gt;, x402:host:&lt;host&gt;, or its row on a market board (x402:, virtuals:, bitagent:, near:, olas: and 12 hex)',
		displayOptions: show('standing', ['journey']),
		routing: { send: { type: 'query', property: 'agent', value: '={{ $value.trim() }}' } },
	},
	{
		displayName: 'Output',
		name: 'output',
		type: 'options',
		default: 'journey',
		options: [
			{ name: 'Whole Journey', value: 'journey', description: 'One item: the agent, its checks, every venue and the reads behind them' },
			{ name: 'One Item per Venue', value: 'venues', description: 'One item per venue, each with the agent and when it was read' },
			{ name: 'One Venue', value: 'venue', description: 'Only the venue you pick' },
		],
		displayOptions: show('standing', ['journey']),
	},
	{
		displayName: 'Venue',
		name: 'venue',
		type: 'options',
		default: 'workflow-nodes',
		options: VENUES.map((v) => ({ name: v.name, value: v.id })).sort((a, b) => a.name.localeCompare(b.name)),
		displayOptions: { show: { resource: ['standing'], operation: ['journey'], output: ['venue'] } },
	},
	{
		displayName: 'Agent',
		name: 'listAgent',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. 8453:1170141',
		description: 'The agent as 8453:&lt;its ERC-8004 ID&gt;',
		displayOptions: show('standing', ['listStatus']),
	},
];
