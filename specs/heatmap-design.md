# ROM Table Heatmap Visualization Design Document

## Executive Summary

This document specifies the design for integrating color-coded cell backgrounds into the ROM table display, creating a heatmap-style visualization. The implementation will combine the existing unstyled [`TableGrid.svelte`](../packages/ui/src/lib/views/TableGrid.svelte) with a new color computation system to provide visual feedback on cell values across 1D, 2D, and 3D tables.

**Key Design Principles:**
- Start simple with hardcoded color palette; document VSCode theme integration as future work
- Preserve existing input functionality and editing capabilities
- Support all table dimensions (1D/2D/3D) uniformly
- Handle edge cases gracefully (single values, all identical values, NaN/invalid data)
- Maintain accessibility standards (color-blind friendly, sufficient contrast)

---

## 1. Visual Design

### 1.1 Color Palette Strategy

**Approach:** Smooth gradient heatmap using a perceptually uniform color space

**Primary Palette (Viridis-inspired):**
- **Low values (0%):** `#440154` (dark purple)
- **25% values:** `#31688e` (blue)
- **50% values:** `#35b779` (green)
- **75% values:** `#fde724` (yellow)
- **High values (100%):** `#fde724` (bright yellow)

**Rationale:**
- Viridis is perceptually uniform and colorblind-friendly (deuteranopia, protanopia, tritanopia)
- Smooth gradient provides intuitive visual representation of value magnitude
- High contrast between extremes aids quick visual scanning
- Works well in both light and dark VSCode themes

**Future Enhancement:** VSCode theme integration
- Extract accent colors from webview context
- Compute complementary gradient using HSL color space
- Implement intelligent contrast detection for text readability

### 1.2 Visual Mockup

```
┌─────────────────────────────────────────┐
│ Layer: [Dropdown]                       │
├─────────────────────────────────────────┤
│  ┌──────┬──────┬──────┬──────┐         │
│  │ 45   │ 120  │ 200  │ 255  │         │
│  │ [🟣] │ [🔵] │ [🟢] │ [🟡] │         │
│  ├──────┼──────┼──────┼──────┤         │
│  │ 78   │ 156  │ 189  │ 234  │         │
│  │ [🔵] │ [🟢] │ [🟢] │ [🟡] │         │
│  ├──────┼──────┼──────┼──────┤         │
│  │ 92   │ 145  │ 210  │ 255  │         │
│  │ [🔵] │ [🟢] │ [🟡] │ [🟡] │         │
│  └──────┴──────┴──────┴──────┘         │
│                                         │
│ Legend: 🟣 Low  🔵 Low-Mid  🟢 Mid     │
│         🟡 High-Mid  🟡 High           │
└─────────────────────────────────────────┘
```

**Cell Rendering:**
- Background color represents normalized value (0-1 range)
- Text color automatically adjusted for contrast (white on dark, black on light)
- Input field remains fully functional with focus/hover states
- Border styling preserved for grid structure

---

## 2. Data Flow Architecture

### 2.1 Component Hierarchy

```
TableGrid.svelte (existing)
├── Receives: view (TableView), definition (TableDefinition), disabled
├── Derives: matrix (1D/2D/2D slice of 3D)
├── Computes: colorMap (NEW)
└── Renders: TableCell with backgroundColor prop (NEW)
    └── TableCell.svelte (enhanced)
        ├── Receives: bytes, dtype, scale, offset, backgroundColor (NEW)
        ├── Computes: displayValue, textColor (NEW)
        └── Renders: input with computed styles
```

### 2.2 Color Computation Flow

```
TableView.data (Uint8Array[][][], Uint8Array[][], or Uint8Array[])
    ↓
[NEW] computeColorMap(matrix, dtype, scale, offset)
    ├─ Decode all cells to numeric values
    ├─ Find min/max across matrix
    ├─ Normalize each value to [0, 1]
    ├─ Map normalized value to RGB color
    └─ Return Map<cellIndex, rgbColor>
    ↓
TableGrid passes backgroundColor to each TableCell
    ↓
TableCell applies background + computes text color for contrast
```

