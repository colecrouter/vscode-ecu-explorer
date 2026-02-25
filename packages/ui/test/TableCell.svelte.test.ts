import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import TableCell from "../src/lib/views/TableCell.svelte";

describe("TableCell Component", () => {
	const bytes = new Uint8Array([42]);

	it("should render formatted value", async () => {
		const screen = render(TableCell, {
			bytes,
			dtype: "u8",
			scale: 1,
			offset: 0,
		});

		const input = screen.getByRole("spinbutton");
		await expect.element(input).toHaveValue(42);
	});

	it("should apply scale and offset", async () => {
		const screen = render(TableCell, {
			bytes,
			dtype: "u8",
			scale: 2,
			offset: 10,
		});

		const input = screen.getByRole("spinbutton");
		// 42 * 2 + 10 = 94
		await expect.element(input).toHaveValue(94);
	});

	it("should show validation error for out of range values", async () => {
		const screen = render(TableCell, {
			bytes,
			dtype: "u8",
			scale: 1,
			offset: 0,
		});

		const input = screen.getByRole("spinbutton");
		await input.fill("300");

		const error = screen.getByText(/out of range/i);
		await expect.element(error).toBeVisible();
	});
});
