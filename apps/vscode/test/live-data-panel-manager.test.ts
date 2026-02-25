/**
 * Unit tests for LiveDataPanelManager
 *
 * Tests panel creation, lifecycle, PID selection, data streaming, and CSV recording.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { LiveDataPanelManager } from "../src/live-data-panel-manager";
import { createMockWebviewPanel } from "./mocks/webview-mock";

// Mock the DeviceManagerImpl
const mockSelectDeviceAndProtocol = vi.fn();
const mockDeviceManager = {
	selectDeviceAndProtocol: mockSelectDeviceAndProtocol,
	registerTransport: vi.fn(),
	registerProtocol: vi.fn(),
	listAllDevices: vi.fn(async () => []),
	getTransport: vi.fn(),
	getProtocols: vi.fn(() => []),
	dispose: vi.fn(),
};

describe("LiveDataPanelManager", () => {
	let manager: LiveDataPanelManager;
	let mockContext: any;
	let mockPanel: ReturnType<typeof createMockWebviewPanel>;

	beforeEach(() => {
		vi.clearAllMocks();

		mockPanel = createMockWebviewPanel("Live Data");

		vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(
			mockPanel as any,
		);

		// Mock writeFile to prevent actual filesystem access
		vi.mocked(vscode.workspace.fs.writeFile).mockResolvedValue(undefined);

		mockContext = {
			subscriptions: [],
			extensionUri: vscode.Uri.file("/test/extension"),
		};

		manager = new LiveDataPanelManager(mockContext, mockDeviceManager as any);
	});

	describe("showPanel", () => {
		it("should create a new webview panel", async () => {
			await manager.showPanel();

			expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
				"ecuExplorerLiveData",
				"Live Data",
				vscode.ViewColumn.One,
				expect.objectContaining({
					enableScripts: true,
					retainContextWhenHidden: true,
				}),
			);
		});

		it("should set HTML content on the panel", async () => {
			await manager.showPanel();

			expect(mockPanel.webview.html).toContain("<!DOCTYPE html>");
			expect(mockPanel.webview.html).toContain("live-data.js");
		});

		it("should reveal existing panel if already open", async () => {
			await manager.showPanel();
			await manager.showPanel();

			// Should only create one panel
			expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
			expect(mockPanel.reveal).toHaveBeenCalledTimes(1);
		});
	});

	describe("message handling", () => {
		it("should handle ready message and call selectDeviceAndProtocol", async () => {
			const mockConnection = {
				deviceInfo: {
					id: "test",
					name: "Test",
					transportName: "test",
					connected: true,
				},
				sendFrame: vi.fn(),
				startStream: vi.fn(),
				stopStream: vi.fn(),
				close: vi.fn(async () => {}),
			};
			const mockProtocol = {
				name: "Test Protocol",
				canHandle: vi.fn(async () => true),
				getSupportedPids: vi.fn(async () => [
					{
						pid: 0x0c,
						name: "Engine RPM",
						unit: "rpm",
						minValue: 0,
						maxValue: 16383,
					},
				]),
			};

			mockSelectDeviceAndProtocol.mockResolvedValue({
				connection: mockConnection,
				protocol: mockProtocol,
			});

			await manager.showPanel();

			// Simulate ready message from webview
			(mockPanel.webview as any)._simulateMessage({ type: "ready" });

			// Wait for async operations
			await new Promise((resolve) => setTimeout(resolve, 50));

			expect(mockSelectDeviceAndProtocol).toHaveBeenCalled();
		});

		it("should send supportedPids message when protocol has getSupportedPids", async () => {
			const mockPids = [
				{
					pid: 0x0c,
					name: "Engine RPM",
					unit: "rpm",
					minValue: 0,
					maxValue: 16383,
				},
				{
					pid: 0x0d,
					name: "Vehicle Speed",
					unit: "km/h",
					minValue: 0,
					maxValue: 255,
				},
			];
			const mockConnection = {
				deviceInfo: {
					id: "test",
					name: "Test",
					transportName: "test",
					connected: true,
				},
				sendFrame: vi.fn(),
				startStream: vi.fn(),
				stopStream: vi.fn(),
				close: vi.fn(async () => {}),
			};
			const mockProtocol = {
				name: "Test Protocol",
				canHandle: vi.fn(async () => true),
				getSupportedPids: vi.fn(async () => mockPids),
			};

			mockSelectDeviceAndProtocol.mockResolvedValue({
				connection: mockConnection,
				protocol: mockProtocol,
			});

			await manager.showPanel();
			(mockPanel.webview as any)._simulateMessage({ type: "ready" });

			await new Promise((resolve) => setTimeout(resolve, 50));

			const messages = (mockPanel.webview as any)._getSentMessages();
			const supportedPidsMsg = messages.find(
				(m: any) => m.type === "supportedPids",
			);
			expect(supportedPidsMsg).toBeDefined();
			expect(supportedPidsMsg?.pids).toEqual(mockPids);
		});

		it("should show error message when selectDeviceAndProtocol fails", async () => {
			mockSelectDeviceAndProtocol.mockRejectedValue(
				new Error("No device found"),
			);

			await manager.showPanel();
			(mockPanel.webview as any)._simulateMessage({ type: "ready" });

			await new Promise((resolve) => setTimeout(resolve, 50));

			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				expect.stringContaining("No device found"),
			);
		});

		it("should start streaming when startStreaming message is received", async () => {
			const mockSession = { stop: vi.fn() };
			const mockConnection = {
				deviceInfo: {
					id: "test",
					name: "Test",
					transportName: "test",
					connected: true,
				},
				sendFrame: vi.fn(),
				startStream: vi.fn(),
				stopStream: vi.fn(),
				close: vi.fn(async () => {}),
			};
			const mockProtocol = {
				name: "Test Protocol",
				canHandle: vi.fn(async () => true),
				getSupportedPids: vi.fn(async () => []),
				streamLiveData: vi.fn(() => mockSession),
			};

			mockSelectDeviceAndProtocol.mockResolvedValue({
				connection: mockConnection,
				protocol: mockProtocol,
			});

			await manager.showPanel();
			(mockPanel.webview as any)._simulateMessage({ type: "ready" });
			await new Promise((resolve) => setTimeout(resolve, 50));

			(mockPanel.webview as any)._simulateMessage({
				type: "startStreaming",
				pids: [0x0c, 0x0d],
				record: false,
			});

			await new Promise((resolve) => setTimeout(resolve, 50));

			expect(mockProtocol.streamLiveData).toHaveBeenCalledWith(
				mockConnection,
				[0x0c, 0x0d],
				expect.any(Function),
				expect.any(Function),
			);

			const messages = (mockPanel.webview as any)._getSentMessages();
			const streamingStartedMsg = messages.find(
				(m: any) => m.type === "streamingStarted",
			);
			expect(streamingStartedMsg).toBeDefined();
		});

		it("should stop streaming when stopStreaming message is received", async () => {
			const mockSession = { stop: vi.fn() };
			const mockConnection = {
				deviceInfo: {
					id: "test",
					name: "Test",
					transportName: "test",
					connected: true,
				},
				sendFrame: vi.fn(),
				startStream: vi.fn(),
				stopStream: vi.fn(),
				close: vi.fn(async () => {}),
			};
			const mockProtocol = {
				name: "Test Protocol",
				canHandle: vi.fn(async () => true),
				getSupportedPids: vi.fn(async () => []),
				streamLiveData: vi.fn(() => mockSession),
			};

			mockSelectDeviceAndProtocol.mockResolvedValue({
				connection: mockConnection,
				protocol: mockProtocol,
			});

			await manager.showPanel();
			(mockPanel.webview as any)._simulateMessage({ type: "ready" });
			await new Promise((resolve) => setTimeout(resolve, 50));

			(mockPanel.webview as any)._simulateMessage({
				type: "startStreaming",
				pids: [0x0c],
				record: false,
			});
			await new Promise((resolve) => setTimeout(resolve, 50));

			(mockPanel.webview as any)._simulateMessage({ type: "stopStreaming" });
			await new Promise((resolve) => setTimeout(resolve, 50));

			expect(mockSession.stop).toHaveBeenCalled();

			const messages = (mockPanel.webview as any)._getSentMessages();
			const streamingStoppedMsg = messages.find(
				(m: any) => m.type === "streamingStopped",
			);
			expect(streamingStoppedMsg).toBeDefined();
		});
	});

	describe("CSV recording (deprecated — record field is now ignored)", () => {
		it("should NOT write CSV file when record:true is sent (record field is deprecated)", async () => {
			const mockSession = { stop: vi.fn() };
			const mockConnection = {
				deviceInfo: {
					id: "test",
					name: "Test",
					transportName: "test",
					connected: true,
				},
				sendFrame: vi.fn(),
				startStream: vi.fn(),
				stopStream: vi.fn(),
				close: vi.fn(async () => {}),
			};

			let capturedOnFrame: ((frame: any) => void) | undefined;
			const mockProtocol = {
				name: "Test Protocol",
				canHandle: vi.fn(async () => true),
				getSupportedPids: vi.fn(async () => []),
				streamLiveData: vi.fn((_conn: any, _pids: any, onFrame: any) => {
					capturedOnFrame = onFrame;
					return mockSession;
				}),
			};

			mockSelectDeviceAndProtocol.mockResolvedValue({
				connection: mockConnection,
				protocol: mockProtocol,
			});

			// Mock workspace folders
			vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue([
				{ uri: vscode.Uri.file("/workspace"), name: "workspace", index: 0 },
			] as any);

			await manager.showPanel();
			(mockPanel.webview as any)._simulateMessage({ type: "ready" });
			await new Promise((resolve) => setTimeout(resolve, 50));

			(mockPanel.webview as any)._simulateMessage({
				type: "startStreaming",
				pids: [0x0c],
				record: true, // deprecated — should be ignored
			});
			await new Promise((resolve) => setTimeout(resolve, 50));

			// Simulate receiving a frame
			capturedOnFrame?.({
				timestamp: 100,
				pid: 0x0c,
				value: 1000,
				unit: "rpm",
			});

			(mockPanel.webview as any)._simulateMessage({ type: "stopStreaming" });
			await new Promise((resolve) => setTimeout(resolve, 50));

			// CSV should NOT be written by the panel — logging is now handled by LoggingManager
			expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
		});

		it("should still stream data even without a workspace folder (record field is ignored)", async () => {
			const mockSession = { stop: vi.fn() };
			const mockConnection = {
				deviceInfo: {
					id: "test",
					name: "Test",
					transportName: "test",
					connected: true,
				},
				sendFrame: vi.fn(),
				startStream: vi.fn(),
				stopStream: vi.fn(),
				close: vi.fn(async () => {}),
			};
			const mockProtocol = {
				name: "Test Protocol",
				canHandle: vi.fn(async () => true),
				getSupportedPids: vi.fn(async () => []),
				streamLiveData: vi.fn(() => mockSession),
			};

			mockSelectDeviceAndProtocol.mockResolvedValue({
				connection: mockConnection,
				protocol: mockProtocol,
			});

			// No workspace folders
			vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue(
				undefined,
			);

			await manager.showPanel();
			(mockPanel.webview as any)._simulateMessage({ type: "ready" });
			await new Promise((resolve) => setTimeout(resolve, 50));

			(mockPanel.webview as any)._simulateMessage({
				type: "startStreaming",
				pids: [0x0c],
				record: true, // deprecated — should be ignored
			});
			await new Promise((resolve) => setTimeout(resolve, 50));

			// Streaming should still start (no error about workspace folder)
			expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
			expect(mockProtocol.streamLiveData).toHaveBeenCalled();
		});
	});

	describe("onFrame event", () => {
		it("should fire onFrame event for each received frame", async () => {
			const mockSession = { stop: vi.fn() };
			const mockConnection = {
				deviceInfo: {
					id: "test",
					name: "Test",
					transportName: "test",
					connected: true,
				},
				sendFrame: vi.fn(),
				startStream: vi.fn(),
				stopStream: vi.fn(),
				close: vi.fn(async () => {}),
			};

			let capturedOnFrame: ((frame: any) => void) | undefined;
			const mockProtocol = {
				name: "Test Protocol",
				canHandle: vi.fn(async () => true),
				getSupportedPids: vi.fn(async () => []),
				streamLiveData: vi.fn((_conn: any, _pids: any, onFrame: any) => {
					capturedOnFrame = onFrame;
					return mockSession;
				}),
			};

			mockSelectDeviceAndProtocol.mockResolvedValue({
				connection: mockConnection,
				protocol: mockProtocol,
			});

			await manager.showPanel();
			(mockPanel.webview as any)._simulateMessage({ type: "ready" });
			await new Promise((resolve) => setTimeout(resolve, 50));

			(mockPanel.webview as any)._simulateMessage({
				type: "startStreaming",
				pids: [0x0c],
				record: false,
			});
			await new Promise((resolve) => setTimeout(resolve, 50));

			const receivedFrames: any[] = [];
			manager.onFrame((frame) => receivedFrames.push(frame));

			const testFrame = { timestamp: 100, pid: 0x0c, value: 1000, unit: "rpm" };
			capturedOnFrame?.(testFrame);

			expect(receivedFrames).toHaveLength(1);
			expect(receivedFrames[0]).toEqual(testFrame);
		});
	});

	describe("panel lifecycle", () => {
		it("should clean up when panel is disposed", async () => {
			const mockSession = { stop: vi.fn() };
			const mockConnection = {
				deviceInfo: {
					id: "test",
					name: "Test",
					transportName: "test",
					connected: true,
				},
				sendFrame: vi.fn(),
				startStream: vi.fn(),
				stopStream: vi.fn(),
				close: vi.fn(async () => {}),
			};
			const mockProtocol = {
				name: "Test Protocol",
				canHandle: vi.fn(async () => true),
				getSupportedPids: vi.fn(async () => []),
				streamLiveData: vi.fn(() => mockSession),
			};

			mockSelectDeviceAndProtocol.mockResolvedValue({
				connection: mockConnection,
				protocol: mockProtocol,
			});

			await manager.showPanel();
			(mockPanel.webview as any)._simulateMessage({ type: "ready" });
			await new Promise((resolve) => setTimeout(resolve, 50));

			(mockPanel.webview as any)._simulateMessage({
				type: "startStreaming",
				pids: [0x0c],
				record: false,
			});
			await new Promise((resolve) => setTimeout(resolve, 50));

			// Dispose the panel
			mockPanel.dispose();
			await new Promise((resolve) => setTimeout(resolve, 50));

			// Session should be stopped
			expect(mockSession.stop).toHaveBeenCalled();

			// Creating a new panel should work (panel reference was cleared)
			await manager.showPanel();
			expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(2);
		});
	});
});
