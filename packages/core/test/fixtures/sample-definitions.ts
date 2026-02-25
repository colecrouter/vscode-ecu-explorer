/**
 * Helper functions to create test table definitions
 */

export function createTestDefinition(overrides: Record<string, unknown> = {}) {
	return {
		name: "Test Definition",
		providerId: "test-provider",
		defUri: "test://definition",
		tables: [],
		...overrides,
	};
}

export function create1DTableDefinition(
	overrides: Record<string, unknown> = {},
) {
	return {
		name: "1D Table",
		address: 0x1000,
		type: "1d",
		columns: 10,
		axis: {
			name: "X Axis",
			address: 0x2000,
			length: 10,
			type: "u16",
		},
		...overrides,
	};
}

export function create2DTableDefinition(
	overrides: Record<string, unknown> = {},
) {
	return {
		name: "2D Table",
		address: 0x1000,
		type: "2d",
		columns: 16,
		rows: 16,
		xAxis: {
			name: "X Axis",
			address: 0x2000,
			length: 16,
			type: "u16",
		},
		yAxis: {
			name: "Y Axis",
			address: 0x2100,
			length: 16,
			type: "u16",
		},
		...overrides,
	};
}

export function create3DTableDefinition(
	overrides: Record<string, unknown> = {},
) {
	return {
		name: "3D Table",
		address: 0x1000,
		type: "3d",
		columns: 16,
		rows: 16,
		layers: 8,
		xAxis: {
			name: "X Axis",
			address: 0x2000,
			length: 16,
			type: "u16",
		},
		yAxis: {
			name: "Y Axis",
			address: 0x2100,
			length: 16,
			type: "u16",
		},
		zAxis: {
			name: "Z Axis",
			address: 0x2200,
			length: 8,
			type: "u16",
		},
		...overrides,
	};
}

export function createAxisDefinition(overrides: Record<string, unknown> = {}) {
	return {
		name: "Test Axis",
		address: 0x2000,
		length: 10,
		type: "u16",
		static: true,
		scale: 1,
		offset: 0,
		...overrides,
	};
}

export function createStaticAxisDefinition(
	overrides: Record<string, unknown> = {},
) {
	return {
		name: "Static Axis",
		address: 0x2000,
		length: 10,
		type: "u16",
		static: true,
		...overrides,
	};
}

export function createDynamicAxisDefinition(
	overrides: Record<string, unknown> = {},
) {
	return {
		name: "Dynamic Axis",
		address: 0x2000,
		length: 10,
		type: "u16",
		static: false,
		...overrides,
	};
}

export function createScaledAxisDefinition(
	overrides: Record<string, unknown> = {},
) {
	return {
		name: "Scaled Axis",
		address: 0x2000,
		length: 10,
		type: "u16",
		scale: 0.1,
		offset: 20,
		...overrides,
	};
}

export function createFuelMapDefinition(): Record<string, unknown> {
	return {
		name: "Fuel Map",
		address: 0x3000,
		type: "2d",
		columns: 16,
		rows: 16,
		xAxis: {
			name: "Load",
			address: 0x4000,
			length: 16,
			type: "u8",
			scale: 1,
			offset: 0,
		},
		yAxis: {
			name: "RPM",
			address: 0x4100,
			length: 16,
			type: "u16",
			scale: 25,
			offset: 0,
		},
	};
}

export function createIgnitionMapDefinition(): Record<string, unknown> {
	return {
		name: "Ignition Map",
		address: 0x5000,
		type: "3d",
		columns: 16,
		rows: 16,
		layers: 8,
		xAxis: {
			name: "Load",
			address: 0x6000,
			length: 16,
			type: "u8",
		},
		yAxis: {
			name: "RPM",
			address: 0x6100,
			length: 16,
			type: "u16",
		},
		zAxis: {
			name: "Gear",
			address: 0x6200,
			length: 8,
			type: "u8",
		},
	};
}

export function createBoostMapDefinition(): Record<string, unknown> {
	return {
		name: "Boost Map",
		address: 0x7000,
		type: "2d",
		columns: 12,
		rows: 12,
		xAxis: {
			name: "Load",
			address: 0x8000,
			length: 12,
			type: "u8",
		},
		yAxis: {
			name: "RPM",
			address: 0x8100,
			length: 12,
			type: "u16",
		},
	};
}

export function createCompleteDefinition(): Record<string, unknown> {
	return {
		name: "Complete Test Definition",
		providerId: "test-provider",
		defUri: "test://complete-definition",
		tables: [
			createFuelMapDefinition(),
			createIgnitionMapDefinition(),
			createBoostMapDefinition(),
		],
	};
}

export function createDefinitionWithFingerprints(): Record<string, unknown> {
	return {
		name: "Definition with Fingerprints",
		providerId: "test-provider",
		defUri: "test://fingerprinted-definition",
		fingerprints: [
			{
				address: 0x0,
				bytes: [0x4d, 0x5a, 0x90, 0x00],
			},
			{
				address: 0x100,
				bytes: [0x12, 0x34, 0x56, 0x78],
			},
		],
		tables: [createFuelMapDefinition()],
	};
}
