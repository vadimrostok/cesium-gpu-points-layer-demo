# Changelog

## 0.1.0

- Split rendering logic into a dedicated library package: `cesium-gpu-points-layer`.
- Updated demo project package name to `cesium-gpu-points-layer-demo`.
- Switched demo imports to consume the library package.
- Consolidated entity rendering into generic point layers backed by shared `BasePointRecord`.
- Added demo docs for data prep, startup flow, draw-order, and rotation/animation flags.
