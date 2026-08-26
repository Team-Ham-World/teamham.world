function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function ascii(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function uint16(value: number): Uint8Array {
  return new Uint8Array([(value >>> 8) & 0xff, value & 0xff]);
}

function uint24LE(value: number): Uint8Array {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
  ]);
}

function uint32(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function uint32LE(value: number): Uint8Array {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

let crcTable: Uint32Array | null = null;

function pngCrc(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let value = 0; value < 256; value += 1) {
      let crc = value;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
      }
      crcTable[value] = crc >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = ascii(type);
  return concat(uint32(data.byteLength), typeBytes, data, uint32(pngCrc(concat(typeBytes, data))));
}

export function syntheticPng(
  width = 320,
  height = 200,
  options: { animated?: boolean; paddingBytes?: number; chunkCount?: number } = {},
): Uint8Array {
  const chunks: Uint8Array[] = [
    pngChunk(
      "IHDR",
      concat(
        uint32(width),
        uint32(height),
        new Uint8Array([8, 6, 0, 0, 0]),
      ),
    ),
  ];
  if (options.animated) {
    chunks.push(pngChunk("acTL", concat(uint32(1), uint32(0))));
  }
  if (options.paddingBytes) {
    chunks.push(pngChunk("tEXt", new Uint8Array(options.paddingBytes).fill(65)));
  }
  for (let index = 0; index < (options.chunkCount ?? 0); index += 1) {
    chunks.push(pngChunk("tEXt", new Uint8Array([65])));
  }
  chunks.push(pngChunk("IDAT", new Uint8Array([0])));
  chunks.push(pngChunk("IEND", new Uint8Array()));
  return concat(
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    ...chunks,
  );
}

function webpChunk(type: string, data: Uint8Array): Uint8Array {
  return concat(
    ascii(type),
    uint32LE(data.byteLength),
    data,
    data.byteLength % 2 === 1 ? new Uint8Array([0]) : new Uint8Array(),
  );
}

export function syntheticWebP(
  width = 320,
  height = 200,
  options: {
    animated?: boolean;
    animationChunk?: boolean;
    encoding?: "vp8" | "vp8l";
    extended?: boolean;
    paddingBytes?: number;
  } = {},
): Uint8Array {
  const encoding = options.encoding ?? "vp8";
  const extended = options.extended ?? true;
  const flags = (options.animated ? 0x02 : 0) | (options.paddingBytes ? 0x20 : 0);
  const chunks: Uint8Array[] = [];
  if (extended) {
    chunks.push(
      webpChunk(
        "VP8X",
        concat(
          new Uint8Array([flags, 0, 0, 0]),
          uint24LE(width - 1),
          uint24LE(height - 1),
        ),
      ),
    );
  }
  if (options.paddingBytes) {
    chunks.push(webpChunk("ICCP", new Uint8Array(options.paddingBytes).fill(65)));
  }
  if (options.animationChunk) {
    chunks.push(webpChunk("ANIM", new Uint8Array(6)));
  }
  if (encoding === "vp8") {
    chunks.push(
      webpChunk(
        "VP8 ",
        new Uint8Array([
          0x10,
          0,
          0,
          0x9d,
          0x01,
          0x2a,
          width & 0xff,
          (width >>> 8) & 0x3f,
          height & 0xff,
          (height >>> 8) & 0x3f,
        ]),
      ),
    );
  } else {
    const bits = (((height - 1) << 14) | (width - 1)) >>> 0;
    chunks.push(webpChunk("VP8L", concat(new Uint8Array([0x2f]), uint32LE(bits))));
  }
  const payload = concat(ascii("WEBP"), ...chunks);
  return concat(ascii("RIFF"), uint32LE(payload.byteLength), payload);
}

function box(type: string, payload: Uint8Array): Uint8Array {
  return concat(uint32(payload.byteLength + 8), ascii(type), payload);
}

function fullBox(
  type: string,
  version: number,
  flags: number,
  data: Uint8Array,
): Uint8Array {
  return box(
    type,
    concat(
      new Uint8Array([
        version,
        (flags >>> 16) & 0xff,
        (flags >>> 8) & 0xff,
        flags & 0xff,
      ]),
      data,
    ),
  );
}

function avifMeta(
  width: number,
  height: number,
  extentOffset: number,
  includeItemReference: boolean,
): Uint8Array {
  const hdlr = fullBox(
    "hdlr",
    0,
    0,
    concat(new Uint8Array(4), ascii("pict"), new Uint8Array(12), new Uint8Array([0])),
  );
  const pitm = fullBox("pitm", 0, 0, uint16(1));
  const infe = fullBox(
    "infe",
    2,
    0,
    concat(uint16(1), uint16(0), ascii("av01"), new Uint8Array([0])),
  );
  const iinf = fullBox("iinf", 0, 0, concat(uint16(1), infe));
  const iloc = fullBox(
    "iloc",
    0,
    0,
    concat(
      new Uint8Array([0x44, 0x00]),
      uint16(1),
      uint16(1),
      uint16(0),
      uint16(1),
      uint32(extentOffset),
      uint32(4),
    ),
  );
  const ispe = fullBox("ispe", 0, 0, concat(uint32(width), uint32(height)));
  const ipco = box("ipco", ispe);
  const ipma = fullBox(
    "ipma",
    0,
    0,
    concat(uint32(1), uint16(1), new Uint8Array([1, 0x81])),
  );
  const iprp = box("iprp", concat(ipco, ipma));
  const iref = includeItemReference ? fullBox("iref", 0, 0, new Uint8Array()) : new Uint8Array();
  return fullBox("meta", 0, 0, concat(hdlr, pitm, iloc, iinf, iprp, iref));
}

export function syntheticAvif(
  width = 320,
  height = 200,
  options: {
    sequenceBrand?: boolean;
    trackBox?: boolean;
    itemReference?: boolean;
    majorBrand?: string;
    compatibleBrands?: readonly string[];
    paddingBytes?: number;
  } = {},
): Uint8Array {
  const brand = options.sequenceBrand ? "avis" : "avif";
  const majorBrand = options.majorBrand ?? brand;
  const compatibleBrands = options.compatibleBrands ?? [brand, "mif1"];
  const ftyp = box(
    "ftyp",
    concat(
      ascii(majorBrand),
      uint32(0),
      ...compatibleBrands.map((compatibleBrand) => ascii(compatibleBrand)),
    ),
  );
  const padding = options.paddingBytes
    ? box("free", new Uint8Array(options.paddingBytes))
    : new Uint8Array();
  let meta = avifMeta(width, height, 0, options.itemReference ?? false);
  const optionalTrack = options.trackBox ? box("moov", new Uint8Array()) : new Uint8Array();
  const mdatOffset =
    ftyp.byteLength + padding.byteLength + meta.byteLength + optionalTrack.byteLength + 8;
  meta = avifMeta(width, height, mdatOffset, options.itemReference ?? false);
  return concat(ftyp, padding, meta, optionalTrack, box("mdat", new Uint8Array(4)));
}

function jpegSegment(marker: number, payload: Uint8Array): Uint8Array {
  return concat(new Uint8Array([0xff, marker]), uint16(payload.byteLength + 2), payload);
}

export function syntheticJpeg(
  width = 320,
  height = 200,
  options: { paddingBytes?: number; truncate?: boolean } = {},
): Uint8Array {
  const segments: Uint8Array[] = [];
  let padding = Math.max(0, options.paddingBytes ?? 0);
  if (padding === 0) {
    segments.push(jpegSegment(0xe0, new Uint8Array()));
  } else {
    while (padding > 0) {
      const length = Math.min(padding, 65_533);
      segments.push(jpegSegment(0xe1, new Uint8Array(length)));
      padding -= length;
    }
  }
  segments.push(
    jpegSegment(
      0xc0,
      concat(
        new Uint8Array([8]),
        uint16(height),
        uint16(width),
        new Uint8Array([3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]),
      ),
    ),
  );
  segments.push(
    jpegSegment(
      0xda,
      new Uint8Array([3, 1, 0, 2, 0, 3, 0, 0, 63, 0]),
    ),
  );
  const result = concat(
    new Uint8Array([0xff, 0xd8]),
    ...segments,
    new Uint8Array([0x00, 0xff, 0xd9]),
  );
  return options.truncate ? result.slice(0, -2) : result;
}

export function syntheticMalformedJpegLargeZeros(
  byteSize = 1_000_000,
): Uint8Array {
  const bytes = new Uint8Array(Math.max(4, byteSize));
  bytes.set([0xff, 0xd8, 0xff, 0x01]);
  return bytes;
}

export const syntheticGif = new TextEncoder().encode("GIF89a........");
export const syntheticSvg = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>',
);
export const syntheticIcnsZeroEntry = concat(
  ascii("icns"),
  uint32(16),
  ascii("ic07"),
  uint32(0),
);
export const syntheticJxlContainer = new Uint8Array([
  0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a,
]);
export const syntheticJxlCodestream = new Uint8Array([0xff, 0x0a, 0x00, 0x00]);
