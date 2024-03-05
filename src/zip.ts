import { startsWith } from "https://deno.land/std@0.216.0/bytes/starts_with.ts";
import { createLocalFile, LocalFile, LocalFileZipEntry } from "./local-file.ts";
import {
  CentralDirectory,
  createCentralDirectory,
} from "./central-directory.ts";

/**
 * Header signature.
 */
const SIGNATURE = Uint8Array.of(0x50, 0x4B);

/**
 * Local file header signature
 * SIGNATURE + Uint8Array.of(0x03, 0x04)
 */
const LOCAL_FILE = Uint8Array.of(0x50, 0x4B, 0x03, 0x04);

/**
 * Central directory header signature
 * SIGNATURE + Uint8Array.of(0x01, 0x02)
 */
const CENTRAL_DIRECTORY = Uint8Array.of(0x50, 0x4B, 0x01, 0x02);

async function* exploreZip(
  readable: ReadableStream<Uint8Array>,
  bufferLength = 8096,
): AsyncGenerator<LocalFileZipEntry | CentralDirectory> {
  const reader = readable.getReader({ mode: "byob" });
  let memoryBuffer = new ArrayBuffer(bufferLength);
  let i = 0;
  let it: ReadableStreamBYOBReadResult<Uint8Array>;
  let buffer: Uint8Array;
  while (!(it = await reader.read(new Uint8Array(memoryBuffer))).done) {
    buffer = it.value;
    while ((i = buffer.indexOf(SIGNATURE[0])) !== -1) {
      buffer = buffer.subarray(i);
      if (startsWith(buffer, LOCAL_FILE)) {
        const { endBuffer, localFile } = createLocalFile(buffer.subarray(LOCAL_FILE.byteLength));
        const entry = new LocalFileZipEntry({
          buffer,
          info: localFile,
          reader,
        });
        yield entry;
        // If the file is already read into the current buffer
        if (entry.compressedSize < endBuffer.byteLength) {
          buffer = endBuffer.subarray(entry.compressedSize);
          continue;
        }
        if (!entry.consumed) {
          for await (const it of entry) {
            // Consume the stream.
            buffer = it;
          }
        }
        // if (endBuffer.length < localFile.header.compressedSize) {
        //   entrysize = localFile.header.compressedSize - endBuffer.byteLength;
        // }
        continue;
      }
      // if (startsWith(buffer, CENTRAL_DIRECTORY)) {
      //   const { endBuffer, centralDirectory } = createCentralDirectory(buffer.subarray(CENTRAL_DIRECTORY.length));
      //   yield centralDirectory;
      //   buffer = endBuffer;
      //   continue;
      // }
      buffer = buffer.subarray(CENTRAL_DIRECTORY.length);
    }
    memoryBuffer = buffer.buffer;
  }
}

function centralDirectoryPredicate(
  f: LocalFileZipEntry | CentralDirectory,
): f is CentralDirectory {
  return !(f instanceof LocalFileZipEntry);
}

async function main([infile]: string[]): Promise<number> {
  if (infile === undefined) {
    console.error("Usage:", "zip", "INFILE");
    return 1;
  }
  const file = await Deno.open(infile);
  // const entries = await Array.fromAsync(exploreZip(file.readable));
  for await (const entry of exploreZip(file.readable, 16192)) {
    // if (centralDirectoryPredicate(entry)) {
    //   break;
    // }
    console.log(entry.filename);
  }
  // const directories = entries.filter(centralDirectoryPredicate);
  // if (directories.length !== 4) {
  //   console.error("Found less than 4 files");
  //   console.log("Find:", directories.length);
  //   return 2;
  // }
  return 0;
}

if (import.meta.main) {
  main(Deno.args.slice())
    .then(Deno.exit);
}
