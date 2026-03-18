/**
 * Unit tests for LoggingManager
 *
 * Tests CSV logging lifecycle: startLog, onFrame, pauseLog, resumeLog, stopLog,
 * column filtering, openLogsFolder, and error cases.
 */

import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { LoggingManager, openLogsFolder } from "../src/logging-manager.js";
import {
	createLoggingConfiguration,
	createSamplePids,
	createWorkspaceFolders,
} from "./mocks/logging-fixtures.js";

const OPEN_FOLDER_ACTION = "Open Folder";

// ─── LoggingManager Tests ────────────────────────────────────────────────────

describe("LoggingManager", () => {
	let manager: LoggingManager;

	beforeEach(() => {
		// Mock workspace folders
		vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue([
			...createWorkspaceFolders(),
		]);

		// Mock workspace.fs
		vi.mocked(vscode.workspace.fs.createDirectory).mockResolvedValue(undefined);
		vi.mocked(vscode.workspace.fs.writeFile).mockResolvedValue(undefined);

		// Mock workspace.getConfiguration
		vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
			createLoggingConfiguration("logs"),
		);

		// Mock showInformationMessage to return undefined (no button clicked)
		vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(
			undefined,
		);

		manager = new LoggingManager();
	});

	describe("startLog", () => {
		it("should set state to recording after startLog", async () => {
			const pids = createSamplePids();
			await manager.startLog([...pids]);
			expect(manager.loggingState).toBe("recording");
		});

		it("should fire onDidChangeState with recording", async () => {
			const stateChanges: string[] = [];
			manager.onDidChangeState((state) => stateChanges.push(state));

			await manager.startLog([...createSamplePids()]);
			expect(stateChanges).toContain("recording");
		});

		it("should create the logs directory", async () => {
			await manager.startLog([...createSamplePids()]);
			expect(vscode.workspace.fs.createDirectory).toHaveBeenCalled();
		});

		it("should build correct CSV header with PID names", async () => {
			const pids = createSamplePids();
			await manager.startLog([...pids]);

			// Stop to write the file
			await manager.stopLog();

			const writeCall = vi.mocked(vscode.workspace.fs.writeFile).mock.calls[0];
			expect(writeCall).toBeDefined();
			const content = new TextDecoder().decode(writeCall?.[1]);
			const header = ["Timestamp (ms)", ...pids.map((pid) => pid.name)].join(
				",",
			);
			expect(content).toContain(header);
		});

		it("should build correct units row", async () => {
			const pids = createSamplePids();
			await manager.startLog([...pids]);
			await manager.stopLog();

			const writeCall = vi.mocked(vscode.workspace.fs.writeFile).mock.calls[0];
			const content = new TextDecoder().decode(writeCall?.[1]);
			const unitsRow = ["Unit", ...pids.map((pid) => pid.unit)].join(",");
			expect(content).toContain(unitsRow);
		});

		it("should be idempotent when already recording", async () => {
			const pids = createSamplePids();
			await manager.startLog([...pids]);
			await manager.startLog([...pids]); // second call should be no-op

			expect(manager.loggingState).toBe("recording");
			// createDirectory should only be called once
			expect(vscode.workspace.fs.createDirectory).toHaveBeenCalledTimes(1);
		});

		it("should show error when no workspace folder is open", async () => {
			vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue(
				undefined,
			);

			await manager.startLog([...createSamplePids()]);

			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				expect.stringContaining("No workspace folder is open"),
			);
			expect(manager.loggingState).toBe("idle");
		});

		it("should use relative logsFolder setting", async () => {
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
				createLoggingConfiguration("data/logs"),
			);

			await manager.startLog([...createSamplePids()]);

			const createDirCall = vi.mocked(vscode.workspace.fs.createDirectory).mock
				.calls[0];
			expect(createDirCall?.[0].fsPath).toContain(path.normalize("data/logs"));
		});

		it("should use absolute logsFolder setting", async () => {
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
				createLoggingConfiguration("/absolute/logs"),
			);

			await manager.startLog([...createSamplePids()]);

			const createDirCall = vi.mocked(vscode.workspace.fs.createDirectory).mock
				.calls[0];
			expect(createDirCall?.[0].fsPath).toBe(path.normalize("/absolute/logs"));
		});

		it("should include generic log channels in the CSV header", async () => {
			await manager.startLog({
				pids: [...createSamplePids()],
				channels: [
					{
						key: "wideband-primary",
						name: "Wideband AFR",
						unit: "AFR",
					},
				],
			});

			await manager.stopLog();

			const writeCall = vi.mocked(vscode.workspace.fs.writeFile).mock.calls[0];
			const content = new TextDecoder().decode(writeCall?.[1]);
			expect(content).toContain(
				"Timestamp (ms),Engine RPM,Coolant Temp,Throttle Position,Wideband AFR",
			);
			expect(content).toContain("Unit,rpm,°C,%,AFR");
		});
	});

	describe("onFrame", () => {
		it("should append row when recording", async () => {
			const pids = createSamplePids();
			await manager.startLog([...pids]);

			manager.onFrame({ timestamp: 1000, pid: 0x0c, value: 850, unit: "rpm" });

			await manager.stopLog();

			const writeCall = vi.mocked(vscode.workspace.fs.writeFile).mock.calls[0];
			const content = new TextDecoder().decode(writeCall?.[1]);
			// Row should contain the value for Engine RPM column
			expect(content).toContain("850");
		});

		it("should drop frame when paused", async () => {
			const pids = createSamplePids();
			const [activePid] = pids;
			await manager.startLog([...pids]);
			manager.pauseLog();

			manager.onFrame({
				timestamp: 1000,
				pid: activePid.pid,
				value: 850,
				unit: activePid.unit,
			});

			manager.resumeLog();
			await manager.stopLog();

			const writeCall = vi.mocked(vscode.workspace.fs.writeFile).mock.calls[0];
			const content = new TextDecoder().decode(writeCall?.[1]);
			// Only header and units row, no data rows with 850
			const lines = content.trim().split("\n");
			expect(lines).toHaveLength(2); // header + units only
		});

		it("should drop frame when idle", async () => {
			const [pid] = createSamplePids();
			// Don't start logging
			manager.onFrame({
				timestamp: 1000,
				pid: pid.pid,
				value: 850,
				unit: pid.unit,
			});

			// No file should be written
			expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
		});

		it("should drop frame for PID not in enabled columns", async () => {
			const pids = createSamplePids();
			const [enabledPid, filteredPid] = pids;
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
				createLoggingConfiguration("logs", [enabledPid.name]),
			);
			await manager.startLog([...pids]);

			manager.onFrame({
				timestamp: 1000,
				pid: filteredPid.pid,
				value: 82,
				unit: filteredPid.unit,
			});

			await manager.stopLog();

			const writeCall = vi.mocked(vscode.workspace.fs.writeFile).mock.calls[0];
			const content = new TextDecoder().decode(writeCall?.[1]);
			// Only header and units row
			const lines = content.trim().split("\n");
			expect(lines).toHaveLength(2);
		});

		it("should append generic channel samples when recording", async () => {
			await manager.startLog({
				channels: [
					{
						key: "wideband-primary",
						name: "Wideband AFR",
						unit: "AFR",
					},
				],
			});

			manager.onChannelSample("wideband-primary", 1000, 14.7);

			await manager.stopLog();

			const writeCall = vi.mocked(vscode.workspace.fs.writeFile).mock.calls[0];
			const content = new TextDecoder().decode(writeCall?.[1]);
			expect(content).toContain("14.7");
		});
	});

	describe("pauseLog / resumeLog", () => {
		it("should set state to paused", async () => {
			await manager.startLog([...createSamplePids()]);
			manager.pauseLog();
			expect(manager.loggingState).toBe("paused");
		});

		it("should fire onDidChangeState with paused", async () => {
			const stateChanges: string[] = [];
			manager.onDidChangeState((state) => stateChanges.push(state));

			await manager.startLog([...createSamplePids()]);
			manager.pauseLog();

			expect(stateChanges).toContain("paused");
		});

		it("should set state back to recording on resumeLog", async () => {
			await manager.startLog([...createSamplePids()]);
			manager.pauseLog();
			manager.resumeLog();
			expect(manager.loggingState).toBe("recording");
		});

		it("should fire onDidChangeState with recording on resumeLog", async () => {
			const stateChanges: string[] = [];
			manager.onDidChangeState((state) => stateChanges.push(state));

			await manager.startLog([...createSamplePids()]);
			manager.pauseLog();
			manager.resumeLog();

			expect(stateChanges).toEqual(["recording", "paused", "recording"]);
		});

		it("should be no-op if pauseLog called when not recording", () => {
			manager.pauseLog(); // idle state
			expect(manager.loggingState).toBe("idle");
		});

		it("should be no-op if resumeLog called when not paused", async () => {
			await manager.startLog([...createSamplePids()]);
			manager.resumeLog(); // already recording
			expect(manager.loggingState).toBe("recording");
		});
	});

	describe("stopLog", () => {
		it("should write CSV file on stopLog", async () => {
			await manager.startLog([...createSamplePids()]);
			manager.onFrame({ timestamp: 1000, pid: 0x0c, value: 850, unit: "rpm" });
			await manager.stopLog();

			expect(vscode.workspace.fs.writeFile).toHaveBeenCalled();
		});

		it("should show information message with file path", async () => {
			await manager.startLog([...createSamplePids()]);
			await manager.stopLog();

			expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
				expect.stringContaining("Log saved to"),
				"Open Folder",
			);
		});

		it("should reset state to idle after stopLog", async () => {
			await manager.startLog([...createSamplePids()]);
			await manager.stopLog();
			expect(manager.loggingState).toBe("idle");
		});

		it("should fire onDidChangeState with idle on stopLog", async () => {
			const stateChanges: string[] = [];
			manager.onDidChangeState((state) => stateChanges.push(state));

			await manager.startLog([...createSamplePids()]);
			await manager.stopLog();

			expect(stateChanges).toContain("idle");
		});

		it("should return undefined when called in idle state", async () => {
			const result = await manager.stopLog();
			expect(result).toBeUndefined();
		});

		it("should return the saved URI", async () => {
			await manager.startLog([...createSamplePids()]);
			const uri = await manager.stopLog();
			expect(uri).toBeDefined();
			expect(uri?.fsPath).toContain("log-");
			expect(uri?.fsPath).toContain(".csv");
		});

		it("should reveal logs folder when Open Folder is clicked", async () => {
			vi.mocked(vscode.window.showInformationMessage).mockImplementation(
				(async () =>
					OPEN_FOLDER_ACTION) as typeof vscode.window.showInformationMessage,
			);

			await manager.startLog([...createSamplePids()]);
			await manager.stopLog();

			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				"revealFileInOS",
				expect.anything(),
			);
		});

		it("should allow starting a new log after stopping", async () => {
			await manager.startLog([...createSamplePids()]);
			await manager.stopLog();
			const createDirectoryCallCount = vi.mocked(
				vscode.workspace.fs.createDirectory,
			).mock.calls.length;
			const writeFileCallCount = vi.mocked(vscode.workspace.fs.writeFile).mock
				.calls.length;

			await manager.startLog([...createSamplePids()]);

			expect(manager.loggingState).toBe("recording");
			expect(vscode.workspace.fs.createDirectory).toHaveBeenCalledTimes(
				createDirectoryCallCount + 1,
			);
			expect(vscode.workspace.fs.writeFile).toHaveBeenCalledTimes(
				writeFileCallCount,
			);
		});
	});

	describe("column filtering", () => {
		it("should include all PIDs when columns is 'all'", async () => {
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
				createLoggingConfiguration("logs"),
			);

			const pids = createSamplePids();
			await manager.startLog([...pids]);
			await manager.stopLog();

			const writeCall = vi.mocked(vscode.workspace.fs.writeFile).mock.calls[0];
			const content = new TextDecoder().decode(writeCall?.[1]);
			expect(content).toContain("Engine RPM");
			expect(content).toContain("Coolant Temp");
			expect(content).toContain("Throttle Position");
		});

		it("should only include specified PIDs when columns is an array", async () => {
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
				createLoggingConfiguration("logs", ["Engine RPM", "Coolant Temp"]),
			);

			const pids = createSamplePids();
			await manager.startLog([...pids]);
			await manager.stopLog();

			const writeCall = vi.mocked(vscode.workspace.fs.writeFile).mock.calls[0];
			const content = new TextDecoder().decode(writeCall?.[1]);
			expect(content).toContain("Engine RPM");
			expect(content).toContain("Coolant Temp");
			expect(content).not.toContain("Throttle Position");
		});

		it("should silently ignore unknown PID names in columns array", async () => {
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
				createLoggingConfiguration("logs", ["Engine RPM", "Unknown PID"]),
			);

			const pids = createSamplePids();
			await manager.startLog([...pids]);
			await manager.stopLog();

			const writeCall = vi.mocked(vscode.workspace.fs.writeFile).mock.calls[0];
			const content = new TextDecoder().decode(writeCall?.[1]);
			expect(content).toContain("Engine RPM");
			expect(content).not.toContain("Unknown PID");
		});
	});

	describe("CSV format", () => {
		it("should write relative timestamps in data rows", async () => {
			const pids = createSamplePids();
			await manager.startLog([...pids]);

			// The session start time is captured at startLog; frame.timestamp is ms since session start
			// In our implementation, relativeTs = frame.timestamp - sessionStartMs
			// Since sessionStartMs = Date.now() at startLog time, and frame.timestamp is also ms,
			// we need to use a timestamp that makes sense
			manager.onFrame({
				timestamp: Date.now(),
				pid: 0x0c,
				value: 850,
				unit: "rpm",
			});

			await manager.stopLog();

			const writeCall = vi.mocked(vscode.workspace.fs.writeFile).mock.calls[0];
			const content = new TextDecoder().decode(writeCall?.[1]);
			const lines = content.trim().split("\n");
			// Should have header, units, and at least one data row
			expect(lines.length).toBeGreaterThanOrEqual(3);
		});

		it("should produce sparse rows with empty cells for missing PIDs", async () => {
			const pids = createSamplePids();
			const [activePid] = pids;
			await manager.startLog([...pids]);

			// Only send Engine RPM frame
			manager.onFrame({
				timestamp: Date.now(),
				pid: activePid.pid,
				value: 850,
				unit: activePid.unit,
			});

			await manager.stopLog();

			const writeCall = vi.mocked(vscode.workspace.fs.writeFile).mock.calls[0];
			const content = new TextDecoder().decode(writeCall?.[1]);
			const lines = content.trim().split("\n");
			// Data row should have 4 fields: timestamp, Engine RPM, Coolant Temp (empty), Throttle Position (empty)
			const dataRow = lines[2]; // index 0=header, 1=units, 2=first data row
			if (dataRow === undefined) {
				throw new Error("Expected first data row to exist");
			}
			const fields = dataRow.split(",");
			expect(fields).toHaveLength(pids.length + 1); // timestamp + PID columns
			expect(fields[1]).toBe("850"); // Engine RPM value
			expect(fields[2]).toBe(""); // Coolant Temp empty
			expect(fields[3]).toBe(""); // Throttle Position empty
		});
	});
});

