import {
	type HardwareCandidate,
	type HardwareDeviceSelectionStrategy,
	type HardwarePromptOptions,
	type HardwareRequestAction,
	promptForHardwareCandidate,
} from "./hardware-selection.js";

export interface HardwareCandidateSource {
	listCandidates(): Promise<readonly HardwareCandidate[]>;
	getRequestActions?(): readonly HardwareRequestAction[];
	getPromptOptions?(
		onForgot?: (candidate: HardwareCandidate) => void,
	): HardwarePromptOptions;
}

export interface AggregatedHardwareSourceEntry {
	source: HardwareCandidateSource;
	strategy?: HardwareDeviceSelectionStrategy;
}

export interface AggregatedHardwareSelection {
	candidates: readonly HardwareCandidate[];
	requestActions: readonly HardwareRequestAction[];
	promptOptions: HardwarePromptOptions;
	rememberCandidate(candidate: HardwareCandidate): void;
}

function getCandidateKey(candidate: HardwareCandidate): string {
	return [
		candidate.device.id,
		candidate.device.transportName,
		candidate.locality,
	].join("::");
}

export async function createAggregatedHardwareSelection(
	entries: readonly AggregatedHardwareSourceEntry[],
): Promise<AggregatedHardwareSelection> {
	const candidates: HardwareCandidate[] = [];
	const requestActions: HardwareRequestAction[] = [];
	const candidateStrategies = new Map<
		string,
		HardwareDeviceSelectionStrategy | undefined
	>();
	const forgetHandlers: Array<
		(candidate: HardwareCandidate) => Promise<boolean>
	> = [];

	for (const entry of entries) {
		const sourceCandidates = await entry.source.listCandidates();
		for (const candidate of sourceCandidates) {
			candidates.push(candidate);
			candidateStrategies.set(getCandidateKey(candidate), entry.strategy);
		}

		for (const action of entry.source.getRequestActions?.() ?? []) {
			requestActions.push({
				...action,
				run: async () => {
					const candidate = await action.run();
					if (candidate != null) {
						candidateStrategies.set(getCandidateKey(candidate), entry.strategy);
					}
					return candidate;
				},
			});
		}

		const promptOptions = entry.source.getPromptOptions?.((candidate) => {
			entry.strategy?.forgetCandidate?.(candidate);
		});
		if (promptOptions?.forgetCandidate != null) {
			forgetHandlers.push(async (candidate) => {
				if (promptOptions.canForgetCandidate?.(candidate) === false) {
					return false;
				}
				await promptOptions.forgetCandidate?.(candidate);
				return true;
			});
		}
	}

	return {
		candidates,
		requestActions,
		promptOptions: {
			canForgetCandidate: (candidate) =>
				forgetHandlers.length > 0 &&
				entries.some((entry) => {
					const promptOptions = entry.source.getPromptOptions?.();
					return promptOptions?.canForgetCandidate?.(candidate) === true;
				}),
			forgetCandidate: async (candidate) => {
				for (const handler of forgetHandlers) {
					if (await handler(candidate)) {
						return;
					}
				}
			},
		},
		rememberCandidate(candidate) {
			candidateStrategies
				.get(getCandidateKey(candidate))
				?.rememberCandidate(candidate);
		},
	};
}

export async function selectHardwareCandidateFromSource(options: {
	source: HardwareCandidateSource;
	strategy?: HardwareDeviceSelectionStrategy;
	emptyMessage: string;
	forcePrompt?: boolean;
}): Promise<HardwareCandidate> {
	const candidates = await options.source.listCandidates();
	const requestActions = options.source.getRequestActions?.() ?? [];
	if (candidates.length === 0 && requestActions.length === 0) {
		throw new Error(options.emptyMessage);
	}

	const promptOptions =
		options.source.getPromptOptions?.((candidate) => {
			options.strategy?.forgetCandidate?.(candidate);
		}) ?? {};

	if (options.strategy != null && options.forcePrompt !== true) {
		return options.strategy.selectDevice(
			candidates,
			requestActions,
			promptOptions,
		);
	}

	return promptForHardwareCandidate(candidates, requestActions, promptOptions);
}
