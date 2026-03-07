import type { Unit } from "@ecu-explorer/core";

export function formatUnit(unit: Unit | undefined): string {
	return unit?.symbol ?? "";
}