// ─── openLogsFolder Tests ────────────────────────────────────────────────────

describe("openLogsFolder", () => {
	beforeEach(() => {
		vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue([
			...createWorkspaceFolders(),
		]);

		vi.mocked(vscode.workspace.fs.createDirectory).mockResolvedValue(undefined);

		vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
			createLoggingConfiguration("logs"),
		);
	});

	it("should create the logs directory", async () => {
		await openLogsFolder();
		expect(vscode.workspace.fs.createDirectory).toHaveBeenCalled();
	});

	it("should execute revealFileInOS with the logs folder URI", async () => {
		await openLogsFolder();
		expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
			"revealFileInOS",
			expect.objectContaining({
				fsPath: expect.stringContaining("logs"),
			}),
		);
	});

	it("should show error when no workspace folder is open", async () => {
		vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue(
			undefined,
		);

		await openLogsFolder();

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			expect.stringContaining("No workspace folder is open"),
		);
		expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
			"revealFileInOS",
			expect.anything(),
		);
	});

	it("should resolve relative logsFolder path against workspace root", async () => {
		vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
			createLoggingConfiguration("data/logs"),
		);

		await openLogsFolder();

		const createDirCall = vi.mocked(vscode.workspace.fs.createDirectory).mock
			.calls[0];
		expect(createDirCall?.[0].fsPath).toContain(path.normalize("data/logs"));
	});

	it("should use absolute logsFolder path as-is", async () => {
		vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
			createLoggingConfiguration("/absolute/path/logs"),
		);

		await openLogsFolder();

		const createDirCall = vi.mocked(vscode.workspace.fs.createDirectory).mock
			.calls[0];
		expect(createDirCall?.[0].fsPath).toBe(
			path.normalize("/absolute/path/logs"),
		);
	});
});
