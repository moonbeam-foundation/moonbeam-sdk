import type {
	ICredentialDataDecryptedObject,
	ICredentialTestRequest,
	ICredentialType,
	IHttpRequestOptions,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

/**
 * Moonbeam's endpoint and, for the plan actions, a plan key. The free reads (where an agent is listed, the list step's
 * status, sellers by class) run on the endpoint alone; the list step, the hire plan, a listing's pause and go-live, and
 * the key's own reads need the key. The key goes only in the x-api-key header, the way @moonbeam-foundation/sdk sends it.
 */
export class MoonbeamApi implements ICredentialType {
	name = 'moonbeamApi';

	displayName = 'Moonbeam API';

	icon: Icon = { light: 'file:moonbeam.svg', dark: 'file:moonbeam.dark.svg' };

	documentationUrl = 'https://github.com/moonbeam-foundation/moonbeam-sdk/tree/main/packages/workflow-nodes#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'Endpoint',
			name: 'endpoint',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'e.g. https://your-endpoint.example/v1',
			description: 'The Moonbeam endpoint that comes with your key, /v1 included (the SDK reads the same value from MOONBEAM_API)',
		},
		{
			displayName: 'Plan Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'Optional for the free reads. Needed for Listing → List on Markets, Pause and Go Live, Hire → Plan Hire and the Key resource. A plan key comes with a Moonbeam plan (https://next.moonbeam.network/acp/plans).',
		},
	];

	// The key rides only when it is set: an empty header is never sent (the SDK's own rule)
	async authenticate(credentials: ICredentialDataDecryptedObject, requestOptions: IHttpRequestOptions): Promise<IHttpRequestOptions> {
		const key = typeof credentials.apiKey === 'string' ? credentials.apiKey.trim() : '';
		if (!key) return requestOptions;
		return { ...requestOptions, headers: { ...(requestOptions.headers ?? {}), 'x-api-key': key } };
	}

	// A free read that answers with or without a key
	test: ICredentialTestRequest = {
		request: { baseURL: '={{$credentials.endpoint.replace(/\\/+$/, "")}}', url: '/classes', method: 'GET' },
	};
}
