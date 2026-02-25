/**
 * Mock webview API for testing
 */

import { vi } from "vitest";

export function createMockWebview() {
	const messageListeners: Array<(message: unknown) => void> = [];
	const sentMessages: Array<unknown> = [];

	const postMessage = vi.fn(async (message: unknown) => {
		sentMessages.push(message);
		return true;
	});

	return {
		html: "",
		cspSource: "vscode-webview://12345",
		asWebviewUri: (uri: unknown) => uri,
		postMessage,
		onDidReceiveMessage: (callback: (message: unknown) => void) => {
			messageListeners.push(callback);
			return { dispose: () => {} };
		},
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

export function createMockWebviewPanel(title: string = "Test Panel") {
	const webview = createMockWebview();
	const disposeListeners: Array<() => void> = [];

	const panel = {
		viewType: "test-view",
		title,
		iconPath: undefined,
		webview,
		viewColumn: 1,
		active: true,
		visible: true,
		onDidDispose: (callback: () => void) => {
			disposeListeners.push(callback);
			return { dispose: () => {} };
		},
		onDidChangeViewState: (_callback: () => void) => ({ dispose: () => {} }),
		reveal: vi.fn(async (_viewColumn?: number, _preserveFocus?: boolean) => {}),
		dispose: vi.fn(() => {
			for (const listener of disposeListeners) {
				listener();
			}
		}),
	};

	return panel;
}

/**
 * Create a mock panel with viewType and title (for compatibility)
 */
export function createMockPanel(viewType: string, title: string) {
	const webview = createMockWebview();
	const disposeListeners: Array<() => void> = [];

	const panel = {
		viewType,
		title,
		iconPath: undefined,
		webview,
		viewColumn: 1,
		active: true,
		visible: true,
		onDidDispose: (callback: () => void) => {
			disposeListeners.push(callback);
			return { dispose: () => {} };
		},
		onDidChangeViewState: (_callback: () => void) => ({ dispose: () => {} }),
		reveal: vi.fn(async (_viewColumn?: number, _preserveFocus?: boolean) => {}),
		dispose: vi.fn(() => {
			for (const listener of disposeListeners) {
				listener();
			}
		}),
	};

	return panel;
}
