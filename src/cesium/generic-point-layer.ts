import * as Cesium from 'cesium';
import type { Primitive } from 'cesium';
import type { SvgSpriteRasterized } from './sprite-texture';
import {
  CesiumPointTextureLayer,
  buildPointShaders,
  type BasePointRecord,
  type CesiumGpuPointLayerDescriptor,
  type CesiumGpuPointLayerShaders,
  type CesiumGpuPointLayerUniforms,
  type PointLayerSpriteSource,
  type SpriteTextureAtlas,
  type PreparedPointRecord,
} from './gpu-point-layer';

export const DEFAULT_POINT_SCALE = 40_000_000;
export const DEFAULT_MIN_POINT_SIZE = 30;
export const DEFAULT_MAX_POINT_SIZE = 128;
export const DEFAULT_MAX_EXTRAPOLATION_SECONDS = 60 * 60 * 24 * 365;
export const DEFAULT_POINT_ALTITUDE_METERS = 10;
export const DEFAULT_POINT_HEADING_RADIANS = 0;
export const DEFAULT_POINT_CULL_DOT_THRESHOLD = 0.5;

export interface GenericPointLayerShaderConfig {
  dataTextureUniform: string;
  dataTextureDimensionsUniform: string;
  spriteTextureUniform: string;
  motionTextureUniform: string;
  nowSecondsUniform: string;
  maxExtrapolationSecondsUniform: string;
  rotationEnabledUniform: string;
}

export interface GenericPointLayerDescriptor {
  name: string;
  attributeName: string;
  indexAttributeLocation: number;
  boundingSphere: Cesium.BoundingSphere;
  cullDotThreshold?: number;
  headingOffsetRadians?: number;
  shaders?: CesiumGpuPointLayerShaders;
  shaderConfig?: Partial<GenericPointLayerShaderConfig>;
}

export interface GenericPointLayerOptions {
  pointScale?: number;
  minPointSize?: number;
  maxPointSize?: number;
  maxExtrapolationSeconds?: number;
  rotateToHeading?: boolean;
  sprite: SpriteTextureAtlas | PointLayerSpriteSource;
  enableAnimation?: boolean;
  defaultAltitudeMeters?: number;
  defaultHeadingRadians?: number;
}

interface GenericPreparedPoint
  extends Omit<BasePointRecord, 'altitudeMeters' | 'headingRadians'>,
    PreparedPointRecord {
  altitudeMeters: number;
  headingRadians: number;
  speedMetersPerSecond: number;
  directionX: number;
  directionY: number;
  timestampSeconds: number;
}

const DEFAULT_POINT_SHADER_CONFIG: GenericPointLayerShaderConfig = {
  dataTextureUniform: 'u_pointTexture',
  dataTextureDimensionsUniform: 'u_pointTextureDimensions',
  spriteTextureUniform: 'u_spriteTexture',
  motionTextureUniform: 'u_pointMotionTexture',
  nowSecondsUniform: 'u_nowSeconds',
  maxExtrapolationSecondsUniform: 'u_maxExtrapolationSeconds',
  rotationEnabledUniform: 'u_rotationEnabled',
};

const resolveShaderConfig = (
  raw?: Partial<GenericPointLayerShaderConfig>,
): GenericPointLayerShaderConfig => ({
  dataTextureUniform: raw?.dataTextureUniform ?? DEFAULT_POINT_SHADER_CONFIG.dataTextureUniform,
  dataTextureDimensionsUniform:
    raw?.dataTextureDimensionsUniform ??
    DEFAULT_POINT_SHADER_CONFIG.dataTextureDimensionsUniform,
  spriteTextureUniform: raw?.spriteTextureUniform ?? DEFAULT_POINT_SHADER_CONFIG.spriteTextureUniform,
  motionTextureUniform: raw?.motionTextureUniform ?? DEFAULT_POINT_SHADER_CONFIG.motionTextureUniform,
  nowSecondsUniform: raw?.nowSecondsUniform ?? DEFAULT_POINT_SHADER_CONFIG.nowSecondsUniform,
  maxExtrapolationSecondsUniform:
    raw?.maxExtrapolationSecondsUniform ??
    DEFAULT_POINT_SHADER_CONFIG.maxExtrapolationSecondsUniform,
  rotationEnabledUniform:
    raw?.rotationEnabledUniform ?? DEFAULT_POINT_SHADER_CONFIG.rotationEnabledUniform,
});

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Generic GPU point layer that supports optional rotation and optional motion extrapolation.
 * The base record intentionally does not require altitude, heading, or speed values.
 */
export class GenericPointLayer<TPoint extends BasePointRecord> {
  public readonly primitive: Primitive;

  private readonly pointLayer: CesiumPointTextureLayer<TPoint, GenericPreparedPoint>;
  private readonly defaultAltitudeMeters: number;
  private readonly defaultHeadingRadians: number;
  private readonly enableAnimation: boolean;
  private readonly cullDotThreshold: number;
  private readonly playbackStartSeconds = performance.now() / 1000;
  private readonly motionAnchorSeconds = 0.0001;

  public constructor(
    points: readonly TPoint[] = [],
    descriptor: GenericPointLayerDescriptor,
    options: GenericPointLayerOptions,
  ) {
    this.defaultAltitudeMeters = options.defaultAltitudeMeters ?? DEFAULT_POINT_ALTITUDE_METERS;
    this.defaultHeadingRadians = options.defaultHeadingRadians ?? DEFAULT_POINT_HEADING_RADIANS;
    this.enableAnimation = options.enableAnimation ?? true;
    this.cullDotThreshold = descriptor.cullDotThreshold ?? DEFAULT_POINT_CULL_DOT_THRESHOLD;
    this.pointLayer = this.createPointLayer(descriptor, options);
    this.pointLayer.setRecords(points);
    this.primitive = this.pointLayer.primitive;
  }

