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

export function parseDate(modeDate: number, modeTime: number): Date {
  // Keep the 7 firsts bits
  const year = modeDate >>> 9;
  // Remove year and days
  const month = (modeDate & 511) >>> 5;
  // Keep the 5 lasts bits
  const day = modeDate & 31;
  // Keep 5 firsts bits and remove the minutes and seconds.
  const hours = modeTime >>> 11;
  // Remove hours and remove seconds.
  const minutes = (modeTime & 2047) >>> 5;
  // Keep the 5 lasts bits
  const seconds = modeTime & 31;
  return new Date(1980 + year, month - 1, day, hours, minutes, seconds * 2);
}
