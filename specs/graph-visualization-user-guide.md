# Graph Visualization User Guide

## Overview

The Graph Visualization feature provides interactive charts for visualizing ROM table data. View your calibration tables as line plots, heatmaps, or layer views with real-time updates, zoom/pan controls, and seamless integration with the table grid.

### Why Use Graph Visualization?

- **Visual patterns**: Spot trends, anomalies, and patterns in your data at a glance
- **Interactive exploration**: Zoom, pan, and hover to explore data in detail
- **Cell selection**: Click on chart points to select cells in the grid
- **Real-time updates**: Charts update instantly as you edit table values
- **Multiple views**: Switch between different chart types for different perspectives

---

## Getting Started

### Opening Graphs

To open a graph for a table, you have several options:

1. **Open Graph Button**: Click the "📈 Open Graph" button in the table toolbar
2. **Keyboard Shortcut**: Press **Ctrl+Shift+G** (Windows/Linux) or **Cmd+Shift+G** (macOS)
3. **Command Palette**: Open the command palette (Ctrl+Shift+P) and search for "Open Graph"
4. **Context Menu**: Right-click on a table in the sidebar and select "Open Graph"

**Keyboard Shortcut**: `Ctrl/Cmd + Shift + G` - Open graph in separate window

### Separate Windows

Graphs now open in separate editor tabs, providing several benefits:

- **Multi-monitor support**: Drag graph tabs to a separate monitor
- **Flexible layouts**: Arrange table and graph side-by-side, stacked, or in any layout
- **Independent scrolling**: Scroll and zoom the graph without affecting the table
- **Multiple graphs**: Open graphs for multiple tables simultaneously
- **Persistent state**: Graph state is preserved when closing and reopening

**Synchronization**:
- Graphs automatically update when you edit table values
- Cell selection is synchronized between table and graph
- Changes are reflected in real-time across all open views

---

## Chart Types

### 1D Tables: Line Plots

**Purpose**: Visualize single-row or single-column data as a line graph

**Features**:
- X axis: Axis values (e.g., RPM, load) or indices
- Y axis: Table values (e.g., AFR, timing)
- Line connecting data points
- Markers at each data point
- Axis labels with units

**Example Use Cases**:
- Fuel trim vs RPM
- Boost target vs load
- Timing advance vs RPM

**Interactions**:
- Click on a point to select that cell in the grid
- Hover over a point to see exact values
- Zoom in/out to focus on specific ranges
- Pan left/right to explore different sections

### 2D Tables: Heatmaps

**Purpose**: Visualize two-dimensional data as a color-coded heatmap

**Features**:
- X axis: Column axis values (e.g., RPM)
- Y axis: Row axis values (e.g., load)
- Color gradient: Represents table values
- Color bar: Shows value-to-color mapping
- Grid lines: Optional overlay for cell boundaries

**Example Use Cases**:
- Fuel map (RPM vs load)
- Ignition timing map
- Boost control map

**Interactions**:
- Click on a cell to select it in the grid
- Hover over a cell to see X, Y, and Z values
- Zoom in/out to focus on specific regions
- Pan to explore different areas of the map

**Color Gradient**:
- Blue: Low values
- Green: Medium-low values
- Yellow: Medium-high values
- Red: High values

### 3D Tables: Layer Views

**Purpose**: Visualize three-dimensional data as multiple 2D heatmap layers

**Features**:
- Each layer is a 2D heatmap
- Layer selector to switch between layers
- Layer names from axis labels (e.g., "Octane 91", "Octane 93")
- Same heatmap features as 2D tables

**Example Use Cases**:
- Fuel maps with octane variants
- Timing maps with temperature compensation
- Multi-dimensional boost control

**Interactions**:
- Use layer selector to switch between layers
- Click "Previous Layer" / "Next Layer" buttons
- All 2D heatmap interactions apply to each layer

**Keyboard Shortcuts**:
- `Ctrl/Cmd + ↑` - Previous layer
- `Ctrl/Cmd + ↓` - Next layer

---

## Interactive Controls

### Zoom Controls

**Zoom In**: Click the **+** button or press `+` key
- Increases magnification by 20%
- Centers on current view
- Maximum zoom: 5x

**Zoom Out**: Click the **-** button or press `-` key
- Decreases magnification by 20%
- Centers on current view
- Minimum zoom: 1x (fit to view)

**Reset Zoom**: Click the **Reset** button or press `0` key
- Returns to 1x zoom (fit to view)
- Resets pan position to center

**Mouse Wheel Zoom**:
- Scroll up to zoom in
- Scroll down to zoom out
- Zooms toward cursor position

