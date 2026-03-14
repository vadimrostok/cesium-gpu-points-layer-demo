import * as Cesium from 'cesium';
import type { Primitive } from 'cesium';
import type { SvgSpriteRasterized } from './sprite-texture';
import {
  CesiumPointTextureLayer,
  buildPointShaders,
  type PointLayerSpriteSource,
  computePointTextureLayout,
  filterPointsForVisibleHemisphere,
  packPointsIntoFloatTexture,
  type CesiumGpuPointLayerDescriptor,
  type CesiumGpuPointLayerUniforms,
  type PreparedPointRecord,
  type PointTextureLayout,
  type SpriteTextureAtlas,
} from './gpu-point-layer';

export interface EarthquakeLayerEarthquake {
  id: string;
  longitude: number;
  latitude: number;
  altitudeMeters: number;
  headingRadians: number;
}

export type EarthquakeTextureLayout = PointTextureLayout;

export interface PackedEarthquakeTexture {
  data: Float32Array;
  layout: EarthquakeTextureLayout;
  earthquakeCount: number;
}

export interface EarthquakeLayerOptions {
  pointScale?: number;
  minPointSize?: number;
  maxPointSize?: number;
  rotateToHeading?: boolean;
  sprite: SpriteTextureAtlas | PointLayerSpriteSource;
}

interface PreparedEarthquake extends EarthquakeLayerEarthquake, PreparedPointRecord {}

const DEFAULT_POINT_SCALE = 40_000_000;
const DEFAULT_MIN_POINT_SIZE = 128;
const DEFAULT_MAX_POINT_SIZE = 256;
const EARTHQUAKE_INDEX_ATTRIBUTE_LOCATION = 0;
const CULL_ANGLE = 0.5;
const EARTHQUAKE_BOUNDING_SPHERE = new Cesium.BoundingSphere(
  Cesium.Cartesian3.ZERO,
  Cesium.Ellipsoid.WGS84.maximumRadius + 1_000_000,
);
const EARTHQUAKE_SHADERS = buildPointShaders({
  attributeName: 'a_earthquakeIndex',
  dataTextureUniform: 'u_earthquakeTexture',
  dataTextureDimensionsUniform: 'u_earthquakeTextureDimensions',
});

export const computeEarthquakeTextureLayout = (
  earthquakeCapacity: number,
): EarthquakeTextureLayout => {
  return computePointTextureLayout(earthquakeCapacity);
};

export const packEarthquakesIntoFloatTexture = (
  earthquakes: readonly EarthquakeLayerEarthquake[],
  previousData?: Float32Array,
  previousLayout?: EarthquakeTextureLayout,
): PackedEarthquakeTexture => {
  const packed = packPointsIntoFloatTexture(
    earthquakes,
    previousData,
    previousLayout,
    (out, earthquake, valueOffset) => {
      out[valueOffset] = earthquake.longitude;
      out[valueOffset + 1] = earthquake.latitude;
      out[valueOffset + 2] = earthquake.altitudeMeters;
      out[valueOffset + 3] = earthquake.headingRadians;
    },
  );

  return {
    data: packed.data,
    layout: packed.layout,
    earthquakeCount: packed.count,
  };
};

export const isEarthquakeInVisibleHemisphere = (
  earthquake: EarthquakeLayerEarthquake,
  cameraDirection: Cesium.Cartesian3,
): boolean => {
  const scratchDirection = new Cesium.Cartesian3();
  const scratchCartesian = new Cesium.Cartesian3();
  const earthquakeCartesian = Cesium.Cartesian3.fromDegrees(
    earthquake.longitude,
    earthquake.latitude,
    earthquake.altitudeMeters,
    Cesium.Ellipsoid.WGS84,
    scratchCartesian,
  );
  const earthquakeDirection = Cesium.Cartesian3.normalize(earthquakeCartesian, scratchDirection);

  return Cesium.Cartesian3.dot(cameraDirection, earthquakeDirection) > 0;
};

export const filterEarthquakesForVisibleHemisphere = (
  earthquakes: readonly EarthquakeLayerEarthquake[],
  cameraDirection: Cesium.Cartesian3,
): EarthquakeLayerEarthquake[] => {
  return filterPointsForVisibleHemisphere(earthquakes, cameraDirection);
};

