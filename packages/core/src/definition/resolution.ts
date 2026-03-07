import { scoreRomDefinition } from "./match.js";
import type { ROMDefinitionProvider } from "./provider.js";
import type { ROMDefinition, ROMDefinitionStub } from "./rom.js";

export const ROM_DEFINITION_CONFIDENCE_THRESHOLD = 0.5;

export type ROMDefinitionCandidate = {
	provider: ROMDefinitionProvider;
	peek: ROMDefinitionStub;
	score: number;
};

export type ROMDefinitionDiscovery = {
	candidates: ROMDefinitionCandidate[];
	allDefinitions: {
		provider: ROMDefinitionProvider;
		peek: ROMDefinitionStub;
	}[];
};

export type ROMDefinitionResolutionPlan =
	| {
			kind: "saved";
			definition: ROMDefinition;
			definitionUri: string;
	  }
	| {
			kind: "auto";
			definition: ROMDefinition;
			definitionUri: string;
			candidates: ROMDefinitionCandidate[];
	  }
	| {
			kind: "prompt-candidate";
			candidates: ROMDefinitionCandidate[];
	  }
	| {
			kind: "prompt-all";
			allDefinitions: {
				provider: ROMDefinitionProvider;
				peek: ROMDefinitionStub;
			}[];
	  }
	| {
			kind: "prompt-file";
	  };

export async function discoverRomDefinitionCandidates(
	romUri: string,
	romBytes: Uint8Array,
	providers: ROMDefinitionProvider[],
): Promise<ROMDefinitionDiscovery> {
	const candidates: ROMDefinitionCandidate[] = [];
	const allDefinitions: {
		provider: ROMDefinitionProvider;
		peek: ROMDefinitionStub;
	}[] = [];

	for (const provider of providers) {
		const uris = await provider.discoverDefinitionUris(romUri);
		for (const uri of uris) {
			const peek = await provider.peek(uri);
			allDefinitions.push({ provider, peek });
			const score = scoreRomDefinition(romBytes, peek);
			if (score > 0) {
				candidates.push({ provider, peek, score });
			}
		}
	}

	candidates.sort((a, b) => b.score - a.score);

	return { candidates, allDefinitions };
}

export async function planRomDefinitionResolution(
	romUri: string,
	romBytes: Uint8Array,
	providers: ROMDefinitionProvider[],
	savedDefinitionUri?: string,
): Promise<ROMDefinitionResolutionPlan> {
	if (savedDefinitionUri) {
		for (const provider of providers) {
			if (await provider.canParseDefinitionUri(savedDefinitionUri)) {
				const definition = await provider.parse(savedDefinitionUri);
				return {
					kind: "saved",
					definition,
					definitionUri: savedDefinitionUri,
				};
			}
		}
	}

	const discovery = await discoverRomDefinitionCandidates(
		romUri,
		romBytes,
		providers,
	);
	const best = discovery.candidates[0];

	if (best && best.score >= ROM_DEFINITION_CONFIDENCE_THRESHOLD) {
		const definition = await best.provider.parse(best.peek.uri);
		return {
			kind: "auto",
			definition,
			definitionUri: best.peek.uri,
			candidates: discovery.candidates,
		};
	}

	if (discovery.candidates.length > 0) {
		return {
			kind: "prompt-candidate",
			candidates: discovery.candidates,
		};
	}

	if (discovery.allDefinitions.length > 0) {
		return {
			kind: "prompt-all",
			allDefinitions: discovery.allDefinitions,
		};
	}

	return { kind: "prompt-file" };
}
