import { concatBytes } from "./utils.ts";
import { LocalFile, createLocalFile } from "./local-file.ts";
import { CentralDirectory, createCentralDirectory } from "./central-directory.ts";

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
  for await (const buffer of readable) {
    const signaturePredicate: (v: number, j: number) => boolean = (v, j) =>
      v === buffer[i + j];
    while ((i = buffer.indexOf(SIGNATURE[0], i)) !== -1) {
      if (LOCAL_FILE.every(signaturePredicate)) {
        const { end, localFile } = createLocalFile(buffer, i);
        yield localFile;
        i = end;
        continue;
      }
      if (CENTRAL_DIRECTORY.every(signaturePredicate)) {
        const { end, centralDirectory } = createCentralDirectory(buffer, i);
        yield centralDirectory;
        i = end;
        continue;
      }
      i += SIGNATURE.length;
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
  console.log(
    entries.filter((f) => f.filename === "src/zip.ts").map((f) => ({
      ...f,
      size: f.header.size.reduce(concatBytes),
      compressedSize: f.header.compressedSize.reduce(concatBytes),
      crc: f.header.crc32.reduce(
        (acc, v) => acc + v.toString(16).toUpperCase().padStart(2, "0"),
        "",
      ),
    })),
  );
  return 0;
}

if (import.meta.main) {
  main(Deno.args.slice())
    .then(Deno.exit);
}
