import type { DefinitionProvider, ROMDefinition } from "@ecu-explorer/core";
import { beforeEach, describe, expect, test, vi } from "vitest";
import * as vscode from "vscode";
import { handleOpenTableFromTree } from "../src/commands/graph-commands.js";
import {
	openTableInCustomEditor,
	setTableCommandsContext,
} from "../src/commands/table-commands.js";
import { RomEditorProvider } from "../src/rom/editor-provider.js";
import { WorkspaceState } from "../src/workspace-state.js";

type MockMemento = Pick<vscode.Memento, "get" | "update" | "keys">;

function createDefinition(uri: string): ROMDefinition {
	return {
		uri,
		name: "Resolved Definition",
		fingerprints: [],
		platform: {},
		tables: [
			{
				id: "cyl-fuel-trim-2::fuel::0x1000",
				name: "Cylinder Fuel Trim #2",
				kind: "table1d",
				rows: 1,
				z: {
					id: "cyl-fuel-trim-2-z::0x1000",
					name: "Cylinder Fuel Trim #2",
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
}

describe("table open definition identity", () => {
	let mockMemento: MockMemento;
	let workspaceState: WorkspaceState;

	beforeEach(() => {
		vi.restoreAllMocks();
		mockMemento = {
			get: vi.fn(() => undefined),
			update: vi.fn(),
			keys: vi.fn(() => []),
		};
		workspaceState = new WorkspaceState(mockMemento);
	});

	test("[`openTableInCustomEditor()`](apps/vscode/src/commands/table-commands.ts:51) includes the saved definition URI and stable table id in the table URI", async () => {
		const romUri = vscode.Uri.file("/test/rom.hex");
		workspaceState.saveRomDefinition(
			romUri.fsPath,
			"file:///defs/resolved.xml",
		);
		setTableCommandsContext({ list: () => [] }, workspaceState);
		const executeSpy = vi
			.spyOn(vscode.commands, "executeCommand")
			.mockResolvedValue(undefined);

		await openTableInCustomEditor(
			romUri,
			"cyl-fuel-trim-2::fuel::0x1000",
			"Cylinder Fuel Trim #2",
		);

		expect(executeSpy).toHaveBeenCalledWith(
			"vscode.openWith",
			expect.objectContaining({
				query: expect.stringContaining("table=cyl-fuel-trim-2::fuel::0x1000"),
			}),
			"romViewer.tableEditor",
		);
	});

	test("[`handleOpenTableFromTree()`](apps/vscode/src/commands/table-commands.ts:197) forwards the stable table id and display name", async () => {
		const openTableSpy = vi.fn(async () => undefined);

		await handleOpenTableFromTree(
			{} as vscode.ExtensionContext,
			"file:///test/rom.hex",
			"shared-label::ignition::0x2000",
			"Shared Label",
			openTableSpy,
		);

		expect(openTableSpy).toHaveBeenCalledWith(
			expect.objectContaining({ fsPath: "/test/rom.hex" }),
			"shared-label::ignition::0x2000",
			"Shared Label",
		);
	});

	test("[`RomEditorProvider.openCustomDocument()`](apps/vscode/src/rom/editor-provider.ts:179) can reopen a table using the carried definition URI", async () => {
		const romUri = vscode.Uri.file("/test/rom.hex");
		const definitionUri = "file:///defs/resolved.xml";
		const definition = createDefinition(definitionUri);
		const provider: DefinitionProvider = {
			id: "ecuflash",
			label: "ECUFlash",
			canParseDefinitionUri: vi.fn((uri: string) => uri === definitionUri),
			discoverDefinitionUris: vi.fn(async () => []),
			peek: vi.fn(),
			parse: vi.fn(async (uri: string) => {
				if (uri !== definitionUri) {
					throw new Error("Unexpected definition URI");
				}
				return definition;
			}),
		};
		const context = {
			workspaceState: mockMemento,
			extensionUri: vscode.Uri.file("/extension"),
		} as vscode.ExtensionContext;
		const editorProvider = new RomEditorProvider(context, {
			list: () => [provider],
		});
		vi.spyOn(vscode.workspace.fs, "readFile").mockResolvedValue(
			new Uint8Array([0x56, 0x89, 0x03, 0x13]),
		);
		vi.spyOn(vscode.window, "showOpenDialog").mockResolvedValue(undefined);
		vi.spyOn(vscode.window, "showQuickPick").mockResolvedValue(undefined);

		const tableUri = vscode.Uri.parse(
			`ecu-table://${romUri.path}/${encodeURIComponent("Cylinder Fuel Trim #2")}?table=${encodeURIComponent("cyl-fuel-trim-2::fuel::0x1000")}&name=${encodeURIComponent("Cylinder Fuel Trim #2")}&definition=${encodeURIComponent(definitionUri)}`,
		);

		const document = await editorProvider.openCustomDocument(
			tableUri,
			{ backupId: undefined, untitledDocumentData: undefined },
			{} as vscode.CancellationToken,
		);

		const tableDocument = document as InstanceType<
			typeof RomEditorProvider
		> extends never
			? never
			: typeof document;
		if (!("tableId" in tableDocument)) {
			throw new Error("Expected a TableDocument");
		}
		expect(tableDocument.tableId).toBe("cyl-fuel-trim-2::fuel::0x1000");
		expect(provider.parse).toHaveBeenCalledWith(definitionUri);
	});

	test("[`RomEditorProvider.openCustomDocument()`](apps/vscode/src/rom/editor-provider.ts:194) resolves duplicate display names by stable id", async () => {
		const romUri = vscode.Uri.file("/test/rom.hex");
		const definitionUri = "file:///defs/resolved.xml";
		const definition: ROMDefinition = {
			uri: definitionUri,
			name: "Resolved Definition",
			fingerprints: [],
			platform: {},
			tables: [
				{
					id: "shared-label::fuel::0x1000",
					name: "Shared Label",
					category: "Fuel",
					kind: "table1d",
					rows: 1,
					z: {
						id: "shared-label-z::fuel::0x1000",
						name: "Shared Label",
						address: 0x1000,
						dtype: "u8",
						endianness: "le",
						length: 1,
					},
				},
				{
					id: "shared-label::ignition::0x2000",
					name: "Shared Label",
					category: "Ignition",
					kind: "table1d",
					rows: 1,
					z: {
						id: "shared-label-z::ignition::0x2000",
						name: "Shared Label",
						address: 0x2000,
						dtype: "u8",
						endianness: "le",
						length: 1,
					},
				},
			],
		};
		const provider: DefinitionProvider = {
			id: "ecuflash",
			label: "ECUFlash",
			canParseDefinitionUri: vi.fn((uri: string) => uri === definitionUri),
			discoverDefinitionUris: vi.fn(async () => []),
			peek: vi.fn(),
			parse: vi.fn(async () => definition),
		};
		const context = {
			workspaceState: mockMemento,
			extensionUri: vscode.Uri.file("/extension"),
		} as vscode.ExtensionContext;
		const editorProvider = new RomEditorProvider(context, {
			list: () => [provider],
		});
		vi.spyOn(vscode.workspace.fs, "readFile").mockResolvedValue(
			new Uint8Array([0x56, 0x89, 0x03, 0x13]),
		);

		const tableUri = vscode.Uri.parse(
			`ecu-table://${romUri.path}/${encodeURIComponent("Shared Label")}?table=${encodeURIComponent("shared-label::ignition::0x2000")}&name=${encodeURIComponent("Shared Label")}&definition=${encodeURIComponent(definitionUri)}`,
		);

		const document = await editorProvider.openCustomDocument(
			tableUri,
			{ backupId: undefined, untitledDocumentData: undefined },
			{} as vscode.CancellationToken,
		);

		if (!("tableId" in document)) {
			throw new Error("Expected a TableDocument");
		}
		expect(document.tableId).toBe("shared-label::ignition::0x2000");
		expect(document.tableDef.id).toBe("shared-label::ignition::0x2000");
		expect(document.tableDef.name).toBe("Shared Label");
	});
});
