# Spatial Bench tests

## Unit tests

No dependencies beyond Node 20 or newer.

    node --test spatial-tests/fea.test.mjs
    node --test spatial-tests/kernel.test.mjs

`fea.test.mjs` checks the solver against closed-form answers: a pulled bar, cantilevers in bending and under their own weight, a round rod, a rotated part, and both solvers against each other. `kernel.test.mjs` checks volumes, fusing and holes through the mesh kernel, and the 3MF and STL writers.

## End-to-end tests

These drive the real page in headless Chromium.

    npm install --no-save playwright iwer
    npx playwright install chromium
    node spatial-tests/e2e/screen.e2e.mjs
    node spatial-tests/e2e/headset.e2e.mjs

`screen.e2e.mjs` builds parts through the on-screen controls with mouse and touch, compares a cantilever with beam theory, exports and re-reads 3MF and STL, reloads offline, runs without the mesh kernel, and runs inside a sandboxed frame.

`headset.e2e.mjs` installs Meta's Immersive Web Emulation Runtime (IWER) so the page believes it is on a Quest 3, then moves emulated controllers and hands: taking shapes off the shelf, carrying, turning, stretching, every button, the bin, the bench knob, pinch and fingertip presses, leaving and re-entering.

What the emulator cannot show: comfort and reach, tracking jitter, how passthrough looks, and real frame rate. Those need a headset.

Screenshots go to the system temp folder under `whim-e2e`, or to `WHIM_E2E_OUT`.
