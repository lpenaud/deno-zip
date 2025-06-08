import { indexOfNeedle } from "@std/bytes";
import { EMPTY_BUFFER, EMPTY_UINT8_ARRAY } from "./constants.ts";

export interface ByobBufferOptions {
  readable: ReadableStream<Uint8Array>;
  byteLength: number;
}

export class ByobBuffer {
  
  #reader: ReadableStreamBYOBReader;

  #buffer: ArrayBufferLike;

  #offset: number;

  get consumed(): boolean {
    return this.#buffer.byteLength === 0;
  }

  constructor({ readable, byteLength }: ByobBufferOptions) {
    this.#reader = readable.getReader({ mode: "byob" });
    this.#buffer = new ArrayBuffer(byteLength);
    this.#offset = 0;
  }

  async fill(): Promise<void> {
    let byteOffset = 0;
    for (;;) {
      const { done, value } = await this.#reader.read(new Uint8Array(this.#buffer, byteOffset));
      if (value !== undefined) {
        this.#buffer = value.buffer;
        byteOffset = value.byteOffset + value.byteLength;
      }
      if (done) {
        break;
      }
    }
  }

  *findNeedle(needle: Uint8Array) {
    let view = new Uint8Array(this.#buffer);
    let i = 0;
    while ((i = indexOfNeedle(view, needle)) !== -1) {
      i += needle.length;
      yield i;
      view = new Uint8Array(this.#buffer, this.#offset);
    }
  }

  async read(length: number): Promise<Uint8Array> {
    if (length === 0) {
      return EMPTY_UINT8_ARRAY;
    }
    let view: Uint8Array;
    if (this.#offset + length <= this.#buffer.byteLength) {
      view = new Uint8Array(this.#buffer, this.#offset, length);
      this.#offset += length;
      return view;
    }
    if (this.#offset < this.#buffer.byteLength) {
      view = new Uint8Array(this.#buffer, this.#offset);
      this.#offset = this.#buffer.byteLength;
      return view;
    }
    if (this.consumed) {
      throw new Error("Reader already consumed");
    }
    const { done, value } = await this.#reader.read(new Uint8Array(this.#buffer));
    if (done) {
      this.#offset = 0;
      this.#buffer = EMPTY_BUFFER;
      return new Uint8Array(this.#buffer);
    }
    this.#buffer = value.buffer;
    if (length > this.#buffer.byteLength) {
      this.#offset = this.#buffer.byteLength;
      return value;
    }
    this.#offset = length;
    return new Uint8Array(this.#buffer, 0, length);
  }
}
