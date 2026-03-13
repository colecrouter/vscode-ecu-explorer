import type { DefinitionProvider, ROMDefinition } from "@ecu-explorer/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import {
	RomEditorProvider,
	TableEditorDelegate,
} from "../src/rom/editor-provider.js";
import {
	createExtensionContext,
	createMockWorkspaceState,
} from "./mocks/vscode-harness.js";

function createDefinition(uri: string): ROMDefinition {
	return {
		uri,
		name: "Resolved Definition",
		fingerprints: [],
		platform: {},
		tables: [
			{
				id: "test-table",
				name: "Test Table",
				kind: "table1d",
				rows: 4,
				z: {
					id: "test-table-z",
					name: "Values",
					address: 0,
					dtype: "u8",
					endianness: "le",
					length: 4,
					scale: 1,
					offset: 0,
				},
			},
		],
	};
}

describe("RomEditorProvider dirty events", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("emits edit events for table edits with native undo/redo callbacks", async () => {
		const romUri = vscode.Uri.file("/test/rom.hex");
		const definitionUri = "file:///defs/resolved.xml";
		const definition = createDefinition(definitionUri);
		const provider: DefinitionProvider = {
			id: "ecuflash",
			label: "ECUFlash",
			canParseDefinitionUri: vi.fn((uri: string) => uri === definitionUri),
			discoverDefinitionUris: vi.fn(async () => []),
			peek: vi.fn(),
			parse: vi.fn(async () => definition),
		};
		const context = createExtensionContext({
			workspaceState: createMockWorkspaceState(),
			extensionUri: vscode.Uri.file("/extension"),
		}) as vscode.ExtensionContext;
		const onTableEditAction = vi.fn(async () => undefined);
		const editorProvider = new RomEditorProvider(
			context,
			{
				list: () => [provider],
			},
			undefined,
			undefined,
			undefined,
			onTableEditAction,
		);
		const tableDelegate = new TableEditorDelegate(editorProvider);
		vi.spyOn(vscode.workspace.fs, "readFile").mockResolvedValue(
			new Uint8Array([0x10, 0x20, 0x30, 0x40]),
		);

		const events: unknown[] = [];
		tableDelegate.onDidChangeCustomDocument((event) => {
			events.push(event);
		});

		const tableUri = vscode.Uri.parse(
			`ecu-table://${romUri.path}/${encodeURIComponent("Test Table")}?table=${encodeURIComponent("test-table")}&name=${encodeURIComponent("Test Table")}&definition=${encodeURIComponent(definitionUri)}`,
		);

		const document = await editorProvider.openCustomDocument(
			tableUri,
			{ backupId: undefined, untitledDocumentData: undefined },
			{} as vscode.CancellationToken,
		);
		if (!("romDocument" in document)) {
			throw new Error("Expected a TableDocument");
		}

		document.romDocument.updateBytes(
			new Uint8Array([0xaa, 0x20, 0x30, 0x40]),
			0,
			1,
			true,
		);

		expect(events).toHaveLength(1);
		expect(events[0]).toEqual(
			expect.objectContaining({
				document,
			}),
		);
		expect(events[0]).toHaveProperty("undo");
		expect(events[0]).toHaveProperty("redo");

		const event = events[0] as vscode.CustomDocumentEditEvent<typeof document>;
		await event.undo();
		await event.redo();

		expect(onTableEditAction).toHaveBeenNthCalledWith(1, document, "undo");
		expect(onTableEditAction).toHaveBeenNthCalledWith(2, document, "redo");
	});
});
