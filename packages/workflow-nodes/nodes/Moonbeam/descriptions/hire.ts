import type { IDataObject, IExecuteSingleFunctions, IHttpRequestOptions, IN8nHttpFullResponse, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { asItems, failed, needKey, param, refuse, show } from './shared';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

async function searchQuery(this: IExecuteSingleFunctions, requestOptions: IHttpRequestOptions): Promise<IHttpRequestOptions> {
	const tag = param(this, 'tag');
	if (!tag) refuse(this, 'Search Sellers needs a job class, e.g. text.summarize');
	return requestOptions;
}
async function searchOut(this: IExecuteSingleFunctions, _items: INodeExecutionData[], response: IN8nHttpFullResponse): Promise<INodeExecutionData[]> {
	const j = (response.body ?? {}) as IDataObject;
	if (response.statusCode >= 400 || j.ok === false) failed(this, response, 'GET /match/search');
	return asItems(Array.isArray(j.hits) ? (j.hits as IDataObject[]) : []);
}

/** hirePlan(): the terms of one hire as POST /settle reads them; the answer is unsigned calls, each with its signer. */
async function planBody(this: IExecuteSingleFunctions, requestOptions: IHttpRequestOptions): Promise<IHttpRequestOptions> {
	const buyer = param(this, 'buyer');
	const seller = param(this, 'seller');
	const price = param(this, 'price');
	if (!ADDRESS.test(buyer) || !ADDRESS.test(seller)) refuse(this, 'Buyer and Seller are 0x addresses (40 hex)');
	if (!/^[1-9][0-9]*$/.test(price)) refuse(this, 'Price is a whole number of the token\'s smallest unit, e.g. 1000000 for 1 USDC');
	const deadline = Number(this.getNodeParameter('deadline', 0)) || Math.floor(Date.now() / 1000) + 3600;
	const o = this.getNodeParameter('planOptions', {}) as IDataObject;
	const evidence = typeof o.evidence === 'string' ? o.evidence.trim() : '';
	const refId = typeof o.refId === 'string' ? o.refId.trim() : '';
	const note = typeof o.note === 'string' ? o.note.trim() : '';
	const body: IDataObject = {
		kind: 'agent',
		chainId: Number(this.getNodeParameter('chainId', 8453)),
		buyer,
		seller,
		price,
		deadline,
		...(evidence ? { evidence } : {}),
		...(refId ? { ref: { id: refId, ...(note ? { note } : {}) } } : {}),
	};
	return { ...requestOptions, body };
}
async function planOut(this: IExecuteSingleFunctions, _items: INodeExecutionData[], response: IN8nHttpFullResponse): Promise<INodeExecutionData[]> {
	const j = (response.body ?? {}) as IDataObject;
	if (response.statusCode >= 400 || j.ok === false) failed(this, response, 'POST /settle');
	return asItems([{ ...j, calls: Array.isArray(j.calls) ? j.calls : [], sent: false }]);
}

export const hireOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['hire'] } },
		options: [
			{
				name: 'Plan Hire',
				value: 'plan',
				action: 'Plan the hire of an agent',
				description: 'The unsigned calls of one hire, in order: the buyer\'s funding and the seller\'s acceptance, each with who signs it. Nothing is signed or sent. Plan key.',
				routing: {
					request: { method: 'POST', url: '/settle', ignoreHttpStatusErrors: true, returnFullResponse: true },
					send: { preSend: [needKey, planBody] },
					output: { postReceive: [planOut] },
				},
			},
			{
				name: 'Search Sellers',
				value: 'searchSellers',
				action: 'Search sellers for a job class',
				description: 'Sellers on Base for one job class, ranked, one item each. Free.',
				routing: {
					request: { method: 'GET', url: '/match/search', ignoreHttpStatusErrors: true, returnFullResponse: true },
					send: { preSend: [searchQuery] },
					output: { postReceive: [searchOut] },
				},
			},
		],
		default: 'searchSellers',
	},
	// Search Sellers
	{
		displayName: 'Job Class',
		name: 'tag',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. text.summarize',
		description: 'The job class to hire for',
		displayOptions: show('hire', ['searchSellers']),
		routing: { send: { type: 'query', property: 'tag', value: '={{ $value.trim() }}' } },
	},
	{
		displayName: 'Filters',
		name: 'searchFilters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: show('hire', ['searchSellers']),
		options: [
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 50,
				description: 'Max number of results to return',
				routing: { send: { type: 'query', property: 'limit' } },
			},
			{
				displayName: 'Price Cap',
				name: 'priceCap',
				type: 'string',
				default: '',
				placeholder: 'e.g. 0.05',
				description: 'The most a buyer pays per job, in USDC',
				routing: { send: { type: 'query', property: 'price_cap', value: '={{ $value || undefined }}' } },
			},
			{
				displayName: 'Side',
				name: 'side',
				type: 'string',
				default: '',
				placeholder: 'e.g. seller',
				description: 'Which side of the market to read',
				routing: { send: { type: 'query', property: 'side', value: '={{ $value || undefined }}' } },
			},
			{
				displayName: 'Venue',
				name: 'venue',
				type: 'string',
				default: '',
				placeholder: 'e.g. x402-base',
				description: 'Only sellers on this venue',
				routing: { send: { type: 'query', property: 'venue', value: '={{ $value || undefined }}' } },
			},
		],
	},
	// Plan Hire
	{
		displayName: 'Chain',
		name: 'chainId',
		type: 'options',
		default: 8453,
		options: [{ name: 'Base', value: 8453 }],
		description: 'Where the hire runs',
		displayOptions: show('hire', ['plan']),
	},
	{
		displayName: 'Buyer',
		name: 'buyer',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. 0x0000000000000000000000000000000000000001',
		description: 'The wallet that funds the job',
		displayOptions: show('hire', ['plan']),
	},
	{
		displayName: 'Seller',
		name: 'seller',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. 0x0000000000000000000000000000000000000002',
		description: 'The seller\'s owner address',
		displayOptions: show('hire', ['plan']),
	},
	{
		displayName: 'Price (Smallest Units)',
		name: 'price',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. 1000000',
		description: 'The seller\'s price in the token\'s smallest unit (1000000 is 1 USDC)',
		displayOptions: show('hire', ['plan']),
	},
	{
		displayName: 'Deadline (Unix Seconds)',
		name: 'deadline',
		type: 'number',
		default: 0,
		description: 'When the job expires. 0 is one hour from now.',
		displayOptions: show('hire', ['plan']),
	},
	{
		displayName: 'Additional Fields',
		name: 'planOptions',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show('hire', ['plan']),
		options: [
			{
				displayName: 'Evidence Digest',
				name: 'evidence',
				type: 'string',
				default: '',
				placeholder: 'e.g. 0x5f…',
				description: 'The 32-byte digest the seller submits for the delivery, when it is known now',
			},
			{
				displayName: 'Note',
				name: 'note',
				type: 'string',
				default: '',
				placeholder: 'e.g. weekly report',
				description: 'Kept with the reference, for the record',
			},
			{
				displayName: 'Reference ID',
				name: 'refId',
				type: 'string',
				default: '',
				placeholder: 'e.g. order-1042',
				description: 'Your own ID for this hire',
			},
		],
	},
];
