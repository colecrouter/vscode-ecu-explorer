import type { TableDefinition } from "@ecu-explorer/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	GraphSessionController,
	type GraphWebviewApi,
	type PersistedGraphPanelState,
} from "../src/webview/graph-session-controller.svelte.js";

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

function createHost(): GraphWebviewApi {
	return {
		postMessage: vi.fn(),
		getState: vi.fn(),
		setState: vi.fn(),
	};
}

describe("GraphSessionController", () => {
	let host: GraphWebviewApi;

	beforeEach(() => {
		host = createHost();
	});

	it("hydrates metadata from persisted state", () => {
		const persistedState: PersistedGraphPanelState = {
			romPath: "/test/rom.hex",
			tableId: "fuel-table",
			tableName: "Fuel Table",
			definitionUri: "file:///test/definition.xml",
		};

		const controller = new GraphSessionController(host, persistedState);

		expect(controller.romPath).toBe("/test/rom.hex");
		expect(controller.tableId).toBe("fuel-table");
		expect(controller.tableName).toBe("Fuel Table");
		expect(controller.definitionUri).toBe("file:///test/definition.xml");
	});

	it("applies reactive ROM updates through host messages", () => {
		const controller = new GraphSessionController(host);

		controller.handleHostMessage({
			type: "init",
			snapshot: {
				kind: "table1d",
				name: "Fuel Table",
				rows: 4,
				z: [10, 20, 30, 40],
			},
			romBytes: [10, 20, 30, 40, 0, 0, 0, 0, 1, 2, 3, 4, 100],
			tableDefinition: TABLE_DEF,
			tableId: TABLE_DEF.id,
			tableName: TABLE_DEF.name,
			romPath: "/test/rom.hex",
			preferredChartType: "line",
		});

		expect(controller.snapshot).toEqual(
			expect.objectContaining({
				kind: "table1d",
				z: [10, 20, 30, 40],
			}),
		);
		expect(controller.chartState.chartType).toBe("line");

		controller.handleHostMessage({
			type: "update",
			snapshot: {
				kind: "table1d",
				name: "Fuel Table",
				rows: 4,
				z: [42, 20, 30, 40],
			},
			romPatch: {
				offset: 0,
				bytes: [42],
			},
		});

		expect(controller.snapshot).toEqual(
			expect.objectContaining({
				kind: "table1d",
				z: [42, 20, 30, 40],
			}),
		);
	});

	it("forwards chart selection intents back to the host", () => {
		const controller = new GraphSessionController(host);

		controller.handleChartCellSelect(3, 7);
		controller.chartState.selectCell(1, 2);
		controller.syncSelectionChange();
		controller.signalReady();

		expect(host.postMessage).toHaveBeenCalledWith({
			type: "cellSelect",
			row: 3,
			col: 7,
		});
		expect(host.postMessage).toHaveBeenCalledWith({
			type: "selectionChange",
			selection: [{ row: 1, col: 2 }],
		});
		expect(host.postMessage).toHaveBeenCalledWith({ type: "ready" });
	});
});
