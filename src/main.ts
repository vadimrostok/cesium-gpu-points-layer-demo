import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import './styles.css';
import Stats from 'stats.js';
import { BillboardRenderer, type LayerDefinition, type RecordType } from './billboard-renderer';
import { isPreparedGlobePoints, type PreparedGlobePoints } from './globe-data';
import { GpuPointLayer, type BasePointRecord } from 'cesium-gpu-points-layer';

const STATUS_MESSAGE_ID = 'gpu-playground-status';
const HUD_ID = 'gpu-playground-hud';
const DEFAULT_TIME_SPEED = 1;

type RenderMode = 'gpu' | 'billboard';
type PerformanceMode = 'high' | 'mid' | 'low';
type EntityMultiplier = 1 | 2 | 3 | 5 | 10 | 30;

const ENTITY_MULTIPLIER_OPTIONS: ReadonlyArray<EntityMultiplier> = [1, 2, 3, 5, 10, 30];

interface PerformanceProfile {
  resolutionScale: number;
  maximumScreenSpaceError: number;
  pointSizeScale: number;
}

const DEFAULT_MIN_POINT_SIZE = 30;
const DEFAULT_MAX_POINT_SIZE = 128;

interface TimeSpeedOption {
  label: string;
  value: number;
}

interface GpuLayerHandle {
  type: RecordType;
  layer: GpuPointLayer<BasePointRecord>;
}

const TIME_SPEED_OPTIONS: ReadonlyArray<TimeSpeedOption> = [
  { label: 'x1', value: 1 },
  { label: 'x100', value: 100 },
  { label: 'x1000', value: 1_000 },
  { label: 'x10000', value: 10_000 },
];

const PERFORMANCE_PROFILES: Record<PerformanceMode, PerformanceProfile> = {
  high: {
    resolutionScale: window.devicePixelRatio || 1,
    maximumScreenSpaceError: 1,
    pointSizeScale: window.devicePixelRatio || 1,
  },
  mid: {
    resolutionScale: 1,
    maximumScreenSpaceError: 2,
    pointSizeScale: 1,
  },
  low: {
    resolutionScale: 0.5,
    maximumScreenSpaceError: 4,
    pointSizeScale: 0.5,
  },
};

const PERFORMANCE_STORAGE_KEY = 'gpu-playground-performance';
const ALIGN_WITH_GROUND_STORAGE_KEY = 'gpu-playground-align-with-ground';
const ENTITY_MULTIPLIER_STORAGE_KEY = 'gpu-playground-entity-multiplier';

const readStorageValue = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStorageValue = (key: string, value: string): void => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore storage failures so rendering still works when storage is unavailable
  }
};

const readPerformanceMode = (): PerformanceMode => {
  const storedValue = readStorageValue(PERFORMANCE_STORAGE_KEY);
  return storedValue === 'mid' || storedValue === 'low' || storedValue === 'high'
    ? storedValue
    : 'high';
};

const readAlignWithGround = (): boolean => {
  const storedValue = readStorageValue(ALIGN_WITH_GROUND_STORAGE_KEY);
  return storedValue === 'on';
};

const writePerformanceMode = (mode: PerformanceMode): void => writeStorageValue(PERFORMANCE_STORAGE_KEY, mode);
const writeAlignWithGround = (alignWithGround: boolean): void =>
  writeStorageValue(ALIGN_WITH_GROUND_STORAGE_KEY, alignWithGround ? 'on' : 'off');

const readEntityMultiplier = (): EntityMultiplier => {
  const storedValue = readStorageValue(ENTITY_MULTIPLIER_STORAGE_KEY);
  const parsed = Number(storedValue);
  return ENTITY_MULTIPLIER_OPTIONS.includes(parsed as EntityMultiplier) ? parsed as EntityMultiplier : 1;
};

const writeEntityMultiplier = (multiplier: EntityMultiplier): void => {
  writeStorageValue(ENTITY_MULTIPLIER_STORAGE_KEY, String(multiplier));
};

const normalizeLongitude = (longitude: number): number => {
  let normalized = longitude % 360;
  if (normalized > 180) {
    normalized -= 360;
  } else if (normalized < -180) {
    normalized += 360;
  }
  return normalized;
};

const normalizeLatitude = (latitude: number): number => {
  let normalized = latitude;
  while (normalized > 90 || normalized < -90) {
    if (normalized > 90) {
      normalized = 180 - normalized;
    } else if (normalized < -90) {
      normalized = -180 - normalized;
    }
  }
  return normalized;
};

