import * as Cesium from 'cesium';
import {
  PlaneLayer,
  type PlaneLayerPlane,
} from './cesium/plane-layer';
import {
  ShipLayer,
  type ShipLayerShip,
} from './cesium/ship-layer';
import {
  EarthquakeLayer,
  type EarthquakeLayerEarthquake,
} from './cesium/earthquake-layer';

export interface PlaygroundLayers {
  planeLayer: PlaneLayer;
  shipLayer: ShipLayer;
  earthquakeLayer: EarthquakeLayer;
  updatePoints(data: {
    planes: PlaneLayerPlane[];
    ships: ShipLayerShip[];
    earthquakes: EarthquakeLayerEarthquake[];
  }): void;
}

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

  const planeLayer = new PlaneLayer([], {
    sprite: PLANE_SPRITE_SOURCE,
  });
  viewer.scene.primitives.add(planeLayer.primitive);

  return {
    planeLayer,
    shipLayer,
    earthquakeLayer,
    updatePoints(data) {
      planeLayer.updatePlanes(data.planes);
      shipLayer.updateShips(data.ships);
      earthquakeLayer.updateEarthquakes(data.earthquakes);
    },
  };
};
