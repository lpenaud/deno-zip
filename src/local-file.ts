import { concatBytes } from "./utils.ts";

export interface LocalFileHeader {
  offset: number;
  version: number;
  flags: Uint8Array;
  compression: number;
  modeTime: Uint8Array;
  modeDate: Uint8Array;
  crc32: Uint8Array;
  compressedSize: Uint8Array;
  size: Uint8Array;
  filenameLength: number;
  extraFieldsLength: number;
}

export interface LocalFile {
  header: LocalFileHeader;
  filename: string;
  extraFields: Uint8Array;
}

const HEADER_LENGTH = 0x1E;

function createHeader(buffer: Uint8Array): LocalFileHeader {
  return {
    offset: buffer.byteOffset,
    version: buffer.subarray(0x04, 0x06).reduce(concatBytes),
    flags: buffer.slice(0x06, 0x08),
    compression: buffer.subarray(0x08, 0x0A).reduce(concatBytes),
    modeTime: buffer.slice(0x0A, 0x0C),
    modeDate: buffer.slice(0x0C, 0x0E),
    crc32: buffer.slice(0x0E, 0x12).toReversed(),
    compressedSize: buffer.slice(0x12, 0x16),
    size: buffer.slice(0x16, 0x1A),
    filenameLength: buffer.subarray(0x1A, 0x1C).reduce(concatBytes),
    extraFieldsLength: buffer.subarray(0x1C, HEADER_LENGTH).reduce(concatBytes),
  };
}

function fromHeader(
  header: LocalFileHeader,
  buffer: Uint8Array,
): LocalFile {
  const decoder = new TextDecoder();
  return {
    header,
    filename: decoder.decode(buffer.subarray(0, header.filenameLength)),
    extraFields: buffer.slice(header.filenameLength),
  };
}

export function createLocalFile(
  buffer: Uint8Array,
  start: number,
): { end: number; localFile: LocalFile } {
  let end = start + HEADER_LENGTH;
  const header = createHeader(buffer.subarray(start, end));
  start = end;
  end += header.filenameLength + header.extraFieldsLength;
  return {
    localFile: fromHeader(header, buffer.subarray(start, end)),
    end,
  };
}
