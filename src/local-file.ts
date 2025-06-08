import { parseDate } from "./utils.ts";
import { Compression } from "./constants.ts";
import { type ByobBuffer } from "./byob-buffer.ts";

export interface LocalFileHeader {
  version: number;
  flags: number;
  compression: number;
  mode: Date;
  crc32: number;
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

export interface LocalFileZipEntryOptions {
  info: LocalFile;
  reader: ReadableStreamBYOBReader;
  view: Uint8Array;
}

const HEADER_LENGTH = 30;

function createHeader(buffer: Uint8Array): LocalFileHeader {
  const view = new DataView(buffer.buffer, buffer.byteOffset);
  return {
    version: view.getUint16(0, true),
    flags: view.getUint16(2, true),
    compression: view.getUint16(4, true),
    mode: parseDate(view.getUint16(8, true), view.getUint16(6, true)),
    crc32: view.getUint32(10, true),
    compressedSize: view.getUint32(14, true),
    size: view.getUint32(18, true),
    filenameLength: view.getUint16(22, true),
    extraFieldsLength: view.getUint16(24, true),
  };
}

async function fromHeader(
  header: LocalFileHeader,
  buffer: ByobBuffer,
) {
  const decoder = new TextDecoder();
  const localFile: LocalFile = {
    header,
    filename: decoder.decode(await buffer.read(header.filenameLength)),
    extraFields: (await buffer.read(header.extraFieldsLength)).slice(),
  };
  return localFile;
}

export async function createLocalFile(buffer: ByobBuffer) {
  const header = createHeader(await buffer.read(0x1A));
  return fromHeader(header, buffer);
}

export class LocalFileZipEntry {
  #info: LocalFile;

  #reader: ReadableStreamBYOBReader;

  #byteRead: number;

  #buffer: ArrayBufferLike;

  #currentOffset: number;

  #currentLength: number;

  get header(): LocalFileHeader {
    return this.#info.header;
  }

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

  get isDirectory(): boolean {
    return this.filename.endsWith("/");
  }

  get isFile(): boolean {
    return !this.isDirectory;
  }

  get compression(): Compression {
    return this.#info.header.compression;
  }

  get isDeflated(): boolean {
    return this.compression === Compression.DEFLATED;
  }

  get isRaw(): boolean {
    return this.compression === Compression.RAW;
  }

  get readable(): ReadableStream<Uint8Array> {
    const stream = ReadableStream.from(this);
    return this.isDeflated
      ? stream.pipeThrough(new DecompressionStream("deflate-raw"))
      : stream;
  }

  constructor({ info, reader, view }: LocalFileZipEntryOptions) {
    this.#info = info;
    this.#reader = reader;
    this.#buffer = view.buffer;
    this.#currentOffset = view.byteOffset + HEADER_LENGTH +
      info.filename.length +
      info.extraFields.byteLength;
    this.#currentLength = view.byteLength;
    this.#byteRead =
      this.compressedSize < (this.#currentLength - this.#currentOffset)
        ? this.compressedSize
        : this.#currentLength - this.#currentOffset;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array, void> {
    let buffer: Uint8Array | undefined;
    if (this.compressedSize < (this.#currentLength - this.#currentOffset)) {
      yield new Uint8Array(
        this.#buffer,
        this.#currentOffset,
        this.compressedSize,
      );
      return;
    }
    yield new Uint8Array(this.#buffer, this.#currentOffset);
    while ((buffer = await this.#read()) !== undefined) {
      yield buffer;
    }
  }

  async #read(): Promise<Uint8Array | undefined> {
    if (this.consumed) {
      return;
    }
    const length = this.remaning > this.#buffer.byteLength
      ? this.#buffer.byteLength
      : this.remaning;
    const { value: view, done } = await this.#reader.read(
      new Uint8Array(this.#buffer, 0, length),
    );
    if (done) {
      throw new Error("Try to read consumed stream");
    }
    this.#byteRead += view.byteLength;
    this.#buffer = view.buffer;
    return view;
  }
}
