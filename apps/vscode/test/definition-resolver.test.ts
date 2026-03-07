import type {
	DefinitionProvider,
	ROMDefinition,
	ROMDefinitionStub,
} from "@ecu-explorer/core";
import { beforeEach, describe, expect, test, vi } from "vitest";
import * as vscode from "vscode";
import { resolveRomDefinition } from "../src/rom/definition-resolver.js";
import { WorkspaceState } from "../src/workspace-state.js";

type MockMemento = Pick<vscode.Memento, "get" | "update" | "keys">;

function createDefinition(): ROMDefinition {
	return {
		uri: "file:///definition.xml",
		name: "Test Definition",
		fingerprints: [],
		platform: {},
		tables: [],
	};
}

function createProvider(
	overrides?: Partial<DefinitionProvider>,
): DefinitionProvider {
	const stub: ROMDefinitionStub = {
		uri: "file:///definition.xml",
		name: "Test Definition",
		fingerprints: [],
	};

	return {
		id: "ecuflash",
		label: "ECUFlash",
		canParseDefinitionUri: vi.fn(async () => true),
		discoverDefinitionUris: vi.fn(async () => [stub.uri]),
		peek: vi.fn(async () => stub),
		parse: vi.fn(async () => createDefinition()),
		...overrides,
	};
}

describe("resolveRomDefinition", () => {
	const romUri = vscode.Uri.file("/test/rom.hex");
	const romBytes = new Uint8Array([0x56, 0x89, 0x03, 0x13]);
	let stateManager: WorkspaceState;
	let mockMemento: MockMemento;

	beforeEach(() => {
		vi.restoreAllMocks();
		mockMemento = {
			get: vi.fn(() => undefined),
			update: vi.fn(),
			keys: vi.fn(() => []),
		};
		stateManager = new WorkspaceState(mockMemento);
	});

	test("shows actionable include error when a saved definition has unresolved includes", async () => {
		mockMemento.get = vi.fn((key: string) => {
			if (key !== "ecuExplorer.workspaceState") return undefined;
			return {
				romDefinitions: {
					[romUri.fsPath]: "file:///saved-definition.xml",
				},
				lastOpenedTables: {},
				tableStates: {},
				dirtyTables: {},
			};
		});
		stateManager = new WorkspaceState(mockMemento);
		const provider = createProvider({
			parse: vi.fn(async () => {
				throw new Error(
					'Failed to resolve include "56890013" referenced by "C:\\defs\\TephraMOD-56890313.xml". Search roots: C:\\defs. Attempted filename and xmlid lookup in discovered XML files.',
				);
			}),
			discoverDefinitionUris: vi.fn(async () => []),
		});
		const errorSpy = vi
			.spyOn(vscode.window, "showErrorMessage")
			.mockResolvedValue(undefined);

		stateManager.saveRomDefinition(
			romUri.fsPath,
			"file:///saved-definition.xml",
		);

		const result = await resolveRomDefinition(
			romUri,
			romBytes,
			{ list: () => [provider] },
			stateManager,
		);

		expect(result).toBeUndefined();
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("included parent definition could not be found"),
		);
		expect(mockMemento.update).toHaveBeenLastCalledWith(
			"ecuExplorer.workspaceState",
			expect.objectContaining({
				romDefinitions: expect.objectContaining({
					[romUri.fsPath]: "",
				}),
			}),
		);
	});

	test("shows actionable include error when manually selected definition cannot resolve includes", async () => {
		const provider = createProvider({
			discoverDefinitionUris: vi.fn(async () => []),
			parse: vi.fn(async () => {
				throw new Error(
					'Failed to resolve include "56890013" referenced by "C:\\defs\\TephraMOD-56890313.xml". Search roots: C:\\defs. Attempted filename and xmlid lookup in discovered XML files.',
				);
			}),
		});
		vi.spyOn(vscode.window, "showOpenDialog").mockResolvedValue([
			vscode.Uri.file("/manual/TephraMOD-56890313.xml"),
		]);
		const errorSpy = vi
			.spyOn(vscode.window, "showErrorMessage")
			.mockResolvedValue(undefined);

		const result = await resolveRomDefinition(
			romUri,
			romBytes,
			{ list: () => [provider] },
			stateManager,
		);

		expect(result).toBeUndefined();
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("included parent definition could not be found"),
		);
		expect(mockMemento.update).not.toHaveBeenCalled();
	});

	test("returns manually selected definition when no candidate auto-match exists", async () => {
		const selectedUri = vscode.Uri.file("/manual/TephraMOD-56890313.xml");
		const parsed: ROMDefinition = {
			uri: selectedUri.toString(),
			name: "TephraMOD-56890313",
			fingerprints: [],
			platform: {},
			tables: [
				{
					id: "boost-target::0x1000",
					name: "Boost Target",
					kind: "table1d",
					rows: 1,
					z: {
						id: "boost-target-z::0x1000",
						name: "Boost Target",
						address: 0x1000,
						dtype: "u8",
						endianness: "le",
						length: 1,
						scale: 1,
						offset: 0,
					},
				},
			],
		};
		const provider = createProvider({
			discoverDefinitionUris: vi.fn(async () => []),
			parse: vi.fn(async (uri: string) => {
				expect(uri).toBe(selectedUri.toString());
				return parsed;
			}),
		});
		vi.spyOn(vscode.window, "showOpenDialog").mockResolvedValue([selectedUri]);

		const result = await resolveRomDefinition(
			romUri,
			romBytes,
			{ list: () => [provider] },
			stateManager,
		);

		expect(result).toEqual(parsed);
		expect(mockMemento.update).toHaveBeenCalledWith(
			"ecuExplorer.workspaceState",
			expect.objectContaining({
				romDefinitions: expect.objectContaining({
					[romUri.fsPath]: selectedUri.toString(),
				}),
			}),
		);
	});

	test("persists manually selected definition so a later table open can reuse it", async () => {
		const selectedUri = vscode.Uri.file("/manual/TephraMOD-56890313.xml");
		const parsed: ROMDefinition = {
			uri: selectedUri.toString(),
			name: "TephraMOD-56890313",
			fingerprints: [],
			platform: {},
			tables: [],
		};
		const provider = createProvider({
			discoverDefinitionUris: vi.fn(async () => []),
			parse: vi.fn(async () => parsed),
		});
		vi.spyOn(vscode.window, "showOpenDialog").mockResolvedValue([selectedUri]);

		await resolveRomDefinition(
			romUri,
			romBytes,
			{ list: () => [provider] },
			stateManager,
		);

		expect(stateManager.getRomDefinition(romUri.fsPath)).toBe(
			selectedUri.toString(),
		);
	});
});
