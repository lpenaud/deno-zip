import { concatBytes } from "./utils.ts";
import { createLocalFile, LocalFile } from "./local-file.ts";
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
): AsyncGenerator<LocalFile | CentralDirectory> {
  let i = 0;
  for await (let buffer of readable) {
    while ((i = buffer.indexOf(SIGNATURE[0])) !== -1) {
      buffer = buffer.subarray(i);
      if (LOCAL_FILE.every((v, j) => v === buffer[j])) {
        const { endBuffer, localFile } = createLocalFile(buffer.subarray(LOCAL_FILE.length));
        yield localFile;
        buffer = endBuffer;
        continue;
      }
      if (CENTRAL_DIRECTORY.every((v, j) => v === buffer[j])) {
        const { endBuffer, centralDirectory } = createCentralDirectory(buffer.subarray(CENTRAL_DIRECTORY.length));
        yield centralDirectory;
        buffer = endBuffer;
        continue;
      }
      buffer = buffer.subarray(SIGNATURE.length);
    }
  }
}

function centralDirectoryPredicate(
  f: LocalFile | CentralDirectory,
): f is CentralDirectory {
  return (f as CentralDirectory).header.offsetLocalHeader !== undefined;
}

async function main([infile]: string[]): Promise<number> {
  if (infile === undefined) {
    console.error("Usage:", "zip", "INFILE");
    return 1;
  }
  const file = await Deno.open(infile);
  const entries = await Array.fromAsync(exploreZip(file.readable));
  const directories = entries.filter(centralDirectoryPredicate);
  if (directories.length !== 4) {
    console.error("Found less than 4 files");
    console.log("Find:", directories.length);
    return 2;
  }
  console.log(JSON.stringify(entries));
  // console.log(
  //   entries.filter((f) => f.filename === "src/zip.ts").map((f) => ()),
  // );
  return 0;
}

if (import.meta.main) {
  main(Deno.args.slice())
    .then(Deno.exit);
}
