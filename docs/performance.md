# Performance

Measured on GNOME Shell 50.4, headless on a real GPU (gbm on `/dev/dri/renderD129`, not
llvmpipe), driving six GTK3 windows at 800x600.

## Cost

Six windows, every one fully repainted every frame. Far worse than any real desktop.

| | paint per frame |
| --- | --- |
| No effect | 717.7 us |
| Offscreen redirection only | 765.0 us |
| Full effect | 884.3 us |

Redirecting a window through a framebuffer costs 7.9 us per window. The shader and
JavaScript add 19.9 us. Total **27.8 us per window per frame, about 1% of a 16.7ms
frame**.

Repeat runs land between 26 and 28 us per window, so treat the last digit as noise rather
than precision. The split between redirection and shader is indicative, not exact: these
are CPU-side paint durations and GPU work is asynchronous, so some of the second figure is
backpressure.

Idle windows cost nothing. `ClutterOffscreenEffect` reuses its framebuffer unless the
actor is dirty, so the table above only happens if something really is redrawing
everything every frame.

Memory is about 2.1 MB of framebuffer per rounded window (855x655 for an 852x652 actor).
It scales with area, so a window covering a 4K monitor would want about 33 MB. Maximized
and fullscreen windows have no effect at all, which is what keeps that from happening.

## What changed

The first version derived the texture-to-actor mapping on every paint. Those values change
when the framebuffer resizes or the window moves, and almost never otherwise, so a single
`get_target_size()` call now guards the work.

| | before | after |
| --- | --- | --- |
| Per paint, per window | 6.8 to 8.0 us | **0.37 us** |
| Effect cost, six windows | 388.9 us (64.8 us/window) | **166.6 us (27.8 us/window)** |
| Theme resolution, repeated | 2909 us | **3.3 us** |

A 57% cut in per-frame cost. Both sides were measured the same way and the no-effect
baselines agree within 1% (710.3 against 717.7 us), so the comparison holds.

Theme resolution was the other one. Parsing 431 KB of GTK CSS costs about 10ms the first
time and 4ms once the JIT has seen it, measured under gjs on libadwaita's own stylesheet,
and a single theme change fires several signals. It is now cached per environment and
invalidated only by events that change the source text, so a GTK theme switch re-parses
but a dark mode toggle does not.

That cache also outlives a disable. GNOME switches extensions off whenever the screen
locks, and without this an unlock ran the whole startup again: an 80ms subprocess for the
libadwaita probe, then the parse, on the main loop while the unlock animation was still
going. Entries are keyed on the modification time and size of the files they came from,
imports included, so an edit made while the extension was disabled is still picked up.

## What was left alone

Uniform change-detection would skip seven of nine uploads during a resize. That is part of
12 us on a path that runs while you drag a window edge. Not worth the state.

A byte-level search of `/proc/<pid>/maps` would avoid decoding to a string. Real maps
files are 36 to 150 KB, not the megabytes that idea assumed, so decoding is already cheap
and happens once per window.

Shader micro-optimisation had nothing pointing at it.

## Method

Microbenchmarks call functions directly through an in-shell probe. End-to-end cost is
sampled between the stage's `before-paint` and `after-paint` with every window
force-damaged.

Two approaches failed first. Frame-interval timing reports 59.8 fps either way, because
both are vsync-capped with headroom. And single runs drift about 10% between sessions,
which is more than the thing being measured. The numbers above come from three interleaved
on/off repetitions in one session, which held the spread under 2%.

## Checking the instrument

Timings come from `GLib.get_monotonic_time()`. Sleeping for a known interval confirms the
unit:

| slept | monotonic delta | `Date.now()` delta |
| --- | --- | --- |
| 100 ms | 100120 | 100 ms |
| 250 ms | 250063 | 250 ms |
| 500 ms | 500095 | 501 ms |

Microseconds, to within 0.1%.

The paint signals fire once per frame, not more: a 15 second sample yields 901 of them,
which is 60.1 Hz against a 60 Hz virtual monitor.

For an independent check, the same test also reads `utime + stime` from
`/proc/<pid>/stat`, which is kernel accounting and shares no code with the paint timing.
Over 15 seconds:

| | paint timing | process CPU |
| --- | --- | --- |
| Effect on | 809.5 us/frame | 1320 ms |
| Effect off | 652.0 us/frame | 1170 ms |
| Difference | 157.5 us/frame | 150 ms |

157.5 us per frame at 60.1 fps over 15 seconds predicts 142 ms of extra CPU. The kernel
measured 150 ms. Two unrelated instruments agreeing within 6% is the reason to believe the
figure.

## Correctness after optimising

Twelve functional checks pass with zero JavaScript errors: effect on GTK3 and not on
libadwaita, removed and restored across maximize and fullscreen, high contrast and
light/dark resolving, a `gtk.css` override applying live and reverting, no leftover
effects after disable.

Corners re-checked by screenshot after five consecutive resizes, which is what would
expose a stale cached mapping. 15px renders at 15.0px, RMS deviation 0.0030 from the ideal
arc. At 200% scaling, 15.0 logical pixels, RMS 0.0197.

## One measurement that lied

A corner measured 0.1px, then 3.5px, which looked like the caching had broken rendering.

It had not. The isolated config still had `color-scheme prefer-dark` from an earlier run,
so the shell used `picture-uri-dark` and put a photo behind the window. Coverage
extraction reads the blue channel against a flat background, and photos have blue in them.

Reading the uniforms back off the GPU with a debug shader showed every one correct. The
harness was wrong, not the code.
