import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

/**
 * Minimal JSON parse smoke test for the static snapshot.
 */
const parseArg = (name, fallback = '') => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || index + 1 >= process.argv.length) {
    return fallback;
  }

  return process.argv[index + 1];
};

const snapshotPath = parseArg('path', path.resolve(process.cwd(), 'public/be-globe-response.json'));
const raw = await fs.readFile(snapshotPath, 'utf8');
const payload = JSON.parse(raw);

if (!payload || !Array.isArray(payload.records) || !Object.prototype.hasOwnProperty.call(payload, 'limitPerType')) {
  throw new Error('Invalid snapshot: missing records or limitPerType.');
}

const counts = {
  aircraft: 0,
  ship: 0,
  earthquake: 0,
};

const finitePoints = {
  aircraft: 0,
  ship: 0,
  earthquake: 0,
};

for (const record of payload.records) {
  if (!record || typeof record !== 'object') {
    continue;
  }

  const type = record.type;
  if (type !== 'aircraft' && type !== 'ship' && type !== 'earthquake') {
    continue;
  }

  counts[type] += 1;

  const longitude = Number(record.longitude);
  const latitude = Number(record.latitude);
  const directionX = Number(record?.direction?.x);
  const directionY = Number(record?.direction?.y);

  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || !Number.isFinite(directionX) || !Number.isFinite(directionY)) {
    continue;
  }

  const movementDirectionRadians = Math.atan2(directionY, directionX) % (Math.PI * 2);
  const normalizedMovementDirectionRadians = movementDirectionRadians < 0
    ? movementDirectionRadians + Math.PI * 2
    : movementDirectionRadians;

  let altitudeMeters;
  if (type === 'aircraft') {
    const rawAltitude = Number(record?.details?.altitudeMeters);
    altitudeMeters = Number.isFinite(rawAltitude) ? Math.max(rawAltitude, 500) : 500;
  } else {
    altitudeMeters = 1_000;
  }

  if (Number.isFinite(normalizedMovementDirectionRadians) && Number.isFinite(altitudeMeters)) {
    finitePoints[type] += 1;
  }
}

for (const type of Object.keys(counts)) {
  if (counts[type] === 0) {
    throw new Error(`Expected at least one ${type} in snapshot records.`);
  }

  if (finitePoints[type] === 0) {
    throw new Error(`No finite point values for ${type}.`);
  }
}

console.log('[playground] smoke check passed', {
  totalRecords: payload.records.length,
  byType: counts,
  finiteByType: finitePoints,
});
