/** Geometry types shared by the local geometry tools. GeoJSON order is [longitude, latitude]. */

export type Position = [number, number];
export type Ring = Position[];
export type PolygonCoords = Ring[];
export type MultiPolygonCoords = PolygonCoords[];

export interface PolygonGeometry {
  type: 'Polygon';
  coordinates: PolygonCoords;
}
export interface MultiPolygonGeometry {
  type: 'MultiPolygon';
  coordinates: MultiPolygonCoords;
}
export type AreaGeometry = PolygonGeometry | MultiPolygonGeometry;

export interface LatLng {
  latitude: number;
  longitude: number;
}

export class GeometryError extends Error {}
