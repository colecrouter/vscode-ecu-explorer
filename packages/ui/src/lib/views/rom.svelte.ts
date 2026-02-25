import type { ROMDefinition, TableDefinition } from "@ecu-explorer/core";
import { TableView } from "./table.svelte";

export class ROMView {
	protected bytes: Uint8Array;
	protected def: ROMDefinition;
	protected cache: Map<string, TableView<TableDefinition>>;

	constructor(bytes: Uint8Array, def: ROMDefinition) {
		this.bytes = bytes;
		this.def = def;
		this.cache = new Map();
	}

	table(name: string) {
		const cached = this.cache.get(name);
		if (cached) return cached;

		const tableDef = this.def.tables.find((t) => t.name === name);
		if (!tableDef) return undefined;

		const view = new TableView(this.bytes, tableDef);
		this.cache.set(name, view);

		return view;
	}
}
