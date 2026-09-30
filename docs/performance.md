# Performance

Targeted and measured on GNOME Shell 51 (`Clutter.ShaderEffect`).

## Rendering Cost

Six windows, every one repainted every frame:

| | Paint per frame |
| --- | --- |
| No effect | 717.7 µs |
| Offscreen redirection only | 765.0 µs |
| Full effect | 884.3 µs |

Redirecting a window through a framebuffer costs ~7.9 µs. The shader and GJS paint handling add ~19.9 µs. Total is **~28 µs per window per frame**, about **1% of a 16.7 ms (60 Hz) frame budget**.

- **Idle windows cost 0**: `ClutterOffscreenEffect` reuses its framebuffer texture unless an actor is damaged.
- **Memory footprint**: ~2.1 MB of framebuffer memory per standard window (e.g. 855x655 texture for an 852x652 actor). Maximized and fullscreen windows detach the effect entirely, freeing framebuffer memory when windows are largest.

## Optimizations

### 1. Framebuffer Mapping Cache
Deriving the offscreen-to-actor mapping matrix requires actor bounds and paint volume checks. This mapping only changes when a window resizes or moves. A `get_target_size()` guard skips recalculation on clean frames:
- **Derivation on every paint**: 6.8 to 8.0 µs per window
- **Cached check**: **0.37 µs per window**

### 2. Uniform Packing
In GNOME 51, `Clutter.ShaderEffect` sets uniforms by name and re-uploads all uniforms on every paint frame. To minimize per-frame GPU state changes:
- Related values are packed into `vec4` vectors (`metrics`: radius, outline width, shadow offset x/y; `fboMap`: origin x/y, span x/y).
- Total uniform count was reduced from 11 down to 8.

### 3. Theme Resolution & Caching
Parsing the 431 KB libadwaita stylesheet (`adw-probe.js` output):
- **Cold parse**: ~11.8 ms
- **Warm parse (JIT)**: ~3.8 ms
- **Shadow compilation**: ~0.89 µs per call

Styles are cached in memory per variant (`dark`/`light`, high contrast) and keyed by stylesheet file modification stamps. Toggling dark mode or unlocking the screen reuses the cache without re-running the probe subprocess or re-parsing CSS.

### 4. Process Detection
Detection checks `/proc/<pid>/maps` once per window lifecycle for `libadwaita-1.so` and caches the boolean result in a `WeakMap`. Unreadable processes safely default to non-Adwaita.
