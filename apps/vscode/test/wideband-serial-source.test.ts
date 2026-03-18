import type { SerialRuntime } from "@ecu-explorer/device/hardware-runtime";
import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import {
	promptForWidebandMode,
	WidebandSerialHardwareSource,
} from "../src/wideband-serial-source.js";

describe("WidebandSerialHardwareSource", () => {
	it("lists grouped serial candidates for the current locality", async () => {
		const runtime: SerialRuntime = {
			listPorts: vi.fn(async () => [
				{
					path: "/dev/cu.usbserial-1",
					vendorId: "0403",
					productId: "6001",
					manufacturer: "AEM",
				},
				{
					path: "/dev/tty.usbserial-1",
					vendorId: "0403",
					productId: "6001",
					manufacturer: "AEM",
				},
			]),
			openPort: vi.fn(),
		};
		const source = new WidebandSerialHardwareSource(runtime, "extension-host");

		const candidates = await source.listCandidates();

		expect(candidates).toHaveLength(1);
		expect(candidates[0]).toMatchObject({
			device: {
				id: "wideband-serial:/dev/cu.usbserial-1",
				transportName: "serial",
			},
			locality: "extension-host",
		});
	});

	it("creates a browser request action when requestPort is available", async () => {
		const runtime: SerialRuntime = {
			listPorts: vi.fn(async () => []),
			openPort: vi.fn(),
			requestPort: vi.fn(async () => ({
				path: "wideband-webserial:0403:6001:0",
				friendlyName: "AEM Wideband",
			})),
		};
		const source = new WidebandSerialHardwareSource(runtime, "client-browser");

		const [action] = source.getRequestActions();
		const candidate = await action?.run();

		expect(action?.label).toContain("Connect New Serial Device");
		expect(candidate).toMatchObject({
			device: {
				id: "wideband-serial:wideband-webserial:0403:6001:0",
				name: "AEM Wideband (Serial)",
			},
			locality: "client-browser",
		});
	});

	it("forgets browser-owned serial candidates when supported", async () => {
		const runtime: SerialRuntime = {
			listPorts: vi.fn(async () => []),
			openPort: vi.fn(),
			forgetPort: vi.fn(async () => undefined),
		};
		const source = new WidebandSerialHardwareSource(runtime, "client-browser");
		const promptOptions = source.getPromptOptions();
		const candidate = {
			device: {
				id: "wideband-serial:wideband-webserial:0403:6001:0",
				name: "AEM Wideband (Serial)",
				transportName: "serial",
				connected: false,
			},
			locality: "client-browser" as const,
		};

		expect(promptOptions.canForgetCandidate?.(candidate)).toBe(true);
		await promptOptions.forgetCandidate?.(candidate);

		expect(runtime.forgetPort).toHaveBeenCalledWith(
			"wideband-webserial:0403:6001:0",
		);
	});
});

describe("promptForWidebandMode", () => {
	it("returns the selected mode", async () => {
		vi.mocked(vscode.window.showQuickPick).mockResolvedValueOnce({
			label: "Lambda",
			value: "lambda",
		} as never);

		await expect(promptForWidebandMode()).resolves.toBe("lambda");
	});
});
