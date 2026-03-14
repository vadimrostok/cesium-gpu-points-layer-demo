import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './styles.css';
import Stats from 'stats.js';
import { isPreparedGlobePoints, type PreparedGlobePoints } from './globe-data';
import { GpuPointLayer, type BasePointRecord } from './cesium/gpu-point-layer';

const STATUS_MESSAGE_ID = 'gpu-playground-status';
const HUD_ID = 'gpu-playground-hud';

const mount = async (): Promise<void> => {
  const host = document.getElementById('app');
  if (!host) {
    throw new Error('Root app container is missing.');
  }

  const hudEl = document.createElement('div');
  hudEl.id = HUD_ID;
  hudEl.className = 'gpu-playground-hud';
  host.appendChild(hudEl);

  const fpsCounter = new Stats();
  fpsCounter.showPanel(0);
  fpsCounter.dom.id = 'gpu-playground-fps';
  fpsCounter.dom.className = 'gpu-playground-stats';
  fpsCounter.dom.style.position = 'static';
  fpsCounter.dom.style.pointerEvents = 'none';
  hudEl.appendChild(fpsCounter.dom);

  const statusEl = document.createElement('div');
  statusEl.id = STATUS_MESSAGE_ID;
  statusEl.className = 'gpu-playground-status';
  statusEl.textContent = 'loading snapshot...';
  hudEl.appendChild(statusEl);

  const viewerHost = document.createElement('div');
  viewerHost.id = 'globe-host';
  host.appendChild(viewerHost);

  const viewer = new Cesium.Viewer(viewerHost, {
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    sceneModePicker: false,
    navigationHelpButton: true,
    fullscreenButton: true,
    infoBox: false,
    selectionIndicator: false,
    homeButton: false,
    shouldAnimate: true,
    useBrowserRecommendedResolution: false,
    msaaSamples: 2,
  });

  viewer.resolutionScale = 1;
  viewer.scene.globe.maximumScreenSpaceError = 1.5;
  viewer.scene.globe.depthTestAgainstTerrain = false;
  viewer.scene.screenSpaceCameraController.enableTilt = true;
  viewer.scene.screenSpaceCameraController.enableZoom = true;
  viewer.scene.screenSpaceCameraController.enableRotate = true;
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 30_000;
  viewer.scene.screenSpaceCameraController.maximumZoomDistance = 34_000_000;
  viewer.scene.globe.showGroundAtmosphere = true;
  viewer.scene.globe.enableLighting = true;
  viewer.scene.globe.dynamicAtmosphereLighting = true;
  viewer.scene.globe.dynamicAtmosphereLightingFromSun = true;
  viewer.scene.requestRenderMode = false;
  viewer.clock.shouldAnimate = true;
  viewer.clock.multiplier = 1;

  const onPostRender = (): void => {
    fpsCounter.update();
  };
  viewer.scene.postRender.addEventListener(onPostRender);

  const planeLayer = new GpuPointLayer<BasePointRecord>([], {
    name: 'PlaneLayer',
    textureName: 'plane',
    headingOffsetRadians: -Math.PI / 2,
    sprite: {
      url: '/svgs/medium-plane-2.svg',
      width: 80,
      height: 80,
      resolution: 2,
    },
    pointScale: 70_000_000,
    minPointSize: 30,
    maxPointSize: 128,
    maxExtrapolationSeconds: 60 * 60 * 24 * 365,
    defaultAltitudeMeters: 500,
    drawOrder: 2,
  });
  const shipLayer = new GpuPointLayer<BasePointRecord>([], {
    name: 'ShipLayer',
    textureName: 'ship',
    sprite: {
      url: '/svgs/ship.svg',
      width: 96,
      height: 96,
      resolution: 2,
    },
    pointScale: 40_000_000,
    rotationEnabled: false,
    enableAnimation: false,
    drawOrder: 1,
  });
  const earthquakeLayer = new GpuPointLayer<BasePointRecord>([], {
    name: 'EarthquakeLayer',
    textureName: 'earthquake',
    sprite: {
      url: '/svgs/earthquake.svg',
      width: 80,
      height: 80,
      resolution: 2,
    },
    pointScale: 40_000_000,
    minPointSize: 128,
    maxPointSize: 256,
    rotationEnabled: false,
    enableAnimation: false,
    drawOrder: 0,
  });

  [earthquakeLayer, shipLayer, planeLayer]
    .sort((left, right) => left.drawOrder - right.drawOrder)
    .forEach((layer: GpuPointLayer<BasePointRecord>) => {
      viewer.scene.primitives.add(layer.primitive);
    });

  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(10, 28, 20_000_000),
  });

  const applySnapshot = async (): Promise<void> => {
    const response = await fetch('/be-globe-layer-points.json');
    if (!response.ok) {
      throw new Error(`Failed to load snapshot: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as PreparedGlobePoints;
    if (!isPreparedGlobePoints(payload)) {
      throw new Error('Snapshot does not contain a valid prepared layer payload.');
    }

    planeLayer.setRecords(payload.planes);
    shipLayer.setRecords(payload.ships);
    earthquakeLayer.setRecords(payload.earthquakes);
    statusEl.textContent =
      `records: ${payload.planes.length + payload.ships.length + payload.earthquakes.length} (aircraft ${payload.planes.length}, ships ${payload.ships.length}, earthquakes ${payload.earthquakes.length})`;
  };

  try {
    await applySnapshot();
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    console.error('[gpu-playground] failed to load static snapshot', details);
    statusEl.textContent = 'failed to load /be-globe-layer-points.json';
  }

  const cleanup = (): void => {
    viewer.scene.postRender.removeEventListener(onPostRender);
    viewer.destroy();
    window.removeEventListener('beforeunload', cleanup);
  };

  window.addEventListener('beforeunload', cleanup);
};

void mount();
