/**
 * File algorithm compression.
 */
export const enum Compression {
  /**
   * No compression.
   */
  RAW = 0,

  /**
   * Use deflated algorithm.
   */
  DEFLATED = 8,
}

/**
 * Default buffer length.
 */
export const BUFFER_LENGTH = 8096;

/**
 * Local file header signature.
 */
export const LOCAL_FILE_SIGNATURE = Uint8Array.of(0x50, 0x4B, 0x03, 0x04);

/**
 * Central directory header signature.
 */
export const CENTRAL_DIRECTORY_HEADER = Uint8Array.of(0x50, 0x4B, 0x01, 0x02);

export const EMPTY_BUFFER = new ArrayBuffer(0);

export const EMPTY_UINT8_ARRAY = new Uint8Array(EMPTY_BUFFER);
