import { describe, expect, it } from "vitest";
import {
	type Edit,
	type EditTransaction,
	HistoryStack,
} from "../src/lib/history.js";

type TestEdit = Edit<Uint8Array> & {
	cell: { row: number; col: number };
};

function makeTransaction(
	label: string,
	address: number,
	beforeByte: number,
	afterByte: number,
): EditTransaction<TestEdit> {
	return {
		label,
		timestamp: Date.now(),
		edits: [
			{
				address,
				before: new Uint8Array([beforeByte]),
				after: new Uint8Array([afterByte]),
				cell: { row: 0, col: address },
			},
		],
	};
}

describe("HistoryStack", () => {
	it("records transactions and exposes undo state", () => {
		const history = new HistoryStack<EditTransaction<TestEdit>>();

		const snapshot = history.record(makeTransaction("edit 1", 0, 0x10, 0x20));

		expect(snapshot.canUndo).toBe(true);
		expect(snapshot.canRedo).toBe(false);
		expect(snapshot.undoCount).toBe(1);
		expect(snapshot.atInitialState).toBe(false);
	});

	it("undoes in LIFO order", () => {
		const history = new HistoryStack<EditTransaction<TestEdit>>();
		const first = makeTransaction("edit 1", 0, 0x10, 0x20);
		const second = makeTransaction("edit 2", 1, 0x30, 0x40);

		history.record(first);
		history.record(second);

		const undone = history.undo();

		expect(undone?.transaction).toBe(second);
		expect(undone?.snapshot.canRedo).toBe(true);
		expect(undone?.snapshot.undoCount).toBe(1);
	});

	it("redos the last undone transaction", () => {
		const history = new HistoryStack<EditTransaction<TestEdit>>();
		const transaction = makeTransaction("edit 1", 0, 0x10, 0x20);

		history.record(transaction);
		history.undo();
		const redone = history.redo();

		expect(redone?.transaction).toBe(transaction);
		expect(redone?.snapshot.canUndo).toBe(true);
		expect(redone?.snapshot.canRedo).toBe(false);
	});

	it("clears redo history when a new transaction is recorded after undo", () => {
		const history = new HistoryStack<EditTransaction<TestEdit>>();

		history.record(makeTransaction("edit 1", 0, 0x10, 0x20));
		history.record(makeTransaction("edit 2", 1, 0x30, 0x40));
		history.undo();

		const snapshot = history.record(makeTransaction("edit 3", 2, 0x50, 0x60));

		expect(snapshot.canRedo).toBe(false);
		expect(snapshot.redoCount).toBe(0);
	});

	it("tracks save points across undo and redo", () => {
		const history = new HistoryStack<EditTransaction<TestEdit>>();

		history.record(makeTransaction("edit 1", 0, 0x10, 0x20));
		history.markSavePoint();
		history.record(makeTransaction("edit 2", 1, 0x30, 0x40));

		expect(history.getSnapshot().atSavePoint).toBe(false);

		const undone = history.undo();

		expect(undone?.snapshot.atSavePoint).toBe(true);

		const redone = history.redo();

		expect(redone?.snapshot.atSavePoint).toBe(false);
	});

	it("does not confuse branched history with the save point", () => {
		const history = new HistoryStack<EditTransaction<TestEdit>>();

		history.record(makeTransaction("edit 1", 0, 0x10, 0x20));
		history.record(makeTransaction("edit 2", 1, 0x30, 0x40));
		history.markSavePoint();
		history.undo();

		const snapshot = history.record(makeTransaction("edit 3", 2, 0x50, 0x60));

		expect(snapshot.atSavePoint).toBe(false);
	});

	it("evicts the oldest transaction when capacity is exceeded", () => {
		const history = new HistoryStack<EditTransaction<TestEdit>>(2);
		const first = makeTransaction("edit 1", 0, 0x10, 0x20);
		const second = makeTransaction("edit 2", 1, 0x30, 0x40);
		const third = makeTransaction("edit 3", 2, 0x50, 0x60);

		history.record(first);
		history.record(second);
		const snapshot = history.record(third);

		expect(snapshot.undoCount).toBe(2);
		expect(snapshot.past).toEqual([second, third]);
	});

	it("resets to the initial state on clear", () => {
		const history = new HistoryStack<EditTransaction<TestEdit>>();

		history.record(makeTransaction("edit 1", 0, 0x10, 0x20));
		history.undo();
		const snapshot = history.clear();

		expect(snapshot.canUndo).toBe(false);
		expect(snapshot.canRedo).toBe(false);
		expect(snapshot.atInitialState).toBe(true);
		expect(snapshot.atSavePoint).toBe(true);
	});
});