### Pan Controls

**Arrow Buttons**: Click directional arrows to pan
- Up/Down: Pan vertically
- Left/Right: Pan horizontally
- Pan step: 10% of view

**Keyboard Pan**:
- `↑` - Pan up
- `↓` - Pan down
- `←` - Pan left
- `→` - Pan right

**Mouse Drag Pan**:
- Click and drag on chart to pan
- Works in any direction
- Smooth continuous panning

### Layer Selector (3D Tables Only)

**Purpose**: Switch between layers in 3D tables

**Controls**:
- **Previous Layer** button: Go to previous layer
- **Next Layer** button: Go to next layer
- **Layer name display**: Shows current layer name

**Keyboard Shortcuts**:
- `Ctrl/Cmd + ↑` - Previous layer
- `Ctrl/Cmd + ↓` - Next layer

### View Options

**Grid Toggle**: Show/hide grid lines on chart
- Checkbox in controls panel
- Helps align with cell boundaries
- Default: On

**Chart Type Selector**: Switch between chart types (future feature)
- Line plot
- Heatmap
- Surface plot (3D)

---

## Hover Tooltips

### What They Show

Hover over any chart element to see a tooltip with:

- **X axis value**: With label and unit (e.g., "RPM: 3000 rpm")
- **Y axis value**: With label and unit (e.g., "Load: 80 %")
- **Z value**: Table value with label and unit (e.g., "AFR: 14.7 ratio")
- **Cell coordinates**: Row and column indices

### Tooltip Behavior

- **Appears**: When hovering over chart elements
- **Follows cursor**: Positioned near mouse pointer
- **Smooth transitions**: Fades in/out smoothly
- **Auto-hide**: Disappears when cursor leaves chart

### Value Formatting

- **Small numbers** (< 0.001): Scientific notation (e.g., 1.23e-4)
- **Large numbers** (> 1,000,000): Scientific notation (e.g., 1.23e6)
- **Normal numbers**: Fixed precision (e.g., 14.70)
- **Special values**: "N/A" for NaN, "∞" for infinity

---

## Cell Selection Integration

### Click to Select

Click on any chart element to select the corresponding cell in the table grid:

- **1D charts**: Click on a point to select that cell
- **2D charts**: Click on a heatmap cell to select it
- **3D charts**: Click on a cell in the current layer

### Visual Feedback

- **Selected cell**: Highlighted in both grid and chart
- **Synchronized**: Selection updates in both views
- **Multi-select**: Use Shift+Click in grid for range selection

### Editing from Chart

1. Click on a chart element to select the cell
2. The grid scrolls to show the selected cell
3. Edit the cell value in the grid
4. Chart updates in real-time

---

## Real-Time Updates

### Automatic Chart Updates

Charts update automatically when:

- **Cell edited**: Single cell value changed
- **Multi-cell edit**: Multiple cells changed at once
- **Math operation**: Add, multiply, clamp, smooth, interpolate
- **Undo/redo**: Reverting or reapplying changes
- **Paste**: Clipboard data pasted into cells

### Update Performance

- **Debounced**: Updates debounced by 100ms to prevent excessive redraws
- **Efficient**: Only redraws affected chart elements
- **Smooth**: No flickering or lag during updates

### Large Dataset Optimization

For tables with more than 10,000 data points:

- **Downsampling**: Automatically reduces data points for rendering
- **Preserves shape**: Maintains visual appearance of data
- **Fast rendering**: Ensures smooth interactions
- **Full data**: Original data unchanged, only display is optimized

---

## Keyboard Shortcuts

### Complete Shortcut Reference

| Shortcut | Action | Context |
|----------|--------|---------|
| `Ctrl/Cmd + Shift + G` | Open graph in separate window | Any table |
| `+` or `=` | Zoom in | Chart visible |
| `-` or `_` | Zoom out | Chart visible |
| `0` | Reset zoom | Chart visible |
| `↑` | Pan up | Chart visible |
| `↓` | Pan down | Chart visible |
| `←` | Pan left | Chart visible |
| `→` | Pan right | Chart visible |
| `Ctrl/Cmd + ↑` | Previous layer | 3D table |
| `Ctrl/Cmd + ↓` | Next layer | 3D table |

### Keyboard Navigation Tips

- **Focus**: Click on chart to focus for keyboard shortcuts
- **Modifiers**: Hold Ctrl/Cmd for layer navigation
- **Arrow keys**: Work without modifiers for pan
- **Zoom keys**: Work without modifiers for zoom

---

## Tips & Tricks

### Best Practices

