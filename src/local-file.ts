import { subarrays } from "./utils.ts";
import { concatBytes } from "./utils.ts";

export interface LocalFileHeader {
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

export interface LocalFile {
  header: LocalFileHeader;
  filename: string;
  extraFields: Uint8Array;
}

const HEADER_LENGTH = 0x1E;

const HEADER = [
  // Signature
  // 4,
  // Version
  2,
  // Flags
  2,
  // Compression
  2,
  // Mode time
  2,
  // Mode date
  2,
  // CRC-32
  4,
  // Compressed size
  4,
  // Uncompressed size
  4,
  // Filename length
  2,
  // Extra fields length
  2,
];

function createHeader(buffer: Uint8Array) {
  const it = subarrays(buffer, HEADER);
  const header: LocalFileHeader = {
    version: it.next().value.reduce(concatBytes),
    flags: it.next().value.slice(),
    compression: it.next().value.reduce(concatBytes),
    modeTime: it.next().value.slice(),
    modeDate: it.next().value.slice(),
    crc32: it.next().value.toReversed(),
    compressedSize: it.next().value.reduce(concatBytes),
    size: it.next().value.reduce(concatBytes),
    filenameLength: it.next().value.reduce(concatBytes),
    extraFieldsLength: it.next().value.reduce(concatBytes),
  };
  return { header, headerEndBuffer: it.next().value };
}

function fromHeader(
  header: LocalFileHeader,
  buffer: Uint8Array,
) {
  const decoder = new TextDecoder();
  const it = subarrays(buffer, [
    header.filenameLength,
    header.extraFieldsLength,
  ]);
  const localFile: LocalFile = {
    header,
    filename: decoder.decode(it.next().value),
    extraFields: it.next().value.slice(),
  };
  return { localFile, endBuffer: it.next().value };
}

export function createLocalFile(buffer: Uint8Array) {
  const { header, headerEndBuffer } = createHeader(buffer);
  const { localFile, endBuffer } = fromHeader(header, headerEndBuffer);
  return {
    localFile,
    endBuffer,
  };
}
