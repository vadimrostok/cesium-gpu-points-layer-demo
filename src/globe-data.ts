import type { EarthquakeLayerEarthquake } from './cesium/earthquake-layer';
import type { ShipLayerShip } from './cesium/ship-layer';
import type { BasePointRecord } from './cesium/gpu-point-layer';

interface RawDirection {
  x?: number | null;
  y?: number | null;
  z?: number | null;
}

export type RecordType = 'aircraft' | 'ship' | 'earthquake';

interface RawProcessedRecord {
  id: string;
  type: RecordType;
  longitude: number;
  latitude: number;
  direction?: RawDirection | null;
  details?: {
    altitudeMeters?: number | null;
    speedMps?: number | null;
    category?: number | null;
  };
}

export interface GlobeResponse {
  records: RawProcessedRecord[];
  limitPerType: number | null;
}

interface PlaygroundLayerPoints {
  planes: BasePointRecord[];
  ships: ShipLayerShip[];
  earthquakes: EarthquakeLayerEarthquake[];
}

const MIN_PLANE_ALTITUDE_METERS = 500;
const SHIP_ALTITUDE_METERS = 1_000;
const EARTHQUAKE_ALTITUDE_METERS = 1_000;
const TWO_PI = Math.PI * 2;

const normalizeDirection = (value: number): number => {
  const normalized = value % TWO_PI;
  return normalized < 0 ? normalized + TWO_PI : normalized;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const toHeadingRadians = (direction?: RawDirection | null): number | null => {
  if (!isFiniteNumber(direction?.x) || !isFiniteNumber(direction?.y)) {
    return null;
  }

  const radians = Math.atan2(direction.y, direction.x);
  return normalizeDirection(radians);
};

const isRawRecord = (value: unknown): value is RawProcessedRecord => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as RawProcessedRecord;
  return (
    typeof record.id === 'string' &&
    (record.type === 'aircraft' || record.type === 'ship' || record.type === 'earthquake') &&
    isFiniteNumber(record.latitude) &&
    isFiniteNumber(record.longitude)
  );
};

/**
 * Convert a ProcessedGlobeRecord payload into layer-ready points.
 */
export const toLayerPoints = (response: GlobeResponse): PlaygroundLayerPoints => {
  const planes: BasePointRecord[] = [];
  const ships: ShipLayerShip[] = [];
  const earthquakes: EarthquakeLayerEarthquake[] = [];

  for (const record of response.records) {
    if (!isRawRecord(record)) {
      console.debug('[playground] dropping invalid record: missing required numeric fields', record);
      continue;
    }

    const headingRadians = toHeadingRadians(record.direction);
    const common: BasePointRecord = {
      id: record.id,
      longitude: record.longitude,
      latitude: record.latitude,
      headingRadians: headingRadians ?? undefined,
    };

    if (record.type === 'aircraft') {
      const altitudeMeters = isFiniteNumber(record.details?.altitudeMeters)
        ? Math.max(record.details?.altitudeMeters, MIN_PLANE_ALTITUDE_METERS)
        : undefined;
      const speedMetersPerSecond = isFiniteNumber(record.details?.speedMps)
        ? record.details?.speedMps
        : undefined;

      planes.push({
        ...common,
        altitudeMeters,
        speedMetersPerSecond,
      });
      continue;
    }

    if (record.type === 'ship') {
      ships.push({
        ...common,
        altitudeMeters: SHIP_ALTITUDE_METERS,
        headingRadians: headingRadians ?? 0,
      });
      continue;
    }

    earthquakes.push({
      ...common,
      altitudeMeters: EARTHQUAKE_ALTITUDE_METERS,
      headingRadians: headingRadians ?? 0,
    });
  }

  return {
    planes,
    ships,
    earthquakes,
  };
};

/**
 * WIP (work in progress) response shape check.
 */
export const isGlobeResponse = (value: unknown): value is GlobeResponse => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as GlobeResponse;
  const hasRecords = Array.isArray(candidate.records);
  const hasLimit = Object.prototype.hasOwnProperty.call(candidate, 'limitPerType');
  return hasRecords && hasLimit;
};
