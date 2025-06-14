import { startsWith } from "@std/bytes";
import { Compression, LOCAL_FILE_SIGNATURE } from "./constants.ts";
import * as stdPath from "@std/path";
import * as stdFs from "@std/fs";

interface InternalLocalFileHeader {
  version: number;
  flags: number;
  compression: number;
  crc32: Uint8Array;
  compressedSize: number;
  size: number;
  filenameLength: number;
  extraFieldsLength: number;
  date: Date | undefined;
}

interface ZipEntryHeader {
  version: number;
  flags: number;
  compression: number;
  date: Date | undefined;
  crc32: number;
  compressedSize: number;
  size: number;
  filename: string;
  extraFields: [number, number][];
}

interface ZipEntry {
  header: ZipEntryHeader;
  readable: ReadableStream<Uint8Array>;
}

class BufferReader {
  #buffer: Uint8Array;

  #reader: ReadableStreamDefaultReader<Uint8Array>;

  #open: boolean;

  constructor(readable: ReadableStream<Uint8Array>) {
    this.#buffer = new Uint8Array(0);
    this.#reader = readable.getReader();
    this.#open = true;
  }

  cancel(reason: any) {
    this.#open = false;
    return this.#reader.cancel(reason);
  }

  async readNBytes(length: number): Promise<Uint8Array> {
    const b = new Uint8Array(length);
    return b.subarray(0, await this.read(b));
  }

  async read<T extends ArrayBufferLike>(
    destination: Uint8Array<T>,
  ): Promise<number> {
    let offset = 0;
    while (this.#open) {
      const r = this.#buffer.subarray(
        0,
        Math.min(destination.byteLength - offset, this.#buffer.byteLength),
      );
      destination.set(r, offset);
      offset += r.byteLength;
      this.#buffer = this.#buffer.subarray(r.byteLength);
      if (offset === destination.length) {
        break;
      }
      // Wait for data
      const done = await this.#wait();
      if (done === null) {
        break;
      }
    }
    return offset;
  }

  slice(dest: Uint8Array): number {
    const b = this.#buffer.subarray(0, Math.min(this.#buffer.byteLength, dest.byteLength));
    dest.set(b);
    this.#buffer = this.#buffer.subarray(b.byteLength);
    return b.byteLength;
  }

  async #wait(): Promise<void> {
    const { value, done } = await this.#reader.read();
    if (done) {
      this.#open = false;
      return;
    }
    this.#buffer = value;
  }
}


class UnzipTransformStream implements TransformStream<Uint8Array, ZipEntry> {
  #queue: BufferReader;

  #decoder: TextDecoder;

  #readable: ReadableStream<ZipEntry>;

  #writable: WritableStream<Uint8Array>;

  get readable(): ReadableStream<ZipEntry> {
    return this.#readable;
  }

  get writable(): WritableStream<Uint8Array> {
    return this.#writable;
  }

  constructor() {
    const { readable, writable } = new TransformStream<
      Uint8Array,
      Uint8Array
    >();
    this.#decoder = new TextDecoder();
    this.#queue = new BufferReader(readable);
    this.#readable = ReadableStream.from(this.#unzip());
    this.#writable = writable;
  }

  async *#unzip(): AsyncGenerator<ZipEntry> {
    let buf: Uint8Array;
    for (;;) {
      buf = await this.#queue.readNBytes(30);
      if (buf.byteLength !== 30 || !startsWith(buf, LOCAL_FILE_SIGNATURE)) {
        break;
      }
      const {
        compressedSize,
        compression,
        crc32,
        extraFieldsLength,
        filenameLength,
        flags,
        date,
        size,
        version,
      } = this.#createHeader(buf);
      const expectedLength = filenameLength + extraFieldsLength;
      buf = await this.#queue.readNBytes(expectedLength);
      if (buf.byteLength !== expectedLength) {
        throw new Error("Cannot read filename");
      }
      const filename = this.#decoder.decode(buf.subarray(0, filenameLength));
      const extraFields = this.#parseExtra(
        buf.buffer,
        filenameLength,
        extraFieldsLength,
      );
      let entryReadable = ReadableStream.from(this.#readEntryContent(compressedSize));
      if (compression === Compression.DEFLATED) {
        entryReadable = entryReadable.pipeThrough(
          new DecompressionStream("deflate-raw")
        );
      } else if (compression !== Compression.RAW) {
        console.warn("Unknown compression:", compression);
      }
      yield {
        header: {
          compressedSize,
          compression,
          crc32: 0,
          extraFields,
          filename,
          flags,
          date: new Date(),
          size,
          version,
        },
        readable: entryReadable,
      };
    }
  }

  async *#readEntryContent(compressedSize: number): AsyncGenerator<Uint8Array> {
    if (compressedSize === 0) {
      return;
    }
    const buffer = new ArrayBuffer(Math.min(compressedSize, 16_192));
    let count = this.#queue.slice(new Uint8Array(buffer));
    for (;;) {
      yield new Uint8Array(buffer, 0, count);
      compressedSize -= count;
      if (compressedSize === 0) {
        break;
      }
      count = await this.#queue.read(new Uint8Array(buffer, 0, Math.min(compressedSize, buffer.byteLength)));
    }
  }

  #parseExtra(
    buf: ArrayBufferLike,
    offset: number,
    length: number,
  ): [number, number][] {
    if (length === 0) {
      return [];
    }
    const extra: [number, number][] = [];
    const view = new Uint16Array(buf, offset, length);
    let current: number[] = [];
    for (const n of view) {
      if (current.push(n) === 2) {
        extra.push(current as [number, number]);
        current = [];
      }
    }
    return extra;
  }

  #createHeader(
    { buffer, byteOffset }: ArrayBufferView,
  ): InternalLocalFileHeader {
    const view = new DataView(buffer, byteOffset + LOCAL_FILE_SIGNATURE.byteLength);
    const dostime = view.getUint32(6, true);
    const year = ((dostime >> 25) & 0x7f) + 1980;
    const month = ((dostime >> 21) & 0x0f);
    const day = ((dostime >> 16) & 0x1f)
    const hour = ((dostime >> 11) & 0x1f);
    const minute = ((dostime >> 5) & 0x3f);
    const second = ((dostime << 1) & 0x3e);
    let date: Date | undefined;
    if (month > 0 && month < 13 && day > 0 && hour < 24 && minute < 60 && second < 60) {
      date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    }
    return {
      version: view.getUint16(0, true),
      flags: view.getUint16(2, true),
      compression: view.getUint16(4, true),
      // view.getUint32(10, true)
      crc32: Uint8Array.of(
        view.getUint8(10),
        view.getUint8(11),
        view.getUint8(13),
      ),
      compressedSize: view.getUint32(14, true),
      size: view.getUint32(18, true),
      filenameLength: view.getUint16(22, true),
      extraFieldsLength: view.getUint16(24, true),
      date,
    };
  }
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
  for await (
    const { header, readable } of infile.readable.pipeThrough(new UnzipTransformStream())
  ) {
    const outpath = stdPath.join(outdir, header.filename);
    console.log(header.filename, "=>", outpath);
    if (header.filename.endsWith("/")) {
      continue;
    }
    await stdFs.ensureDir(stdPath.dirname(outpath))
    const outfile = await Deno.open(outpath, {
      write: true,
      createNew: true,
    });
    await readable.pipeTo(outfile.writable);
  }
  return 0;
}

if (import.meta.main) {
  main(Deno.args.slice())
    .then(Deno.exit);
}
