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

const baseUrl = parseArg('base', 'http://localhost:3001');
const output = parseArg('out', path.resolve(process.cwd(), 'public/be-globe-response.json'));
const snapshotUrl = new URL('/api/globe/records', baseUrl).toString();

const response = await fetch(snapshotUrl);
if (!response.ok) {
  throw new Error(`Failed to fetch BE response: ${response.status} ${response.statusText}`);
}

const payload = await response.json();
if (!payload || !Array.isArray(payload.records) || !Object.prototype.hasOwnProperty.call(payload, 'limitPerType')) {
  throw new Error('Fetched payload is not a valid GlobeResponse shape.');
}

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`[playground] saved response to ${output}`);