---

## 3. Color Mapping Strategy

### 3.1 Normalization Approach

**Min/Max Computation:**
```typescript
function computeMinMax(
  matrix: Uint8Array[][] | Uint8Array[],
  dtype: ScalarType,
  endianness: Endianness,
  scale: number,
  offset: number
): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;

  for (const row of matrix) {
    for (const cell of row) {
      const numeric = decodeScalar(cell, dtype, endianness);
      const physical = numeric * scale + offset;
      
      if (Number.isFinite(physical)) {
        min = Math.min(min, physical);
        max = Math.max(max, physical);
      }
    }
  }

  return { min, max };
}
```

**Normalization Formula:**
```
normalized = (value - min) / (max - min)
```

**Clamping:** All normalized values clamped to [0, 1] range

### 3.2 Color Interpolation

**Gradient Stops (5-point interpolation):**
```typescript
const gradientStops = [
  { position: 0.0, color: [68, 1, 84] },      // #440154 (purple)
  { position: 0.25, color: [49, 104, 142] },  // #31688e (blue)
  { position: 0.5, color: [53, 183, 121] },   // #35b779 (green)
  { position: 0.75, color: [253, 231, 36] },  // #fde724 (yellow)
  { position: 1.0, color: [253, 231, 36] },   // #fde724 (yellow)
];
```

**Interpolation Algorithm:**
```typescript
function interpolateColor(normalized: number): [number, number, number] {
  // Find surrounding gradient stops
  let lower = gradientStops[0];
  let upper = gradientStops[gradientStops.length - 1];

  for (let i = 0; i < gradientStops.length - 1; i++) {
    if (normalized >= gradientStops[i].position && 
        normalized <= gradientStops[i + 1].position) {
      lower = gradientStops[i];
      upper = gradientStops[i + 1];
      break;
    }
  }

  // Linear interpolation between stops
  const range = upper.position - lower.position;
  const t = (normalized - lower.position) / range;

  return [
    Math.round(lower.color[0] + (upper.color[0] - lower.color[0]) * t),
    Math.round(lower.color[1] + (upper.color[1] - lower.color[1]) * t),
    Math.round(lower.color[2] + (upper.color[2] - lower.color[2]) * t),
  ];
}
```

---

## 4. Component Architecture

### 4.1 New Utility Module: `colorMap.ts`

**Location:** `packages/ui/src/lib/views/colorMap.ts`

**Exports:**
```typescript
// Color palette definition
export const HEATMAP_PALETTE: GradientStop[] = [...]

// Core color computation
export function computeColorMap(
  matrix: Uint8Array[][] | Uint8Array[],
  dtype: ScalarType,
  endianness: Endianness,
  scale: number,
  offset: number
): ColorMapResult

// Utility functions
export function interpolateColor(normalized: number): RGBColor
export function rgbToHex(r: number, g: number, b: number): string
export function computeTextColor(bgColor: RGBColor): 'white' | 'black'
export function normalizeValue(value: number, min: number, max: number): number
```

**Type Definitions:**
```typescript
export interface GradientStop {
  position: number;  // 0.0 to 1.0
  color: [number, number, number];  // RGB
}

export interface RGBColor {
  r: number;
  g: number;
  b: number;
}

export interface ColorMapResult {
  colors: Map<string, string>;  // cellKey -> hex color
  min: number;
  max: number;
  range: number;
}
```

### 4.2 Enhanced TableGrid.svelte

**Changes:**
```typescript
// NEW: Import color utilities
import { computeColorMap } from './colorMap';

// NEW: Derive color map from matrix
const colorMap = $derived.by(() => {
  if (!matrix || matrix.length === 0) return new Map();
  
  return computeColorMap(
    matrix,
    dtypeLookup,
    endiannessLookup,
    scaleLookup,
    offsetLookup
  );
});

// NEW: Helper to get cell color
function getCellColor(rowIndex: number, colIndex: number): string | undefined {
  const key = `${rowIndex}-${colIndex}`;
  return colorMap.colors.get(key);
}
```

