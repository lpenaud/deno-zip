import { concatBytes } from "./utils.ts";

export interface CentralDirectoryHeader {
  offset: number;
  version: Uint8Array;
  versionNeeded: number;
  flags: Uint8Array;
  compression: number;
  modeTime: Uint8Array;
  modeDate: Uint8Array;
  crc32: Uint8Array;
  compressedSize: Uint8Array;
  size: Uint8Array;
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

const HEADER_LENGTH = 0x2E;

function createHeader(buffer: Uint8Array): CentralDirectoryHeader {
  return {
    offset: buffer.byteOffset,
    version: buffer.subarray(0x04, 0x06),
    versionNeeded: buffer.subarray(0x06, 0x08).reduce(concatBytes),
    flags: buffer.slice(0x08, 0x0A),
    compression: buffer.subarray(0x0A, 0x0C).reduce(concatBytes),
    modeTime: buffer.slice(0x0C, 0x0E),
    modeDate: buffer.slice(0x0E, 0x10),
    crc32: buffer.slice(0x10, 0x14).toReversed(),
    compressedSize: buffer.slice(0x14, 0x18),
    size: buffer.slice(0x18, 0x1C),
    filenameLength: buffer.slice(0x1C, 0x1E).reduce(concatBytes),
    extraFieldsLength: buffer.slice(0x1E, 0x20).reduce(concatBytes),
    commentLength: buffer.slice(0x20, 0x22).reduce(concatBytes),
    diskStart: buffer.slice(0x22, 0x24),
    internalAttributes: buffer.slice(0x24, 0x26),
    externalAttributes: buffer.slice(0x26, 0x2A),
    offsetLocalHeader: buffer.subarray(0x2A, HEADER_LENGTH).reduce(concatBytes),
  };
}

function fromHeader(
  header: CentralDirectoryHeader,
  buffer: Uint8Array,
): CentralDirectory {
  const decoder = new TextDecoder();
  return {
    header,
    filename: decoder.decode(buffer.subarray(0, header.filenameLength)),
    extraFields: buffer.subarray(
      header.filenameLength,
      header.filenameLength + header.extraFieldsLength,
    ),
    comment: decoder.decode(
      buffer.subarray(
        header.filenameLength + header.extraFieldsLength,
        header.filenameLength + header.extraFieldsLength + header.commentLength,
      ),
    ),
  };
}

export function createCentralDirectory(
  buffer: Uint8Array,
  start: number,
): { end: number; centralDirectory: CentralDirectory } {
  let end = start + HEADER_LENGTH;
  const header = createHeader(buffer.subarray(start, end));
  start = end;
  end += header.filenameLength + header.extraFieldsLength +
    header.commentLength;
  return {
    centralDirectory: fromHeader(header, buffer.subarray(start, end)),
    end,
  };
}
