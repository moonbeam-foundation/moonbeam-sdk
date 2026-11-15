import type { IDataObject, IExecuteSingleFunctions, IN8nHttpFullResponse, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { asItems, failed, needKey, show } from './shared';

async function keyOut(this: IExecuteSingleFunctions, _items: INodeExecutionData[], response: IN8nHttpFullResponse): Promise<INodeExecutionData[]> {
	const j = (response.body ?? {}) as IDataObject;
	if (response.statusCode >= 400 || j.ok === false) failed(this, response, 'Moonbeam');
	return asItems([j]);
}

export const keyOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['key'] } },
		options: [
			{
				name: 'Get Standing',
				value: 'standing',
				action: 'Get the standing of your plan key',
				description: 'Your key\'s plan, the days left and its allowance. Plan key.',
				routing: {
					request: { method: 'GET', url: '/access/key', ignoreHttpStatusErrors: true, returnFullResponse: true },
					send: { preSend: [needKey] },
					output: { postReceive: [keyOut] },
				},
			},
			{
				name: 'Get Usage',
				value: 'usage',
				action: 'Get what your key used',
				description: 'Calls and spend per product family over a window, by day and by key. Plan key.',
				routing: {
					request: { method: 'GET', url: '/access/usage', ignoreHttpStatusErrors: true, returnFullResponse: true },
					send: { preSend: [needKey] },
					output: { postReceive: [keyOut] },
				},
			},
		],
		default: 'standing',
	},
	{
		displayName: 'Window',
		name: 'window',
		type: 'options',
		default: 'month',
		options: [
			{ name: 'Last 30 Days', value: '30d' },
			{ name: 'Last 7 Days', value: '7d' },
			{ name: 'Last Day', value: '1d' },
			{ name: 'This Month', value: 'month' },
		],
		displayOptions: show('key', ['usage']),
		routing: { send: { type: 'query', property: 'window' } },
	},
	{
		displayName: 'Scope',
		name: 'scope',
		type: 'options',
		default: 'tenant',
		options: [
			{ name: 'This Key', value: 'key' },
			{ name: 'All Your Keys', value: 'tenant' },
		],
		displayOptions: show('key', ['usage']),
		routing: { send: { type: 'query', property: 'scope' } },
	},
];