const expandEntityMultiplierRecords = (
  records: ReadonlyArray<BasePointRecord>,
  multiplier: EntityMultiplier,
): Array<BasePointRecord> => {
  if (multiplier <= 1) {
    return [...records];
  }

  const output: Array<BasePointRecord> = [];
  const shiftStep = 360 / multiplier;

  for (const record of records) {
    for (let copyIndex = 0; copyIndex < multiplier; copyIndex += 1) {
      const shift = shiftStep * copyIndex;
      if (copyIndex === 0) {
        output.push(record);
        continue;
      }

      output.push({
        ...record,
        id: `${record.id}#x${multiplier}-${copyIndex}`,
        latitude: normalizeLatitude(record.latitude + shift),
        longitude: normalizeLongitude(record.longitude + shift),
      });
    }
  }

  return output;
};

const LAYERS: Array<LayerDefinition> = [
  {
    type: 'earthquake',
    label: 'EarthquakeLayer',
    textureName: 'earthquake',
    spritePath: 'svgs/earthquake.svg',
    spriteWidth: 256,
    spriteHeight: 256,
    pointScale: 40_000_000,
    minPointSize: 128,
    maxPointSize: 256,
    rotationEnabled: false,
    enableAnimation: false,
    headingOffsetRadians: 0,
    defaultAltitudeMeters: 1_000,
    drawOrder: 0,
  },
  {
    type: 'ship',
    label: 'ShipLayer',
    textureName: 'ship',
    spritePath: 'svgs/ship.svg',
    spriteWidth: 192,
    spriteHeight: 192,
    pointScale: 100_000_000,
    minPointSize: 30,
    maxPointSize: 192,
    rotationEnabled: false,
    enableAnimation: false,
    headingOffsetRadians: 0,
    defaultAltitudeMeters: 1_000,
    drawOrder: 1,
  },
  {
    type: 'aircraft',
    label: 'PlaneLayer',
    textureName: 'plane',
    spritePath: 'svgs/medium-plane-2.svg',
    spriteWidth: 128,
    spriteHeight: 128,
    pointScale: 70_000_000,
    minPointSize: 30,
    maxPointSize: 128,
    rotationEnabled: true,
    enableAnimation: true,
    headingOffsetRadians: -Math.PI / 2,
    defaultAltitudeMeters: 500,
    drawOrder: 2,
  },
];


