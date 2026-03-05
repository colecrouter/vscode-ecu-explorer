/**
 * Mock webview API for testing
 */

import { vi } from "vitest";
import type * as vscode from "vscode";

interface MockWebviewMessage {
	type: string;
	[payload: string]: unknown;
}

interface MockWebview {
	html: string;
	cspSource: string;
	options: vscode.WebviewOptions;
	asWebviewUri: (uri: vscode.Uri) => vscode.Uri;
	postMessage: ReturnType<typeof vi.fn<(message: unknown) => Promise<boolean>>>;
	onDidReceiveMessage: (callback: (message: unknown) => void) => {
		dispose: () => void;
	};
	_simulateMessage: (message: unknown) => void;
	_clearMessages: () => void;
	_getSentMessages: () => MockWebviewMessage[];
	_getMessages: () => MockWebviewMessage[];
}

interface MockWebviewPanel {
	viewType: string;
	title: string;
	iconPath: undefined;
	webview: MockWebview;
	viewColumn: vscode.ViewColumn;
	active: boolean;
	visible: boolean;
	onDidDispose: (callback: () => void) => { dispose: () => void };
	onDidChangeViewState: (callback: () => void) => { dispose: () => void };
	reveal: ReturnType<typeof vi.fn>;
	dispose: () => void;
}

export interface MockGraphWebview
	extends Pick<
		vscode.Webview,
		| "html"
		| "cspSource"
		| "options"
		| "asWebviewUri"
		| "postMessage"
		| "onDidReceiveMessage"
	> {
	_clearMessages: () => void;
	_getMessages: () => MockWebviewMessage[];
	_getSentMessages: () => MockWebviewMessage[];
	_simulateMessage: (message: unknown) => void;
}

export type GraphCompatibleWebview = vscode.Webview & MockGraphWebview;

type MockWebviewEvent<T> = (
	listener: (event: T) => unknown,
	thisArgs?: unknown,
	disposables?: { dispose(): unknown }[],
) => vscode.Disposable;

export interface GraphCompatibleWebviewPanel
	extends Pick<
		vscode.WebviewPanel,
		| "active"
		| "dispose"
		| "options"
		| "onDidChangeViewState"
		| "onDidDispose"
		| "reveal"
		| "title"
		| "viewColumn"
		| "viewType"
		| "visible"
	> {
	webview: MockGraphWebview;
	iconPath: vscode.WebviewPanel["iconPath"] | undefined;
}

export type { MockWebview, MockWebviewPanel, MockWebviewMessage };

export function createMockWebview(): MockWebview {
	const messageListeners: Array<(message: unknown) => void> = [];
	const sentMessages: MockWebviewMessage[] = [];
	const postMessage = vi.fn<(message: unknown) => Promise<boolean>>(
		async (message: unknown) => {
			sentMessages.push(message as MockWebviewMessage);
			return true;
		},
	);

	const onDidReceiveMessage: MockWebviewEvent<unknown> = (listener) => {
		messageListeners.push(listener);
		return { dispose: () => {} };
	};

	return {
		html: "",
		cspSource: "vscode-webview://12345",
		options: {},
		asWebviewUri: (uri: vscode.Uri) => uri,
		postMessage,
		onDidReceiveMessage,
		// Helper to simulate receiving messages
		_simulateMessage: (message: unknown) => {
			for (const listener of messageListeners) {
				listener(message);
			}
		},
		// Helper to clear sent messages
		_clearMessages: () => {
			sentMessages.length = 0;
			postMessage.mockClear();
		},
		// Helper to get sent messages
		_getSentMessages: () => sentMessages,
		// Alias for compatibility
		_getMessages: () => sentMessages,
	};
}

export function createMockWebviewPanel(
	title: string = "Test Panel",
): GraphCompatibleWebviewPanel {
	const webview = createMockWebview();
	const disposeListeners: Array<() => void> = [];
	const disposeEvent: MockWebviewEvent<void> = (listener) => {
		disposeListeners.push(listener);
		return { dispose: () => {} };
	};
	const viewStateEvent: MockWebviewEvent<
		vscode.WebviewPanelOnDidChangeViewStateEvent
	> = (_listener) => ({ dispose: () => {} });
	const reveal: GraphCompatibleWebviewPanel["reveal"] = vi.fn(
		async (_viewColumn?: vscode.ViewColumn, _preserveFocus?: boolean) => {},
	);
	const dispose = vi.fn(() => {
		for (const listener of disposeListeners) {
			listener();
		}
	});

	const panel: GraphCompatibleWebviewPanel = {
		viewType: "test-view",
		title,
		iconPath: undefined,
		webview,
		options: {},
		viewColumn: 1 as vscode.ViewColumn,
		active: true,
		visible: true,
		onDidDispose: disposeEvent,
		onDidChangeViewState: viewStateEvent,
		reveal,
		dispose,
	};

	return panel;
}

/**
 * Create a mock panel with viewType and title (for compatibility)
 */
export function createMockPanel(
	viewType: string,
	title: string,
): GraphCompatibleWebviewPanel {
	const webview = createMockWebview();
	const disposeListeners: Array<() => void> = [];
	const disposeEvent: MockWebviewEvent<void> = (listener) => {
		disposeListeners.push(listener);
		return { dispose: () => {} };
	};
	const viewStateEvent: MockWebviewEvent<
		vscode.WebviewPanelOnDidChangeViewStateEvent
	> = (_listener) => ({ dispose: () => {} });
	const reveal: GraphCompatibleWebviewPanel["reveal"] = vi.fn(
		async (_viewColumn?: vscode.ViewColumn, _preserveFocus?: boolean) => {},
	);
	const dispose = vi.fn(() => {
		for (const listener of disposeListeners) {
			listener();
		}
	});

	const panel: GraphCompatibleWebviewPanel = {
		viewType,
		title,
		iconPath: undefined,
		webview,
		options: {},
		viewColumn: 1 as vscode.ViewColumn,
		active: true,
		visible: true,
		onDidDispose: disposeEvent,
		onDidChangeViewState: viewStateEvent,
		reveal,
		dispose,
	};

	return panel;
}
