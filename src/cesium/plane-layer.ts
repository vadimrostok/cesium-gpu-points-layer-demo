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

export interface PlaneLayerPlane {
  id: string;
  longitude: number;
  latitude: number;
  altitudeMeters: number;
  headingRadians: number;
  speedMetersPerSecond?: number | null;
  directionX?: number;
  directionY?: number;
  timestampMs?: number;
}

export type PlaneTextureLayout = PointTextureLayout;

export interface PackedPlaneTexture {
  data: Float32Array;
  layout: PlaneTextureLayout;
  planeCount: number;
}

export interface PlaneLayerOptions {
  pointScale?: number;
  minPointSize?: number;
  maxPointSize?: number;
  maxExtrapolationSeconds?: number;
  rotateToHeading?: boolean;
  sprite: SpriteTextureAtlas | PointLayerSpriteSource;
}

interface PreparedPlane extends PlaneLayerPlane, PreparedPointRecord {
  speedMetersPerSecond: number;
  directionX: number;
  directionY: number;
  timestampSeconds: number;
}

const DEFAULT_POINT_SCALE = 70_000_000;
const DEFAULT_MIN_POINT_SIZE = 30;
const DEFAULT_MAX_POINT_SIZE = 128;
const DEFAULT_MAX_EXTRAPOLATION_SECONDS = 60 * 60 * 24 * 365;
const POINT_INDEX_ATTRIBUTE_LOCATION = 0;
const CULL_ANGLE = 0.5;
const DEFAULT_LAYOUT: PlaneTextureLayout = {
  width: 1,
  height: 1,
  capacity: 1,
};
const PLANE_BOUNDING_SPHERE = new Cesium.BoundingSphere(
  Cesium.Cartesian3.ZERO,
  Cesium.Ellipsoid.WGS84.maximumRadius + 100_000,
);

const PLANE_SHADERS = buildPointShaders({
  attributeName: 'a_planeIndex',
  dataTextureUniform: 'u_planeTexture',
  dataTextureDimensionsUniform: 'u_planeTextureDimensions',
  motionTextureUniform: 'u_planeMotionTexture',
  hasMotionExtrapolation: true,
  nowSecondsUniform: 'u_nowSeconds',
  maxExtrapolationSecondsUniform: 'u_maxExtrapolationSeconds',
  headingOffsetRadians: -Math.PI / 2,
});

export const headingRadiansFromDirection = (directionX: number, directionY: number): number => {
  if (!Number.isFinite(directionX) || !Number.isFinite(directionY)) {
    return 0;
  }

  return Cesium.Math.zeroToTwoPi(Math.atan2(directionY, directionX));
};

export const computePlaneTextureLayout = (planeCapacity: number): PlaneTextureLayout => {
  return computePointTextureLayout(planeCapacity);
};

export const packPlanesIntoFloatTexture = (
  planes: readonly PlaneLayerPlane[],
  previousData?: Float32Array,
  previousLayout?: PlaneTextureLayout,
): PackedPlaneTexture => {
  const packed = packPointsIntoFloatTexture(
    planes,
    previousData,
    previousLayout,
    (out, plane, valueOffset) => {
      out[valueOffset] = plane.longitude;
      out[valueOffset + 1] = plane.latitude;
      out[valueOffset + 2] = plane.altitudeMeters;
      out[valueOffset + 3] = plane.headingRadians;
    },
  );

  return {
    data: packed.data,
    layout: packed.layout,
    planeCount: packed.count,
  };
};

export const packPlaneMotionIntoFloatTexture = (
  planes: readonly PlaneLayerPlane[],
  previousData?: Float32Array,
  previousLayout?: PlaneTextureLayout,
): PackedPlaneTexture => {
  const packed = packPointsIntoFloatTexture(
    planes,
    previousData,
    previousLayout,
    (out, plane, valueOffset) => {
      const directionMagnitude = Math.hypot(plane.directionX ?? 0, plane.directionY ?? 0);
      out[valueOffset] =
        typeof plane.speedMetersPerSecond === 'number' &&
        Number.isFinite(plane.speedMetersPerSecond)
          ? Math.max(plane.speedMetersPerSecond, 0)
          : 0;
      out[valueOffset + 1] =
        directionMagnitude > 0 ? (plane.directionX ?? 0) / directionMagnitude : 0;
      out[valueOffset + 2] =
        directionMagnitude > 0 ? (plane.directionY ?? 0) / directionMagnitude : 0;
      out[valueOffset + 3] =
        typeof plane.timestampMs === 'number' && Number.isFinite(plane.timestampMs)
          ? plane.timestampMs / 1000
          : 0;
    },
  );

  return {
    data: packed.data,
    layout: packed.layout,
    planeCount: packed.count,
  };
};

export const isPlaneInVisibleHemisphere = (
  plane: PlaneLayerPlane,
  cameraDirection: Cesium.Cartesian3,
): boolean => {
  const scratchDirection = new Cesium.Cartesian3();
  const scratchCartesian = new Cesium.Cartesian3();
  const planeCartesian = Cesium.Cartesian3.fromDegrees(
    plane.longitude,
    plane.latitude,
    plane.altitudeMeters,
    Cesium.Ellipsoid.WGS84,
    scratchCartesian,
  );
  const planeDirection = Cesium.Cartesian3.normalize(planeCartesian, scratchDirection);

  return Cesium.Cartesian3.dot(cameraDirection, planeDirection) > 0;
};

export const filterPlanesForVisibleHemisphere = (
  planes: readonly PlaneLayerPlane[],
  cameraDirection: Cesium.Cartesian3,
): PlaneLayerPlane[] => {
  return filterPointsForVisibleHemisphere(planes, cameraDirection);
};

