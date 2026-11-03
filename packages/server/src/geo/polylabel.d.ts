declare module 'polylabel' {
  /** Pole of inaccessibility of a polygon (array of rings, [x, y] pairs). */
  export default function polylabel(
    polygon: number[][][] | [number, number][][],
    precision?: number,
    debug?: boolean,
  ): [number, number] & { distance: number };
}