const EARTHQUAKE_SHADER_CONFIG = {
  shaders: EARTHQUAKE_SHADERS,
  uniforms: {
    dataTexture: 'u_earthquakeTexture',
    dataTextureDimensions: 'u_earthquakeTextureDimensions',
    spriteTexture: 'u_spriteTexture',
    rotationEnabled: 'u_rotationEnabled',
  } as CesiumGpuPointLayerUniforms,
  indexAttributeName: 'a_earthquakeIndex',
  indexAttributeLocation: EARTHQUAKE_INDEX_ATTRIBUTE_LOCATION,
  boundingSphere: EARTHQUAKE_BOUNDING_SPHERE,
};

const prepareEarthquakeForRendering = (
  earthquake: EarthquakeLayerEarthquake,
): PreparedEarthquake | null => {
  if (
    !Number.isFinite(earthquake.longitude) ||
    !Number.isFinite(earthquake.latitude) ||
    !Number.isFinite(earthquake.altitudeMeters) ||
    !Number.isFinite(earthquake.headingRadians)
  ) {
    return null;
  }

  const directionFromEarthCenter = Cesium.Cartesian3.fromDegrees(
    earthquake.longitude,
    earthquake.latitude,
    earthquake.altitudeMeters,
    Cesium.Ellipsoid.WGS84,
    new Cesium.Cartesian3(),
  );
  Cesium.Cartesian3.normalize(directionFromEarthCenter, directionFromEarthCenter);

  return {
    ...earthquake,
    directionFromEarthCenter,
  };
};

export class EarthquakeLayer {
  public readonly primitive: Primitive;

  private readonly pointLayer: CesiumPointTextureLayer<
    EarthquakeLayerEarthquake,
    PreparedEarthquake
  >;

  public constructor(
    earthquakes: readonly EarthquakeLayerEarthquake[] = [],
    options: EarthquakeLayerOptions,
  ) {
    this.pointLayer = this.createPointLayer(options);
    this.pointLayer.setRecords(earthquakes);
    this.primitive = this.pointLayer.primitive;
  }

  public updateEarthquakes(earthquakes: readonly EarthquakeLayerEarthquake[]): void {
    this.pointLayer.setRecords(earthquakes);
  }

  public setSprite(sprite: SvgSpriteRasterized): void {
    this.pointLayer.setSprite(this.normalizeSpriteInput(sprite));
  }

  public setVisibleEarthquakeIds(visibleEarthquakeIds: Iterable<string> | null): void {
    this.pointLayer.setVisiblePointIds(visibleEarthquakeIds);
  }

  public destroy(): void {
    this.pointLayer.destroy();
  }

  private createPointLayer(
    options: EarthquakeLayerOptions,
  ): CesiumPointTextureLayer<EarthquakeLayerEarthquake, PreparedEarthquake> {
    const descriptor: CesiumGpuPointLayerDescriptor<EarthquakeLayerEarthquake, PreparedEarthquake> =
      {
        name: 'EarthquakeLayer',
        shaders: EARTHQUAKE_SHADER_CONFIG.shaders,
        uniforms: EARTHQUAKE_SHADER_CONFIG.uniforms,
        indexAttributeName: EARTHQUAKE_SHADER_CONFIG.indexAttributeName,
        indexAttributeLocation: EARTHQUAKE_SHADER_CONFIG.indexAttributeLocation,
        boundingSphere: EARTHQUAKE_SHADER_CONFIG.boundingSphere,
        options: {
          pointScale: options.pointScale ?? DEFAULT_POINT_SCALE,
          minPointSize: options.minPointSize ?? DEFAULT_MIN_POINT_SIZE,
          maxPointSize: options.maxPointSize ?? DEFAULT_MAX_POINT_SIZE,
          sprite: options.sprite,
          rotateToHeading: options.rotateToHeading ?? false,
          depthTest: false,
          depthMask: false,
        },
        cullDotThreshold: CULL_ANGLE,
        prepareRecord: prepareEarthquakeForRendering,
        packMainData: (earthquake, output, valueOffset): void => {
          output[valueOffset] = earthquake.longitude;
          output[valueOffset + 1] = earthquake.latitude;
          output[valueOffset + 2] = earthquake.altitudeMeters;
          output[valueOffset + 3] = earthquake.headingRadians;
        },
      };

    return new CesiumPointTextureLayer(descriptor);
  }

  private normalizeSpriteInput(sprite: SvgSpriteRasterized): SpriteTextureAtlas {
    return {
      width: sprite.width,
      height: sprite.height,
      pixels: sprite.pixels,
    };
  }
}
