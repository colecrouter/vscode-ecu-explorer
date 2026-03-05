import { vi } from "vitest";

type RelativePatternBase =
	| import("vscode").Uri
	| import("vscode").WorkspaceFolder;

type MockVscodeAugmentation = {
	lm?: {
		registerMcpServerDefinitionProvider: ReturnType<typeof vi.fn>;
	};
	RelativePattern?: new (
		base: RelativePatternBase,
		pattern: string,
	) => {
		base: RelativePatternBase;
		pattern: string;
	};
};

// Mock the vscode module
vi.mock("vscode", async () => {
	const { createVSCodeMock } =
		await vi.importActual<typeof import("jest-mock-vscode")>(
			"jest-mock-vscode",
		);

	// Create the vscode mock using jest-mock-vscode
	const mock = createVSCodeMock(vi);

	// Add proposed/newer APIs not included in jest-mock-vscode
	// vscode.lm — Language Model / MCP APIs (used by mcp-provider.ts)
	const mockWithAugmentation = mock as typeof mock & MockVscodeAugmentation;
	mockWithAugmentation.lm = {
		registerMcpServerDefinitionProvider: vi
			.fn()
			.mockReturnValue({ dispose: vi.fn() }),
	};

	// vscode.RelativePattern — used by per-document file watchers
	if (!mockWithAugmentation.RelativePattern) {
		mockWithAugmentation.RelativePattern = class RelativePattern {
			base: RelativePatternBase;
			pattern: string;
			constructor(base: RelativePatternBase, pattern: string) {
				this.base = base;
				this.pattern = pattern;
			}
		};
	}

	return mock;
});
