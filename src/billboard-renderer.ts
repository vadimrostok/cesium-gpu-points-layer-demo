import * as Cesium from 'cesium';
import { type BasePointRecord } from 'cesium-gpu-points-layer';

export type RecordType = 'aircraft' | 'ship' | 'earthquake';

export interface LayerDefinition {
  type: RecordType;
  label: string;
  textureName: string;
  spritePath: string;
  spriteWidth: number;
  spriteHeight: number;
  pointScale: number;
  minPointSize?: number;
  maxPointSize?: number;
  rotationEnabled: boolean;
  enableAnimation: boolean;
  headingOffsetRadians: number;
  defaultAltitudeMeters: number;
  drawOrder: number;
}

type BillboardRecord = BasePointRecord & {
  directionX?: number;
  directionY?: number;
};

interface BillboardMotionState {
  billboard: Cesium.Billboard;
  baseLatitude: number;
  baseLongitude: number;
  altitudeMeters: number;
  directionX: number;
  directionY: number;
  rotationRadians: number;
  speedMetersPerSecond: number;
}

export interface BillboardRendererOptions {
  viewer: Cesium.Viewer;
  assetUrl: (path: string) => string;
  definitions: ReadonlyArray<LayerDefinition>;
}

const EARTH_RADIUS_METERS = Cesium.Ellipsoid.WGS84.maximumRadius;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isFinitePositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

export class BillboardRenderer {
  private readonly viewer: Cesium.Viewer;
  private readonly definitions: Array<LayerDefinition>;
  private readonly assetUrl: (path: string) => string;

  private readonly collectionByType = new Map<RecordType, Cesium.BillboardCollection>();
  private readonly recordsByType = new Map<RecordType, Array<BillboardRecord>>();
  private readonly statesByType = new Map<RecordType, Array<BillboardMotionState>>();
  private readonly allStates: Array<BillboardMotionState> = [];

  private readonly animatedPositionScratch = new Cesium.Cartographic();
  private readonly animatedCartesianScratch = new Cesium.Cartesian3();

  private readonly toRadians = (degrees: number): number => Cesium.Math.toRadians(degrees);
  private readonly normalizeHeading = (heading: number): number => Cesium.Math.zeroToTwoPi(heading);

  constructor(options: BillboardRendererOptions) {
    this.viewer = options.viewer;
    this.assetUrl = options.assetUrl;
    this.definitions = [...options.definitions].sort((left, right) => left.drawOrder - right.drawOrder);

    for (const definition of this.definitions) {
      const billboardCollection = new Cesium.BillboardCollection({
        scene: this.viewer.scene,
        blendOption: Cesium.BlendOption.OPAQUE,
      });
      billboardCollection.show = false;
      this.collectionByType.set(definition.type, billboardCollection);
      this.statesByType.set(definition.type, []);
      this.viewer.scene.primitives.add(billboardCollection);
    }
  }

  public setVisible(visible: boolean): void {
    for (const collection of this.collectionByType.values()) {
      collection.show = visible;
    }
  }

  public setRecords(recordsByType: ReadonlyMap<RecordType, Array<BasePointRecord>>): void {
    this.recordsByType.clear();
    for (const [type, records] of recordsByType.entries()) {
      this.recordsByType.set(type, [...records] as Array<BillboardRecord>);
    }
    this.syncAll();
  }

  private syncAll(): void {
    this.allStates.length = 0;
    for (const definition of this.definitions) {
      this.fillBillboardCollection(definition);
      const layerStates = this.statesByType.get(definition.type);
      if (!layerStates) {
        continue;
      }
      if (layerStates.length > 100_000) {
        // For some reason, pushing over 100k items with spread operator results in stack overflow exception.
        for (let i = 0; i < Math.ceil(layerStates.length/100_000); i++) {
          this.allStates.push(...layerStates.slice(i * 100_000, (i + 1) * 100_000));
        }
      } else {
        this.allStates.push(...layerStates);
      }
    }
  }

