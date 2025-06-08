import { startsWith } from "@std/bytes";
import {
  Compression,
  EMPTY_UINT8_ARRAY,
  LOCAL_FILE_SIGNATURE,
} from "./constants.ts";

async function readAll(
  reader: ReadableStreamBYOBReader,
  buffer: ArrayBufferLike,
) {
  let byteOffset = 0;
  for (;;) {
    const { done, value } = await reader.read(
      new Uint8Array(buffer, byteOffset),
    );
    if (value) {
      buffer = value.buffer;
      byteOffset = value.byteOffset + value.byteLength;
    }
    // Trop ou suffisament de place
    if (done) {
      return new Uint8Array(buffer, 0, byteOffset);
    }
    // Manque de place
    if (byteOffset >= buffer.byteLength) {
      return new Uint8Array(value.buffer);
    }
  }
}

interface LocalFileHeader {
  version: number;
  flags: number;
  compression: number;
  mode: [number, number];
  crc32: number;
  compressedSize: number;
  size: number;
  filenameLength: number;
  extraFieldsLength: number;
}

function createHeader(buffer: Uint8Array): LocalFileHeader {
  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset + LOCAL_FILE_SIGNATURE.byteLength,
  );
  return {
    version: view.getUint16(0, true),
    flags: view.getUint16(2, true),
    compression: view.getUint16(4, true),
    mode: [view.getUint16(8, true), view.getUint16(6, true)],
    crc32: view.getUint32(10, true),
    compressedSize: view.getUint32(14, true),
    size: view.getUint32(18, true),
    filenameLength: view.getUint16(22, true),
    extraFieldsLength: view.getUint16(24, true),
  };
}

interface DebugOptions {
  headerBuffer: Uint8Array;
  header: LocalFileHeader;
  filename: string;
  content: ReadableStream<Uint8Array>;
}

export class ZipEntryReadableStream extends ReadableStream<Uint8Array> {
  #reader: ReadableStreamBYOBReader;

  #compressedSize: number;

  #count: number;

  constructor(reader: ReadableStreamBYOBReader, compressedSize: number) {
    super({
      pull: async (controller) => {
        const chunk = await this.#read();
        controller.enqueue(chunk);
        if (this.consumed) {
          controller.close();
        }
      },
      cancel: async () => {
        while (this.consumed) {
          await this.#read();
        }
      },
    });
    this.#reader = reader;
    this.#compressedSize = compressedSize;
    this.#count = 0;
  }

  async #read(): Promise<Uint8Array<ArrayBufferLike>> {
    if (this.consumed) {
      return EMPTY_UINT8_ARRAY;
    }
    const chunk = await readAll(
      this.#reader,
      new ArrayBuffer(Math.min(this.remaning, 8096)),
    );
    this.#count += chunk.byteLength;
    return chunk;
  }

  get remaning(): number {
    return this.#compressedSize - this.#count;
  }

  get consumed(): boolean {
    return this.remaning <= 0;
  }
}

function getZipStream(
  reader: ReadableStreamBYOBReader,
  { compressedSize, compression }: LocalFileHeader,
): ReadableStream<Uint8Array> {
  if (compressedSize === 0) {
    return new ReadableStream<Uint8Array>({
      pull: (controller) => controller.close(),
    });
  }
  let stream: ReadableStream<Uint8Array> = new ZipEntryReadableStream(
    reader,
    compressedSize,
  );
  if (compression === Compression.DEFLATED) {
    stream = stream.pipeThrough(new DecompressionStream("deflate-raw"));
  }
  return stream;
}

async function* unzip(
  readable: ReadableStream<Uint8Array>,
): AsyncGenerator<DebugOptions> {
  const decoder = new TextDecoder();
  const reader = readable.getReader({ mode: "byob" });
  let headerBuffer = await readAll(reader, new ArrayBuffer(30));
  if (!startsWith(headerBuffer, LOCAL_FILE_SIGNATURE)) {
    reader.releaseLock();
    await readable.cancel();
    throw new Error("Invalid zip");
  }
  do {
    const header = createHeader(headerBuffer);
    const filename = await readAll(
      reader,
      new ArrayBuffer(header.filenameLength),
    );
    if (header.extraFieldsLength > 0) {
      await readAll(reader, new ArrayBuffer(header.extraFieldsLength));
    }
    const content = getZipStream(reader, header);
    yield {
      filename: decoder.decode(filename),
      header,
      headerBuffer,
      content: content,
    };
    headerBuffer = await readAll(reader, headerBuffer.buffer);
  } while (startsWith(headerBuffer, LOCAL_FILE_SIGNATURE));
  reader.releaseLock();
  await readable.cancel();
}

async function main(): Promise<number> {
  for await (const options of unzip(Deno.stdin.readable)) {
    console.log(options.filename);
    await options.content.cancel();
    // await options.content.pipeTo(Deno.stdout.writable, { preventClose: true });
  }
  return 0;
}

if (import.meta.main) {
  Deno.exit(await main());
}