  public setRecords(points: readonly TPoint[]): void {
    this.pointLayer.setRecords(points);
  }

  public setSprite(sprite: SvgSpriteRasterized): void {
    this.pointLayer.setSprite(this.normalizeSpriteInput(sprite));
  }

  public setVisiblePointIds(visiblePointIds: Iterable<string> | null): void {
    this.pointLayer.setVisiblePointIds(visiblePointIds);
  }

  public destroy(): void {
    this.pointLayer.destroy();
  }

  private createPointLayer(
    descriptor: GenericPointLayerDescriptor,
    options: GenericPointLayerOptions,
  ): CesiumPointTextureLayer<TPoint, GenericPreparedPoint> {
    const enableAnimation = options.enableAnimation ?? true;
    const shaderConfig = resolveShaderConfig(descriptor.shaderConfig);
    const shaders =
      descriptor.shaders ??
      buildPointShaders({
        attributeName: descriptor.attributeName,
        dataTextureUniform: shaderConfig.dataTextureUniform,
        dataTextureDimensionsUniform: shaderConfig.dataTextureDimensionsUniform,
        spriteTextureUniform: shaderConfig.spriteTextureUniform,
        headingOffsetRadians: descriptor.headingOffsetRadians ?? 0,
        hasMotionExtrapolation: enableAnimation,
        motionTextureUniform: shaderConfig.motionTextureUniform,
        nowSecondsUniform: shaderConfig.nowSecondsUniform,
        maxExtrapolationSecondsUniform: shaderConfig.maxExtrapolationSecondsUniform,
      });

    const cesiumUniforms: CesiumGpuPointLayerUniforms = {
      dataTexture: shaderConfig.dataTextureUniform,
      dataTextureDimensions: shaderConfig.dataTextureDimensionsUniform,
      motionTexture: shaderConfig.motionTextureUniform,
      nowSeconds: shaderConfig.nowSecondsUniform,
      maxExtrapolationSeconds: shaderConfig.maxExtrapolationSecondsUniform,
      spriteTexture: shaderConfig.spriteTextureUniform,
      rotationEnabled: shaderConfig.rotationEnabledUniform,
    };

    const layerDescriptor: CesiumGpuPointLayerDescriptor<TPoint, GenericPreparedPoint> = {
      name: descriptor.name,
      shaders,
      uniforms: cesiumUniforms,
      indexAttributeName: descriptor.attributeName,
      indexAttributeLocation: descriptor.indexAttributeLocation,
      boundingSphere: descriptor.boundingSphere,
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
      cullDotThreshold: this.cullDotThreshold,
      prepareRecord: (point) => this.preparePointForRendering(point),
      packMainData: (point, output, valueOffset): void => {
        output[valueOffset] = point.longitude;
        output[valueOffset + 1] = point.latitude;
        output[valueOffset + 2] = point.altitudeMeters;
        output[valueOffset + 3] = point.headingRadians;
      },
      packMotionData: enableAnimation
        ? (point, output, valueOffset): void => {
            output[valueOffset] = point.speedMetersPerSecond;
            output[valueOffset + 1] = point.directionX;
            output[valueOffset + 2] = point.directionY;
            output[valueOffset + 3] = point.timestampSeconds;
          }
        : undefined,
      getNowSeconds: (frameState) => {
        void frameState;
        return performance.now() / 1000 - this.playbackStartSeconds;
      },
    };

    return new CesiumPointTextureLayer(layerDescriptor);
  }

  private normalizeSpriteInput(sprite: SvgSpriteRasterized): SpriteTextureAtlas {
    return {
      width: sprite.width,
      height: sprite.height,
      pixels: sprite.pixels,
    };
  }

  private preparePointForRendering(point: TPoint): GenericPreparedPoint | null {
    const altitudeMeters = isFiniteNumber(point.altitudeMeters)
      ? point.altitudeMeters
      : this.defaultAltitudeMeters;
    const rawHeadingRadians = isFiniteNumber(point.headingRadians)
      ? point.headingRadians
      : this.defaultHeadingRadians;
    const headingRadians = Cesium.Math.zeroToTwoPi(rawHeadingRadians);
    const hasHeading = isFiniteNumber(point.headingRadians);

    if (
      !isFiniteNumber(point.longitude) ||
      !isFiniteNumber(point.latitude) ||
      !isFiniteNumber(altitudeMeters) ||
      !isFiniteNumber(headingRadians)
    ) {
      return null;
    }

    const directionFromEarthCenter = Cesium.Cartesian3.fromDegrees(
      point.longitude,
      point.latitude,
      altitudeMeters,
      Cesium.Ellipsoid.WGS84,
      new Cesium.Cartesian3(),
    );
    Cesium.Cartesian3.normalize(directionFromEarthCenter, directionFromEarthCenter);

    const speedMetersPerSecond =
      this.enableAnimation && isFiniteNumber(point.speedMetersPerSecond)
        ? Math.max(point.speedMetersPerSecond, 0)
        : 0;
    const directionX = speedMetersPerSecond > 0 && hasHeading ? Math.cos(headingRadians) : 0;
    const directionY = speedMetersPerSecond > 0 && hasHeading ? Math.sin(headingRadians) : 0;

    return {
      id: point.id,
      longitude: point.longitude,
      latitude: point.latitude,
      altitudeMeters,
      headingRadians,
      speedMetersPerSecond,
      directionX,
      directionY,
      timestampSeconds: this.motionAnchorSeconds,
      directionFromEarthCenter,
    };
  }
}
