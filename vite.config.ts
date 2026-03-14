import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const normalizeBase = (base: string): string => (base.endsWith('/') ? base : `${base}/`);

export default defineConfig(({ mode }) => {
  const envBase = process.env.VITE_PAGES_BASE_PATH?.trim();
  const base = normalizeBase(
    envBase
      ? envBase
      : mode === 'production'
        ? '/cesium-gpu-points-layer-demo/'
        : '/',
  );

  return {
    base,
    plugins: [
      viteStaticCopy({
        targets: [
          {
            src: 'node_modules/cesium/Build/Cesium/Workers',
            dest: 'cesium',
          },
          {
            src: 'node_modules/cesium/Build/Cesium/Assets',
            dest: 'cesium',
          },
          {
            src: 'node_modules/cesium/Build/Cesium/ThirdParty',
            dest: 'cesium',
          },
          {
            src: 'node_modules/cesium/Build/Cesium/Widgets',
            dest: 'cesium',
          },
        ],
      }),
    ],
    define: {
      CESIUM_BASE_URL: JSON.stringify(`${base}cesium`),
    },
  };
});
