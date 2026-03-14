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

The demo consumes the reusable package from npm:

```json
"cesium-gpu-points-layer": "^0.2.0"
```

If you use a different package version, pin it to that semver range.

Set `VITE_PAGES_BASE_PATH` if you host the demo outside:

```bash
VITE_PAGES_BASE_PATH=/some-subpath/
npm run build
```

In local development against the sibling library repo, use:

```bash
cd <path-to-lib>/cesium-gpu-points-layer
npm install
cd <path-to-demo>/cesium-gpu-points-layer-demo
npm install ../cesium-gpu-points-layer
npm run dev
```

If you prefer explicit commands from the demo project root:

```bash
cd <path-to-lib>/cesium-gpu-points-layer
npm run build
cd <path-to-demo>/cesium-gpu-points-layer-demo
npm install
npm install ../cesium-gpu-points-layer
npm run build
npm run dev
```

### Deployment checklist (GitHub Pages)

```bash
npm install
npm run build
git push origin main
```

GitHub Actions workflow (`.github/workflows/gh-pages.yml`) uploads `dist/` and deploys it to Pages using
`actions/upload-pages-artifact` + `actions/deploy-pages`.
Before first deploy, enable Pages in repository settings:

- Settings → Pages → Build and deployment → Source: `GitHub Actions`.

## Notes

This project is the demo companion and intentionally keeps only app-specific:

- Cesium scene setup
- data fetching/processing
- layer initialization and configuration
- overlay UI (FPS/status)

Reusable rendering logic lives in `cesium-gpu-points-layer`.

## Common debug for Pages

- If sprites or data are 404, verify requests include the repo base path (for example:
  `/cesium-gpu-points-layer-demo/svgs/...`).
- If Cesium assets fail, confirm `CESIUM_BASE_URL` resolves to `/cesium-gpu-points-layer-demo/cesium`.
