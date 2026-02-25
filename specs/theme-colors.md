# Theme Color Integration User Guide

## Overview

The Theme Color Integration feature makes tables and charts adapt to your active VSCode theme. Data visualizations now use colors from your theme's git status indicators (green, yellow, red) for gradients, providing a consistent and accessible experience that matches your preferred color scheme.

### Why Theme-Aware Colors?

- **Visual consistency**: Charts and tables match your VSCode theme automatically
- **Accessibility**: Respects your theme choice, including high contrast modes
- **Semantic meaning**: Colors have intuitive meaning (green=low, yellow=mid, red=high)
- **Automatic updates**: Colors change instantly when you switch themes
- **Better readability**: Colors are optimized for your theme's background

---

## How It Works

### Color Gradients

The extension uses your theme's **git status colors** to create data visualization gradients:

| Value Range | Color | Git Status | Meaning |
|-------------|-------|------------|---------|
| **Low values** | 🟢 Green | Added/New | Safe, low magnitude |
| **Mid values** | 🟡 Yellow | Modified | Moderate, attention |
| **High values** | 🔴 Red | Deleted/Warning | High magnitude, caution |

This creates an intuitive gradient where:
- **Green** represents low values (e.g., low fuel, low boost)
- **Yellow** represents medium values (e.g., moderate load)
- **Red** represents high values (e.g., high RPM, high timing)

### Theme Examples

**Dark Theme (Default Dark+)**:
- Low: Bright green (`#73C991`)
- Mid: Orange-yellow (`#E2C08D`)
- High: Coral red (`#F48771`)

**Light Theme (Default Light+)**:
- Low: Dark green (`#587c0c`)
- Mid: Brown-orange (`#895503`)
- High: Dark red (`#ad0707`)

**High Contrast Themes**:
- Uses high contrast variants of git colors
- Ensures maximum visibility and accessibility
- Respects WCAG contrast guidelines

---

## Automatic Theme Detection

### Theme Change Updates

The extension automatically detects when you change your VSCode theme and updates all visualizations immediately:

1. **Switch theme**: Use VSCode's theme picker (Ctrl/Cmd+K Ctrl/Cmd+T)
2. **Instant update**: All open tables and charts update their colors
3. **No reload needed**: Changes happen in real-time

### Supported Themes

The feature works with **all VSCode themes**, including:

- ✅ Built-in themes (Dark+, Light+, Dark High Contrast, Light High Contrast)
- ✅ Community themes from the marketplace
- ✅ Custom themes you create
- ✅ Theme extensions (Dracula, One Dark Pro, Solarized, etc.)

### What Gets Themed

**Data Visualizations**:
- Table cell background colors (heatmap gradients)
- Chart heatmap colors
- Color bars and legends

**UI Elements** (already themed):
- Backgrounds and borders
- Text colors
- Selection highlights
- Focus indicators
- Buttons and controls

---

## Visual Examples

### 2D Table Heatmap

**Dark Theme**:
```
Low values (green)  →  Mid values (yellow)  →  High values (red)
     🟢                      🟡                      🔴
  Cool colors            Warm colors           Hot colors
```

**Light Theme**:
```
Low values (dark green)  →  Mid values (brown)  →  High values (dark red)
        🟢                        🟤                       🔴
   Darker greens            Earth tones              Darker reds
```

### What You'll See

**Fuel Map Example** (2D table, RPM vs Load):
- **Low fuel values**: Green cells (lean mixture)
- **Target fuel values**: Yellow cells (stoichiometric)
- **Rich fuel values**: Red cells (rich mixture)

**Timing Map Example** (2D table, RPM vs Load):
- **Conservative timing**: Green cells (safe, retarded)
- **Moderate timing**: Yellow cells (balanced)
- **Aggressive timing**: Red cells (advanced, caution)

**Boost Map Example** (2D table, RPM vs Load):
- **Low boost**: Green cells (safe pressure)
- **Medium boost**: Yellow cells (moderate pressure)
- **High boost**: Red cells (maximum pressure)

---

## Fallback Behavior

### When Theme Colors Are Unavailable

If your theme doesn't define git status colors (rare), the extension falls back to a **default Viridis-inspired gradient**:

- Purple → Blue → Green → Yellow
- Scientifically designed for perceptual uniformity
- Works well on both dark and light backgrounds

### Custom Themes

If you're creating a custom theme, define these colors for best results:

```json
{
  "colors": {
    "gitDecoration.addedResourceForeground": "#your-green-color",
    "gitDecoration.modifiedResourceForeground": "#your-yellow-color",
    "gitDecoration.deletedResourceForeground": "#your-red-color"
  }
}
```

---

## Benefits

### Consistency

- **Unified experience**: All VSCode UI elements use the same color palette
- **Familiar colors**: Git status colors are already familiar from source control
- **Predictable**: Same color meanings across all tables and charts

### Accessibility

- **Theme respect**: Honors your accessibility preferences
- **High contrast support**: Works with high contrast themes for visual impairments
- **Color blindness**: Git colors are chosen to be distinguishable for most color vision types
- **Customizable**: Use any theme that works for your needs

### Usability

- **Intuitive**: Green/yellow/red is universally understood (traffic light metaphor)
- **Quick scanning**: Spot high/low values at a glance
- **Context-aware**: Colors adapt to your working environment (day/night themes)

---

## Frequently Asked Questions

### Can I customize the gradient colors?

The gradient colors come from your active VSCode theme. To change them:
1. Switch to a different theme, or
2. Create a custom theme with your preferred git decoration colors

### Do I need to reload after changing themes?

No! The extension detects theme changes automatically and updates all visualizations in real-time.

### What if I don't like the git status colors?

You can:
1. Choose a different VSCode theme with colors you prefer
2. Create a custom theme with your own color choices
3. The extension will always use your theme's colors

### Does this work with custom color themes?

Yes! The extension works with any VSCode theme, including:
- Marketplace themes
- Custom themes you create
- Theme extensions
- Modified built-in themes

### What about color blindness?

VSCode's git status colors are designed with accessibility in mind. For additional support:
- Use high contrast themes for maximum distinction
- Many themes offer color-blind friendly variants
- The semantic meaning (low/mid/high) is also conveyed by position in the gradient

### Can I disable theme colors and use the old gradient?

Currently, theme colors are always used when available. If you prefer the old Viridis gradient, you can use a theme that doesn't define git decoration colors (though this is rare).

---

## Technical Details

### Color Extraction

The extension reads these VSCode theme tokens:

- `gitDecoration.addedResourceForeground` - Green for low values
- `gitDecoration.modifiedResourceForeground` - Yellow for mid values  
- `gitDecoration.deletedResourceForeground` - Red for high values

### Gradient Interpolation

Colors are interpolated smoothly between the three stops:
- 0% (minimum value) → Green
- 50% (middle value) → Yellow
- 100% (maximum value) → Red

### Performance

- Theme colors are cached for performance
- Updates are debounced to avoid excessive re-renders
- No impact on table editing or chart rendering speed

---

## Related Documentation

- [Graph Visualization User Guide](graph-visualization-user-guide.md) - Learn about chart features
- [Architecture Specification](../plans/vscode-theme-color-integration.md) - Technical implementation details
- [VSCode Theme Documentation](https://code.visualstudio.com/api/references/theme-color) - VSCode theme color reference

---

## Feedback

If you have suggestions for improving the theme color integration, please:
- Open an issue on the project repository
- Describe your use case and theme preferences
- Include screenshots if possible

We're committed to making the extension accessible and usable for everyone!
