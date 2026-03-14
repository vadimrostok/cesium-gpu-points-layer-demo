import * as Cesium from 'cesium';
import {
  GenericPointLayer,
  type GenericPointLayerDescriptor,
} from './cesium/generic-point-layer';
import {
  ShipLayer,
  type ShipLayerShip,
} from './cesium/ship-layer';
import {
  EarthquakeLayer,
  type EarthquakeLayerEarthquake,
} from './cesium/earthquake-layer';
import { BasePointRecord } from './cesium/gpu-point-layer';

export interface PlaygroundLayers {
  planeLayer: GenericPointLayer<BasePointRecord>;
  shipLayer: ShipLayer;
  earthquakeLayer: EarthquakeLayer;
  updatePoints(data: {
    planes: BasePointRecord[];
    ships: ShipLayerShip[];
    earthquakes: EarthquakeLayerEarthquake[];
  }): void;
}

const PLANE_DEFAULT_POINT_SCALE = 70_000_000;
const PLANE_DEFAULT_MIN_POINT_SIZE = 30;
const PLANE_DEFAULT_MAX_POINT_SIZE = 128;
const PLANE_DEFAULT_MAX_EXTRAPOLATION_SECONDS = 60 * 60 * 24 * 365;
const PLANE_DEFAULT_MIN_ALTITUDE_METERS = 500;
const PLANE_POINT_INDEX_ATTRIBUTE_LOCATION = 0;
const PLANE_CULL_ANGLE = 0.5;
const PLANE_BOUNDING_SPHERE = new Cesium.BoundingSphere(
  Cesium.Cartesian3.ZERO,
  Cesium.Ellipsoid.WGS84.maximumRadius + 100_000,
);

const PLANE_LAYER_DESCRIPTOR: GenericPointLayerDescriptor = {
  name: 'PlaneLayer',
  attributeName: 'a_planeIndex',
  indexAttributeLocation: PLANE_POINT_INDEX_ATTRIBUTE_LOCATION,
  boundingSphere: PLANE_BOUNDING_SPHERE,
  cullDotThreshold: PLANE_CULL_ANGLE,
  headingOffsetRadians: -Math.PI / 2,
  shaderConfig: {
    dataTextureUniform: 'u_planeTexture',
    dataTextureDimensionsUniform: 'u_planeTextureDimensions',
    spriteTextureUniform: 'u_spriteTexture',
    motionTextureUniform: 'u_planeMotionTexture',
    nowSecondsUniform: 'u_nowSeconds',
    maxExtrapolationSecondsUniform: 'u_maxExtrapolationSeconds',
    rotationEnabledUniform: 'u_rotationEnabled',
  },
};

const PLANE_SPRITE_SOURCE = {
  url: '/svgs/medium-plane-2.svg',
  width: 80,
  height: 80,
  resolution: 2,
};

const SHIP_SPRITE_SOURCE = {
  url: '/svgs/ship.svg',
  width: 96,
  height: 96,
  resolution: 2,
};

const EARTHQUAKE_SPRITE_SOURCE = {
  url: '/svgs/earthquake.svg',
  width: 80,
  height: 80,
  resolution: 2,
};

export const createPlaygroundLayers = (viewer: Cesium.Viewer): PlaygroundLayers => {
  const earthquakeLayer = new EarthquakeLayer([], {
    sprite: EARTHQUAKE_SPRITE_SOURCE,
  });
  viewer.scene.primitives.add(earthquakeLayer.primitive);

  const shipLayer = new ShipLayer([], {
    sprite: SHIP_SPRITE_SOURCE,
  });
  viewer.scene.primitives.add(shipLayer.primitive);

  const planeLayer = new GenericPointLayer<BasePointRecord>([], PLANE_LAYER_DESCRIPTOR, {
    sprite: PLANE_SPRITE_SOURCE,
    pointScale: PLANE_DEFAULT_POINT_SCALE,
    minPointSize: PLANE_DEFAULT_MIN_POINT_SIZE,
    maxPointSize: PLANE_DEFAULT_MAX_POINT_SIZE,
    maxExtrapolationSeconds: PLANE_DEFAULT_MAX_EXTRAPOLATION_SECONDS,
    defaultAltitudeMeters: PLANE_DEFAULT_MIN_ALTITUDE_METERS,
  });
  viewer.scene.primitives.add(planeLayer.primitive);

  return {
    planeLayer,
    shipLayer,
    earthquakeLayer,
    updatePoints(data) {
      planeLayer.setRecords(data.planes);
      shipLayer.updateShips(data.ships);
      earthquakeLayer.updateEarthquakes(data.earthquakes);
    },
  };
};
