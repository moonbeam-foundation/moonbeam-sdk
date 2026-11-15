import type { INodeType, INodeTypeDescription } from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { hireOperations } from './descriptions/hire';
import { keyOperations } from './descriptions/key';
import { listingOperations } from './descriptions/listing';
import { paidCallsOperations } from './descriptions/paidCalls';
import { MOONBEAM_HOST } from './descriptions/shared';
import { standingOperations } from './descriptions/standing';

/**
 * Moonbeam lists agents on the markets where agents are found. This node reads where an agent is listed, lists Moonbeam's
 * paid-calls tools and, on a plan key, runs the list step and plans a hire: the same calls @moonbeam-foundation/sdk makes
 * (journey, listStatus, listOn, pauseListing, resumeListing, delistListing, searchSellers, hirePlan, keyStanding, usage).
 *
 * The free reads run on Moonbeam's own host (https://next.moonbeam.network) with no credential; a credential's Endpoint, the one
 * that comes with a plan key, sends them to that endpoint as the SDK sends them, and the plan actions run there.
 *
 * Declarative: every operation is one request, so what the node does is what its description says. Nothing here signs or
 * sends a transaction; a hire answers unsigned calls, each with who signs it.
 */
export class Moonbeam implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Moonbeam',
		name: 'moonbeam',
		icon: { light: 'file:moonbeam.svg', dark: 'file:moonbeam.dark.svg' } as const,
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Where an agent is listed on every market, Moonbeam\'s paid-calls tools, and on a plan key the list step and the hire plan',
		defaults: { name: 'Moonbeam' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		// Optional: every free read runs on Moonbeam's own host without one; the plan actions ask for it
		credentials: [{ name: 'moonbeamApi', required: false }],
		requestDefaults: {
			baseURL: MOONBEAM_HOST,
			headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Moonbeam-Client': 'workflow-nodes/0.1.0' },
		},
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Agent Standing', value: 'standing', description: 'Where an agent is listed on every venue, and its list step. Free.' },
					{ name: 'Hire', value: 'hire', description: 'Find sellers for a job class, and plan a hire as unsigned calls' },
					{ name: 'Key', value: 'key', description: 'Your plan key\'s standing and what it used' },
					{ name: 'Listing', value: 'listing', description: 'List an agent on the markets where agents are found; pause, go live, delist' },
					{ name: 'Paid Call', value: 'paidCalls', description: 'Moonbeam\'s paid-calls tools, and its free where-listed tool' },
				],
				default: 'standing',
			},
			...standingOperations,
			...paidCallsOperations,
			...listingOperations,
			...hireOperations,
			...keyOperations,
		],
	};
}
