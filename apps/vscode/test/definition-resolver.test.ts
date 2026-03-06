import type {
	DefinitionProvider,
	ROMDefinition,
	ROMDefinitionStub,
} from "@ecu-explorer/core";
import { beforeEach, describe, expect, test, vi } from "vitest";
import * as vscode from "vscode";
import { resolveRomDefinition } from "../src/rom/definition-resolver";
import { WorkspaceState } from "../src/workspace-state";

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
});
