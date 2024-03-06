export function concatBytes(a: number, b: number, i: number): number {
  return a | (b << (i * 8));
}

export function* subarrays(
  buffer: Uint8Array,
  ends: Iterable<number>,
): Generator<Uint8Array, Uint8Array> {
  let buf = buffer;
  for (const end of ends) {
    yield buf.subarray(0, end);
    buf = buf.subarray(end);
  }
  return buf;
}
