import { indexOfNeedle } from "https://deno.land/std@0.216.0/bytes/index_of_needle.ts";
import { createLocalFile, LocalFileZipEntry } from "./local-file.ts";
import { BUFFER_LENGTH, LOCAL_FILE_SIGNATURE } from "./constants.ts";

interface FromStreamOptions {
  bufferLength: number;
}

export async function* fromStream(
  readable: ReadableStream<Uint8Array>,
  options?: Partial<FromStreamOptions>,
): AsyncGenerator<LocalFileZipEntry> {
  const reader = readable.getReader({ mode: "byob" });
  let buffer = new ArrayBuffer(options?.bufferLength ?? BUFFER_LENGTH);
  let it: ReadableStreamBYOBReadResult<Uint8Array>;
  let view: Uint8Array;
  let i: number;
  while (!(it = await reader.read(new Uint8Array(buffer))).done) {
    view = it.value;
    while ((i = indexOfNeedle(view, LOCAL_FILE_SIGNATURE)) !== -1) {
      view = view.subarray(i);
      const { endBuffer, localFile } = createLocalFile(
        view.subarray(LOCAL_FILE_SIGNATURE.byteLength),
      );
      const entry = new LocalFileZipEntry({
        view: view,
        info: localFile,
        reader,
      });
      yield entry;
      // If the file is already read into the current buffer
      if (entry.compressedSize < endBuffer.byteLength) {
        view = endBuffer.subarray(entry.compressedSize);
        continue;
      }
      if (!entry.consumed) {
        for await (const it of entry) {
          // Consume the stream.
          view = it;
        }
      }
    }
    buffer = view.buffer;
  }
}
