import { subarrays } from "./utils.ts";
import { concatBytes } from "./utils.ts";
import { Compression } from "./constants.ts";

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

export interface LocalFileZipEntryOptions {
  info: LocalFile;
  reader: ReadableStreamBYOBReader;
  buffer: Uint8Array;
}

export class LocalFileZipEntry {
  #info: LocalFile;

  #reader: ReadableStreamBYOBReader;

  #byteRead: number;

  #buffer: ArrayBuffer;

  #currentOffset: number;

  #currentLength: number;

  get filename(): string {
    return this.#info.filename;
  }

  get byteLength(): number {
    return this.#info.header.compressedSize;
  }

  get remaning(): number {
    return this.byteLength - this.#byteRead;
  }

  get consumed(): boolean {
    return this.remaning === 0;
  }

  constructor({ info, reader, buffer }: LocalFileZipEntryOptions) {
    this.#info = info;
    this.#reader = reader;
    this.#buffer = buffer.buffer;
    this.#currentOffset = buffer.byteOffset;
    this.#currentLength = buffer.byteLength;
    this.#byteRead = this.byteLength < (this.#currentLength - this.#currentOffset)
      ? this.byteLength
      : this.#currentLength - this.#currentOffset;
  }

  readable(): ReadableStream<Uint8Array> {
    const stream = ReadableStream.from(this);
    return this.#info.header.compression === Compression.DEFLATED
      ? stream.pipeThrough(new DecompressionStream("deflate"))
      : stream;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
    let buffer: Uint8Array | undefined;
    if (this.byteLength < (this.#currentLength - this.#currentOffset)) {
      yield new Uint8Array(this.#buffer, this.#currentOffset, this.byteLength);
      return;
    }
    yield new Uint8Array(this.#buffer, this.#currentOffset);
    while ((buffer = await this.#read()) !== undefined) {
      yield buffer;
    }
  }

  async #read(): Promise<Uint8Array | undefined> {
    if (this.consumed) {
      return undefined;
    }
    const length = this.remaning > this.#buffer.byteLength
      ? this.#buffer.byteLength
      : this.remaning;
    const { value: buffer } = await this.#reader.read(
      new Uint8Array(this.#buffer, 0, length),
    );
    if (buffer === undefined) {
      return undefined;
    }
    // console.error(buffer.byteOffset, buffer.byteLength);
    this.#byteRead += buffer.byteLength;
    this.#buffer = buffer.buffer;
    return buffer;
  }
}
