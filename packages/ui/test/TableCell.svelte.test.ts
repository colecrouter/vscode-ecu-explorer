import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import TableCell from "../src/lib/views/TableCell.svelte";

describe("TableCell Component", () => {
	const bytes = new Uint8Array([42]);

	it("renders formatted text in navigation mode", async () => {
		const screen = render(TableCell, {
			bytes,
			dtype: "u8",
			scale: 1,
			offset: 0,
			isActive: true,
			isEditing: false,
		});

		const display = screen.getByText("42");
		await expect.element(display).toBeVisible();
		expect(screen.container.querySelector("input")).toBeNull();
	});

	it("renders an input in edit mode", async () => {
		const screen = render(TableCell, {
			bytes,
			dtype: "u8",
			scale: 1,
			offset: 0,
			isEditing: true,
		});

		const input = screen.getByRole("spinbutton");
		await expect.element(input).toHaveValue(42);
	});

	it("seeds the edit draft when editSeed is provided", async () => {
		const screen = render(TableCell, {
			bytes,
			dtype: "u8",
			scale: 1,
			offset: 0,
			isEditing: true,
			editSeed: "7",
		});

		const input = screen.getByRole("spinbutton");
		await expect.element(input).toHaveValue(7);
	});

	it("shows validation error for out of range values", async () => {
		const screen = render(TableCell, {
			bytes,
			dtype: "u8",
			scale: 1,
			offset: 0,
			isEditing: true,
		});

		const input = screen.getByRole("spinbutton");
		await input.fill("300");

		const error = screen.getByText(/out of range/i);
		await expect.element(error).toBeVisible();
	});
});
