import { startsWith } from "@std/bytes";
import {
  Compression,
  EMPTY_UINT8_ARRAY,
  LOCAL_FILE_SIGNATURE,
} from "./constants.ts";
import * as stdPath from "@std/path";
import * as stdFs from "@std/fs";
import * as stdStreams from "@std/streams";

class ByobTransformStream {

  #views: Uint8Array[];

  #reader: ReadableStreamDefaultReader<Uint8Array>;

  #byteLength: number;

  constructor(readable: ReadableStream<Uint8Array>) {
    this.#reader = readable.getReader();
    this.#views = [];
    this.#byteLength = 0;
  }

  async read(n: number): Promise<Uint8Array> {
    let r = new Uint8Array(n);
    if (n === 0) {
      return r;
    }
    while (this.#byteLength <= n) {
      const { done, value } = await this.#reader.read();
      if (value) {
        this.#views.push(value.slice());
        this.#byteLength += value.byteLength;
      }
      if (done) {
        break;
      }
    }
    let i: number;
    for (i = 0; i < this.#views.length; i++) {
      const v = this.#views[i];
      const copied = v.subarray(0, Math.min(r.byteLength, v.byteLength));
      r.set(copied);
      r = r.subarray(copied.byteLength);
      if (r.byteLength === 0) {
        if (copied.byteLength !== v.byteLength) {
          this.#views[i] = v.subarray(copied.byteLength);
        } else {
          i++;
        }
        break;
      }
    }
    this.#views.splice(0, i);
    this.#byteLength -= n;
    return new Uint8Array(r.buffer);
  }

  cancel(reason?: string): Promise<void> {
    return this.#reader.cancel(reason);
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

interface ZipEntry {
  headerBuffer: Uint8Array;
  header: LocalFileHeader;
  filename: string;
  readable: ReadableStream<Uint8Array>;
}

class ZipEntryReadableStream extends ReadableStream<Uint8Array> {
  #reader: ByobTransformStream;

  #compressedSize: number;

  #count: number;

  constructor(reader: ByobTransformStream, compressedSize: number) {
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

  async #read(): Promise<Uint8Array<ArrayBufferLike> | undefined> {
    if (this.consumed) {
      return undefined;
    }
    const chunk = await this.#reader.read(Math.min(this.remaning, 16_640));
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
  // reader: ReadableStreamBYOBReader,
  reader: ByobTransformStream,
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
): AsyncGenerator<ZipEntry> {
  const decoder = new TextDecoder();
  const reader = new ByobTransformStream(readable);
  let headerBuffer = await reader.read(30);
  if (!startsWith(headerBuffer, LOCAL_FILE_SIGNATURE)) {
    await reader.cancel();
    throw new Error("Invalid zip");
  }
  do {
    const header = createHeader(headerBuffer);
    const filename = await reader.read(header.filenameLength);
    // TODO: Parse extra fields
    await reader.read(header.extraFieldsLength);
    const readable = getZipStream(reader, header);
    yield {
      filename: decoder.decode(filename),
      header,
      headerBuffer,
      readable,
    };
    headerBuffer = await reader.read(headerBuffer.byteLength);
  } while (startsWith(headerBuffer, LOCAL_FILE_SIGNATURE));
  await reader.cancel();
}

interface MainArgs {
  infile: Deno.FsFile;
  outdir: string;
}

async function prepareArgs([inpath, outdir]: string[]): Promise<MainArgs> {
  const [infile] = await Promise.all([
    Deno.open(inpath),
    stdFs.ensureDir(outdir),
  ]);
  return { infile, outdir: stdPath.resolve(outdir) };
}

async function main(args: string[]): Promise<number> {
  if (args.length !== 2) {
    console.error(
      "Usage:",
      import.meta.filename ?? import.meta.url,
      "INFILE",
      "OUTDIR",
    );
    return 1;
  }
  const { infile, outdir } = await prepareArgs(args);
  for await (const options of unzip(infile.readable)) {
    const outpath = stdPath.join(outdir, options.filename);
    console.log(options.filename, "=>", outpath);
    if (options.filename.endsWith("/")) {
      await Deno.mkdir(outpath);
      continue;
    }
    const outfile = await Deno.open(outpath, {
      write: true,
      createNew: true,
    });
    await options.readable.pipeTo(outfile.writable);
    // await options.content.pipeTo(Deno.stdout.writable, { preventClose: true });
  }
  return 0;
}

if (import.meta.main) {
  main(Deno.args.slice())
    .then(Deno.exit);
}