  private fillBillboardCollection(definition: LayerDefinition): void {
    const collection = this.collectionByType.get(definition.type);
    const records = this.recordsByType.get(definition.type) ?? [];
    if (!collection) {
      return;
    }

    collection.removeAll();
    this.statesByType.set(definition.type, []);
    const states = this.statesByType.get(definition.type);
    if (!states) {
      return;
    }

    const spriteUrl = this.assetUrl(definition.spritePath);
    const rotationOffset = definition.rotationEnabled ? definition.headingOffsetRadians : 0;

    for (const record of records) {
      const rotation = isFiniteNumber(record.rotationRadians) ? record.rotationRadians : 0;
      const rotationNormalized = this.normalizeHeading(rotation);
      const hasRotation = isFiniteNumber(record.rotationRadians);
      const hasMovementDirectionRadians = isFiniteNumber(record.movementDirectionRadians);
      const altitudeMeters = isFiniteNumber(record.altitudeMeters)
        ? record.altitudeMeters
        : definition.defaultAltitudeMeters;
      const speedMetersPerSecond =
        definition.enableAnimation && isFinitePositive(record.speedMetersPerSecond)
          ? record.speedMetersPerSecond
          : 0;

      const directionRecordX = isFiniteNumber((record as BillboardRecord).directionX)
        ? ((record as BillboardRecord).directionX ?? 0)
        : 0;
      const directionRecordY = isFiniteNumber((record as BillboardRecord).directionY)
        ? ((record as BillboardRecord).directionY ?? 0)
        : 0;
      const hasExplicitDirection = Math.hypot(directionRecordX, directionRecordY) > 0;
      const directionScale = hasExplicitDirection
        ? 1 / Math.hypot(directionRecordX, directionRecordY)
        : 0;
      const movementRadians = hasMovementDirectionRadians
        ? (record.movementDirectionRadians ?? 0)
        : rotationNormalized;
      // directionX is east, directionY is north, matching direction vector packing convention.
      const directionX = hasExplicitDirection ? directionRecordX * directionScale : speedMetersPerSecond > 0
        && (hasMovementDirectionRadians || hasRotation)
        ? Math.cos(movementRadians)
        : 0;
      const directionY = hasExplicitDirection ? directionRecordY * directionScale : speedMetersPerSecond > 0
        && (hasMovementDirectionRadians || hasRotation)
        ? Math.sin(movementRadians)
        : 0;
      const hasMotion = speedMetersPerSecond > 0 && (hasRotation || hasExplicitDirection || hasMovementDirectionRadians);

      const position = Cesium.Cartesian3.fromDegrees(
        record.longitude,
        record.latitude,
        altitudeMeters,
      );

      const billboard = collection.add({
        id: record.id,
        image: spriteUrl,
        position,
        width: definition.spriteWidth,
        height: definition.spriteHeight,
        // I tried disabling depth test, but it produced worse performance
        disableDepthTestDistance: 0,
        alignedAxis: Cesium.Cartesian3.ZERO,
        rotation: definition.rotationEnabled ? rotation + rotationOffset : 0,
        scaleByDistance: new Cesium.NearFarScalar(1_150_000, 0.5, 4_333_000, 0.1),
      });

      const state: BillboardMotionState = {
        billboard,
        baseLatitude: this.toRadians(record.latitude),
        baseLongitude: this.toRadians(record.longitude),
        altitudeMeters,
        directionX,
        directionY,
        rotationRadians: rotationNormalized,
        speedMetersPerSecond: hasMotion ? speedMetersPerSecond : 0,
      };
      states.push(state);
      billboard.show = true;
    }
  }

  public update(elapsedSeconds: number): void {
    for (const state of this.allStates) {
      if (state.speedMetersPerSecond > 0 && elapsedSeconds > 0) {
        const traveledMeters = state.speedMetersPerSecond * elapsedSeconds;
        if (traveledMeters <= 0) {
          continue;
        }
        if (state.directionX === 0 && state.directionY === 0) {
          continue;
        }

        const traveledAngularDistance = traveledMeters / EARTH_RADIUS_METERS;
        const angularDistanceSin = Math.sin(traveledAngularDistance);
        const angularDistanceCos = Math.cos(traveledAngularDistance);

        const baseLatitude = state.baseLatitude;
        const baseLongitude = state.baseLongitude;
        const baseSinLatitude = Math.sin(baseLatitude);
        const baseCosLatitude = Math.cos(baseLatitude);
        const baseSinLongitude = Math.sin(baseLongitude);
        const baseCosLongitude = Math.cos(baseLongitude);

        const baseNormalX = baseCosLatitude * baseCosLongitude;
        const baseNormalY = baseCosLatitude * baseSinLongitude;
        const baseNormalZ = baseSinLatitude;

        const eastUnitX = -baseSinLongitude;
        const eastUnitY = baseCosLongitude;
        const eastUnitZ = 0;

        const northUnitX = -baseSinLatitude * baseCosLongitude;
        const northUnitY = -baseSinLatitude * baseSinLongitude;
        const northUnitZ = baseCosLatitude;

        const directionX = northUnitX * state.directionY + eastUnitX * state.directionX;
        const directionY = northUnitY * state.directionY + eastUnitY * state.directionX;
        const directionZ = northUnitZ * state.directionY + eastUnitZ * state.directionX;
        const directionLength = Math.hypot(directionX, directionY, directionZ);
        if (directionLength <= 0) {
          continue;
        }
        const directionUnitX = directionX / directionLength;
        const directionUnitY = directionY / directionLength;
        const directionUnitZ = directionZ / directionLength;

        const nextNormalX = baseNormalX * angularDistanceCos + directionUnitX * angularDistanceSin;
        const nextNormalY = baseNormalY * angularDistanceCos + directionUnitY * angularDistanceSin;
        const nextNormalZ = baseNormalZ * angularDistanceCos + directionUnitZ * angularDistanceSin;

        this.animatedPositionScratch.longitude = Cesium.Math.zeroToTwoPi(
          Math.atan2(nextNormalY, nextNormalX),
        );
        this.animatedPositionScratch.latitude = Math.asin(Cesium.Math.clamp(nextNormalZ, -1, 1));
        this.animatedPositionScratch.height = state.altitudeMeters;

        Cesium.Cartographic.toCartesian(
          this.animatedPositionScratch,
          Cesium.Ellipsoid.WGS84,
          this.animatedCartesianScratch,
        );
        // Cloning without changing `state.billboard.position` is not working.
        // state.billboard.position.clone(this.animatedCartesianScratch);
        state.billboard.position = Cesium.Cartesian3.clone(this.animatedCartesianScratch);
      }
    }
  }
}
