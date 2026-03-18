import type { ROMDefinition, TableDefinition } from "@ecu-explorer/core";
import { snapshotTable } from "@ecu-explorer/core";
import { createSubscriber } from "svelte/reactivity";

export class ReactiveTableModel<T extends TableDefinition = TableDefinition> {
	#subscribe: () => void;

	constructor(
		private readonly rom: ROMView,
		public readonly definition: T,
	) {
		this.#subscribe = createSubscriber((update) =>
			this.rom.onDidUpdate((event) => {
				if (this.overlaps(event.offset, event.length)) {
					update();
				}
			}),
		);
	}

	get snapshot() {
		this.#subscribe();
		return snapshotTable(this.definition, this.rom.romBytes);
	}

	get bytes() {
		this.#subscribe();
		return this.rom.romBytes;
	}

	private overlaps(offset?: number, length?: number): boolean {
		if (offset === undefined || length === undefined) {
			return true;
		}

		const range = getTableByteRange(this.definition);
		const changeEnd = offset + length;
		return offset < range.end && changeEnd > range.start;
	}
}

type RomUpdateEvent = {
	bytes: Uint8Array;
	offset?: number;
	length?: number;
};

export class ROMView {
	protected bytes: Uint8Array;
	protected def: ROMDefinition;
	protected cache: Map<string, ReactiveTableModel<TableDefinition>>;
	#listeners = new Set<(event: RomUpdateEvent) => void>();
	#subscribe: () => void;

	constructor(bytes: Uint8Array, def: ROMDefinition) {
		this.bytes = bytes;
		this.def = def;
		this.cache = new Map();
		this.#subscribe = createSubscriber((update) =>
			this.onDidUpdate(() => {
				update();
			}),
		);
	}

	get romBytes() {
		this.#subscribe();
		return this.bytes;
	}

	get definition() {
		this.#subscribe();
		return this.def;
	}

	replaceBytes(bytes: Uint8Array, offset?: number, length?: number) {
		this.bytes = bytes;
		this.emit({
			bytes,
			...(offset !== undefined ? { offset } : {}),
			...(length !== undefined ? { length } : {}),
		});
	}

	patchBytes(offset: number, value: Uint8Array) {
		const next = new Uint8Array(this.bytes);
		next.set(value, offset);
		this.replaceBytes(next, offset, value.length);
	}

	setDefinition(definition: ROMDefinition) {
		this.def = definition;
		this.cache.clear();
		this.emit({ bytes: this.bytes });
	}

	table(nameOrId: string) {
		const cached = this.cache.get(nameOrId);
		if (cached) return cached;

		const tableDef =
			this.def.tables.find((t) => t.id === nameOrId) ??
			this.def.tables.find((t) => t.name === nameOrId);
		if (!tableDef) return undefined;

		const view = new ReactiveTableModel(this, tableDef);
		this.cache.set(nameOrId, view);
		if (tableDef.id !== nameOrId) {
			this.cache.set(tableDef.id, view);
		}
		if (tableDef.name !== nameOrId) {
			this.cache.set(tableDef.name, view);
		}

		return view;
	}

	onDidUpdate(listener: (event: RomUpdateEvent) => void): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	private emit(event: RomUpdateEvent) {
		for (const listener of this.#listeners) {
			listener(event);
		}
	}
}

function getTableByteRange(definition: TableDefinition): {
	start: number;
	end: number;
} {
	const start = definition.z.address ?? 0;
	const elementSize = getElementSize(definition.z.dtype);

	if (definition.z.indexer) {
		if (definition.kind === "table3d") {
			return { start, end: Number.POSITIVE_INFINITY };
		}

		let min = Number.POSITIVE_INFINITY;
		let max = Number.NEGATIVE_INFINITY;

		if (definition.kind === "table1d") {
			for (let row = 0; row < definition.rows; row++) {
				const address = start + definition.z.indexer(row, 0);
				min = Math.min(min, address);
				max = Math.max(max, address + elementSize);
			}
		} else {
			for (let row = 0; row < definition.rows; row++) {
				for (let col = 0; col < definition.cols; col++) {
					const address = start + definition.z.indexer(row, col);
					min = Math.min(min, address);
					max = Math.max(max, address + elementSize);
				}
			}
		}

		if (Number.isFinite(min) && Number.isFinite(max)) {
			return { start: min, end: max };
		}
	}

	const colStride = definition.z.colStrideBytes ?? elementSize;
	const rowStride =
		definition.kind === "table1d"
			? (definition.z.rowStrideBytes ?? elementSize)
			: (definition.z.rowStrideBytes ?? definition.cols * colStride);

	if (definition.kind === "table1d") {
		return {
			start,
			end: start + rowStride * Math.max(definition.rows - 1, 0) + elementSize,
		};
	}

	const depthStride = rowStride * definition.rows;
	if (definition.kind === "table2d") {
		return {
			start,
			end:
				start +
				rowStride * Math.max(definition.rows - 1, 0) +
				colStride * Math.max(definition.cols - 1, 0) +
				elementSize,
		};
	}

	return {
		start,
		end:
			start +
			depthStride * Math.max(definition.depth - 1, 0) +
			rowStride * Math.max(definition.rows - 1, 0) +
			colStride * Math.max(definition.cols - 1, 0) +
			elementSize,
	};
}

function getElementSize(dtype: TableDefinition["z"]["dtype"]) {
	switch (dtype) {
		case "u8":
		case "i8":
			return 1;
		case "u16":
		case "i16":
			return 2;
		case "u32":
		case "i32":
		case "f32":
			return 4;
		default:
			throw new Error(`Unknown dtype: ${String(dtype)}`);
	}
}
