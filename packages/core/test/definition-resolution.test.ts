import { describe, expect, it, vi } from "vitest";
import { planRomDefinitionResolution } from "../src/definition/resolution.js";
import type {
	ROMDefinition,
	ROMDefinitionProvider,
	ROMDefinitionStub,
} from "../src/index.js";

function createDefinition(uri: string, name = "Definition"): ROMDefinition {
	return {
		uri,
		name,
		fingerprints: [],
		platform: {},
		tables: [],
	};
}

function createProvider(options: {
	id: string;
	canParseDefinitionUri?: (definitionUri: string) => boolean | Promise<boolean>;
	parse?: (definitionUri: string) => Promise<ROMDefinition>;
	peek?: (definitionUri: string) => Promise<ROMDefinitionStub>;
	discoverDefinitionUris?: (romUri?: string) => Promise<string[]>;
}): ROMDefinitionProvider {
	return {
		id: options.id,
		label: options.id,
		discoverDefinitionUris:
			options.discoverDefinitionUris ?? vi.fn(async () => []),
		canParseDefinitionUri: options.canParseDefinitionUri ?? vi.fn(() => false),
		peek:
			options.peek ??
			vi.fn(async (definitionUri: string) => ({
				uri: definitionUri,
				name: definitionUri,
				fingerprints: [],
			})),
		parse:
			options.parse ??
			vi.fn(async (definitionUri: string) => createDefinition(definitionUri)),
	};
}

describe("planRomDefinitionResolution", () => {
	it("uses the provider that claims the saved definition URI", async () => {
		const savedUri = "file:///saved-definition.xml";
		const firstProvider = createProvider({
			id: "first",
			canParseDefinitionUri: vi.fn(() => false),
			parse: vi.fn(async () => {
				throw new Error("should not parse with first provider");
			}),
		});
		const secondProvider = createProvider({
			id: "second",
			canParseDefinitionUri: vi.fn(
				(definitionUri) => definitionUri === savedUri,
			),
			parse: vi.fn(async (definitionUri) =>
				createDefinition(definitionUri, "Saved Definition"),
			),
		});

		const result = await planRomDefinitionResolution(
			"file:///rom.bin",
			new Uint8Array(),
			[firstProvider, secondProvider],
			savedUri,
		);

		expect(result.kind).toBe("saved");
		if (result.kind === "saved") {
			expect(result.definitionUri).toBe(savedUri);
			expect(result.definition.name).toBe("Saved Definition");
		}
		expect(firstProvider.parse).not.toHaveBeenCalled();
		expect(secondProvider.parse).toHaveBeenCalledWith(savedUri);
	});

	it("falls back to discovery when no provider claims the saved definition URI", async () => {
		const savedUri = "file:///saved-definition.unknown";
		const candidateUri = "file:///candidate.xml";
		const provider = createProvider({
			id: "ecuflash",
			canParseDefinitionUri: vi.fn(() => false),
			discoverDefinitionUris: vi.fn(async () => [candidateUri]),
			peek: vi.fn(async () => ({
				uri: candidateUri,
				name: "Candidate",
				fingerprints: [{ reads: [], expectedHex: [] }],
			})),
		});

		const result = await planRomDefinitionResolution(
			"file:///rom.bin",
			new Uint8Array(),
			[provider],
			savedUri,
		);

		expect(result.kind).toBe("prompt-all");
		expect(provider.parse).not.toHaveBeenCalled();
	});
});
