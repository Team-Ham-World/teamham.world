export type StaticImageClassification =
  | { kind: "static" }
  | {
      kind: "animated";
      reason: "apng" | "animated_webp" | "avif_sequence";
    }
  | {
      kind: "uncertain";
      reason:
        | "invalid_signature"
        | "truncated"
        | "malformed"
        | "unsupported_structure"
        | "parser_limit";
    };

export interface StaticImageDimensions {
  width: number;
  height: number;
}

export type StaticImageInspection =
  | { kind: "static"; dimensions: StaticImageDimensions }
  | Exclude<StaticImageClassification, { kind: "static" }>;

const STATIC: StaticImageClassification = { kind: "static" };
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_CONTAINER_ENTRIES = 4_096;
const MAX_IMAGE_PARSER_BYTES = 5_242_880;

function uncertain(
  reason: Extract<StaticImageClassification, { kind: "uncertain" }>[
    "reason"
  ],
): Extract<StaticImageClassification, { kind: "uncertain" }> {
  return { kind: "uncertain", reason };
}

function hasBytes(bytes: Uint8Array, offset: number, length: number): boolean {
  return (
    Number.isSafeInteger(offset) &&
    Number.isSafeInteger(length) &&
    offset >= 0 &&
    length >= 0 &&
    offset <= bytes.byteLength - length
  );
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1_000_000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] +
    (bytes[offset + 1] << 8) +
    (bytes[offset + 2] << 16) +
    bytes[offset + 3] * 0x1_000_000
  );
}

function readUint24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16);
}

function fourCc(bytes: Uint8Array, offset: number): string | null {
  if (!hasBytes(bytes, offset, 4)) return null;
  let value = "";
  for (let index = 0; index < 4; index += 1) {
    const byte = bytes[offset + index];
    if (byte < 0x20 || byte > 0x7e) return null;
    value += String.fromCharCode(byte);
  }
  return value;
}

let pngCrcTable: Uint32Array | null = null;

function getPngCrcTable(): Uint32Array {
  if (pngCrcTable) return pngCrcTable;
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[value] = crc >>> 0;
  }
  pngCrcTable = table;
  return table;
}

