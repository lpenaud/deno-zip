import { subarrays } from "./utils.ts";
import { Compression } from "./constants.ts";

export interface LocalFileHeader {
  version: number;
  flags: number;
  compression: number;
  modeTime: number;
  modeDate: number;
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

function createHeader(buffer: Uint8Array) {
  const view = new DataView(buffer.buffer, buffer.byteOffset);
  const header: LocalFileHeader = {
    version: view.getUint16(0, true),
    flags: view.getUint16(2, true),
    compression: view.getUint16(4, true),
    modeTime: view.getUint16(6, true),
    modeDate: view.getUint16(8, true),
    // Big endian
    crc32: Uint8Array.of(
      view.getUint8(13),
      view.getUint8(12),
      view.getUint8(11),
      view.getUint8(10),
    ),
    compressedSize: view.getUint32(14, true),
    size: view.getUint32(18, true),
    filenameLength: view.getUint16(22, true),
    extraFieldsLength: view.getUint16(24, true),
  };
  return { header, headerEndBuffer: buffer.subarray(26) };
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

  get compressedSize(): number {
    return this.#info.header.compressedSize;
  }

  get remaning(): number {
    return this.compressedSize - this.#byteRead;
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
    this.#byteRead =
      this.compressedSize < (this.#currentLength - this.#currentOffset)
        ? this.compressedSize
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
    if (this.compressedSize < (this.#currentLength - this.#currentOffset)) {
      yield new Uint8Array(this.#buffer, this.#currentOffset, this.compressedSize);
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
