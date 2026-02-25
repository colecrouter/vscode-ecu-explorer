import type { LiveDataFrame, PidDescriptor } from "@ecu-explorer/device";
import * as vscode from "vscode";
import { readConfig } from "./config";

export type LoggingState = "idle" | "recording" | "paused";

/**
 * Manages independent CSV logging of live data frames.
 *
 * Logging is controlled via status bar commands and is independent of the
 * Live Data webview panel. A session can be started, paused, resumed, and
 * stopped without the panel being open.
 *
 * The CSV uses a wide format: one column per PID, named by PID name.
 * All data is accumulated in-memory and written atomically on stopLog().
 */
export class LoggingManager implements vscode.Disposable {
	private state: LoggingState = "idle";
	private csvBuffer = "";
	private recordingUri: vscode.Uri | undefined;
	private sessionStartMs = 0;
	private columns: string[] | "all" = "all";
	/** pid -> name */
	private pidNames: Map<number, string> = new Map();
	/** pid -> unit */
	private pidUnits: Map<number, string> = new Map();
	/** Ordered list of pid numbers for column positions */
	private pidOrder: number[] = [];

	private _onDidChangeState = new vscode.EventEmitter<LoggingState>();
	readonly onDidChangeState: vscode.Event<LoggingState> =
		this._onDidChangeState.event;

	/**
	 * Start a new logging session.
	 *
	 * @param pids - The PID descriptors for all active PIDs being streamed
	 * @throws If no workspace folder is open
	 */
	async startLog(pids: PidDescriptor[]): Promise<void> {
		if (this.state !== "idle") {
			// Already recording or paused — idempotent
			return;
		}

		// Resolve workspace root
		const workspaceFolders = vscode.workspace.workspaceFolders;
		const firstFolder = workspaceFolders?.[0];
		if (!firstFolder) {
			vscode.window.showErrorMessage(
				"No workspace folder is open. Open a folder to enable logging.",
			);
			return;
		}
		const workspaceRoot = firstFolder.uri;

		// Read logsFolder setting
		const cfg = readConfig();
		const logsFolder: string = cfg.logsFolder;

		// Resolve log folder URI
		let logsFolderUri: vscode.Uri;
		if (logsFolder.startsWith("/") || logsFolder.match(/^[a-zA-Z]:\\/)) {
			logsFolderUri = vscode.Uri.file(logsFolder);
		} else {
			logsFolderUri = vscode.Uri.joinPath(workspaceRoot, logsFolder);
		}

		// Create directory if it doesn't exist
		await vscode.workspace.fs.createDirectory(logsFolderUri);

		// Build filename with ISO timestamp (colons and dots replaced with dashes)
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
		const fileName = `log-${timestamp}.csv`;
		this.recordingUri = vscode.Uri.joinPath(logsFolderUri, fileName);

		// Read column filter setting
		this.columns = cfg.logging.columns;

		// Filter PIDs based on column setting
		let filteredPids: PidDescriptor[];
		if (this.columns === "all") {
			filteredPids = pids;
		} else {
			filteredPids = pids.filter((p) =>
				(this.columns as string[]).includes(p.name),
			);
		}

		// Build PID maps and order
		this.pidNames.clear();
		this.pidUnits.clear();
		this.pidOrder = [];
		for (const pid of filteredPids) {
			this.pidNames.set(pid.pid, pid.name);
			this.pidUnits.set(pid.pid, pid.unit);
			this.pidOrder.push(pid.pid);
		}

		// Build CSV header row: Timestamp (ms),<PID Name 1>,<PID Name 2>,...
		const headerCols = filteredPids.map((p) => p.name).join(",");
		const headerRow = `Timestamp (ms),${headerCols}`;

		// Build units row: Unit,<unit1>,<unit2>,...
		const unitCols = filteredPids.map((p) => p.unit).join(",");
		const unitsRow = `Unit,${unitCols}`;

		this.csvBuffer = `${headerRow}\n${unitsRow}\n`;
		this.sessionStartMs = Date.now();

		this.state = "recording";
		this._onDidChangeState.fire(this.state);

		// Set VSCode context keys
		vscode.commands.executeCommand(
			"setContext",
			"ecuExplorer.loggingActive",
			true,
		);
		vscode.commands.executeCommand(
			"setContext",
			"ecuExplorer.loggingPaused",
			false,
		);
	}

	/**
	 * Pause the current logging session.
	 * Frames received while paused are not written to the CSV buffer.
	 * No-op if not currently recording.
	 */
	pauseLog(): void {
		if (this.state !== "recording") {
			return;
		}
		this.state = "paused";
		this._onDidChangeState.fire(this.state);

		vscode.commands.executeCommand(
			"setContext",
			"ecuExplorer.loggingActive",
			false,
		);
		vscode.commands.executeCommand(
			"setContext",
			"ecuExplorer.loggingPaused",
			true,
		);
	}

