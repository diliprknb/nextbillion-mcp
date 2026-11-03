import * as z from 'zod/v4';
import { centroidAndLabel } from '../../geo/centroid.js';
import { normaliseArea } from '../../geo/convert.js';
import { textResult, type NbTool, type ToolResult } from '../types.js';
import {
  AreaGeometrySchema,
  GEOMETRY_TOOL_ANNOTATIONS,
  geometryInput,
  toLatLng,
} from './shared.js';

const Schema = z.strictObject({
  polygon: AreaGeometrySchema,
});

export const centroid: NbTool<typeof Schema> = {
  name: 'centroid',
  title: 'Centroid and Label Point of a Polygon',
  description:
    'The area-weighted centre of a polygon and a label point that is guaranteed to lie inside it ' +
    '(the centroid of a C- or ring-shaped area falls outside; the label point does not). Computed ' +
    'locally, no sign-in needed. Parameters: polygon (GeoJSON Polygon/MultiPolygon, or an isochrone ' +
    'Feature). Returns centroid, label_point ({latitude, longitude}) and centroid_inside. ' +
    'Example: {"polygon": {"type": "Polygon", "coordinates": [[[77.59, 12.97], [77.61, 12.97], ' +
    '[77.61, 12.99], [77.59, 12.99], [77.59, 12.97]]]}}',
  inputSchema: Schema,
  annotations: GEOMETRY_TOOL_ANNOTATIONS,
  async run(args): Promise<ToolResult> {
    return geometryInput(() => {
      const r = centroidAndLabel(normaliseArea(args.polygon));
      const out = {
        centroid: toLatLng(r.centroid),
        label_point: toLatLng(r.labelPoint),
        centroid_inside: r.centroidInside,
      };
      return textResult(
        `Centroid ${out.centroid.latitude}, ${out.centroid.longitude} (${r.centroidInside ? 'inside' : 'outside'} the shape); label point ${out.label_point.latitude}, ${out.label_point.longitude}.`,
        out,
      );
    });
  },
};
