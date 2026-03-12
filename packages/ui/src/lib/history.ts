export interface Edit<TValue = Uint8Array> {
	address: number;
	before: TValue;
	after: TValue;
	label?: string;
	metadata?: Record<string, unknown>;
}

export interface EditTransaction<TEdit extends Edit = Edit> {
	label: string;
	edits: readonly TEdit[];
	timestamp: number;
}

export interface HistorySnapshot<
	TTransaction extends EditTransaction = EditTransaction,
> {
	past: readonly TTransaction[];
	future: readonly TTransaction[];
	canUndo: boolean;
	canRedo: boolean;
	undoCount: number;
	redoCount: number;
	atSavePoint: boolean;
	atInitialState: boolean;
}

export interface HistoryMoveResult<
	TTransaction extends EditTransaction = EditTransaction,
> {
	transaction: TTransaction;
	snapshot: HistorySnapshot<TTransaction>;
}

type HistoryNode<TTransaction extends EditTransaction> = {
	id: number;
	transaction: TTransaction;
};

export class HistoryStack<
	TTransaction extends EditTransaction = EditTransaction,
> {
	private past: HistoryNode<TTransaction>[] = [];
	private future: HistoryNode<TTransaction>[] = [];
	private nextId = 1;
	private savePointId = 0;

	constructor(private readonly capacity: number = Number.POSITIVE_INFINITY) {
		if (!Number.isInteger(capacity) && capacity !== Number.POSITIVE_INFINITY) {
			throw new TypeError("History capacity must be an integer or Infinity");
		}

		if (capacity < 1 && capacity !== Number.POSITIVE_INFINITY) {
			throw new RangeError("History capacity must be at least 1");
		}
	}

	record(transaction: TTransaction): HistorySnapshot<TTransaction> {
		this.past.push({
			id: this.nextId++,
			transaction,
		});
		this.future = [];

		if (this.past.length > this.capacity) {
			const removed = this.past.shift();
			if (removed && removed.id === this.savePointId) {
				this.savePointId = 0;
			}
		}

		return this.getSnapshot();
	}

	undo(): HistoryMoveResult<TTransaction> | null {
		const node = this.past.pop();
		if (!node) {
			return null;
		}

		this.future.push(node);
		return {
			transaction: node.transaction,
			snapshot: this.getSnapshot(),
		};
	}

	redo(): HistoryMoveResult<TTransaction> | null {
		const node = this.future.pop();
		if (!node) {
			return null;
		}

		this.past.push(node);
		return {
			transaction: node.transaction,
			snapshot: this.getSnapshot(),
		};
	}

	markSavePoint(): HistorySnapshot<TTransaction> {
		this.savePointId = this.currentStateId();
		return this.getSnapshot();
	}

	clear(): HistorySnapshot<TTransaction> {
		this.past = [];
		this.future = [];
		this.savePointId = 0;
		return this.getSnapshot();
	}

	getSnapshot(): HistorySnapshot<TTransaction> {
		const past = this.past.map((node) => node.transaction);
		const future = [...this.future].reverse().map((node) => node.transaction);

		return {
			past,
			future,
			canUndo: past.length > 0,
			canRedo: future.length > 0,
			undoCount: past.length,
			redoCount: future.length,
			atSavePoint: this.currentStateId() === this.savePointId,
			atInitialState: past.length === 0,
		};
	}

	private currentStateId(): number {
		return this.past.at(-1)?.id ?? 0;
	}
}