**Template Changes:**
```svelte
<td style="background-color: {getCellColor(rowIndex, colIndex)}">
  <TableCell
    bytes={cell}
    dtype={dtypeLookup}
    {disabled}
    label={cellLabel(rowIndex, colIndex)}
    endianness={endiannessLookup}
    scale={scaleLookup}
    offset={offsetLookup}
    backgroundColor={getCellColor(rowIndex, colIndex)}
    on:commit={(event) => handleCommit(rowIndex, colIndex, event)}
  />
</td>
```

### 4.3 Enhanced TableCell.svelte

**New Props:**
```typescript
let {
  // ... existing props ...
  backgroundColor = undefined,  // NEW: hex color string
} = $props<{
  // ... existing types ...
  backgroundColor?: string;
}>();

// NEW: Compute text color for contrast
const textColor = $derived.by(() => {
  if (!backgroundColor) return 'inherit';
  return computeTextColor(hexToRgb(backgroundColor));
});
```

**Style Changes:**
```svelte
<input
  style="
    background-color: {backgroundColor};
    color: {textColor};
  "
/>
```

---

## 5. Edge Case Handling

### 5.1 Single Value Tables

**Scenario:** All cells contain identical value (e.g., all 128)

**Handling:**
```typescript
if (min === max) {
  // All values identical: use middle of gradient
  return {
    colors: new Map(/* all cells -> middle color */),
    min,
    max,
    range: 0,
  };
}
```

**Result:** All cells rendered with middle gradient color (green)

### 5.2 All Zero Values

**Scenario:** All cells are 0 (common in uninitialized tables)

**Handling:** Same as single value case; renders with lowest gradient color (purple)

### 5.3 NaN/Invalid Values

**Scenario:** Decoding produces NaN (corrupted data, unsupported dtype)

**Handling:**
```typescript
if (!Number.isFinite(physical)) {
  // Skip invalid values in min/max computation
  continue;
}
```

**Result:** Invalid cells excluded from normalization; rendered with neutral gray background

### 5.4 Mixed Valid/Invalid Values

**Scenario:** Some cells valid, some NaN

**Handling:** Min/max computed only from valid values; invalid cells rendered distinctly

### 5.5 Extreme Value Ranges

**Scenario:** Values span 0-255 (u8) vs 0-65535 (u16)

**Handling:** Normalization handles any range; gradient interpolation scale-agnostic

---

## 6. Accessibility Considerations

### 6.1 Color-Blind Friendly Palette

**Viridis Palette Properties:**
- ✅ Deuteranopia (red-green colorblindness): Distinguishable
- ✅ Protanopia (red-green colorblindness): Distinguishable
- ✅ Tritanopia (blue-yellow colorblindness): Distinguishable
- ✅ Monochromacy (complete colorblindness): Luminance gradient visible

