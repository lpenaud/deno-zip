
interface ZipEntryHeader {
  version: number;
  flags: Uint8Array;
  compression: number;
  modeTime: Uint8Array;
  modeDate: Uint8Array;
  crc32: Uint8Array;
  compressedSize: number;
  size: number;
  filenameLength: number;
  extraFieldsLength: number;
}

interface ZipEntry {
  header: ZipEntryHeader;
  filename: string;
  extraFields: Uint8Array;
}

/**
 * File header signature
 */
const SIGNATURE = Uint8Array.of(0x50, 0x4B, 0x03, 0x04);

function concatBytes(a: number, b: number, i: number): number {
  return a + (b << (i * 4));
}

function zipEntryHeader(buffer: Uint8Array): ZipEntryHeader {
  return {
    version: buffer.subarray(0x04, 0x06).reduce(concatBytes),
    flags: buffer.slice(0x06, 0x08),
    compression: buffer.subarray(0x08, 0x0A).reduce(concatBytes),
    modeTime: buffer.slice(0x0A, 0x0C),
    modeDate: buffer.slice(0x0C, 0x0E),
    crc32: buffer.slice(0x0E, 0x12),
    compressedSize: buffer.subarray(0x12, 0x16).reduce(concatBytes),
    size: buffer.subarray(0x16, 0x1A).reduce(concatBytes),
    filenameLength: buffer.subarray(0x1A, 0x1C).reduce(concatBytes),
    extraFieldsLength: buffer.subarray(0x1C, 0x1E).reduce(concatBytes),
  };
}

function zipEntry(header: ZipEntryHeader, buffer: Uint8Array): ZipEntry {
  const decoder = new TextDecoder();
  return {
    header,
    filename: decoder.decode(buffer.subarray(0, header.filenameLength)),
    extraFields: buffer.slice(header.filenameLength),
  };
}

async function* exploreZip(readable: ReadableStream<Uint8Array>): AsyncGenerator<ZipEntry> {
  let fileIndex = 0;
  let i = 0;
  for await (const buffer of readable) {
    while ((i = buffer.indexOf(SIGNATURE[0], i)) !== -1) {
      if (SIGNATURE.every((v, j) => v === buffer[i + j])) {
        const header = zipEntryHeader(buffer.subarray(i, i + 0x1E));
        i += 0x1E;
        yield zipEntry(header, buffer.subarray(i, i + header.filenameLength + header.extraFieldsLength));
        i += header.filenameLength + header.extraFieldsLength;
        continue;
      }
      i += SIGNATURE.length;
    }
    fileIndex += buffer.length;
  }
}

async function main([infile]: string[]): Promise<number> {
  if (infile === undefined) {
    console.error("Usage:", "zip", "INFILE");
    return 1;
  }
  const file = await Deno.open(infile);
  const files = await Array.fromAsync(exploreZip(file.readable));
  if (files.length !== 4) {
    console.error("Found less than 4 files");
    console.log("Find:", files.length);
    return 2;
  }
  console.log(files);
  return 0;
}

if (import.meta.main) {
  main(Deno.args.slice())
    .then(Deno.exit);
}
