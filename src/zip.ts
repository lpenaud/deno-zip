import { createLocalFile } from "./local-file.ts";
import { BUFFER_LENGTH, LOCAL_FILE_SIGNATURE } from "./constants.ts";
import { ByobBuffer } from "./byob-buffer.ts";
import { indexOfNeedle } from "@std/bytes";

interface FromStreamOptions {
  bufferLength: number;
}

export async function* fromStream(
  readable: ReadableStream<Uint8Array>,
  options?: Partial<FromStreamOptions>,
) {
  const byobBuffer = new ByobBuffer({
    readable,
    byteLength: options?.bufferLength ?? BUFFER_LENGTH,
  });
  do {
    await byobBuffer.fill();
    for (const seek of byobBuffer.findNeedle(LOCAL_FILE_SIGNATURE)) {
      await byobBuffer.read(seek);
      const localFile = await createLocalFile(byobBuffer);
      yield localFile;
      for (
        let remaning = localFile.header.compressedSize;
        remaning > 0;
        remaning -= (await byobBuffer.read(remaning)).byteLength
      ) {
        // Seek the stream to the end of the current local file
      }
    }
  } while (!byobBuffer.consumed);
}
