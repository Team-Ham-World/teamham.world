export interface ImageDimensions {
  width: number;
  height: number;
}

export type JpegHeaderInspection =
  | { kind: "dimensions"; dimensions: ImageDimensions }
  | { kind: "need_more" }
  | {
      kind: "invalid";
      reason: "invalid_signature" | "malformed" | "parser_limit";
    };

const MAX_IMAGE_PARSER_BYTES = 5_242_880;
const MAX_JPEG_MARKERS = 65_536;

function isStartOfFrame(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

export function inspectJpegHeader(
  bytes: Uint8Array,
  totalByteSize: number,
): JpegHeaderInspection {
  if (
    !Number.isSafeInteger(totalByteSize) ||
    totalByteSize <= 0 ||
    totalByteSize > MAX_IMAGE_PARSER_BYTES ||
    bytes.byteLength > totalByteSize
  ) {
    return { kind: "invalid", reason: "parser_limit" };
  }
  if (bytes.byteLength < 2) return { kind: "need_more" };
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return { kind: "invalid", reason: "invalid_signature" };
  }

  let offset = 2;
  let markers = 0;
  while (offset < bytes.byteLength) {
    markers += 1;
    if (markers > MAX_JPEG_MARKERS) {
      return { kind: "invalid", reason: "parser_limit" };
    }
    if (bytes[offset] !== 0xff) {
      return { kind: "invalid", reason: "malformed" };
    }
    do {
      offset += 1;
    } while (offset < bytes.byteLength && bytes[offset] === 0xff);
    if (offset >= bytes.byteLength) return { kind: "need_more" };

    const marker = bytes[offset];
    offset += 1;
    if (
      marker === 0x00 ||
      marker === 0x01 ||
      marker === 0xd8 ||
      marker === 0xd9 ||
      (marker >= 0xd0 && marker <= 0xd7) ||
      marker === 0xda
    ) {
      return { kind: "invalid", reason: "malformed" };
    }
    if (offset + 2 > bytes.byteLength) return { kind: "need_more" };

    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > totalByteSize) {
      return { kind: "invalid", reason: "malformed" };
    }
    if (offset + length > bytes.byteLength) return { kind: "need_more" };

    if (isStartOfFrame(marker)) {
      const dataOffset = offset + 2;
      if (length < 11) return { kind: "invalid", reason: "malformed" };
      const precision = bytes[dataOffset];
      const height = (bytes[dataOffset + 1] << 8) | bytes[dataOffset + 2];
      const width = (bytes[dataOffset + 3] << 8) | bytes[dataOffset + 4];
      const componentCount = bytes[dataOffset + 5];
      if (
        precision === 0 ||
        precision > 16 ||
        width === 0 ||
        height === 0 ||
        componentCount === 0 ||
        length !== 8 + componentCount * 3
      ) {
        return { kind: "invalid", reason: "malformed" };
      }
      return { kind: "dimensions", dimensions: { width, height } };
    }

    offset += length;
  }

  return { kind: "need_more" };
}
