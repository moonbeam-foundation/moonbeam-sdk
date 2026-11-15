import type {
	ICredentialDataDecryptedObject,
	ICredentialTestRequest,
	ICredentialType,
	IHttpRequestOptions,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

/**
 * Optional for the free reads, which run on Moonbeam's own host (https://next.moonbeam.network) without it. The plan actions (the
 * list step, the hire plan, a listing's pause, go-live and delist, the key's own reads) need the plan key and the endpoint that
 * comes with it; with that endpoint set, the free reads go there too, as the SDK sends them. The key goes only in the x-api-key header, the way @moonbeam-foundation/sdk sends it.
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
			placeholder: 'e.g. https://your-endpoint.example/v1',
			description:
				'Optional. Empty: the free reads run on Moonbeam (https://next.moonbeam.network). Set it to the endpoint that comes with your plan key, /v1 included (the SDK\'s MOONBEAM_API), for the plan actions and the full journey.',
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

	// A free read that answers with or without a key: the endpoint's job classes, else Moonbeam's own plans
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.endpoint ? $credentials.endpoint.trim().replace(/\\/+$/, "") : "https://next.moonbeam.network"}}',
			url: '={{$credentials.endpoint ? "/classes" : "/api/acp/plans"}}',
			method: 'GET',
		},
	};
}
