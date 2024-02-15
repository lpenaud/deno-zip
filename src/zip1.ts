
/**
 * File header signature
 */
const SIGNATURE = Uint8Array.of(0x50, 0x4B, 0x03, 0x04);

async function main([infile]: string[]): Promise<number> {
  if (infile === undefined) {
    console.error("Usage:", "zip", "INFILE");
    return 1;
  }
  const file = await Deno.open(infile);
  const files: number[] = [];
  let fileIndex = 0;
  let i = 0;
  for await (const buffer of file.readable) {
    while ((i = buffer.indexOf(SIGNATURE[0], i)) !== -1) {
      if (SIGNATURE.every((v, j) => v === buffer[i + j])) {
        files.push(fileIndex + i);
      }
      i += SIGNATURE.length;
    }
    fileIndex += buffer.length;
  }
  console.log(files.map(v => `0x${v.toString(16)}`));
  return 0;
}

if (import.meta.main) {
  main(Deno.args.slice())
    .then(Deno.exit);
}