const mount = async (): Promise<void> => {
  const assetUrl = (path: string): string =>
    `${import.meta.env.BASE_URL}${path.startsWith('/') ? path.substring(1) : path}`;

  const host = document.getElementById('app');
  if (!host) {
    throw new Error('Root app container is missing.');
  }

  const hudEl = document.createElement('div');
  hudEl.id = HUD_ID;
  hudEl.className = 'gpu-playground-hud';
  host.appendChild(hudEl);

  const controlRow = document.createElement('div');
  controlRow.className = 'gpu-playground-controls';

  const modeLabel = document.createElement('label');
  modeLabel.textContent = 'Renderer';
  modeLabel.setAttribute('for', 'gpu-playground-render-mode');
  controlRow.appendChild(modeLabel);

  const modeSelector = document.createElement('select');
  modeSelector.id = 'gpu-playground-render-mode';
  modeSelector.className = 'gpu-playground-select';
  const gpuModeOption = document.createElement('option');
  gpuModeOption.value = 'gpu';
  gpuModeOption.textContent = 'GPU points (default)';
  const billboardModeOption = document.createElement('option');
  billboardModeOption.value = 'billboard';
  billboardModeOption.textContent = 'Cesium Billboards';
  modeSelector.append(gpuModeOption, billboardModeOption);
  modeSelector.value = 'gpu';
  controlRow.appendChild(modeSelector);

  const performanceLabel = document.createElement('label');
  performanceLabel.textContent = 'Performance';
  performanceLabel.setAttribute('for', 'gpu-playground-performance-mode');
  controlRow.appendChild(performanceLabel);

  const performanceSelector = document.createElement('select');
  performanceSelector.id = 'gpu-playground-performance-mode';
  performanceSelector.className = 'gpu-playground-select';
  const highPerformanceOption = document.createElement('option');
  highPerformanceOption.value = 'high';
  highPerformanceOption.textContent = 'high';
  const midPerformanceOption = document.createElement('option');
  midPerformanceOption.value = 'mid';
  midPerformanceOption.textContent = 'mid';
  const lowPerformanceOption = document.createElement('option');
  lowPerformanceOption.value = 'low';
  lowPerformanceOption.textContent = 'low';
  performanceSelector.append(highPerformanceOption, midPerformanceOption, lowPerformanceOption);
  performanceSelector.value = readPerformanceMode();
  controlRow.appendChild(performanceSelector);

  const entityMultiplierLabel = document.createElement('label');
  entityMultiplierLabel.textContent = 'Entities multiplier';
  entityMultiplierLabel.setAttribute('for', 'gpu-playground-entity-multiplier');
  controlRow.appendChild(entityMultiplierLabel);

  const entityMultiplierSelector = document.createElement('select');
  entityMultiplierSelector.id = 'gpu-playground-entity-multiplier';
  entityMultiplierSelector.className = 'gpu-playground-select';
  for (const value of ENTITY_MULTIPLIER_OPTIONS) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = `x${value}`;
    entityMultiplierSelector.append(option);
  }
  entityMultiplierSelector.value = String(readEntityMultiplier());
  controlRow.appendChild(entityMultiplierSelector);

  const alignWithGroundControl = document.createElement('div');
  alignWithGroundControl.style.display = 'flex';
  alignWithGroundControl.style.alignItems = 'center';
  alignWithGroundControl.style.gap = '8px';

  const alignWithGroundLabel = document.createElement('label');
  alignWithGroundLabel.textContent = 'Align with ground';
  alignWithGroundLabel.setAttribute('for', 'gpu-playground-align-with-ground');
  alignWithGroundControl.appendChild(alignWithGroundLabel);

  const alignWithGroundSelector = document.createElement('select');
  alignWithGroundSelector.id = 'gpu-playground-align-with-ground';
  alignWithGroundSelector.className = 'gpu-playground-select';
  const alignWithGroundOnOption = document.createElement('option');
  alignWithGroundOnOption.value = 'on';
  alignWithGroundOnOption.textContent = 'On';
  const alignWithGroundOffOption = document.createElement('option');
  alignWithGroundOffOption.value = 'off';
  alignWithGroundOffOption.textContent = 'Off';
  alignWithGroundSelector.append(alignWithGroundOnOption, alignWithGroundOffOption);
  alignWithGroundSelector.value = readAlignWithGround() ? 'on' : 'off';
  alignWithGroundControl.appendChild(alignWithGroundSelector);
  controlRow.appendChild(alignWithGroundControl);

  const timeSpeedLabel = document.createElement('label');
  timeSpeedLabel.textContent = 'Time speed';
  timeSpeedLabel.setAttribute('for', 'gpu-playground-time-speed');
  controlRow.appendChild(timeSpeedLabel);

  const timeSpeedSelector = document.createElement('select');
  timeSpeedSelector.id = 'gpu-playground-time-speed';
  timeSpeedSelector.className = 'gpu-playground-select';
  for (const option of TIME_SPEED_OPTIONS) {
    const optionElement = document.createElement('option');
    optionElement.value = String(option.value);
    optionElement.textContent = option.label;
    if (option.value === DEFAULT_TIME_SPEED) {
      optionElement.selected = true;
    }
    timeSpeedSelector.appendChild(optionElement);
  }
  controlRow.appendChild(timeSpeedSelector);

  const statusEl = document.createElement('div');
  statusEl.id = STATUS_MESSAGE_ID;
  statusEl.className = 'gpu-playground-status';
  statusEl.textContent = 'loading snapshot...';

  const fpsCounter = new Stats();
  fpsCounter.showPanel(0);
  fpsCounter.dom.id = 'gpu-playground-fps';
  fpsCounter.dom.className = 'gpu-playground-stats';
  fpsCounter.dom.style.position = 'static';
  fpsCounter.dom.style.pointerEvents = 'none';

  hudEl.append(controlRow, statusEl, fpsCounter.dom);

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

  viewer.scene.globe.maximumScreenSpaceError = PERFORMANCE_PROFILES.high.maximumScreenSpaceError;
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
  const getWallClockSeconds = (): number => performance.now() / 1000;
  let timeSpeedMultiplier = DEFAULT_TIME_SPEED;
  let playbackStartWallSeconds = getWallClockSeconds();
  let playbackScaledSeconds = 0;

  const getScaledElapsedSeconds = (): number => {
    const wallElapsed = getWallClockSeconds() - playbackStartWallSeconds;
    return playbackScaledSeconds + wallElapsed * timeSpeedMultiplier;
  };

  const sortedLayerDefinitions = [...LAYERS].sort((left, right) => left.drawOrder - right.drawOrder);
  const baseRecords = new Map<RecordType, Array<BasePointRecord>>();
  const activeRecords = new Map<RecordType, Array<BasePointRecord>>();

  const getRecords = (payload: PreparedGlobePoints): Map<RecordType, Array<BasePointRecord>> => {
    const grouped = new Map<RecordType, Array<BasePointRecord>>();
    grouped.set('aircraft', payload.planes);
    grouped.set('ship', payload.ships);
    grouped.set('earthquake', payload.earthquakes);
    return grouped;
  };
  const billboardRenderer = new BillboardRenderer({
    viewer,
    assetUrl,
    definitions: sortedLayerDefinitions,
  });

  const scalePointSize = (value: number, scale: number): number =>
    Math.max(1, Math.round(value * scale));

  let activePerformanceMode: PerformanceMode = readPerformanceMode();
  let activeAlignWithGround = readAlignWithGround();
  let activeEntityMultiplier: EntityMultiplier = readEntityMultiplier();

  const getExpandedRecords = (): Map<RecordType, Array<BasePointRecord>> =>
    new Map([
      ['aircraft', expandEntityMultiplierRecords(baseRecords.get('aircraft') ?? [], activeEntityMultiplier)],
      ['ship', expandEntityMultiplierRecords(baseRecords.get('ship') ?? [], activeEntityMultiplier)],
      ['earthquake', expandEntityMultiplierRecords(baseRecords.get('earthquake') ?? [], activeEntityMultiplier)],
    ]);

  const createGpuLayers = (profile: PerformanceProfile): Array<GpuLayerHandle> =>
    sortedLayerDefinitions.map((definition: LayerDefinition): GpuLayerHandle => {
      const minPointSize = scalePointSize(
        definition.minPointSize ?? DEFAULT_MIN_POINT_SIZE,
        profile.pointSizeScale,
      );
      const maxPointSize = scalePointSize(
        definition.maxPointSize ?? DEFAULT_MAX_POINT_SIZE,
        profile.pointSizeScale,
      );

      const layer = new GpuPointLayer<BasePointRecord>([], {
        name: definition.label,
        textureName: definition.textureName,
        headingOffsetRadians: definition.headingOffsetRadians,
        sprite: {
          url: assetUrl(definition.spritePath),
          width: definition.spriteWidth,
          height: definition.spriteHeight,
        },
        pointScale: definition.pointScale,
        minPointSize,
        maxPointSize,
        rotationEnabled: definition.rotationEnabled,
        enableAnimation: definition.enableAnimation,
        maxExtrapolationSeconds: 60 * 60 * 24 * 365,
        defaultAltitudeMeters: definition.defaultAltitudeMeters,
        drawOrder: definition.drawOrder,
        alignWithGround: activeAlignWithGround,
      });
      viewer.scene.primitives.add(layer.primitive);
      return { type: definition.type, layer };
    });

  let gpuLayers = createGpuLayers(PERFORMANCE_PROFILES[activePerformanceMode]);
  viewer.resolutionScale = PERFORMANCE_PROFILES[activePerformanceMode].resolutionScale;
  for (const handle of gpuLayers) {
    handle.layer.primitive.show = true;
  }
  viewer.scene.globe.maximumScreenSpaceError = PERFORMANCE_PROFILES[activePerformanceMode].maximumScreenSpaceError;

  let activeRenderMode: RenderMode = 'gpu';

  const applyEntityMultiplier = (multiplier: EntityMultiplier): void => {
    activeEntityMultiplier = multiplier;
    writeEntityMultiplier(multiplier);

    activeRecords.clear();
    for (const [type, records] of getExpandedRecords().entries()) {
      let tinyCounter = 0;
      const step = 200 / records.length;
      for (const record of records) {
        // Reduce flickering over massive overlaps at some zoom levels
        record.altitudeMeters ??= 0;
        record.altitudeMeters += tinyCounter;
        tinyCounter += step;
      }
      activeRecords.set(type, records);
    }

    billboardRenderer.setRecords(activeRecords);
    applyPerformanceMode(activePerformanceMode);
  };

  const applyPerformanceMode = (mode: PerformanceMode): void => {
    activePerformanceMode = mode;
    const profile = PERFORMANCE_PROFILES[mode];
    viewer.resolutionScale = profile.resolutionScale;
    viewer.scene.globe.maximumScreenSpaceError = profile.maximumScreenSpaceError;

    const previousLayers = gpuLayers;
    const recordMap = new Map(activeRecords);
    for (const previous of previousLayers) {
      viewer.scene.primitives.remove(previous.layer.primitive);
      previous.layer.destroy();
    }

    gpuLayers = createGpuLayers(profile);

    for (const handle of gpuLayers) {
      const records = recordMap.get(handle.type) ?? [];
      handle.layer.setRecords(records);
      handle.layer.primitive.show = activeRenderMode === 'gpu';
    }
    for (const handle of gpuLayers) {
      const primitive = handle.layer.primitive as typeof handle.layer.primitive & {
        getNowSeconds: () => number;
      }
      primitive.getNowSeconds = () => getScaledElapsedSeconds();
    }
    setRendererMode(activeRenderMode);
  };

  const setRendererMode = (mode: RenderMode): void => {
    activeRenderMode = mode;
    const useBillboard = mode === 'billboard';

    for (const handle of gpuLayers) {
      handle.layer.primitive.show = !useBillboard;
    }
    alignWithGroundControl.hidden = useBillboard;
    billboardRenderer.setVisible(useBillboard);

    const totals = [
      ['aircraft', activeRecords.get('aircraft')?.length ?? 0],
      ['ship', activeRecords.get('ship')?.length ?? 0],
      ['earthquake', activeRecords.get('earthquake')?.length ?? 0],
    ];
    const totalCount = totals.reduce((acc, [, count]) => acc + Number(count), 0);
    const label = mode === 'billboard' ? 'Cesium Billboards' : 'GPU points';
    statusEl.textContent = `${label}: ${totalCount} points (aircraft ${totals[0]?.[1] ?? 0}, ships ${totals[1]?.[1] ?? 0}, earthquakes ${totals[2]?.[1] ?? 0})`;
  };

  modeSelector.addEventListener('change', () => {
    setRendererMode(modeSelector.value as RenderMode);
  });
  performanceSelector.addEventListener('change', () => {
    const mode = performanceSelector.value as PerformanceMode;
    writePerformanceMode(mode);
    applyPerformanceMode(performanceSelector.value as PerformanceMode);
  });
  entityMultiplierSelector.addEventListener('change', () => {
    const multiplier = Number(entityMultiplierSelector.value);
    applyEntityMultiplier(multiplier as EntityMultiplier);
  });
  alignWithGroundSelector.addEventListener('change', () => {
    activeAlignWithGround = alignWithGroundSelector.value === 'on';
    writeAlignWithGround(activeAlignWithGround);
    applyPerformanceMode(activePerformanceMode);
  });
  const setTimeSpeed = (multiplier: number): void => {
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      return;
    }
    const currentScaled = getScaledElapsedSeconds();
    timeSpeedMultiplier = multiplier;
    playbackStartWallSeconds = getWallClockSeconds();
    playbackScaledSeconds = currentScaled;
    for (const handle of gpuLayers) {
      const primitive = handle.layer.primitive as typeof handle.layer.primitive & {
        getNowSeconds: () => number;
      }
      primitive.getNowSeconds = () => getScaledElapsedSeconds();
    }
  };
  timeSpeedSelector.addEventListener('change', () => {
    const selected = Number(timeSpeedSelector.value);
    setTimeSpeed(selected);
  });

  const onPostRender = (): void => {
    fpsCounter.update();
    if (activeRenderMode === 'billboard') {
      const timeScaledElapsedSeconds = getScaledElapsedSeconds();
      billboardRenderer.update(timeScaledElapsedSeconds);
    }
  };
  viewer.scene.preRender.addEventListener(onPostRender);
  setTimeSpeed(DEFAULT_TIME_SPEED);

  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(10, 28, 20_000_000),
  });

  const applySnapshot = async (): Promise<void> => {
    const response = await fetch(assetUrl('be-globe-layer-points.json'));
    if (!response.ok) {
      throw new Error(`Failed to load snapshot: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as PreparedGlobePoints;
    if (!isPreparedGlobePoints(payload)) {
      throw new Error('Snapshot does not contain a valid prepared layer payload.');
    }

    const groupedRecords = getRecords(payload);
    baseRecords.clear();
    for (const [type, records] of groupedRecords.entries()) {
      baseRecords.set(type, records);
    }
    applyEntityMultiplier(activeEntityMultiplier);
  };

  try {
    await applySnapshot();
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    console.error('[gpu-playground] failed to load static snapshot', details);
    statusEl.textContent = 'failed to load be-globe-layer-points.json';
  }

  const cleanup = (): void => {
    viewer.scene.preRender.removeEventListener(onPostRender);
    viewer.destroy();
    window.removeEventListener('beforeunload', cleanup);
  };

  window.addEventListener('beforeunload', cleanup);
};

void mount();