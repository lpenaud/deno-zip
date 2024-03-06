import { fromStream } from "./zip.ts";
import * as path from "https://deno.land/std@0.216.0/path/mod.ts";

async function cleanOutdir(outdir: string): Promise<void> {
  try {
    await Deno.remove(outdir, {
      recursive: true,
    });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return;
    }
    throw error;
  }
}

async function main([infile, outdir]: string[]): Promise<number> {
  if (infile === undefined || outdir === undefined) {
    console.error("Usage:", "zip", "INFILE", "OUTDIR");
    return 1;
  }
  const file = await Deno.open(infile);
  await cleanOutdir(outdir);
  await Deno.mkdir(outdir, {
    recursive: true,
  });
  for await (const entry of fromStream(file.readable)) {
    const dest = path.resolve(outdir, entry.filename);
    if (entry.isDirectory) {
      console.log("Make directory '%s'", dest);
      await Deno.mkdir(dest);
      continue;
    }
    console.log(entry.filename, "->", dest);
    console.log(entry.header);
    const outfile = await Deno.open(dest, {
      create: true,
      write: true,
    });
    // FIXME: TypeError: failed to write whole buffer
    await entry.readable.pipeTo(outfile.writable);
  }
  return 0;
}

if (import.meta.main) {
  main(Deno.args.slice())
    .then(Deno.exit);
}
