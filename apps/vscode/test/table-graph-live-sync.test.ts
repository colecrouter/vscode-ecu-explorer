import {
	type ROMDefinition,
	snapshotTable,
	type TableDefinition,
} from "@ecu-explorer/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { GraphPanelManager } from "../src/graph-panel-manager.js";
import {
	handleTableOpen,
	setTableHandlerContext,
} from "../src/handlers/table-handler.js";
import { RomDocument } from "../src/rom/document.js";
import { TableDocument } from "../src/table-document.js";
import { createExtensionContext } from "./mocks/vscode-harness.js";
import {
	createMockWebviewPanel,
	type GraphCompatibleWebview,
	type GraphCompatibleWebviewPanel,
} from "./mocks/webview-mock.js";

const TABLE_DEF: TableDefinition = {
	id: "fuel-table",
	name: "Fuel Table",
	kind: "table1d",
	rows: 4,
	x: {
		id: "fuel-x",
		name: "RPM",
		address: 0x10,
		dtype: "u8",
	},
	z: {
		id: "fuel-z",
		name: "Value",
		address: 0,
		dtype: "u8",
	},
} as TableDefinition;

const DEFINITION: ROMDefinition = {
	uri: "file:///test/definition.xml",
	name: "Test Definition",
	fingerprints: [],
	platform: { make: "Subaru" },
	tables: [TABLE_DEF],
};

function asPanel(panel: GraphCompatibleWebviewPanel): vscode.WebviewPanel {
	return panel as vscode.WebviewPanel;
}

function asWebview(webview: vscode.Webview): GraphCompatibleWebview {
	return webview as GraphCompatibleWebview;
}

describe("Table to Graph live synchronization", () => {
	beforeEach(() => {
		vi.mocked(vscode.window.createWebviewPanel).mockImplementation(
			(_viewType, title) => asPanel(createMockWebviewPanel(title)),
		);
	});

	it("pushes graph updates when a real table webview edit updates the ROM document", async () => {
		const context = createExtensionContext();
		const romUri = vscode.Uri.file("/test/live-sync.hex");
		const romDocument = new RomDocument(
			romUri,
			new Uint8Array([10, 20, 30, 40, 1, 2, 3, 4, 5, 6, 7, 8, 1000]),
			DEFINITION,
		);
		const tableUri = vscode.Uri.parse(
			"ecu-table:/test/live-sync.hex?table=fuel-table",
		);
		const tableDocument = new TableDocument(
			tableUri,
			romDocument,
			TABLE_DEF.id,
			TABLE_DEF,
		);

		const panelToDocument = new Map<vscode.WebviewPanel, RomDocument>();
		const tableSessions = new Map();
		let graphManager: GraphPanelManager;

		setTableHandlerContext(() => ({
			activeRom: null,
			activeTableName: null,
			activeTableDef: null,
			activePanel: null,
			panelToDocument,
			tableSessions,
			treeProvider: null,
			getRomDocumentForPanel: (panel) => panelToDocument.get(panel),
			getRomDocumentForPanelRef: (panel) => panelToDocument.get(panel),
			setupTableWebview: async (panel) => {
				panel.webview.html = "<html><body>table</body></html>";
			},
			registerPanel: (panel, document) => {
				panelToDocument.set(panel, document);
			},
			notifyTableSessionAvailable: (session) => {
				graphManager.handleTableSessionAvailable(session);
			},
			handleCellEdit: () => {},
			handleUndo: () => {},
			handleRedo: () => {},
			exportActiveTableCsvFlow: async () => {},
			importTableFromCsvFlow: async () => {},
			openTableInCustomEditor: async () => {},
		}));

		graphManager = new GraphPanelManager(
			context as vscode.ExtensionContext,
			(romPath) => (romPath === romUri.fsPath ? romDocument : undefined),
			(romPath, tableId) => {
				if (romPath !== romUri.fsPath || tableId !== TABLE_DEF.id) {
					return undefined;
				}
				return snapshotTable(TABLE_DEF, romDocument.romBytes);
			},
			undefined,
			undefined,
			(romPath, tableId) => {
				if (romPath !== romUri.fsPath || tableId !== TABLE_DEF.id) {
					return undefined;
				}
				return tableSessions.get(tableUri.toString());
			},
		);

		const graphPanel = graphManager.getOrCreatePanel(
			romUri.fsPath,
			TABLE_DEF.id,
			TABLE_DEF.name,
			snapshotTable(TABLE_DEF, romDocument.romBytes),
		);
		asWebview(graphPanel.webview)._clearMessages();

		const tablePanel = asPanel(createMockWebviewPanel("Table"));
		await handleTableOpen(
			tableDocument,
			tablePanel,
			context as vscode.ExtensionContext,
		);
		asWebview(tablePanel.webview)._simulateMessage({
			type: "ready",
		});
		asWebview(graphPanel.webview)._clearMessages();

		asWebview(tablePanel.webview)._simulateMessage({
			type: "cellEdit",
			row: 0,
			col: 0,
			value: new Uint8Array([42]),
		});

		expect(graphPanel.webview.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "update",
				snapshot: expect.objectContaining({
					kind: "table1d",
					name: TABLE_DEF.name,
					z: [42, 20, 30, 40],
				}),
			}),
		);
	});
});
