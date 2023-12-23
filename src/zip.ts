/**
 * https://users.cs.jmu.edu/buchhofp/forensics/formats/pkzip.html
 * https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream
 * 
 * TODO:
 *   - Use DecompressionStream
 *   - Seek because sometime data information are after file data
 *   - Use the checksum (crc32)?
 *   - Use one buffer?
 */

interface ZipEntryHeader {
  version: number;
  flags: Uint8Array;
  compression: number;
  modeTime: Uint8Array;
  modeDate: Uint8Array;
  crc32: Uint8Array;
  compressedSize: number;
  size: number;
  filename: number;
  extraFields: number;
}

interface ZipEntryOptions {
  reader: ReadableStreamBYOBReader;
  compressedSize: number;
  filename: string;
  buffer: Uint8Array;
}

const SIGNATURE = Object.freeze([0x50, 0x4B, 0x03, 0x04]);

function concatBytes(a: number, b: number, i: number): number {
  return a + (b << (i * 4));
}

function bufferFileEntry(
  buffer: ArrayBuffer,
  { compressedSize }: ZipEntryHeader,
): Uint8Array {
  return new Uint8Array(
    buffer,
    0,
    compressedSize > buffer.byteLength ? buffer.byteLength : compressedSize,
  );
}

class ZipEntry {
  #reader: ReadableStreamBYOBReader;

  #remaining: number;

  #buffer: Uint8Array;

  #filename: string;

  get consumed(): boolean {
    return this.#remaining === 0;
  }

  get filename(): string {
    return this.#filename;
  }

  get buffer(): ArrayBuffer {
    return this.#buffer.buffer;
  }

  constructor({ reader, compressedSize, filename, buffer }: ZipEntryOptions) {
    this.#reader = reader;
    this.#remaining = compressedSize;
    this.#buffer = buffer;
    this.#filename = filename;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
    do {
      const { value } = await this.#reader.read(this.#buffer);
      if (value !== undefined) {
        this.#remaining = this.#remaining - value.length;
        this.#buffer = new Uint8Array(value.buffer, 0, this.#remaining);
        yield value;
      }
    } while (!this.consumed);
  }
}

class UnZip {
  #reader: ReadableStream;

  #decoder: TextDecoder;

  static async fromFile(filename: string | URL) {
    return new UnZip((await Deno.open(filename)).readable);
  }

  constructor(reader: ReadableStream) {
    this.#reader = reader;
    this.#decoder = new TextDecoder();
  }

  entryHeader(chunk: Uint8Array): ZipEntryHeader {
    if (!SIGNATURE.every((v, i) => v === chunk[i])) {
      throw new Error("Invalid signature");
    }
    return {
      // 20 -> 2.0
      version: chunk.subarray(0x4, 0x6).reduce(concatBytes, 0),
      // 0-15
      flags: chunk.slice(0x6, 0x8),
      // 0 -> RAW, 8 -> DEFLATE
      compression: chunk.subarray(0x8, 0xA).reduce(concatBytes, 0),
      modeTime: chunk.slice(0xA, 0xC),
      modeDate: chunk.slice(0xC, 0xE),
      crc32: chunk.slice(0xE, 0x12),
      compressedSize: chunk.subarray(0x12, 0x16).reduce(concatBytes, 0),
      size: chunk.subarray(0x16, 0x1A).reduce(concatBytes, 0),
      filename: chunk.subarray(0x1A, 0x1C).reduce(concatBytes, 0),
      extraFields: chunk.subarray(0x1C, 0x1E).reduce(concatBytes, 0),
    };
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<ZipEntry> {
    const reader = this.#reader.getReader({ mode: "byob" });
    let headerBuffer = new ArrayBuffer(0x1E);
    let variableBuffer = new ArrayBuffer(0x1FE);
    let fileBuffer = new ArrayBuffer(4096);
    for (;;) {
      const it = await reader.read(new Uint8Array(headerBuffer));
      if (it.value === undefined) {
        break;
      }
      const header = this.entryHeader(it.value);
      const itVariable = await reader.read(
        new Uint8Array(variableBuffer, 0, header.filename + header.extraFields),
      );
      if (itVariable.value === undefined) {
        throw new Error("Pb read filename entry");
      }
      const filename = this.#decoder.decode(
        itVariable.value.subarray(0, header.filename),
      );
      const entry = new ZipEntry({
        reader,
        compressedSize: header.compressedSize,
        filename,
        buffer: bufferFileEntry(fileBuffer, header),
      });
      yield entry;
      if (it.done) {
        break;
      }
      if (!entry.consumed) {
        // FIXME: Seek the file
        for await (const _b of entry) {
          // consume the file length.
        }
      }
      headerBuffer = it.value.buffer;
      variableBuffer = itVariable.value.buffer;
      fileBuffer = entry.buffer;
    }
  }

  cancel(): Promise<void> {
    return this.#reader.cancel();
  }
}

async function main(args: string[]): Promise<number> {
  if (args.length !== 1) {
    console.error("Usage:", "zip", "INFILE");
    return 1;
  }
  const unzip = await UnZip.fromFile(args[0]);
  try {
    for await (const entry of unzip) {
      console.log(entry);
    }
  } catch (error) {
    console.error(error);
    return 1;
  } finally {
    await unzip.cancel();
  }
  return 0;
}

if (import.meta.main) {
  main(Deno.args.slice())
    .then(Deno.exit);
}