const PLANE_SHADER_CONFIG = {
  shaders: PLANE_SHADERS,
  uniforms: {
    dataTexture: 'u_planeTexture',
    dataTextureDimensions: 'u_planeTextureDimensions',
    motionTexture: 'u_planeMotionTexture',
    nowSeconds: 'u_nowSeconds',
    maxExtrapolationSeconds: 'u_maxExtrapolationSeconds',
    spriteTexture: 'u_spriteTexture',
    rotationEnabled: 'u_rotationEnabled',
  } as CesiumGpuPointLayerUniforms,
  indexAttributeName: 'a_planeIndex',
  indexAttributeLocation: POINT_INDEX_ATTRIBUTE_LOCATION,
  boundingSphere: PLANE_BOUNDING_SPHERE,
};

const preparePlaneForRendering = (plane: PlaneLayerPlane): PreparedPlane | null => {
  if (
    !Number.isFinite(plane.longitude) ||
    !Number.isFinite(plane.latitude) ||
    !Number.isFinite(plane.altitudeMeters) ||
    !Number.isFinite(plane.headingRadians)
  ) {
    return null;
  }

  const directionFromEarthCenter = Cesium.Cartesian3.fromDegrees(
    plane.longitude,
    plane.latitude,
    plane.altitudeMeters,
    Cesium.Ellipsoid.WGS84,
    new Cesium.Cartesian3(),
  );
  Cesium.Cartesian3.normalize(directionFromEarthCenter, directionFromEarthCenter);
  const directionMagnitude = Math.hypot(plane.directionX ?? 0, plane.directionY ?? 0);
  const speedMetersPerSecond =
    typeof plane.speedMetersPerSecond === 'number' && Number.isFinite(plane.speedMetersPerSecond)
      ? Math.max(plane.speedMetersPerSecond, 0)
      : 0;

  return {
    ...plane,
    directionFromEarthCenter,
    speedMetersPerSecond,
    directionX: directionMagnitude > 0 ? (plane.directionX ?? 0) / directionMagnitude : 0,
    directionY: directionMagnitude > 0 ? (plane.directionY ?? 0) / directionMagnitude : 0,
    timestampSeconds:
      typeof plane.timestampMs === 'number' && Number.isFinite(plane.timestampMs)
        ? plane.timestampMs / 1000
        : Date.now() / 1000,
  };
};

export class PlaneLayer {
  public readonly primitive: Primitive;

  private readonly pointLayer: CesiumPointTextureLayer<PlaneLayerPlane, PreparedPlane>;
  private readonly playbackStartSeconds = performance.now() / 1000;
  private readonly motionAnchorSeconds = 0.0001;

  public constructor(planes: readonly PlaneLayerPlane[] = [], options: PlaneLayerOptions) {
    this.pointLayer = this.createPointLayer(options);
    this.pointLayer.setRecords(planes);
    this.primitive = this.pointLayer.primitive;
  }

  public updatePlanes(planes: readonly PlaneLayerPlane[]): void {
    this.pointLayer.setRecords(planes);
  }

  public setSprite(sprite: SvgSpriteRasterized): void {
    this.pointLayer.setSprite(this.normalizeSpriteInput(sprite));
  }

  public setVisiblePlaneIds(visiblePlaneIds: Iterable<string> | null): void {
    this.pointLayer.setVisiblePointIds(visiblePlaneIds);
  }

  public destroy(): void {
    this.pointLayer.destroy();
  }

  private createPointLayer(
    options: PlaneLayerOptions,
  ): CesiumPointTextureLayer<PlaneLayerPlane, PreparedPlane> {
    const descriptor: CesiumGpuPointLayerDescriptor<PlaneLayerPlane, PreparedPlane> = {
      name: 'PlaneLayer',
      shaders: PLANE_SHADER_CONFIG.shaders,
      uniforms: PLANE_SHADER_CONFIG.uniforms,
      indexAttributeName: PLANE_SHADER_CONFIG.indexAttributeName,
      indexAttributeLocation: PLANE_SHADER_CONFIG.indexAttributeLocation,
      boundingSphere: PLANE_SHADER_CONFIG.boundingSphere,
      options: {
        pointScale: options.pointScale ?? DEFAULT_POINT_SCALE,
        minPointSize: options.minPointSize ?? DEFAULT_MIN_POINT_SIZE,
        maxPointSize: options.maxPointSize ?? DEFAULT_MAX_POINT_SIZE,
        maxExtrapolationSeconds:
          options.maxExtrapolationSeconds ?? DEFAULT_MAX_EXTRAPOLATION_SECONDS,
        sprite: options.sprite,
        rotateToHeading: options.rotateToHeading ?? true,
        depthTest: false,
        depthMask: false,
      },
      cullDotThreshold: CULL_ANGLE,
      prepareRecord: preparePlaneForRendering,
      packMainData: (plane, output, valueOffset): void => {
        output[valueOffset] = plane.longitude;
        output[valueOffset + 1] = plane.latitude;
        output[valueOffset + 2] = plane.altitudeMeters;
        output[valueOffset + 3] = plane.headingRadians;
      },
      packMotionData: (plane, output, valueOffset): void => {
        output[valueOffset] = plane.speedMetersPerSecond;
        output[valueOffset + 1] = plane.directionX;
        output[valueOffset + 2] = plane.directionY;
        output[valueOffset + 3] = this.motionAnchorSeconds;
      },
      getNowSeconds: (frameState) => {
        void frameState;
        return performance.now() / 1000 - this.playbackStartSeconds;
      },
      // The core performs culling from the prepared point records.
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

export const DEFAULT_PLANE_LAYER_CULL_ANGLE = CULL_ANGLE;
export const DEFAULT_PLANE_LAYER_LAYOUT = DEFAULT_LAYOUT;
