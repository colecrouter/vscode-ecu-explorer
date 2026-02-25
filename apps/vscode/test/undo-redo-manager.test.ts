import { beforeEach, describe, expect, it } from "vitest";
import {
	type BatchEditOperation,
	type EditOperation,
	isBatchEdit,
	type StackEntry,
	UndoRedoManager,
} from "../src/undo-redo-manager";

/**
 * Helper to build a minimal EditOperation for testing.
 */
function makeOp(
	row: number,
	col: number,
	oldByte: number,
	newByte: number,
	address?: number,
): EditOperation {
	const op: EditOperation = {
		row,
		col,
		oldValue: new Uint8Array([oldByte]),
		newValue: new Uint8Array([newByte]),
		timestamp: Date.now(),
	};
	if (address !== undefined) op.address = address;
	return op;
}

describe("UndoRedoManager", () => {
	let manager: UndoRedoManager;

	beforeEach(() => {
		manager = new UndoRedoManager();
	});

	// -------------------------------------------------------------------------
	// Basic push / pop (undo)
	// -------------------------------------------------------------------------
	describe("basic push / undo", () => {
		it("push() adds to undo stack and canUndo() becomes true", () => {
			expect(manager.canUndo()).toBe(false);
			manager.push(makeOp(0, 0, 0x10, 0x20));
			expect(manager.canUndo()).toBe(true);
		});

		it("undo() returns the pushed item", () => {
			const op = makeOp(0, 0, 0x10, 0x20);
			manager.push(op);
			const result = manager.undo();
			expect(result).toEqual(op);
		});

		it("undo() removes the item from the undo stack", () => {
			manager.push(makeOp(0, 0, 0x10, 0x20));
			manager.undo();
			expect(manager.canUndo()).toBe(false);
		});

		it("undo() on an empty stack returns null", () => {
			expect(manager.undo()).toBeNull();
		});

		it("multiple push()es stack in LIFO order", () => {
			const op1 = makeOp(0, 0, 0x10, 0x20);
			const op2 = makeOp(0, 1, 0x30, 0x40);
			manager.push(op1);
			manager.push(op2);

			expect(manager.undo()).toEqual(op2);
			expect(manager.undo()).toEqual(op1);
			expect(manager.undo()).toBeNull();
		});
	});

	// -------------------------------------------------------------------------
	// Redo stack behaviour
	// -------------------------------------------------------------------------
	describe("redo stack behaviour", () => {
		it("canRedo() is false initially", () => {
			expect(manager.canRedo()).toBe(false);
		});

		it("canRedo() is true after undo()", () => {
			manager.push(makeOp(0, 0, 0x10, 0x20));
			manager.undo();
			expect(manager.canRedo()).toBe(true);
		});

		it("redo() returns the previously undone item", () => {
			const op = makeOp(0, 0, 0x10, 0x20);
			manager.push(op);
			manager.undo();
			const redone = manager.redo();
			expect(redone).toEqual(op);
		});

		it("redo() on an empty redo stack returns null", () => {
			expect(manager.redo()).toBeNull();
		});

		it("after redo(), canRedo() is false and canUndo() is true again", () => {
			manager.push(makeOp(0, 0, 0x10, 0x20));
			manager.undo();
			manager.redo();
			expect(manager.canRedo()).toBe(false);
			expect(manager.canUndo()).toBe(true);
		});

		it("push() after undo() clears the redo stack (new edit invalidates future redo)", () => {
			manager.push(makeOp(0, 0, 0x10, 0x20));
			manager.undo();
			expect(manager.canRedo()).toBe(true);

			// New edit
			manager.push(makeOp(0, 0, 0x10, 0x99));
			expect(manager.canRedo()).toBe(false);
		});
	});

	// -------------------------------------------------------------------------
	// isAtInitialState
	// -------------------------------------------------------------------------
	describe("isAtInitialState()", () => {
		it("is true on a freshly created manager", () => {
			expect(manager.isAtInitialState()).toBe(true);
		});

		it("is false after push()", () => {
			manager.push(makeOp(0, 0, 0x10, 0x20));
			expect(manager.isAtInitialState()).toBe(false);
		});

		it("is true after pushing and then undoing back to empty", () => {
			manager.push(makeOp(0, 0, 0x10, 0x20));
			manager.undo();
			expect(manager.isAtInitialState()).toBe(true);
		});

		it("is false when undo stack is non-empty even if redo stack is also non-empty", () => {
			manager.push(makeOp(0, 0, 0x10, 0x20));
			manager.push(makeOp(0, 1, 0x30, 0x40));
			manager.undo(); // one item on redo, one on undo
			expect(manager.isAtInitialState()).toBe(false);
		});
	});

	// -------------------------------------------------------------------------
	// pushBatch
	// -------------------------------------------------------------------------
	describe("pushBatch()", () => {
		it("creates exactly one entry on the undo stack, not N entries", () => {
			const ops = [
				makeOp(0, 0, 0x10, 0x20, 0),
				makeOp(0, 1, 0x30, 0x40, 1),
				makeOp(0, 2, 0x50, 0x60, 2),
			];
			manager.pushBatch(ops, "batch label");

			expect(manager.canUndo()).toBe(true);
			// Only one undo step should exist: undoing once returns null
			manager.undo();
			expect(manager.canUndo()).toBe(false);
		});

		it("undo() of a batch returns a BatchEditOperation containing all ops", () => {
			const ops = [makeOp(0, 0, 0x10, 0x20, 0), makeOp(0, 1, 0x30, 0x40, 1)];
			manager.pushBatch(ops, "my batch");

			const entry = manager.undo();
			expect(entry).not.toBeNull();
			expect(isBatchEdit(entry!)).toBe(true);

			const batch = entry as BatchEditOperation;
			expect(batch.ops).toHaveLength(2);
			expect(batch.label).toBe("my batch");
			expect(batch.ops[0]).toEqual(ops[0]);
			expect(batch.ops[1]).toEqual(ops[1]);
		});

		it("pushBatch() with empty ops array does NOT push anything", () => {
			manager.pushBatch([], "empty batch");
			expect(manager.canUndo()).toBe(false);
			expect(manager.isAtInitialState()).toBe(true);
		});

		it("pushBatch() clears the redo stack exactly once (not N times)", () => {
			// Populate the redo stack with one item
			manager.push(makeOp(0, 0, 0x10, 0x20));
			manager.undo();
			expect(manager.canRedo()).toBe(true);

			// Now push a 3-op batch — redo stack should be cleared (just once)
			const ops = [
				makeOp(0, 0, 0x10, 0x20, 0),
				makeOp(0, 1, 0x30, 0x40, 1),
				makeOp(0, 2, 0x50, 0x60, 2),
			];
			manager.pushBatch(ops, "new batch");

			expect(manager.canRedo()).toBe(false);
		});

		it("after undoing a batch, popRedo (redo()) returns the same batch", () => {
			const ops = [makeOp(0, 0, 0x10, 0x20, 0), makeOp(0, 1, 0x30, 0x40, 1)];
			manager.pushBatch(ops, "batch");

			const undone = manager.undo();
			expect(isBatchEdit(undone!)).toBe(true);

			const redone = manager.redo() as BatchEditOperation;
			expect(isBatchEdit(redone)).toBe(true);
			expect(redone.ops).toHaveLength(2);
			expect(redone.label).toBe("batch");
		});
	});

	// -------------------------------------------------------------------------
	// isBatchEdit type guard
	// -------------------------------------------------------------------------
	describe("isBatchEdit()", () => {
		it("returns false for a plain EditOperation", () => {
			const op = makeOp(0, 0, 0x10, 0x20);
			expect(isBatchEdit(op)).toBe(false);
		});

		it("returns true for a BatchEditOperation", () => {
			const batch: BatchEditOperation = {
				ops: [makeOp(0, 0, 0x10, 0x20)],
				timestamp: Date.now(),
				label: "test",
			};
			expect(isBatchEdit(batch)).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// clear()
	// -------------------------------------------------------------------------
	describe("clear()", () => {
		it("after clear(), isAtInitialState() returns true", () => {
			manager.push(makeOp(0, 0, 0x10, 0x20));
			manager.push(makeOp(0, 1, 0x30, 0x40));
			manager.clear();
			expect(manager.isAtInitialState()).toBe(true);
		});

		it("after clear(), canUndo() returns false", () => {
			manager.push(makeOp(0, 0, 0x10, 0x20));
			manager.clear();
			expect(manager.canUndo()).toBe(false);
		});

		it("after clear(), canRedo() returns false", () => {
			manager.push(makeOp(0, 0, 0x10, 0x20));
			manager.undo(); // move to redo stack
			manager.clear();
			expect(manager.canRedo()).toBe(false);
		});

		it("after clear(), undo() returns null", () => {
			manager.push(makeOp(0, 0, 0x10, 0x20));
			manager.clear();
			expect(manager.undo()).toBeNull();
		});

		it("after clear(), redo() returns null", () => {
			manager.push(makeOp(0, 0, 0x10, 0x20));
			manager.undo();
			manager.clear();
			expect(manager.redo()).toBeNull();
		});

		it("clears both stacks independently of how they were populated", () => {
			// Fill undo stack
			manager.push(makeOp(0, 0, 0x10, 0x20));
			manager.pushBatch(
				[makeOp(0, 1, 0x30, 0x40, 1), makeOp(0, 2, 0x50, 0x60, 2)],
				"batch",
			);
			// Partially undo to also populate redo stack
			manager.undo(); // batch → redo
			// Both stacks are non-empty now
			expect(manager.canUndo()).toBe(true);
			expect(manager.canRedo()).toBe(true);

			manager.clear();

			expect(manager.canUndo()).toBe(false);
			expect(manager.canRedo()).toBe(false);
			expect(manager.isAtInitialState()).toBe(true);
		});
	});

	// -------------------------------------------------------------------------
	// StackEntry type narrowing (ensure single edit is NOT a batch)
	// -------------------------------------------------------------------------
	describe("StackEntry narrowing after undo", () => {
		it("undo() of a plain push() is NOT a batch", () => {
			const op = makeOp(1, 2, 0xaa, 0xbb, 0x200);
			manager.push(op);
			const entry = manager.undo() as StackEntry;
			expect(isBatchEdit(entry)).toBe(false);
		});

		it("undo() of pushBatch() IS a batch", () => {
			manager.pushBatch([makeOp(0, 0, 0x10, 0x20, 0)], "single-op batch");
			const entry = manager.undo() as StackEntry;
			expect(isBatchEdit(entry)).toBe(true);
		});
	});
});
