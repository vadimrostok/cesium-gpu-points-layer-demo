# Cesium GPU Point Layer Demo

This demo shows a full Cesium scene rendered with `cesium-gpu-points-layer`, a high-performance
point rendering utility intended for dense 2D sprite-based point clouds.

The app renders three layers:

- aircraft (planes)
- ships
- earthquakes

The layers are ordered by draw command so objects are drawn in this sequence:
earthquakes → ships → planes.

## Run

```bash
npm run fetch:be-response
npm run prepare:globe-points
npm run dev
```

## Data flow

The demo keeps backend response handling out of the library:

- `scripts/fetch-be-response.mjs` downloads and saves `public/be-globe-response.json`.
- `scripts/prepare-globe-points.mjs` transforms raw records into compact `public/be-globe-layer-points.json`.
- `src/globe-data.ts` validates `PreparedGlobePoints` and basic `BasePointRecord` shape.

Library consumers only deal with already prepared records:

- `id: string`
- `longitude: number`
- `latitude: number`
- `altitudeMeters?: number`
- `headingRadians?: number`
- `speedMetersPerSecond?: number`

## Config highlights

- `drawOrder` controls layer stacking because depth test is disabled for performance.
- `rotationEnabled` toggles sprite rotation from heading.
- `enableAnimation` toggles motion extrapolation driven by `speedMetersPerSecond` + `headingRadians`.

## Library wiring (demo + lib split)

The demo consumes the reusable package from this sibling project:

```json
"cesium-gpu-points-layer": "file:../cesium-gpu-points-layer"
```

When publishing, replace that with the published package version (for example, `^0.1.0`).

In local development, keep the library built before running the demo:

```bash
cd <path-to-lib>/cesium-gpu-points-layer
npm install
cd <path-to-demo>/cesium-gpu-points-layer-demo
npm install
npm run dev
```

If you prefer explicit commands from the demo project root:

```bash
npm install
npm run build:lib
npm run dev
```

## Notes

This project is the demo companion and intentionally keeps only app-specific:

- Cesium scene setup
- data fetching/processing
- layer initialization and configuration
- overlay UI (FPS/status)

Reusable rendering logic lives in `cesium-gpu-points-layer`.
