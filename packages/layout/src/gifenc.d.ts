// gifenc ships no types; this is the surface we use.
declare module 'gifenc' {
  export type Palette = number[][];
  export function GIFEncoder(): {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts?: { palette?: Palette; delay?: number; repeat?: number; transparent?: boolean },
    ): void;
    finish(): void;
    bytes(): Uint8Array;
  };
  export function quantize(
    data: Uint8ClampedArray | Uint8Array,
    maxColors: number,
    opts?: { format?: string },
  ): Palette;
  export function applyPalette(data: Uint8ClampedArray | Uint8Array, palette: Palette, format?: string): Uint8Array;
}