	/**
	 * Resume a paused logging session.
	 * Subsequent frames are written to the same buffer, continuing the log.
	 * No-op if not currently paused.
	 */
	resumeLog(): void {
		if (this.state !== "paused") {
			return;
		}
		this.state = "recording";
		this._onDidChangeState.fire(this.state);

		vscode.commands.executeCommand(
			"setContext",
			"ecuExplorer.loggingActive",
			true,
		);
		vscode.commands.executeCommand(
			"setContext",
			"ecuExplorer.loggingPaused",
			false,
		);
	}

	/**
	 * Stop the logging session and write the CSV file to disk.
	 *
	 * @returns The URI of the saved file, or undefined if no session was active
	 */
	async stopLog(): Promise<vscode.Uri | undefined> {
		if (this.state === "idle") {
			return undefined;
		}

		const savedUri = this.recordingUri;

		this.state = "idle";
		this._onDidChangeState.fire(this.state);

		vscode.commands.executeCommand(
			"setContext",
			"ecuExplorer.loggingActive",
			false,
		);
		vscode.commands.executeCommand(
			"setContext",
			"ecuExplorer.loggingPaused",
			false,
		);

		if (savedUri && this.csvBuffer) {
			const data = new TextEncoder().encode(this.csvBuffer);
			await vscode.workspace.fs.writeFile(savedUri, data);

			// Build relative path for display
			const workspaceFolders = vscode.workspace.workspaceFolders;
			let displayPath = savedUri.fsPath;
			const firstWsFolder = workspaceFolders?.[0];
			if (firstWsFolder) {
				const rootPath = firstWsFolder.uri.fsPath;
				if (displayPath.startsWith(rootPath)) {
					displayPath = displayPath
						.slice(rootPath.length)
						.replace(/^[\\/]/, "");
				}
			}

			const action = await vscode.window.showInformationMessage(
				`Log saved to ${displayPath}.`,
				"Open Folder",
			);

			if (action === "Open Folder") {
				// Reveal the logs folder in OS file manager
				const logsFolderUri = vscode.Uri.joinPath(savedUri, "..");
				await vscode.commands.executeCommand("revealFileInOS", logsFolderUri);
			}
		}

		// Clear state
		this.csvBuffer = "";
		this.recordingUri = undefined;
		this.pidNames.clear();
		this.pidUnits.clear();
		this.pidOrder = [];

		return savedUri;
	}

	/**
	 * Feed a live data frame into the logger.
	 *
	 * Frames are only written to the CSV buffer when state is 'recording'.
	 * Frames received while paused or idle are dropped.
	 *
	 * @param frame - The live data frame to process
	 */
	onFrame(frame: LiveDataFrame): void {
		if (this.state !== "recording") {
			return;
		}

		// Check if this PID is in the enabled columns
		if (!this.pidNames.has(frame.pid)) {
			return;
		}

		// Compute relative timestamp
		const relativeTs = frame.timestamp - this.sessionStartMs;

		// Build a sparse row: timestamp + values for each PID column
		// For PIDs not in this frame, use empty string
		const values = this.pidOrder.map((pid) => {
			if (pid === frame.pid) {
				return String(frame.value);
			}
			return "";
		});

		const row = `${relativeTs},${values.join(",")}\n`;
		this.csvBuffer += row;
	}

	/**
	 * Get the current logging state.
	 */
	get loggingState(): LoggingState {
		return this.state;
	}

	dispose(): void {
		this._onDidChangeState.dispose();
	}
}

/**
 * Open the configured logs folder in the OS file manager.
 * Creates the folder if it doesn't exist.
 *
 * @param context - The extension context (unused, kept for API consistency)
 */
export async function openLogsFolder(
	_context?: vscode.ExtensionContext,
): Promise<void> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	const firstFolder = workspaceFolders?.[0];
	if (!firstFolder) {
		vscode.window.showErrorMessage("No workspace folder is open.");
		return;
	}
	const workspaceRoot = firstFolder.uri;

	const cfg = readConfig();
	const logsFolder: string = cfg.logsFolder;

	let logsFolderUri: vscode.Uri;
	if (logsFolder.startsWith("/")) {
		logsFolderUri = vscode.Uri.file(logsFolder);
	} else {
		logsFolderUri = vscode.Uri.joinPath(workspaceRoot, logsFolder);
	}

	// Create directory if it doesn't exist
	await vscode.workspace.fs.createDirectory(logsFolderUri);

	await vscode.commands.executeCommand("revealFileInOS", logsFolderUri);
}
