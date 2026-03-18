import type {
	WidebandAdapter,
	WidebandHardwareCandidate,
	WidebandReading,
	WidebandSession,
} from "@ecu-explorer/wideband";
import * as vscode from "vscode";
import type { HardwareCandidate } from "./hardware-selection.js";

export interface ActiveWidebandSession {
	adapter: WidebandAdapter;
	candidate: HardwareCandidate;
	session: WidebandSession;
}

export class WidebandManager implements vscode.Disposable {
	private adapters: WidebandAdapter[] = [];
	private _activeSession: ActiveWidebandSession | undefined;
	private _latestReading: WidebandReading | undefined;
	private readonly onDidChangeSessionEmitter = new vscode.EventEmitter<
		ActiveWidebandSession | undefined
	>();
	private readonly onDidReadEmitter =
		new vscode.EventEmitter<WidebandReading>();
	private readonly onDidChangeReadingEmitter = new vscode.EventEmitter<
		WidebandReading | undefined
	>();

	constructor(
		private readonly listHardwareCandidates: () => Promise<
			readonly HardwareCandidate[]
		>,
	) {}

	readonly onDidChangeSession = this.onDidChangeSessionEmitter.event;
	readonly onDidRead = this.onDidReadEmitter.event;
	readonly onDidChangeReading = this.onDidChangeReadingEmitter.event;

	get activeSession(): ActiveWidebandSession | undefined {
		return this._activeSession;
	}

	get latestReading(): WidebandReading | undefined {
		return this._latestReading;
	}

	registerAdapter(adapter: WidebandAdapter): void {
		this.adapters.push(adapter);
	}

	setAdapters(adapters: readonly WidebandAdapter[]): void {
		this.adapters = [...adapters];
	}

	getAdapters(): readonly WidebandAdapter[] {
		return [...this.adapters];
	}

	async listCandidates(): Promise<readonly HardwareCandidate[]> {
		const hardwareCandidates = await this.listHardwareCandidates();
		const matches: HardwareCandidate[] = [];

		for (const candidate of hardwareCandidates) {
			if (await this.canAnyAdapterOpen(candidate)) {
				matches.push(candidate);
			}
		}

		return matches;
	}

	async openCandidate(
		candidate: HardwareCandidate,
	): Promise<ActiveWidebandSession> {
		const adapter = await this.findMatchingAdapter(candidate);
		if (adapter == null) {
			throw new Error(`No wideband adapter matched "${candidate.device.name}"`);
		}

		if (this._activeSession != null) {
			await this._activeSession.session.close();
		}

		const session = await adapter.open(toWidebandHardwareCandidate(candidate));
		await session.startStream((reading) => {
			this._latestReading = reading;
			this.onDidReadEmitter.fire(reading);
			this.onDidChangeReadingEmitter.fire(reading);
		});
		this._activeSession = {
			adapter,
			candidate,
			session,
		};
		this.onDidChangeSessionEmitter.fire(this._activeSession);
		return this._activeSession;
	}

	async disconnect(): Promise<void> {
		if (this._activeSession == null) {
			return;
		}

		await this._activeSession.session.close();
		this._activeSession = undefined;
		this._latestReading = undefined;
		this.onDidChangeSessionEmitter.fire(undefined);
		this.onDidChangeReadingEmitter.fire(undefined);
	}

	dispose(): void {
		void this.disconnect();
		this.onDidReadEmitter.dispose();
		this.onDidChangeReadingEmitter.dispose();
		this.onDidChangeSessionEmitter.dispose();
	}

	private async canAnyAdapterOpen(
		candidate: HardwareCandidate,
	): Promise<boolean> {
		for (const adapter of this.adapters) {
			if (await adapter.canOpen(toWidebandHardwareCandidate(candidate))) {
				return true;
			}
		}
		return false;
	}

	private async findMatchingAdapter(
		candidate: HardwareCandidate,
	): Promise<WidebandAdapter | undefined> {
		for (const adapter of this.adapters) {
			if (await adapter.canOpen(toWidebandHardwareCandidate(candidate))) {
				return adapter;
			}
		}
		return undefined;
	}
}

export function toWidebandHardwareCandidate(
	candidate: HardwareCandidate,
): WidebandHardwareCandidate {
	return {
		id: candidate.device.id,
		name: candidate.device.name,
		transportName: candidate.device.transportName,
		locality: candidate.locality,
	};
}
