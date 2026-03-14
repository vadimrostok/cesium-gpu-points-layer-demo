import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

/**
 * Parse arguments from process argv.
 */
const parseArg = (name, fallback = '') => {
  const argIndex = process.argv.indexOf(`--${name}`);
  if (argIndex === -1 || argIndex + 1 >= process.argv.length) {
    return fallback;
  }

  return process.argv[argIndex + 1];
};

const input = parseArg('input', path.resolve(process.cwd(), 'public/be-globe-response.json'));
const output = parseArg(
  'output',
  path.resolve(process.cwd(), 'public/be-globe-layer-points.json'),
);
const aircraftMinAltitudeMeters = Number.parseInt(
  parseArg('aircraftMinAltitudeMeters', '500'),
  10,
);
const shipAltitudeMeters = Number.parseInt(parseArg('shipAltitudeMeters', '1000'), 10);
const earthquakeAltitudeMeters = Number.parseInt(parseArg('earthquakeAltitudeMeters', '1000'), 10);

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const toHeadingRadians = (direction) => {
  if (!isFiniteNumber(direction?.x) || !isFiniteNumber(direction?.y)) {
    return null;
  }

  const raw = Math.atan2(direction.y, direction.x);
  const normalized = raw % (Math.PI * 2);
  return normalized < 0 ? normalized + Math.PI * 2 : normalized;
};

const rawPayloadText = await fs.readFile(input, 'utf8');
const rawPayload = JSON.parse(rawPayloadText);
if (!rawPayload || !Array.isArray(rawPayload.records) || !Object.prototype.hasOwnProperty.call(rawPayload, 'limitPerType')) {
  throw new Error('Input payload is not a valid GlobeResponse shape.');
}

const planes = [];
const ships = [];
const earthquakes = [];

for (const record of rawPayload.records) {
  if (!record || typeof record !== 'object') {
    continue;
  }

  const type = record.type;
  if (type !== 'aircraft' && type !== 'ship' && type !== 'earthquake') {
    continue;
  }

  if (
    typeof record.id !== 'string' ||
    !isFiniteNumber(record.longitude) ||
    !isFiniteNumber(record.latitude)
  ) {
    continue;
  }

  const headingRadians = toHeadingRadians(record.direction);
  const base = {
    id: record.id,
    longitude: record.longitude,
    latitude: record.latitude,
  };

  if (type === 'aircraft') {
    const altitudeMeters = isFiniteNumber(record?.details?.altitudeMeters)
      ? Math.max(record.details.altitudeMeters, aircraftMinAltitudeMeters)
      : undefined;
    const speedMetersPerSecond = isFiniteNumber(record?.details?.speedMps)
      ? record.details.speedMps
      : undefined;
    planes.push({
      ...base,
      altitudeMeters,
      headingRadians: headingRadians ?? undefined,
      speedMetersPerSecond,
    });
    continue;
  }

  if (type === 'ship') {
    ships.push({
      ...base,
      altitudeMeters: shipAltitudeMeters,
      headingRadians: headingRadians ?? undefined,
    });
    continue;
  }

  earthquakes.push({
    ...base,
    altitudeMeters: earthquakeAltitudeMeters,
    headingRadians: headingRadians ?? undefined,
  });
}

const prepared = {
  planes,
  ships,
  earthquakes,
};

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(prepared, null, 2)}\n`, 'utf8');
console.log(
  `[playground] saved prepared layer data to ${output}: aircraft=${planes.length}, ship=${ships.length}, earthquake=${earthquakes.length}`,
);
