import { vi } from "vitest";
import * as vscode from "vscode";

type Disposable = { dispose: () => void };

export type MockWorkspaceState = Pick<
	vscode.ExtensionContext["workspaceState"],
	"get" | "update" | "keys"
>;

export type TestExtensionContext = Pick<
	vscode.ExtensionContext,
	"subscriptions" | "extensionUri"
> &
	Partial<
		Pick<
			vscode.ExtensionContext,
			"workspaceState" | "globalStorageUri" | "extensionPath"
		>
	> & {
		extension?: {
			packageJSON: {
				version: string;
			};
		};
	};

export interface CapturingFileSystemWatcher
	extends Pick<
		vscode.FileSystemWatcher,
		| "onDidChange"
		| "onDidCreate"
		| "onDidDelete"
		| "dispose"
		| "ignoreCreateEvents"
		| "ignoreChangeEvents"
		| "ignoreDeleteEvents"
	> {
	fireChange: (uri: vscode.Uri) => void;
	fireCreate: (uri: vscode.Uri) => void;
}

export interface MockRomDocument {
	uri: vscode.Uri;
	romBytes: Uint8Array;
	definition: undefined;
	isDirty: boolean;
	updateBytes: ReturnType<
		typeof vi.fn<
			(
				newBytes: Uint8Array,
				address?: number,
				length?: number,
				markDirty?: boolean,
			) => void
		>
	>;
	makeDirty: ReturnType<typeof vi.fn>;
	makeClean: ReturnType<typeof vi.fn>;
	onDidChange: ReturnType<typeof vi.fn>;
	onDidUpdateBytes: ReturnType<typeof vi.fn>;
	onDidDispose: ReturnType<
		typeof vi.fn<(cb: () => void) => { dispose: () => void }>
	>;
	dispose: ReturnType<typeof vi.fn>;
	triggerDispose: () => void;
}

export function createMockWorkspaceState(): MockWorkspaceState {
	return {
		get: vi.fn(),
		update: vi.fn().mockResolvedValue(undefined),
		keys: vi.fn().mockReturnValue([]),
	};
}

export function createExtensionContext(
	overrides: Partial<TestExtensionContext> = {},
): TestExtensionContext {
	return {
		subscriptions: [],
		extensionUri: vscode.Uri.file("/test/extension"),
		workspaceState: createMockWorkspaceState(),
		...overrides,
	};
}

export function createMockFileSystemWatcher(): Pick<
	vscode.FileSystemWatcher,
	| "onDidChange"
	| "onDidCreate"
	| "onDidDelete"
	| "dispose"
	| "ignoreCreateEvents"
	| "ignoreChangeEvents"
	| "ignoreDeleteEvents"
> {
	return {
		onDidChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		onDidCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		dispose: vi.fn(),
		ignoreCreateEvents: false,
		ignoreChangeEvents: false,
		ignoreDeleteEvents: false,
	};
}

export function createCapturingFileSystemWatcher(): CapturingFileSystemWatcher {
	let changeListener: ((uri: vscode.Uri) => void) | null = null;
	let createListener: ((uri: vscode.Uri) => void) | null = null;

	const watcher: CapturingFileSystemWatcher = {
		onDidChange(cb: (uri: vscode.Uri) => void): Disposable {
			changeListener = cb;
			return { dispose: vi.fn() };
		},
		onDidCreate(cb: (uri: vscode.Uri) => void): Disposable {
			createListener = cb;
			return { dispose: vi.fn() };
		},
		onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		dispose: vi.fn(),
		ignoreCreateEvents: false,
		ignoreChangeEvents: false,
		ignoreDeleteEvents: true,
		fireChange(uri: vscode.Uri) {
			changeListener?.(uri);
		},
		fireCreate(uri: vscode.Uri) {
			createListener?.(uri);
		},
	};

	vi.spyOn(watcher, "onDidChange");
	vi.spyOn(watcher, "onDidCreate");

	return watcher;
}

export function createMockRomDocument(
	uri: vscode.Uri,
	romBytes: Uint8Array,
): MockRomDocument {
	let disposeListener: (() => void) | null = null;

	return {
		uri,
		romBytes,
		definition: undefined,
		isDirty: false,
		updateBytes: vi.fn(
			(
				_newBytes: Uint8Array,
				_address?: number,
				_length?: number,
				_markDirty?: boolean,
			) => {},
		),
		makeDirty: vi.fn(),
		makeClean: vi.fn(),
		onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
		onDidUpdateBytes: vi.fn(() => ({ dispose: vi.fn() })),
		onDidDispose: vi.fn((cb: () => void) => {
			disposeListener = cb;
			return { dispose: vi.fn() };
		}),
		dispose: vi.fn(() => {
			disposeListener?.();
		}),
		triggerDispose() {
			disposeListener?.();
		},
	};
}