1. **Use zoom for precision**: Zoom in to see fine details in your data
2. **Pan to explore**: Pan around to explore different regions
3. **Click to edit**: Click on chart points to quickly jump to cells
4. **Watch for patterns**: Look for smooth gradients vs sharp transitions
5. **Compare layers**: Switch between 3D layers to compare variants

### Performance Tips

1. **Close graph when not needed**: Close the graph editor tab to free up resources
2. **Arrange windows**: Use VSCode's layout features to arrange table and graph optimally
3. **Large tables**: Chart automatically optimizes for tables >10,000 points
4. **Smooth operations**: Math operations update chart smoothly

### Workflow Suggestions

**Editing Workflow**:
1. Open graph in separate window (Ctrl+Shift+G)
2. Arrange table and graph side-by-side
3. Identify areas that need adjustment in the graph
4. Click on chart to select cells
5. Edit values in the table grid
6. Watch graph update in real-time
7. Use zoom to verify changes

**Analysis Workflow**:
1. Open graph for visual overview
2. Arrange windows for optimal viewing
3. Zoom in on areas of interest
4. Hover to see exact values
5. Compare with expected patterns
6. Use layer selector for 3D tables
7. Export to CSV for external analysis

---

## Troubleshooting

### Graph Not Opening

**Problem**: Graph window doesn't open when pressing Ctrl/Cmd+Shift+G

**Solutions**:
- Ensure a table is open in the editor
- Check that the table has data (not empty)
- Try closing and reopening the ROM file
- Check the Output panel for errors (View > Output > ECU Explorer)

### Graph Not Updating

**Problem**: Graph doesn't update after editing cells

**Solutions**:
- Wait 100ms for debounced update
- Check that graph window is visible
- Try closing and reopening the graph
- Verify cell edit was committed (press Enter)

### Performance Issues

**Problem**: Graph is slow or laggy

**Solutions**:
- Close graph window when not needed
- For very large tables (>50,000 points), downsampling is automatic
- Close other editor tabs to free memory
- Restart VSCode if performance degrades

### Zoom/Pan Not Working

**Problem**: Zoom or pan controls don't respond

**Solutions**:
- Click on chart to focus it
- Check that zoom level isn't at min/max
- Try reset zoom (press 0)
- Verify keyboard shortcuts aren't conflicting with browser

### Tooltip Not Showing

**Problem**: Hover tooltip doesn't appear

**Solutions**:
- Ensure mouse is over chart elements (points, cells)
- Check that chart is fully loaded
- Try moving mouse slowly over chart
- Verify browser supports CSS transitions

### Layer Selector Missing

**Problem**: Layer selector doesn't appear for 3D table

**Solutions**:
- Verify table is actually 3D (has Z axis)
- Check that table definition includes layer names
- Try closing and reopening the graph
- Verify graph window is visible

---

## Advanced Features

### Downsampling

For large datasets (>10,000 points), the chart automatically downsamples data for performance:

- **Algorithm**: Largest-triangle-three-buckets (LTTB)
- **Preserves shape**: Maintains visual appearance
- **Configurable**: Threshold can be adjusted in code
- **Transparent**: Happens automatically, no user action needed

### Canvas Rendering

Charts use HTML5 Canvas for rendering:

- **Performance**: Faster than SVG for large datasets
- **Smooth**: Hardware-accelerated rendering
- **Interactive**: Full support for click, hover, zoom, pan
- **Responsive**: Adapts to container size

### Lazy Loading

Plotly.js library is loaded lazily:

- **On-demand**: Only loaded when chart view is first opened
- **Cached**: Loaded once per session
- **Fast**: Doesn't slow down initial page load
- **Fallback**: Shows loading indicator while loading

---

## Related Documentation

- [`specs/graph-visualization.md`](graph-visualization.md) - Technical specification
- [`specs/heatmap-design.md`](heatmap-design.md) - Heatmap design details
- [`plans/graph-visualization-architecture.md`](../plans/graph-visualization-architecture.md) - Architecture design
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) - System architecture
- [`DEVELOPMENT.md`](../DEVELOPMENT.md) - Development status

---

## Feedback and Support

If you encounter issues or have suggestions for the graph visualization feature:

1. Check this guide for troubleshooting steps
2. Review the technical specification for implementation details
3. Check known issues in [`specs/KNOWN_ISSUES.md`](KNOWN_ISSUES.md)
4. Report bugs or request features via GitHub issues

---

**Last Updated**: 2026-02-14  
**Version**: v0.7  
**Status**: Complete ✅

**Note**: This guide has been updated to reflect the new separate graph windows feature. Graphs now open in separate editor tabs instead of a split view within the table editor.
