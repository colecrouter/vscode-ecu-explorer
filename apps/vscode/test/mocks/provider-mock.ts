/**
 * Mock DefinitionProvider for testing
 */

export function createMockProvider(overrides: Record<string, unknown> = {}) {
	return {
		id: "test-provider",
		name: "Test Provider",
		getDefinitions: async () => [
			{
				id: "def1",
				name: "Test Definition 1",
				providerId: "test-provider",
				defUri: "test://def1",
				tables: [],
			},
		],
		getDefinition: async (defUri: string) => ({
			id: "def1",
			name: "Test Definition",
			providerId: "test-provider",
			defUri,
			tables: [],
		}),
		matchRom: async (_romBytes: Uint8Array) => ({
			defUri: "test://def1",
			score: 100,
		}),
		...overrides,
	};
}

export function createMockProviderRegistry() {
	const providers = new Map();

	return {
		register: (id: string, provider: unknown) => {
			providers.set(id, provider);
		},
		get: (id: string) => providers.get(id),
		getAll: () => Array.from(providers.values()),
		has: (id: string) => providers.has(id),
		unregister: (id: string) => providers.delete(id),
	};
}

export function createMockDefinition(overrides: Record<string, any> = {}) {
	return {
		id: "def1",
		name: "Test Definition",
		providerId: "test-provider",
		defUri: "test://def1",
		tables: [],
		fingerprints: [],
		...overrides,
	};
}

export function createMockTable(overrides: Record<string, any> = {}) {
	return {
		name: "Test Table",
		address: 0x1000,
		type: "2d",
		columns: 16,
		rows: 16,
		xAxis: {
			name: "X Axis",
			address: 0x2000,
			length: 16,
		},
		yAxis: {
			name: "Y Axis",
			address: 0x2100,
			length: 16,
		},
		...overrides,
	};
}

export function createMockAxis(overrides: Record<string, any> = {}) {
	return {
		name: "Test Axis",
		address: 0x2000,
		length: 10,
		type: "u16",
		static: true,
		...overrides,
	};
}

export function createMockFingerprint(overrides: Record<string, any> = {}) {
	return {
		address: 0x0,
		bytes: [0x4d, 0x5a, 0x90, 0x00],
		...overrides,
	};
}

export function createMockRomInstance(overrides: Record<string, any> = {}) {
	return {
		id: "rom1",
		romUri: "file:///path/to/rom.hex",
		providerId: "test-provider",
		defUri: "test://def1",
		bytes: new Uint8Array(256),
		definition: createMockDefinition(),
		...overrides,
	};
}

export function createMockRomAssociation(overrides: Record<string, any> = {}) {
	return {
		romUri: "file:///path/to/rom.hex",
		providerId: "test-provider",
		defUri: "test://def1",
		lastOpenedAt: Date.now(),
		...overrides,
	};
}

export function createMockMatchResult(overrides: Record<string, any> = {}) {
	return {
		defUri: "test://def1",
		score: 95,
		...overrides,
	};
}

export function createMockProviderWithDefinitions(definitions: any[] = []) {
	return {
		id: "test-provider",
		name: "Test Provider",
		getDefinitions: async () =>
			definitions.length > 0 ? definitions : [createMockDefinition()],
		getDefinition: async (_defUri: string) =>
			definitions[0] || createMockDefinition(),
		matchRom: async (_romBytes: Uint8Array) => createMockMatchResult(),
	};
}

export function createMockProviderWithError(error: Error) {
	return {
		id: "error-provider",
		name: "Error Provider",
		getDefinitions: async () => {
			throw error;
		},
		getDefinition: async (_defUri: string) => {
			throw error;
		},
		matchRom: async (_romBytes: Uint8Array) => {
			throw error;
		},
	};
}

export function createMockProviderWithMatches(matches: any[] = []) {
	return {
		id: "test-provider",
		name: "Test Provider",
		getDefinitions: async () => [createMockDefinition()],
		getDefinition: async (_defUri: string) => createMockDefinition(),
		matchRom: async (_romBytes: Uint8Array) => {
			if (matches.length > 0) {
				return matches[0];
			}
			return createMockMatchResult();
		},
	};
}
