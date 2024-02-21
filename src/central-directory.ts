import { concatBytes, subarrays } from "./utils.ts";

export interface CentralDirectoryHeader {
  version: Uint8Array;
  versionNeeded: number;
  flags: Uint8Array;
  compression: number;
  modeTime: Uint8Array;
  modeDate: Uint8Array;
  crc32: Uint8Array;
  compressedSize: number;
  size: number;
  filenameLength: number;
  extraFieldsLength: number;
  commentLength: number;
  diskStart: Uint8Array;
  internalAttributes: Uint8Array;
  externalAttributes: Uint8Array;
  offsetLocalHeader: number;
}

export interface CentralDirectory {
  header: CentralDirectoryHeader;
  filename: string;
  extraFields: Uint8Array;
  comment: string;
}

const HEADER = [
  // Signature
  // 4,
  // Version
  2,
  // Version needed
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
  // File comment length
  2,
  // Disk # start
  2,
  // Internal attributes
  2,
  // External attributes
  4,
  // Local header offset
  4,
];

function createHeader(buffer: Uint8Array) {
  const it = subarrays(buffer, HEADER);
  const header: CentralDirectoryHeader = {
    version: it.next().value.slice(),
    versionNeeded: it.next().value.reduce(concatBytes),
    flags: it.next().value.slice(),
    compression: it.next().value.reduce(concatBytes),
    modeTime: it.next().value.slice(),
    modeDate: it.next().value.slice(),
    crc32: it.next().value.toReversed(),
    compressedSize: it.next().value.reduce(concatBytes),
    size: it.next().value.reduce(concatBytes),
    filenameLength: it.next().value.reduce(concatBytes),
    extraFieldsLength: it.next().value.reduce(concatBytes),
    commentLength: it.next().value.reduce(concatBytes),
    diskStart: it.next().value.slice(),
    internalAttributes: it.next().value.slice(),
    externalAttributes: it.next().value.slice(),
    offsetLocalHeader: it.next().value.reduce(concatBytes),
  };
  return { header, headerEndBuffer: it.next().value };
}

function fromHeader(
  header: CentralDirectoryHeader,
  buffer: Uint8Array,
) {
  const decoder = new TextDecoder();
  const it = subarrays(buffer, [
    header.filenameLength,
    header.extraFieldsLength,
    header.commentLength,
  ]);
  const centralDirectory: CentralDirectory = {
    header,
    filename: decoder.decode(it.next().value),
    extraFields: it.next().value.slice(),
    comment: decoder.decode(it.next().value),
  };
  return {
    centralDirectory,
    endBuffer: it.next().value,
  };
}

export function createCentralDirectory(buffer: Uint8Array) {
  const { header, headerEndBuffer } = createHeader(buffer);
  const { centralDirectory, endBuffer } = fromHeader(header, headerEndBuffer);
  return {
    centralDirectory,
    endBuffer,
  };
}
