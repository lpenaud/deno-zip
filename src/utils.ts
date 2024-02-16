export function concatBytes(a: number, b: number, i: number): number {
  return a | (b << (i * 8));
}
