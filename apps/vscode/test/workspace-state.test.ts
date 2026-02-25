import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as vscode from "vscode";
import { type TableEditorState, WorkspaceState } from "../src/workspace-state";

describe("workspace-state", () => {
	let memento: vscode.Memento;
	let workspaceState: WorkspaceState;
	let storage: Map<string, any>;

	beforeEach(() => {
		// Create a mock memento with in-memory storage
		storage = new Map();
		memento = {
			get: (key: string) => storage.get(key),
			update: async (key: string, value: any) => {
				storage.set(key, value);
			},
			keys: () => Array.from(storage.keys()),
		};

		workspaceState = new WorkspaceState(memento);
	});

	afterEach(() => {
		// Clean up any pending timers
		vi.clearAllTimers();
	});

	describe("saveRomDefinition and getRomDefinition", () => {
		it("saves and retrieves ROM definition", () => {
			const romPath = "/path/to/rom.hex";
			const definitionUri = "file:///path/to/def.xml";

			workspaceState.saveRomDefinition(romPath, definitionUri);
			const retrieved = workspaceState.getRomDefinition(romPath);

			expect(retrieved).toBe(definitionUri);
		});

		it("returns undefined for non-existent ROM", () => {
			const retrieved = workspaceState.getRomDefinition("/nonexistent.hex");
			expect(retrieved).toBeUndefined();
		});

		it("overwrites existing definition", () => {
			const romPath = "/path/to/rom.hex";
			const def1 = "file:///def1.xml";
			const def2 = "file:///def2.xml";

			workspaceState.saveRomDefinition(romPath, def1);
			workspaceState.saveRomDefinition(romPath, def2);

			const retrieved = workspaceState.getRomDefinition(romPath);
			expect(retrieved).toBe(def2);
		});

		it("handles multiple ROM files independently", () => {
			const rom1 = "/path/to/rom1.hex";
			const rom2 = "/path/to/rom2.hex";
			const def1 = "file:///def1.xml";
			const def2 = "file:///def2.xml";

			workspaceState.saveRomDefinition(rom1, def1);
			workspaceState.saveRomDefinition(rom2, def2);

			expect(workspaceState.getRomDefinition(rom1)).toBe(def1);
			expect(workspaceState.getRomDefinition(rom2)).toBe(def2);
		});
	});

	describe("saveLastOpenedTable and getLastOpenedTable", () => {
		it("saves and retrieves last opened table", () => {
			const romPath = "/path/to/rom.hex";
			const tableId = "Fuel Map";

			workspaceState.saveLastOpenedTable(romPath, tableId);
			const retrieved = workspaceState.getLastOpenedTable(romPath);

			expect(retrieved).toBe(tableId);
		});

		it("returns undefined for non-existent ROM", () => {
			const retrieved = workspaceState.getLastOpenedTable("/nonexistent.hex");
			expect(retrieved).toBeUndefined();
		});

		it("overwrites existing table", () => {
			const romPath = "/path/to/rom.hex";
			const table1 = "Fuel Map";
			const table2 = "Ignition Map";

			workspaceState.saveLastOpenedTable(romPath, table1);
			workspaceState.saveLastOpenedTable(romPath, table2);

			const retrieved = workspaceState.getLastOpenedTable(romPath);
			expect(retrieved).toBe(table2);
		});

		it("handles multiple ROM files independently", () => {
			const rom1 = "/path/to/rom1.hex";
			const rom2 = "/path/to/rom2.hex";
			const table1 = "Fuel Map";
			const table2 = "Ignition Map";

			workspaceState.saveLastOpenedTable(rom1, table1);
			workspaceState.saveLastOpenedTable(rom2, table2);

			expect(workspaceState.getLastOpenedTable(rom1)).toBe(table1);
			expect(workspaceState.getLastOpenedTable(rom2)).toBe(table2);
		});
	});

	describe("saveTableState and getTableState", () => {
		it("saves and retrieves table state", async () => {
			vi.useFakeTimers();

			const tableUri = "ecu-explorer://table?file=test&table=t1";
			const state: TableEditorState = {
				romPath: "/path/to/rom.hex",
				tableId: "Fuel Map",
				definitionUri: "file:///def.xml",
			};

			workspaceState.saveTableState(tableUri, state);

			// Fast-forward time to trigger debounced save
			await vi.advanceTimersByTimeAsync(1000);

			const retrieved = workspaceState.getTableState(tableUri);
			expect(retrieved).toEqual(state);

			vi.useRealTimers();
		});

		it("saves state with scroll position", async () => {
			vi.useFakeTimers();

			const tableUri = "ecu-explorer://table?file=test&table=t1";
			const state: TableEditorState = {
				romPath: "/path/to/rom.hex",
				tableId: "Fuel Map",
				definitionUri: "file:///def.xml",
				scrollPosition: { row: 5, col: 10 },
			};

			workspaceState.saveTableState(tableUri, state);
			await vi.advanceTimersByTimeAsync(1000);

			const retrieved = workspaceState.getTableState(tableUri);
			expect(retrieved).toEqual(state);

			vi.useRealTimers();
		});

		it("saves state with selection", async () => {
			vi.useFakeTimers();

			const tableUri = "ecu-explorer://table?file=test&table=t1";
			const state: TableEditorState = {
				romPath: "/path/to/rom.hex",
				tableId: "Fuel Map",
				definitionUri: "file:///def.xml",
				selection: {
					startRow: 0,
					startCol: 0,
					endRow: 5,
					endCol: 5,
				},
			};

			workspaceState.saveTableState(tableUri, state);
			await vi.advanceTimersByTimeAsync(1000);

			const retrieved = workspaceState.getTableState(tableUri);
			expect(retrieved).toEqual(state);

			vi.useRealTimers();
		});

		it("saves state with last modified timestamp", async () => {
			vi.useFakeTimers();

			const tableUri = "ecu-explorer://table?file=test&table=t1";
			const state: TableEditorState = {
				romPath: "/path/to/rom.hex",
				tableId: "Fuel Map",
				definitionUri: "file:///def.xml",
				lastModified: Date.now(),
			};

			workspaceState.saveTableState(tableUri, state);
			await vi.advanceTimersByTimeAsync(1000);

			const retrieved = workspaceState.getTableState(tableUri);
			expect(retrieved).toEqual(state);

			vi.useRealTimers();
		});

		it("returns undefined for non-existent table", () => {
			const retrieved = workspaceState.getTableState("nonexistent");
			expect(retrieved).toBeUndefined();
		});

		it("debounces multiple rapid saves", async () => {
			vi.useFakeTimers();

			const tableUri = "ecu-explorer://table?file=test&table=t1";
			const state1: TableEditorState = {
				romPath: "/path/to/rom.hex",
				tableId: "Fuel Map",
				definitionUri: "file:///def.xml",
				scrollPosition: { row: 0, col: 0 },
			};
			const state2: TableEditorState = {
				...state1,
				scrollPosition: { row: 5, col: 5 },
			};
			const state3: TableEditorState = {
				...state1,
				scrollPosition: { row: 10, col: 10 },
			};

			// Save multiple times rapidly
			workspaceState.saveTableState(tableUri, state1);
			await vi.advanceTimersByTimeAsync(500);
			workspaceState.saveTableState(tableUri, state2);
			await vi.advanceTimersByTimeAsync(500);
			workspaceState.saveTableState(tableUri, state3);

			// Only the last state should be saved after debounce
			await vi.advanceTimersByTimeAsync(1000);

			const retrieved = workspaceState.getTableState(tableUri);
			expect(retrieved).toEqual(state3);

			vi.useRealTimers();
		});

		it("handles multiple table states independently", async () => {
			vi.useFakeTimers();

			const uri1 = "ecu-explorer://table?file=test1&table=t1";
			const uri2 = "ecu-explorer://table?file=test2&table=t2";
			const state1: TableEditorState = {
				romPath: "/path/to/rom1.hex",
				tableId: "Fuel Map",
				definitionUri: "file:///def1.xml",
			};
			const state2: TableEditorState = {
				romPath: "/path/to/rom2.hex",
				tableId: "Ignition Map",
				definitionUri: "file:///def2.xml",
			};

			workspaceState.saveTableState(uri1, state1);
			workspaceState.saveTableState(uri2, state2);
			await vi.advanceTimersByTimeAsync(1000);

			expect(workspaceState.getTableState(uri1)).toEqual(state1);
			expect(workspaceState.getTableState(uri2)).toEqual(state2);

			vi.useRealTimers();
		});
	});

	describe("clearRomState", () => {
		it("clears ROM definition", () => {
			const romPath = "/path/to/rom.hex";
			workspaceState.saveRomDefinition(romPath, "file:///def.xml");
			workspaceState.clearRomState(romPath);

			expect(workspaceState.getRomDefinition(romPath)).toBeUndefined();
		});

		it("clears last opened table", () => {
			const romPath = "/path/to/rom.hex";
			workspaceState.saveLastOpenedTable(romPath, "Fuel Map");
			workspaceState.clearRomState(romPath);

			expect(workspaceState.getLastOpenedTable(romPath)).toBeUndefined();
		});

		it("clears all table states for ROM", async () => {
			vi.useFakeTimers();

			const romPath = "/path/to/rom.hex";
			const uri1 = "ecu-explorer://table?file=test&table=t1";
			const uri2 = "ecu-explorer://table?file=test&table=t2";
			const state1: TableEditorState = {
				romPath,
				tableId: "Fuel Map",
				definitionUri: "file:///def.xml",
			};
			const state2: TableEditorState = {
				romPath,
				tableId: "Ignition Map",
				definitionUri: "file:///def.xml",
			};

			workspaceState.saveTableState(uri1, state1);
			workspaceState.saveTableState(uri2, state2);
			await vi.advanceTimersByTimeAsync(1000);

			workspaceState.clearRomState(romPath);

			expect(workspaceState.getTableState(uri1)).toBeUndefined();
			expect(workspaceState.getTableState(uri2)).toBeUndefined();

			vi.useRealTimers();
		});

		it("does not affect other ROM files", async () => {
			vi.useFakeTimers();

			const rom1 = "/path/to/rom1.hex";
			const rom2 = "/path/to/rom2.hex";

			workspaceState.saveRomDefinition(rom1, "file:///def1.xml");
			workspaceState.saveRomDefinition(rom2, "file:///def2.xml");
			workspaceState.saveLastOpenedTable(rom1, "Fuel Map");
			workspaceState.saveLastOpenedTable(rom2, "Ignition Map");

			const uri1 = "ecu-explorer://table?file=test1&table=t1";
			const uri2 = "ecu-explorer://table?file=test2&table=t2";
			const state1: TableEditorState = {
				romPath: rom1,
				tableId: "Fuel Map",
				definitionUri: "file:///def1.xml",
			};
			const state2: TableEditorState = {
				romPath: rom2,
				tableId: "Ignition Map",
				definitionUri: "file:///def2.xml",
			};

			workspaceState.saveTableState(uri1, state1);
			workspaceState.saveTableState(uri2, state2);
			await vi.advanceTimersByTimeAsync(1000);

			// Clear only rom1
			workspaceState.clearRomState(rom1);

			// rom1 state should be cleared
			expect(workspaceState.getRomDefinition(rom1)).toBeUndefined();
			expect(workspaceState.getLastOpenedTable(rom1)).toBeUndefined();
			expect(workspaceState.getTableState(uri1)).toBeUndefined();

			// rom2 state should remain
			expect(workspaceState.getRomDefinition(rom2)).toBe("file:///def2.xml");
			expect(workspaceState.getLastOpenedTable(rom2)).toBe("Ignition Map");
			expect(workspaceState.getTableState(uri2)).toEqual(state2);

			vi.useRealTimers();
		});
	});

	describe("clearAll", () => {
		it("clears all state", async () => {
			vi.useFakeTimers();

			workspaceState.saveRomDefinition("/rom1.hex", "file:///def1.xml");
			workspaceState.saveRomDefinition("/rom2.hex", "file:///def2.xml");
			workspaceState.saveLastOpenedTable("/rom1.hex", "Fuel Map");
			workspaceState.saveLastOpenedTable("/rom2.hex", "Ignition Map");

			const uri = "ecu-explorer://table?file=test&table=t1";
			const state: TableEditorState = {
				romPath: "/rom1.hex",
				tableId: "Fuel Map",
				definitionUri: "file:///def1.xml",
			};
			workspaceState.saveTableState(uri, state);
			await vi.advanceTimersByTimeAsync(1000);

			workspaceState.clearAll();

			expect(workspaceState.getRomDefinition("/rom1.hex")).toBeUndefined();
			expect(workspaceState.getRomDefinition("/rom2.hex")).toBeUndefined();
			expect(workspaceState.getLastOpenedTable("/rom1.hex")).toBeUndefined();
			expect(workspaceState.getLastOpenedTable("/rom2.hex")).toBeUndefined();
			expect(workspaceState.getTableState(uri)).toBeUndefined();

			vi.useRealTimers();
		});
	});

	describe("getAllRomDefinitions", () => {
		it("returns all ROM definitions", () => {
			workspaceState.saveRomDefinition("/rom1.hex", "file:///def1.xml");
			workspaceState.saveRomDefinition("/rom2.hex", "file:///def2.xml");

			const all = workspaceState.getAllRomDefinitions();

			expect(all).toEqual({
				"/rom1.hex": "file:///def1.xml",
				"/rom2.hex": "file:///def2.xml",
			});
		});

		it("returns empty object when no definitions", () => {
			const all = workspaceState.getAllRomDefinitions();
			expect(all).toEqual({});
		});

		it("returns a copy of the state", () => {
			workspaceState.saveRomDefinition("/rom1.hex", "file:///def1.xml");

			const all1 = workspaceState.getAllRomDefinitions();
			const all2 = workspaceState.getAllRomDefinitions();

			expect(all1).not.toBe(all2); // Different objects
			expect(all1).toEqual(all2); // Same content
		});
	});

	describe("getAllTableStates", () => {
		it("returns all table states", async () => {
			vi.useFakeTimers();

			const uri1 = "ecu-explorer://table?file=test1&table=t1";
			const uri2 = "ecu-explorer://table?file=test2&table=t2";
			const state1: TableEditorState = {
				romPath: "/rom1.hex",
				tableId: "Fuel Map",
				definitionUri: "file:///def1.xml",
			};
			const state2: TableEditorState = {
				romPath: "/rom2.hex",
				tableId: "Ignition Map",
				definitionUri: "file:///def2.xml",
			};

			workspaceState.saveTableState(uri1, state1);
			workspaceState.saveTableState(uri2, state2);
			await vi.advanceTimersByTimeAsync(1000);

			const all = workspaceState.getAllTableStates();

			expect(all).toEqual({
				[uri1]: state1,
				[uri2]: state2,
			});

			vi.useRealTimers();
		});

		it("returns empty object when no states", () => {
			const all = workspaceState.getAllTableStates();
			expect(all).toEqual({});
		});

		it("returns a copy of the state", async () => {
			vi.useFakeTimers();

			const uri = "ecu-explorer://table?file=test&table=t1";
			const state: TableEditorState = {
				romPath: "/rom1.hex",
				tableId: "Fuel Map",
				definitionUri: "file:///def1.xml",
			};

			workspaceState.saveTableState(uri, state);
			await vi.advanceTimersByTimeAsync(1000);

			const all1 = workspaceState.getAllTableStates();
			const all2 = workspaceState.getAllTableStates();

			expect(all1).not.toBe(all2); // Different objects
			expect(all1).toEqual(all2); // Same content

			vi.useRealTimers();
		});
	});

	describe("flush", () => {
		it("saves pending state immediately", () => {
			vi.useFakeTimers();

			const tableUri = "ecu-explorer://table?file=test&table=t1";
			const state: TableEditorState = {
				romPath: "/path/to/rom.hex",
				tableId: "Fuel Map",
				definitionUri: "file:///def.xml",
			};

			workspaceState.saveTableState(tableUri, state);

			// Don't advance timers - flush should save immediately
			workspaceState.flush();

			const retrieved = workspaceState.getTableState(tableUri);
			expect(retrieved).toEqual(state);

			vi.useRealTimers();
		});

		it("clears pending timeout", () => {
			vi.useFakeTimers();

			const tableUri = "ecu-explorer://table?file=test&table=t1";
			const state: TableEditorState = {
				romPath: "/path/to/rom.hex",
				tableId: "Fuel Map",
				definitionUri: "file:///def.xml",
			};

			workspaceState.saveTableState(tableUri, state);
			workspaceState.flush();

			// Advancing timers should not cause another save
			vi.advanceTimersByTime(1000);

			// State should still be saved
			const retrieved = workspaceState.getTableState(tableUri);
			expect(retrieved).toEqual(state);

			vi.useRealTimers();
		});

		it("does nothing when no pending state", () => {
			expect(() => workspaceState.flush()).not.toThrow();
		});
	});

	describe("state persistence across instances", () => {
		it("persists state across WorkspaceState instances", () => {
			const romPath = "/path/to/rom.hex";
			const definitionUri = "file:///def.xml";

			// Save with first instance
			workspaceState.saveRomDefinition(romPath, definitionUri);

			// Create new instance with same memento
			const newInstance = new WorkspaceState(memento);

			// Should retrieve saved state
			expect(newInstance.getRomDefinition(romPath)).toBe(definitionUri);
		});

		it("persists table state across instances", async () => {
			vi.useFakeTimers();

			const tableUri = "ecu-explorer://table?file=test&table=t1";
			const state: TableEditorState = {
				romPath: "/path/to/rom.hex",
				tableId: "Fuel Map",
				definitionUri: "file:///def.xml",
			};

			workspaceState.saveTableState(tableUri, state);
			await vi.advanceTimersByTimeAsync(1000);

			// Create new instance with same memento
			const newInstance = new WorkspaceState(memento);

			// Should retrieve saved state
			expect(newInstance.getTableState(tableUri)).toEqual(state);

			vi.useRealTimers();
		});
	});

	describe("state sanitization", () => {
		it("sanitizes invalid ROM definitions", () => {
			// Manually corrupt the state
			storage.set("ecuExplorer.workspaceState", {
				romDefinitions: { valid: "file:///def.xml", invalid: 123 },
				lastOpenedTables: {},
				tableStates: {},
			});

			const newInstance = new WorkspaceState(memento);

			// Should only return valid entries
			const all = newInstance.getAllRomDefinitions();
			expect(all).toEqual({ valid: "file:///def.xml" });
		});

		it("sanitizes invalid table states", () => {
			// Manually corrupt the state
			storage.set("ecuExplorer.workspaceState", {
				romDefinitions: {},
				lastOpenedTables: {},
				tableStates: {
					valid: {
						romPath: "/rom.hex",
						tableId: "Fuel Map",
						definitionUri: "file:///def.xml",
					},
					invalid: {
						romPath: "/rom.hex",
						// Missing required fields
					},
				},
			});

			const newInstance = new WorkspaceState(memento);

			// Should only return valid entries
			const all = newInstance.getAllTableStates();
			expect(Object.keys(all)).toEqual(["valid"]);
		});

		it("handles null state gracefully", () => {
			storage.set("ecuExplorer.workspaceState", null);

			const newInstance = new WorkspaceState(memento);

			expect(newInstance.getAllRomDefinitions()).toEqual({});
			expect(newInstance.getAllTableStates()).toEqual({});
		});

		it("handles undefined state gracefully", () => {
			// Don't set any state
			const newInstance = new WorkspaceState(memento);

			expect(newInstance.getAllRomDefinitions()).toEqual({});
			expect(newInstance.getAllTableStates()).toEqual({});
		});

		it("validates scroll position in table state", () => {
			storage.set("ecuExplorer.workspaceState", {
				romDefinitions: {},
				lastOpenedTables: {},
				tableStates: {
					invalid: {
						romPath: "/rom.hex",
						tableId: "Fuel Map",
						definitionUri: "file:///def.xml",
						scrollPosition: { row: "invalid", col: 0 }, // Invalid type
					},
				},
			});

			const newInstance = new WorkspaceState(memento);

			// Should reject invalid state
			const all = newInstance.getAllTableStates();
			expect(all).toEqual({});
		});

		it("validates selection in table state", () => {
			storage.set("ecuExplorer.workspaceState", {
				romDefinitions: {},
				lastOpenedTables: {},
				tableStates: {
					invalid: {
						romPath: "/rom.hex",
						tableId: "Fuel Map",
						definitionUri: "file:///def.xml",
						selection: {
							startRow: 0,
							startCol: 0,
							endRow: "invalid", // Invalid type
							endCol: 5,
						},
					},
				},
			});

			const newInstance = new WorkspaceState(memento);

			// Should reject invalid state
			const all = newInstance.getAllTableStates();
			expect(all).toEqual({});
		});

		it("validates lastModified in table state", () => {
			storage.set("ecuExplorer.workspaceState", {
				romDefinitions: {},
				lastOpenedTables: {},
				tableStates: {
					invalid: {
						romPath: "/rom.hex",
						tableId: "Fuel Map",
						definitionUri: "file:///def.xml",
						lastModified: "invalid", // Invalid type
					},
				},
			});

			const newInstance = new WorkspaceState(memento);

			// Should reject invalid state
			const all = newInstance.getAllTableStates();
			expect(all).toEqual({});
		});
	});
});
