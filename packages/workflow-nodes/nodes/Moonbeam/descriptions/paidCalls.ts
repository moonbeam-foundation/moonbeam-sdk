import type { IDataObject, IExecuteSingleFunctions, IHttpRequestOptions, IN8nHttpFullResponse, INodeExecutionData, INodeProperties } from 'n8n-workflow';
import { AGENT_REF, PAID_CALLS_BASE, asItems, failed, param, refuse, show } from './shared';

const rpc = (method: string, params?: IDataObject): IDataObject => ({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) });
const HEADERS = { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' };

/** The JSON-RPC answer's result, or the server's own error. */
function resultOf(ctx: IExecuteSingleFunctions, response: IN8nHttpFullResponse): IDataObject {
	const j = (response.body ?? {}) as IDataObject;
	if (response.statusCode >= 400) failed(ctx, response, 'Moonbeam paid calls');
	const err = j.error as IDataObject | undefined;
	if (err) refuse(ctx, `Moonbeam paid calls refused: ${String(err.message ?? JSON.stringify(err))}`);
	if (!j.result || typeof j.result !== 'object') refuse(ctx, 'Moonbeam paid calls did not answer a result');
	return j.result as IDataObject;
}

async function toolsOut(this: IExecuteSingleFunctions, _items: INodeExecutionData[], response: IN8nHttpFullResponse): Promise<INodeExecutionData[]> {
	const tools = resultOf(this, response).tools;
	if (!Array.isArray(tools)) refuse(this, 'Moonbeam paid calls did not answer a tools list');
	return asItems(tools as IDataObject[]);
}

async function whereListedBody(this: IExecuteSingleFunctions, requestOptions: IHttpRequestOptions): Promise<IHttpRequestOptions> {
	const ref = param(this, 'whereAgent');
	if (!AGENT_REF.test(ref)) refuse(this, `An agent here is 8453:<its ERC-8004 id>, not "${ref}"`);
	return { ...requestOptions, body: rpc('tools/call', { name: 'moonbeam_where_listed', arguments: { ref } }) };
}
async function whereListedOut(this: IExecuteSingleFunctions, _items: INodeExecutionData[], response: IN8nHttpFullResponse): Promise<INodeExecutionData[]> {
	const r = resultOf(this, response);
	const text = Array.isArray(r.content) ? (r.content as IDataObject[]).map((c) => c.text).filter((t) => typeof t === 'string').join('\n') : '';
	if (r.isError) refuse(this, text || 'Moonbeam paid calls refused the call');
	const structured = (r.structuredContent ?? {}) as IDataObject;
	return asItems([{ ...structured, says: text }]);
}

export const paidCallsOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['paidCalls'] } },
		options: [
			{
				name: 'List Tools',
				value: 'listTools',
				action: 'List the paid calls tools',
				description: 'Every tool Moonbeam\'s paid-calls MCP server offers, one item each, with its price in its description and its input schema. Free.',
				routing: {
					request: { method: 'POST', baseURL: PAID_CALLS_BASE, url: '/mcp', headers: HEADERS, body: rpc('tools/list'), ignoreHttpStatusErrors: true, returnFullResponse: true },
					output: { postReceive: [toolsOut] },
				},
			},
			{
				name: 'Where Listed',
				value: 'whereListed',
				action: 'Ask where an agent is listed',
				description: 'The paid-calls server\'s free tool: where an ERC-8004 agent on Base stands on ERC-8004, the MCP Registry and the A2A Registry. Free.',
				routing: {
					request: { method: 'POST', baseURL: PAID_CALLS_BASE, url: '/mcp', headers: HEADERS, ignoreHttpStatusErrors: true, returnFullResponse: true },
					send: { preSend: [whereListedBody] },
					output: { postReceive: [whereListedOut] },
				},
			},
		],
		default: 'listTools',
	},
	{
		displayName: 'Agent',
		name: 'whereAgent',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. 8453:1170141',
		description: 'The agent as 8453:&lt;its ERC-8004 ID&gt;',
		displayOptions: show('paidCalls', ['whereListed']),
	},
];
