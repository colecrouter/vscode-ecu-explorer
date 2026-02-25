export interface RangeEdit {
	address: number;
	before: Uint8Array;
	after: Uint8Array;
}

export interface Transaction {
	label: string;
	edits: RangeEdit[];
}