function pngChunkCrc(bytes: Uint8Array, start: number, end: number): number {
  const table = getPngCrcTable();
  let crc = 0xffffffff;
  for (let offset = start; offset < end; offset += 1) {
    crc = table[(crc ^ bytes[offset]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function isValidPngChunkType(type: string): boolean {
  return /^[A-Za-z]{4}$/.test(type) && /[A-Z]/.test(type[2]);
}

function readValidPngHeader(
  bytes: Uint8Array,
  dataOffset: number,
): StaticImageDimensions | null {
  const width = readUint32BE(bytes, dataOffset);
  const height = readUint32BE(bytes, dataOffset + 4);
  const bitDepth = bytes[dataOffset + 8];
  const colorType = bytes[dataOffset + 9];
  const validDepths: Readonly<Record<number, readonly number[]>> = {
    0: [1, 2, 4, 8, 16],
    2: [8, 16],
    3: [1, 2, 4, 8],
    4: [8, 16],
    6: [8, 16],
  };
  if (
    width > 0 &&
    height > 0 &&
    validDepths[colorType]?.includes(bitDepth) === true &&
    bytes[dataOffset + 10] === 0 &&
    bytes[dataOffset + 11] === 0 &&
    (bytes[dataOffset + 12] === 0 || bytes[dataOffset + 12] === 1)
  ) {
    return { width, height };
  }
  return null;
}

export function inspectPngStatic(bytes: Uint8Array): StaticImageInspection {
  if (bytes.byteLength > MAX_IMAGE_PARSER_BYTES) return uncertain("parser_limit");
  if (!hasBytes(bytes, 0, PNG_SIGNATURE.byteLength)) {
    return uncertain("truncated");
  }
  if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    return uncertain("invalid_signature");
  }

  let offset = PNG_SIGNATURE.byteLength;
  let chunks = 0;
  let sawHeader = false;
  let sawImageData = false;
  let imageDataEnded = false;
  let sawPalette = false;
  let dimensions: StaticImageDimensions | null = null;

  while (offset < bytes.byteLength) {
    chunks += 1;
    if (chunks > MAX_CONTAINER_ENTRIES) return uncertain("parser_limit");
    if (!hasBytes(bytes, offset, 12)) return uncertain("truncated");

    const length = readUint32BE(bytes, offset);
    const type = fourCc(bytes, offset + 4);
    if (type === null || !isValidPngChunkType(type)) {
      return uncertain("malformed");
    }
    const dataOffset = offset + 8;
    const crcOffset = dataOffset + length;
    if (!Number.isSafeInteger(crcOffset) || !hasBytes(bytes, crcOffset, 4)) {
      return uncertain("truncated");
    }
    const expectedCrc = readUint32BE(bytes, crcOffset);
    if (pngChunkCrc(bytes, offset + 4, crcOffset) !== expectedCrc) {
      return uncertain("malformed");
    }

    if (!sawHeader) {
      dimensions =
        type === "IHDR" && length === 13
          ? readValidPngHeader(bytes, dataOffset)
          : null;
      if (dimensions === null) {
        return uncertain("malformed");
      }
      sawHeader = true;
    } else if (type === "IHDR") {
      return uncertain("malformed");
    }

    if (type === "acTL") return { kind: "animated", reason: "apng" };
    if (type === "fcTL" || type === "fdAT") {
      return uncertain("malformed");
    }
    if (type === "PLTE") {
      if (sawPalette || sawImageData || length === 0 || length % 3 !== 0) {
        return uncertain("malformed");
      }
      sawPalette = true;
    } else if (type === "IDAT") {
      if (imageDataEnded) return uncertain("malformed");
      sawImageData = true;
    } else if (sawImageData && type !== "IEND") {
      imageDataEnded = true;
    }

    if (type === "IEND") {
      if (length !== 0 || !sawImageData) return uncertain("malformed");
      return crcOffset + 4 === bytes.byteLength
        ? { kind: "static", dimensions: dimensions! }
        : uncertain("malformed");
    }

    const isCritical = type.charCodeAt(0) >= 65 && type.charCodeAt(0) <= 90;
    if (
      isCritical &&
      type !== "IHDR" &&
      type !== "PLTE" &&
      type !== "IDAT" &&
      type !== "IEND"
    ) {
      return uncertain("unsupported_structure");
    }
    offset = crcOffset + 4;
  }

  return uncertain("truncated");
}

export function classifyPngStatic(
  bytes: Uint8Array,
): StaticImageClassification {
  const inspection = inspectPngStatic(bytes);
  return inspection.kind === "static" ? STATIC : inspection;
}

function readVp8Dimensions(
  bytes: Uint8Array,
  offset: number,
  length: number,
): StaticImageDimensions | null {
  if (
    length < 10 ||
    (bytes[offset] & 1) !== 0 ||
    bytes[offset + 3] !== 0x9d ||
    bytes[offset + 4] !== 0x01 ||
    bytes[offset + 5] !== 0x2a
  ) {
    return null;
  }
  const width = (bytes[offset + 6] | (bytes[offset + 7] << 8)) & 0x3fff;
  const height = (bytes[offset + 8] | (bytes[offset + 9] << 8)) & 0x3fff;
  return width > 0 && height > 0 ? { width, height } : null;
}

function readVp8lDimensions(
  bytes: Uint8Array,
  offset: number,
  length: number,
): (StaticImageDimensions & { hasAlpha: boolean }) | null {
  if (length < 5 || bytes[offset] !== 0x2f) return null;
  const bits = readUint32LE(bytes, offset + 1) >>> 0;
  if ((bits >>> 29) !== 0) return null;
  return {
    width: (bits & 0x3fff) + 1,
    height: ((bits >>> 14) & 0x3fff) + 1,
    hasAlpha: ((bits >>> 28) & 1) === 1,
  };
}

export function inspectWebPStatic(bytes: Uint8Array): StaticImageInspection {
  if (bytes.byteLength > MAX_IMAGE_PARSER_BYTES) return uncertain("parser_limit");
  if (!hasBytes(bytes, 0, 12)) return uncertain("truncated");
  if (fourCc(bytes, 0) !== "RIFF" || fourCc(bytes, 8) !== "WEBP") {
    return uncertain("invalid_signature");
  }

  const riffSize = readUint32LE(bytes, 4);
  if (riffSize < 4) return uncertain("malformed");
  const containerEnd = riffSize + 8;
  if (!Number.isSafeInteger(containerEnd)) return uncertain("malformed");
  if (containerEnd > bytes.byteLength) return uncertain("truncated");
  if (containerEnd !== bytes.byteLength) return uncertain("malformed");

  const knownChunks = new Set([
    "VP8X",
    "VP8 ",
    "VP8L",
    "ALPH",
    "ICCP",
    "EXIF",
    "XMP ",
    "ANIM",
    "ANMF",
  ]);
  let offset = 12;
  let chunks = 0;
  let sawExtended = false;
  let sawImage = false;
  let sawAlpha = false;
  let sawIcc = false;
  let sawExif = false;
  let sawXmp = false;
  let extendedFlags = 0;
  let canvasDimensions: StaticImageDimensions | null = null;
  let imageDimensions: StaticImageDimensions | null = null;
  let imageHasAlpha = false;
  let imageType: "VP8 " | "VP8L" | null = null;

  while (offset < containerEnd) {
    chunks += 1;
    if (chunks > MAX_CONTAINER_ENTRIES) return uncertain("parser_limit");
    if (containerEnd - offset < 8) return uncertain("malformed");
    const type = fourCc(bytes, offset);
    if (type === null || !knownChunks.has(type)) {
      return uncertain("unsupported_structure");
    }
    const length = readUint32LE(bytes, offset + 4);
    const paddedLength = length + (length & 1);
    const dataOffset = offset + 8;
    const nextOffset = dataOffset + paddedLength;
    if (
      !Number.isSafeInteger(nextOffset) ||
      nextOffset > containerEnd ||
      dataOffset + length > containerEnd
    ) {
      return uncertain("malformed");
    }
    if (length % 2 === 1 && bytes[dataOffset + length] !== 0) {
      return uncertain("malformed");
    }

    if (type === "ANIM" || type === "ANMF") {
      return { kind: "animated", reason: "animated_webp" };
    }
    if (type === "VP8X") {
      if (chunks !== 1 || sawExtended || length !== 10) {
        return uncertain("malformed");
      }
      sawExtended = true;
      extendedFlags = bytes[dataOffset];
      if ((extendedFlags & 0xc1) !== 0) return uncertain("malformed");
      if ((extendedFlags & 0x02) !== 0) {
        return { kind: "animated", reason: "animated_webp" };
      }
      if (
        bytes[dataOffset + 1] !== 0 ||
        bytes[dataOffset + 2] !== 0 ||
        bytes[dataOffset + 3] !== 0
      ) {
        return uncertain("malformed");
      }
      canvasDimensions = {
        width: readUint24LE(bytes, dataOffset + 4) + 1,
        height: readUint24LE(bytes, dataOffset + 7) + 1,
      };
    } else if (type === "ALPH") {
      if (
        !sawExtended ||
        sawAlpha ||
        sawImage ||
        length < 1 ||
        (bytes[dataOffset] & 0xe3) !== 0
      ) {
        return uncertain("malformed");
      }
      sawAlpha = true;
    } else if (type === "VP8 " || type === "VP8L") {
      if (sawImage || (sawAlpha && type !== "VP8 ")) return uncertain("malformed");
      if (!sawExtended && chunks !== 1) return uncertain("malformed");
      if (type === "VP8 ") {
        imageDimensions = readVp8Dimensions(bytes, dataOffset, length);
      } else {
        const lossless = readVp8lDimensions(bytes, dataOffset, length);
        imageDimensions = lossless
          ? { width: lossless.width, height: lossless.height }
          : null;
        imageHasAlpha = lossless?.hasAlpha ?? false;
      }
      if (imageDimensions === null) return uncertain("malformed");
      imageType = type;
      sawImage = true;
    } else {
      if (!sawExtended || length === 0) return uncertain("malformed");
      if (type === "ICCP") {
        if (sawIcc || sawImage) return uncertain("malformed");
        sawIcc = true;
      } else if (type === "EXIF") {
        if (sawExif || !sawImage) return uncertain("malformed");
        sawExif = true;
      } else if (type === "XMP ") {
        if (sawXmp || !sawImage) return uncertain("malformed");
        sawXmp = true;
      }
    }

    offset = nextOffset;
  }

  if (!sawImage || imageDimensions === null) return uncertain("malformed");
  if (!sawExtended) {
    return chunks === 1
      ? { kind: "static", dimensions: imageDimensions }
      : uncertain("malformed");
  }
  if (
    canvasDimensions === null ||
    imageType === null ||
    canvasDimensions.width !== imageDimensions.width ||
    canvasDimensions.height !== imageDimensions.height
  ) {
    return uncertain("malformed");
  }
  const expectedFlags =
    (sawIcc ? 0x20 : 0) |
    (sawAlpha || imageHasAlpha ? 0x10 : 0) |
    (sawExif ? 0x08 : 0) |
    (sawXmp ? 0x04 : 0);
  if (extendedFlags !== expectedFlags || (sawAlpha && imageType !== "VP8 ")) {
    return uncertain("malformed");
  }
  return { kind: "static", dimensions: canvasDimensions };
}

export function classifyWebPStatic(
  bytes: Uint8Array,
): StaticImageClassification {
  const inspection = inspectWebPStatic(bytes);
  return inspection.kind === "static" ? STATIC : inspection;
}

interface IsoBox {
  type: string;
  start: number;
  payloadStart: number;
  end: number;
}

type IsoParseResult<T> =
  | { success: true; value: T }
  | {
      success: false;
      reason:
        | "truncated"
        | "malformed"
        | "unsupported_structure"
        | "parser_limit";
    };

function readVariableUint(
  bytes: Uint8Array,
  offset: number,
  size: number,
): number | null {
  if (size < 0 || size > 8 || !hasBytes(bytes, offset, size)) return null;
  let value = 0;
  for (let index = 0; index < size; index += 1) {
    const byte = bytes[offset + index];
    if (value > Math.floor((Number.MAX_SAFE_INTEGER - byte) / 256)) {
      return null;
    }
    value = value * 256 + byte;
  }
  return value;
}

function parseIsoBoxes(
  bytes: Uint8Array,
  start: number,
  end: number,
): IsoParseResult<IsoBox[]> {
  if (
    bytes.byteLength > MAX_IMAGE_PARSER_BYTES ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    end > bytes.byteLength
  ) {
    return { success: false, reason: "parser_limit" };
  }
  const boxes: IsoBox[] = [];
  let offset = start;
  while (offset < end) {
    if (boxes.length >= MAX_CONTAINER_ENTRIES) {
      return { success: false, reason: "parser_limit" };
    }
    if (end - offset < 8) return { success: false, reason: "truncated" };
    const size32 = readUint32BE(bytes, offset);
    const type = fourCc(bytes, offset + 4);
    if (type === null) return { success: false, reason: "malformed" };

    let headerSize = 8;
    let size = size32;
    if (size32 === 1) {
      if (end - offset < 16) return { success: false, reason: "truncated" };
      const extended = readVariableUint(bytes, offset + 8, 8);
      if (extended === null) return { success: false, reason: "malformed" };
      headerSize = 16;
      size = extended;
    } else if (size32 === 0) {
      return { success: false, reason: "malformed" };
    }

    if (size < headerSize || size > end - offset) {
      return {
        success: false,
        reason: size > end - offset ? "truncated" : "malformed",
      };
    }
    const boxEnd = offset + size;
    boxes.push({
      type,
      start: offset,
      payloadStart: offset + headerSize,
      end: boxEnd,
    });
    offset = boxEnd;
  }
  return { success: true, value: boxes };
}

function fullBoxHeader(
  bytes: Uint8Array,
  box: IsoBox,
): { version: number; flags: number; dataStart: number } | null {
  if (!hasBytes(bytes, box.payloadStart, 4)) return null;
  return {
    version: bytes[box.payloadStart],
    flags:
      (bytes[box.payloadStart + 1] << 16) |
      (bytes[box.payloadStart + 2] << 8) |
      bytes[box.payloadStart + 3],
    dataStart: box.payloadStart + 4,
  };
}

function parsePrimaryItemId(bytes: Uint8Array, box: IsoBox): number | null {
  const header = fullBoxHeader(bytes, box);
  if (!header || header.flags !== 0) return null;
  const size = header.version === 0 ? 2 : header.version === 1 ? 4 : 0;
  if (size === 0 || header.dataStart + size !== box.end) return null;
  return readVariableUint(bytes, header.dataStart, size);
}

function parseItemInfo(
  bytes: Uint8Array,
  box: IsoBox,
): IsoParseResult<Map<number, string>> {
  const header = fullBoxHeader(bytes, box);
  if (!header || header.flags !== 0 || header.version > 1) {
    return { success: false, reason: "malformed" };
  }
  const countSize = header.version === 0 ? 2 : 4;
  if (!hasBytes(bytes, header.dataStart, countSize)) {
    return { success: false, reason: "truncated" };
  }
  const expectedCount = readVariableUint(bytes, header.dataStart, countSize);
  if (expectedCount === null || expectedCount > MAX_CONTAINER_ENTRIES) {
    return { success: false, reason: "parser_limit" };
  }
  const children = parseIsoBoxes(
    bytes,
    header.dataStart + countSize,
    box.end,
  );
  if (!children.success) return children;
  if (children.value.length !== expectedCount) {
    return { success: false, reason: "malformed" };
  }

  const items = new Map<number, string>();
  for (const child of children.value) {
    if (child.type !== "infe") {
      return { success: false, reason: "unsupported_structure" };
    }
    const infe = fullBoxHeader(bytes, child);
    if (!infe || infe.flags !== 0 || (infe.version !== 2 && infe.version !== 3)) {
      return { success: false, reason: "malformed" };
    }
    const idSize = infe.version === 2 ? 2 : 4;
    if (!hasBytes(bytes, infe.dataStart, idSize + 7)) {
      return { success: false, reason: "truncated" };
    }
    const itemId = readVariableUint(bytes, infe.dataStart, idSize);
    const protectionIndex = readUint16BE(bytes, infe.dataStart + idSize);
    const itemType = fourCc(bytes, infe.dataStart + idSize + 2);
    let itemNameEnd = infe.dataStart + idSize + 6;
    while (itemNameEnd < child.end && bytes[itemNameEnd] !== 0) {
      itemNameEnd += 1;
    }
    if (
      itemId === null ||
      itemId === 0 ||
      protectionIndex !== 0 ||
      itemType === null ||
      itemNameEnd >= child.end ||
      items.has(itemId)
    ) {
      return { success: false, reason: "malformed" };
    }
    items.set(itemId, itemType);
  }
  return { success: true, value: items };
}

interface ItemLocationExtent {
  method: number;
  dataReferenceIndex: number;
  start: number;
  length: number;
}

function parsePrimaryItemLocation(
  bytes: Uint8Array,
  box: IsoBox,
  primaryItemId: number,
): IsoParseResult<ItemLocationExtent[]> {
  const header = fullBoxHeader(bytes, box);
  if (!header || header.flags !== 0 || header.version > 2) {
    return { success: false, reason: "malformed" };
  }
  if (!hasBytes(bytes, header.dataStart, 2)) {
    return { success: false, reason: "truncated" };
  }
  const first = bytes[header.dataStart];
  const second = bytes[header.dataStart + 1];
  const offsetSize = first >>> 4;
  const lengthSize = first & 0x0f;
  const baseOffsetSize = second >>> 4;
  const indexSize = header.version === 0 ? 0 : second & 0x0f;
  if (
    (header.version === 0 && (second & 0x0f) !== 0) ||
    offsetSize > 8 ||
    lengthSize === 0 ||
    lengthSize > 8 ||
    baseOffsetSize > 8 ||
    indexSize > 8
  ) {
    return { success: false, reason: "unsupported_structure" };
  }

  let cursor = header.dataStart + 2;
  const countSize = header.version < 2 ? 2 : 4;
  const itemCount = readVariableUint(bytes, cursor, countSize);
  if (itemCount === null || itemCount > MAX_CONTAINER_ENTRIES) {
    return { success: false, reason: "parser_limit" };
  }
  cursor += countSize;
  let primaryExtents: ItemLocationExtent[] | null = null;
  let totalExtents = 0;
  const seenItemIds = new Set<number>();

  for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
    const idSize = header.version < 2 ? 2 : 4;
    const itemId = readVariableUint(bytes, cursor, idSize);
    if (itemId === null) return { success: false, reason: "truncated" };
    if (itemId === 0 || seenItemIds.has(itemId)) {
      return { success: false, reason: "malformed" };
    }
    seenItemIds.add(itemId);
    cursor += idSize;
    let method = 0;
    if (header.version === 1 || header.version === 2) {
      if (!hasBytes(bytes, cursor, 2)) {
        return { success: false, reason: "truncated" };
      }
      const constructionMethod = readUint16BE(bytes, cursor);
      if ((constructionMethod & 0xfff0) !== 0) {
        return { success: false, reason: "malformed" };
      }
      method = constructionMethod & 0x0f;
      cursor += 2;
      if (method !== 0 && method !== 1) {
        return { success: false, reason: "unsupported_structure" };
      }
    }
    if (!hasBytes(bytes, cursor, 2)) {
      return { success: false, reason: "truncated" };
    }
    const dataReferenceIndex = readUint16BE(bytes, cursor);
    cursor += 2;
    const baseOffset = readVariableUint(bytes, cursor, baseOffsetSize);
    if (baseOffset === null) return { success: false, reason: "truncated" };
    cursor += baseOffsetSize;
    if (!hasBytes(bytes, cursor, 2)) {
      return { success: false, reason: "truncated" };
    }
    const extentCount = readUint16BE(bytes, cursor);
    cursor += 2;
    totalExtents += extentCount;
    if (
      extentCount === 0 ||
      extentCount > MAX_CONTAINER_ENTRIES ||
      totalExtents > MAX_CONTAINER_ENTRIES
    ) {
      return { success: false, reason: "malformed" };
    }
    const extents: ItemLocationExtent[] = [];
    for (let extentIndex = 0; extentIndex < extentCount; extentIndex += 1) {
      if (indexSize > 0) {
        const parsedIndex = readVariableUint(bytes, cursor, indexSize);
        if (parsedIndex === null) return { success: false, reason: "truncated" };
        cursor += indexSize;
      }
      const relativeOffset = readVariableUint(bytes, cursor, offsetSize);
      if (relativeOffset === null) {
        return { success: false, reason: "truncated" };
      }
      cursor += offsetSize;
      const length = readVariableUint(bytes, cursor, lengthSize);
      if (length === null) return { success: false, reason: "truncated" };
      cursor += lengthSize;
      if (length === 0 || baseOffset > Number.MAX_SAFE_INTEGER - relativeOffset) {
        return { success: false, reason: "malformed" };
      }
      extents.push({
        method,
        dataReferenceIndex,
        start: baseOffset + relativeOffset,
        length,
      });
    }
    if (itemId === primaryItemId) {
      if (primaryExtents !== null) {
        return { success: false, reason: "malformed" };
      }
      primaryExtents = extents;
    }
  }

  if (cursor !== box.end || primaryExtents === null) {
    return { success: false, reason: "malformed" };
  }
  return { success: true, value: primaryExtents };
}

interface ItemProperties {
  primaryImageSize: StaticImageDimensions | null;
  imageSizePropertyCount: number;
}

function parseItemProperties(
  bytes: Uint8Array,
  box: IsoBox,
  primaryItemId: number,
): IsoParseResult<ItemProperties> {
  const children = parseIsoBoxes(bytes, box.payloadStart, box.end);
  if (!children.success) return children;
  const ipcoBoxes = children.value.filter((child) => child.type === "ipco");
  const ipmaBoxes = children.value.filter((child) => child.type === "ipma");
  if (
    children.value.some(
      (child) => child.type !== "ipco" && child.type !== "ipma",
    ) ||
    ipcoBoxes.length !== 1 ||
    ipmaBoxes.length !== 1
  ) {
    return { success: false, reason: "malformed" };
  }

  const properties = parseIsoBoxes(
    bytes,
    ipcoBoxes[0].payloadStart,
    ipcoBoxes[0].end,
  );
  if (!properties.success) return properties;
  const allowedPropertyTypes = new Set([
    "ispe",
    "pixi",
    "av1C",
    "colr",
    "pasp",
    "clap",
    "irot",
    "imir",
  ]);
  let imageSizePropertyCount = 0;
  const imageSizes: Array<StaticImageDimensions | null> = [];
  for (const property of properties.value) {
    if (!allowedPropertyTypes.has(property.type)) {
      return { success: false, reason: "unsupported_structure" };
    }
    if (property.type === "ispe") {
      const header = fullBoxHeader(bytes, property);
      if (
        !header ||
        header.version !== 0 ||
        header.flags !== 0 ||
        header.dataStart + 8 !== property.end
      ) {
        return { success: false, reason: "malformed" };
      }
      const width = readUint32BE(bytes, header.dataStart);
      const height = readUint32BE(bytes, header.dataStart + 4);
      if (width === 0 || height === 0) {
        return { success: false, reason: "malformed" };
      }
      imageSizePropertyCount += 1;
      imageSizes.push({ width, height });
    } else {
      imageSizes.push(null);
    }
  }

  const ipma = fullBoxHeader(bytes, ipmaBoxes[0]);
  if (!ipma || ipma.version > 1 || (ipma.flags & ~1) !== 0) {
    return { success: false, reason: "malformed" };
  }
  let cursor = ipma.dataStart;
  if (!hasBytes(bytes, cursor, 4)) {
    return { success: false, reason: "truncated" };
  }
  const entryCount = readUint32BE(bytes, cursor);
  cursor += 4;
  if (entryCount > MAX_CONTAINER_ENTRIES) {
    return { success: false, reason: "parser_limit" };
  }
  const wideAssociation = (ipma.flags & 1) !== 0;
  let primaryImageSize: StaticImageDimensions | null = null;
  let totalAssociations = 0;
  const associatedItemIds = new Set<number>();
  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    const idSize = ipma.version === 0 ? 2 : 4;
    const itemId = readVariableUint(bytes, cursor, idSize);
    if (itemId === null || !hasBytes(bytes, cursor + idSize, 1)) {
      return { success: false, reason: "truncated" };
    }
    if (itemId === 0 || associatedItemIds.has(itemId)) {
      return { success: false, reason: "malformed" };
    }
    associatedItemIds.add(itemId);
    cursor += idSize;
    const associationCount = bytes[cursor];
    cursor += 1;
    totalAssociations += associationCount;
    if (totalAssociations > MAX_CONTAINER_ENTRIES) {
      return { success: false, reason: "parser_limit" };
    }
    for (
      let associationIndex = 0;
      associationIndex < associationCount;
      associationIndex += 1
    ) {
      const associationSize = wideAssociation ? 2 : 1;
      const association = readVariableUint(bytes, cursor, associationSize);
      if (association === null) return { success: false, reason: "truncated" };
      cursor += associationSize;
      const propertyIndex = wideAssociation
        ? association & 0x7fff
        : association & 0x7f;
      if (propertyIndex === 0 || propertyIndex > properties.value.length) {
        return { success: false, reason: "malformed" };
      }
      const essential = wideAssociation
        ? (association & 0x8000) !== 0
        : (association & 0x80) !== 0;
      const imageSize = imageSizes[propertyIndex - 1];
      if (itemId === primaryItemId && imageSize !== null) {
        if (!essential || primaryImageSize !== null) {
          return { success: false, reason: "malformed" };
        }
        primaryImageSize = imageSize;
      }
    }
  }
  if (cursor !== ipmaBoxes[0].end) {
    return { success: false, reason: "malformed" };
  }
  return {
    success: true,
    value: { primaryImageSize, imageSizePropertyCount },
  };
}

function isExtentWithin(
  extent: ItemLocationExtent,
  ranges: readonly { start: number; end: number }[],
): boolean {
  if (extent.dataReferenceIndex !== 0) return false;
  if (extent.start > Number.MAX_SAFE_INTEGER - extent.length) return false;
  const end = extent.start + extent.length;
  return ranges.some((range) => extent.start >= range.start && end <= range.end);
}

export function inspectAvifStatic(bytes: Uint8Array): StaticImageInspection {
  if (bytes.byteLength > MAX_IMAGE_PARSER_BYTES) return uncertain("parser_limit");
  if (!hasBytes(bytes, 0, 12)) return uncertain("truncated");
  const topLevel = parseIsoBoxes(bytes, 0, bytes.byteLength);
  if (!topLevel.success) return uncertain(topLevel.reason);
  if (
    topLevel.value.length === 0 ||
    topLevel.value[0].type !== "ftyp" ||
    topLevel.value.filter((box) => box.type === "ftyp").length !== 1
  ) {
    return uncertain("invalid_signature");
  }

  const ftyp = topLevel.value[0];
  if (
    ftyp.end - ftyp.payloadStart < 8 ||
    (ftyp.end - ftyp.payloadStart - 8) % 4 !== 0 ||
    (ftyp.end - ftyp.payloadStart - 8) / 4 > 64
  ) {
    return uncertain("malformed");
  }
  const majorBrand = fourCc(bytes, ftyp.payloadStart);
  if (majorBrand === null) return uncertain("malformed");
  const compatibleBrands: string[] = [];
  for (let offset = ftyp.payloadStart + 8; offset < ftyp.end; offset += 4) {
    const brand = fourCc(bytes, offset);
    if (brand === null) return uncertain("malformed");
    compatibleBrands.push(brand);
  }
  if (majorBrand === "avis" || compatibleBrands.includes("avis")) {
    return { kind: "animated", reason: "avif_sequence" };
  }
  if (majorBrand !== "avif") return uncertain("invalid_signature");

  const trackBoxes = new Set([
    "moov",
    "trak",
    "mvex",
    "moof",
    "traf",
    "mfra",
  ]);
  if (topLevel.value.some((box) => trackBoxes.has(box.type))) {
    return { kind: "animated", reason: "avif_sequence" };
  }
  const allowedTopLevel = new Set(["ftyp", "meta", "mdat", "free", "skip", "wide"]);
  if (topLevel.value.some((box) => !allowedTopLevel.has(box.type))) {
    return uncertain("unsupported_structure");
  }
  const metaBoxes = topLevel.value.filter((box) => box.type === "meta");
  if (metaBoxes.length !== 1) return uncertain("unsupported_structure");
  const mdatRanges = topLevel.value
    .filter((box) => box.type === "mdat")
    .map((box) => ({ start: box.payloadStart, end: box.end }));

  const metaHeader = fullBoxHeader(bytes, metaBoxes[0]);
  if (!metaHeader || metaHeader.version !== 0 || metaHeader.flags !== 0) {
    return uncertain("malformed");
  }
  const metaChildren = parseIsoBoxes(bytes, metaHeader.dataStart, metaBoxes[0].end);
  if (!metaChildren.success) return uncertain(metaChildren.reason);
  if (
    metaChildren.value.some(
      (box) => trackBoxes.has(box.type) || box.type === "iref",
    )
  ) {
    return uncertain("unsupported_structure");
  }
  const allowedMeta = new Set([
    "hdlr",
    "pitm",
    "iloc",
    "iinf",
    "iprp",
    "idat",
    "dinf",
    "free",
    "skip",
  ]);
  if (metaChildren.value.some((box) => !allowedMeta.has(box.type))) {
    return uncertain("unsupported_structure");
  }

  const one = (type: string): IsoBox | null => {
    const matches = metaChildren.value.filter((box) => box.type === type);
    return matches.length === 1 ? matches[0] : null;
  };
  const hdlr = one("hdlr");
  const pitm = one("pitm");
  const iloc = one("iloc");
  const iinf = one("iinf");
  const iprp = one("iprp");
  if (!hdlr || !pitm || !iloc || !iinf || !iprp) {
    return uncertain("unsupported_structure");
  }
  const handler = fullBoxHeader(bytes, hdlr);
  if (
    !handler ||
    handler.version !== 0 ||
    handler.flags !== 0 ||
    !hasBytes(bytes, handler.dataStart, 8) ||
    fourCc(bytes, handler.dataStart + 4) !== "pict"
  ) {
    return uncertain("malformed");
  }

  const primaryItemId = parsePrimaryItemId(bytes, pitm);
  if (primaryItemId === null || primaryItemId === 0) {
    return uncertain("malformed");
  }
  const items = parseItemInfo(bytes, iinf);
  if (!items.success) return uncertain(items.reason);
  const imageItems = [...items.value].filter(([, type]) => type === "av01");
  const allowedItemTypes = new Set(["av01", "Exif", "mime"]);
  if (
    imageItems.length !== 1 ||
    imageItems[0][0] !== primaryItemId ||
    [...items.value.values()].some((type) => !allowedItemTypes.has(type))
  ) {
    return uncertain("unsupported_structure");
  }

  const locations = parsePrimaryItemLocation(bytes, iloc, primaryItemId);
  if (!locations.success) return uncertain(locations.reason);
  const idatBoxes = metaChildren.value.filter((box) => box.type === "idat");
  if (idatBoxes.length > 1) return uncertain("unsupported_structure");
  const idatRanges = idatBoxes.map((box) => ({
    start: 0,
    end: box.end - box.payloadStart,
  }));
  for (const extent of locations.value) {
    const ranges = extent.method === 0 ? mdatRanges : idatRanges;
    if (!isExtentWithin(extent, ranges)) {
      return uncertain("malformed");
    }
  }

  const properties = parseItemProperties(bytes, iprp, primaryItemId);
  if (!properties.success) return uncertain(properties.reason);
  if (
    properties.value.primaryImageSize === null ||
    properties.value.imageSizePropertyCount !== 1
  ) {
    return uncertain("unsupported_structure");
  }

  return { kind: "static", dimensions: properties.value.primaryImageSize };
}

export function classifyAvifStatic(
  bytes: Uint8Array,
): StaticImageClassification {
  const inspection = inspectAvifStatic(bytes);
  return inspection.kind === "static" ? STATIC : inspection;
}

export function classifyStaticImage(
  format: "png" | "webp" | "avif",
  bytes: Uint8Array,
): StaticImageClassification {
  if (format === "png") return classifyPngStatic(bytes);
  if (format === "webp") return classifyWebPStatic(bytes);
  return classifyAvifStatic(bytes);
}
