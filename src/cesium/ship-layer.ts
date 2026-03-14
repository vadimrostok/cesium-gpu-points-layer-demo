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

export interface ShipLayerShip {
  id: string;
  longitude: number;
  latitude: number;
  altitudeMeters: number;
  headingRadians: number;
}

export type ShipTextureLayout = PointTextureLayout;

export interface PackedShipTexture {
  data: Float32Array;
  layout: ShipTextureLayout;
  shipCount: number;
}

export interface ShipLayerOptions {
  pointScale?: number;
  minPointSize?: number;
  maxPointSize?: number;
  rotateToHeading?: boolean;
  sprite: SpriteTextureAtlas | PointLayerSpriteSource;
}

interface PreparedShip extends ShipLayerShip, PreparedPointRecord {}

const DEFAULT_POINT_SCALE = 40_000_000;
const DEFAULT_MIN_POINT_SIZE = 30;
const DEFAULT_MAX_POINT_SIZE = 128;
const SHIP_INDEX_ATTRIBUTE_LOCATION = 0;
const CULL_ANGLE = 0.5;
const SHIP_BOUNDING_SPHERE = new Cesium.BoundingSphere(
  Cesium.Cartesian3.ZERO,
  Cesium.Ellipsoid.WGS84.maximumRadius + 1_000_000,
);
const DEFAULT_LAYOUT: ShipTextureLayout = {
  width: 1,
  height: 1,
  capacity: 1,
};
const SHIP_SHADERS = buildPointShaders({
  attributeName: 'a_shipIndex',
  dataTextureUniform: 'u_shipTexture',
  dataTextureDimensionsUniform: 'u_shipTextureDimensions',
});

export const computeShipTextureLayout = (shipCapacity: number): ShipTextureLayout => {
  return computePointTextureLayout(shipCapacity);
};

export const packShipsIntoFloatTexture = (
  ships: readonly ShipLayerShip[],
  previousData?: Float32Array,
  previousLayout?: ShipTextureLayout,
): PackedShipTexture => {
  const packed = packPointsIntoFloatTexture(
    ships,
    previousData,
    previousLayout,
    (out, ship, valueOffset) => {
      out[valueOffset] = ship.longitude;
      out[valueOffset + 1] = ship.latitude;
      out[valueOffset + 2] = ship.altitudeMeters;
      out[valueOffset + 3] = ship.headingRadians;
    },
  );

  return {
    data: packed.data,
    layout: packed.layout,
    shipCount: packed.count,
  };
};

export const isShipInVisibleHemisphere = (
  ship: ShipLayerShip,
  cameraDirection: Cesium.Cartesian3,
): boolean => {
  const scratchDirection = new Cesium.Cartesian3();
  const scratchCartesian = new Cesium.Cartesian3();
  const shipCartesian = Cesium.Cartesian3.fromDegrees(
    ship.longitude,
    ship.latitude,
    ship.altitudeMeters,
    Cesium.Ellipsoid.WGS84,
    scratchCartesian,
  );
  const shipDirection = Cesium.Cartesian3.normalize(shipCartesian, scratchDirection);

  return Cesium.Cartesian3.dot(cameraDirection, shipDirection) > 0;
};

export const filterShipsForVisibleHemisphere = (
  ships: readonly ShipLayerShip[],
  cameraDirection: Cesium.Cartesian3,
): ShipLayerShip[] => {
  return filterPointsForVisibleHemisphere(ships, cameraDirection);
};

const SHIP_SHADER_CONFIG = {
  shaders: SHIP_SHADERS,
  uniforms: {
    dataTexture: 'u_shipTexture',
    dataTextureDimensions: 'u_shipTextureDimensions',
    spriteTexture: 'u_spriteTexture',
    rotationEnabled: 'u_rotationEnabled',
  } as CesiumGpuPointLayerUniforms,
  indexAttributeName: 'a_shipIndex',
  indexAttributeLocation: SHIP_INDEX_ATTRIBUTE_LOCATION,
  boundingSphere: SHIP_BOUNDING_SPHERE,
};

const prepareShipForRendering = (ship: ShipLayerShip): PreparedShip | null => {
  if (
    !Number.isFinite(ship.longitude) ||
    !Number.isFinite(ship.latitude) ||
    !Number.isFinite(ship.altitudeMeters) ||
    !Number.isFinite(ship.headingRadians)
  ) {
    return null;
  }

  const directionFromEarthCenter = Cesium.Cartesian3.fromDegrees(
    ship.longitude,
    ship.latitude,
    ship.altitudeMeters,
    Cesium.Ellipsoid.WGS84,
    new Cesium.Cartesian3(),
  );
  Cesium.Cartesian3.normalize(directionFromEarthCenter, directionFromEarthCenter);

  return {
    ...ship,
    directionFromEarthCenter,
  };
};

export class ShipLayer {
  public readonly primitive: Primitive;

  private readonly pointLayer: CesiumPointTextureLayer<ShipLayerShip, PreparedShip>;
  public constructor(ships: readonly ShipLayerShip[] = [], options: ShipLayerOptions) {
    this.pointLayer = this.createPointLayer(options);
    this.pointLayer.setRecords(ships);
    this.primitive = this.pointLayer.primitive;
  }

  public updateShips(ships: readonly ShipLayerShip[]): void {
    this.pointLayer.setRecords(ships);
  }

  public setSprite(sprite: SvgSpriteRasterized): void {
    this.pointLayer.setSprite(this.normalizeSpriteInput(sprite));
  }

  public setVisibleShipIds(visibleShipIds: Iterable<string> | null): void {
    this.pointLayer.setVisiblePointIds(visibleShipIds);
  }

  public destroy(): void {
    this.pointLayer.destroy();
  }

  private createPointLayer(
    options: ShipLayerOptions,
  ): CesiumPointTextureLayer<ShipLayerShip, PreparedShip> {
    const descriptor: CesiumGpuPointLayerDescriptor<ShipLayerShip, PreparedShip> = {
      name: 'ShipLayer',
      shaders: SHIP_SHADER_CONFIG.shaders,
      uniforms: SHIP_SHADER_CONFIG.uniforms,
      indexAttributeName: SHIP_SHADER_CONFIG.indexAttributeName,
      indexAttributeLocation: SHIP_SHADER_CONFIG.indexAttributeLocation,
      boundingSphere: SHIP_SHADER_CONFIG.boundingSphere,
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
      prepareRecord: prepareShipForRendering,
      packMainData: (ship, output, valueOffset): void => {
        output[valueOffset] = ship.longitude;
        output[valueOffset + 1] = ship.latitude;
        output[valueOffset + 2] = ship.altitudeMeters;
        output[valueOffset + 3] = ship.headingRadians;
      },
      extraUniformMap: () => ({}),
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

export const DEFAULT_SHIP_LAYOUT = DEFAULT_LAYOUT;