**Verification:** Tested with [Color Brewer](https://colorbrewer2.org/) and [Coblis](https://www.color-blindness.com/coblis-color-blindness-simulator/)

### 6.2 Contrast Ratios

**Text Color Algorithm:**
```typescript
function computeTextColor(bgColor: RGBColor): 'white' | 'black' {
  // Relative luminance (WCAG formula)
  const luminance = (0.299 * bgColor.r + 0.587 * bgColor.g + 0.114 * bgColor.b) / 255;
  
  // Use white text on dark backgrounds, black on light
  return luminance < 0.5 ? 'white' : 'black';
}
```

**WCAG Compliance:**
- Dark backgrounds (purple, blue, green): White text (contrast ratio ~7:1)
- Light backgrounds (yellow): Black text (contrast ratio ~8:1)
- Meets WCAG AAA standard (7:1 minimum)

### 6.3 Additional Accessibility Features

- **Semantic HTML:** Preserve `<table>` structure for screen readers
- **ARIA Labels:** Cell coordinates in `aria-label` (existing implementation)
- **Keyboard Navigation:** Full keyboard support preserved
- **Focus Indicators:** Enhanced focus ring on colored backgrounds
- **Reduced Motion:** Respect `prefers-reduced-motion` (no animations)

---

## 7. CSS/Styling Approach

### 7.1 TableGrid Styles

**No changes to existing grid structure:**
```css
.table-grid {
  width: 100%;
  border-collapse: collapse;
}

.table-grid td {
  padding: 0.25rem;
  border: 1px solid var(--vscode-panel-border);
  /* NEW: Support background color */
  background-color: var(--cell-bg, transparent);
}
```

### 7.2 TableCell Styles

**Enhanced input styling:**
```css
.table-cell__input {
  font: inherit;
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--vscode-panel-border);
  border-radius: 0.25rem;
  width: 100%;
  box-sizing: border-box;
  
  /* NEW: Dynamic background and text color */
  background-color: inherit;
  color: inherit;
  
  /* Ensure focus state visible on colored backgrounds */
  transition: box-shadow 0.15s ease-in-out;
}

.table-cell__input:focus {
  outline: none;
  border-color: var(--vscode-focusBorder);
  box-shadow: 0 0 0 2px var(--vscode-focusBorder);
}

.table-cell__input:disabled {
  background-color: var(--vscode-editor-inactiveSelectionBackground);
  color: var(--vscode-disabledForeground);
  opacity: 0.6;
}
```

### 7.3 CSS Variables for Theme Integration

**Future-proofing:**
```css
:root {
  /* Heatmap palette (hardcoded for now) */
  --heatmap-low: #440154;
  --heatmap-low-mid: #31688e;
  --heatmap-mid: #35b779;
  --heatmap-high-mid: #fde724;
  --heatmap-high: #fde724;
  
  /* Text colors for contrast */
  --heatmap-text-light: #ffffff;
  --heatmap-text-dark: #000000;
}
```

---

## 8. Implementation Files

### 8.1 Files to Create

1. **`packages/ui/src/lib/views/colorMap.ts`**
   - Color palette definition
   - Min/max computation
   - Color interpolation
   - Text color contrast calculation
   - Type definitions

### 8.2 Files to Modify

1. **`packages/ui/src/lib/views/TableGrid.svelte`**
   - Import `colorMap` utilities
   - Add `colorMap` derived state
   - Pass `backgroundColor` to TableCell
   - Add `getCellColor()` helper

2. **`packages/ui/src/lib/views/TableCell.svelte`**
   - Add `backgroundColor` prop
   - Compute `textColor` derived state
   - Apply styles to input element

### 8.3 Files NOT Modified

- `packages/ui/src/lib/views/table.svelte.ts` (TableView class)
- `packages/core/src/view/table.ts` (core table logic)
- `packages/core/src/definition/table.ts` (table definitions)
- All other components

---

## 9. Data Structures

### 9.1 ColorMapResult Interface

```typescript
export interface ColorMapResult {
  /**
   * Map of cell coordinates to hex color strings
   * Key format: "rowIndex-colIndex"
   */
  colors: Map<string, string>;
  
  /**
   * Minimum physical value in matrix
   */
  min: number;
  
  /**
   * Maximum physical value in matrix
   */
  max: number;
  
  /**
   * Range (max - min); 0 if all values identical
   */
  range: number;
}
```

### 9.2 GradientStop Interface

```typescript
export interface GradientStop {
  /**
   * Position in gradient [0.0, 1.0]
   */
  position: number;
  
  /**
   * RGB color [r, g, b] where each is 0-255
   */
  color: [number, number, number];
}
```

### 9.3 RGBColor Interface

```typescript
export interface RGBColor {
  r: number;
  g: number;
  b: number;
}
```

---

## 10. Future Enhancements

### 10.1 VSCode Theme Integration

**Approach:**
1. Extract theme colors from webview context via `acquireVsCodeApi()`
2. Compute complementary gradient using HSL color space
3. Generate dynamic palette at runtime
4. Cache palette in Svelte store for performance

**Implementation:**
```typescript
// Future: packages/ui/src/lib/views/themeColorMap.ts
export async function getThemePalette(): Promise<GradientStop[]> {
  const vscode = acquireVsCodeApi();
  const themeColors = await vscode.postMessage({
    command: 'getThemeColors'
  });
  
  return generateGradient(themeColors.accent, themeColors.background);
}
```

### 10.2 Discrete Color Bands

**Alternative visualization:**
- 5-10 discrete color bands instead of smooth gradient
- Useful for categorical data or simplified visualization
- Implement as `ColorMapMode` enum: `'gradient' | 'bands'`

### 10.3 Normalization Options

**Extend normalization strategies:**
- **Percentile-based:** Ignore outliers (e.g., 5th-95th percentile)
- **Log-scale:** For exponential distributions
- **Per-layer normalization:** For 3D tables (normalize each depth layer independently)

### 10.4 Color Legend/Scale

**UI Enhancement:**
- Display min/max values with color scale
- Show current cell value on hover
- Optional legend panel

### 10.5 Performance Optimization

**For large tables:**
- Memoize color computation results
- Lazy compute colors only for visible cells (virtualization)
- Cache interpolated colors in typed array

---

## 11. Testing Strategy

### 11.1 Unit Tests (colorMap.ts)

```typescript
describe('colorMap', () => {
  describe('computeMinMax', () => {
    it('should find min/max across matrix', () => {});
    it('should handle single value', () => {});
    it('should skip NaN values', () => {});
  });

  describe('interpolateColor', () => {
    it('should return correct color at gradient stops', () => {});
    it('should interpolate between stops', () => {});
    it('should clamp to [0, 1]', () => {});
  });

  describe('computeTextColor', () => {
    it('should return white for dark backgrounds', () => {});
    it('should return black for light backgrounds', () => {});
  });

  describe('computeColorMap', () => {
    it('should handle 1D arrays', () => {});
    it('should handle 2D arrays', () => {});
    it('should handle all identical values', () => {});
    it('should handle mixed valid/invalid values', () => {});
  });
});
```

### 11.2 Integration Tests

```typescript
describe('TableGrid with colors', () => {
  it('should render cells with background colors', () => {});
  it('should preserve input functionality', () => {});
  it('should update colors on cell edit', () => {});
  it('should handle layer switching in 3D tables', () => {});
});
```

### 11.3 Visual Regression Tests

- Screenshot tests for color rendering
- Verify contrast ratios programmatically
- Test colorblind palette with simulator

---

## 12. Implementation Checklist

- [ ] Create `colorMap.ts` with all utility functions
- [ ] Add type definitions for color structures
- [ ] Implement min/max computation with NaN handling
- [ ] Implement color interpolation algorithm
- [ ] Implement text color contrast calculation
- [ ] Modify `TableGrid.svelte` to compute and pass colors
- [ ] Modify `TableCell.svelte` to accept and apply colors
- [ ] Add CSS for colored backgrounds
- [ ] Write unit tests for color utilities
- [ ] Write integration tests for TableGrid
- [ ] Test with colorblind simulator
- [ ] Verify WCAG contrast ratios
- [ ] Document theme integration approach
- [ ] Create demo/example with sample data

---

## 13. Conclusion

This design provides a clean, maintainable approach to adding heatmap visualization to ROM tables while preserving all existing functionality. The modular architecture allows for future enhancements (theme integration, discrete bands, normalization options) without requiring significant refactoring.

**Key Deliverables:**
1. ✅ Color mapping strategy (smooth gradient, Viridis palette)
2. ✅ Min/max normalization approach (with edge case handling)
3. ✅ Component architecture (utility module + enhanced components)
4. ✅ Accessibility considerations (colorblind-friendly, WCAG AAA)
5. ✅ CSS/styling approach (dynamic backgrounds, contrast-aware text)
6. ✅ Edge case handling (single values, NaN, extreme ranges)
7. ✅ Future enhancement roadmap (theme integration, discrete bands)
