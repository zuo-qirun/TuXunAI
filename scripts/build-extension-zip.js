const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const root = path.resolve(__dirname, "..");
const defaultSourceDir = path.join(root, "extension");
const defaultOutputFile = path.join(root, "dist", "TuXunAI.zip");

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = crcTable[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const dosDate =
    ((year - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  return { dosDate, dosTime };
}

function writeUInt16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function writeUInt32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

function collectFiles(sourceDir) {
  const files = [];

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  walk(sourceDir);
  return files;
}

function buildExtensionZip(sourceDir = defaultSourceDir, outputFile = defaultOutputFile) {
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Extension directory does not exist: ${sourceDir}`);
  }

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });

  const fileParts = [];
  const centralParts = [];
  let offset = 0;

  for (const filePath of collectFiles(sourceDir)) {
    const raw = fs.readFileSync(filePath);
    const compressed = zlib.deflateRawSync(raw, { level: 9 });
    const checksum = crc32(raw);
    const stat = fs.statSync(filePath);
    const { dosDate, dosTime } = dosDateTime(stat.mtime);
    const name = path.relative(sourceDir, filePath).replaceAll(path.sep, "/");
    const nameBuffer = Buffer.from(name, "utf8");

    const localHeader = Buffer.concat([
      writeUInt32(0x04034b50),
      writeUInt16(20),
      writeUInt16(0),
      writeUInt16(8),
      writeUInt16(dosTime),
      writeUInt16(dosDate),
      writeUInt32(checksum),
      writeUInt32(compressed.length),
      writeUInt32(raw.length),
      writeUInt16(nameBuffer.length),
      writeUInt16(0),
      nameBuffer
    ]);

    fileParts.push(localHeader, compressed);

    centralParts.push(
      Buffer.concat([
        writeUInt32(0x02014b50),
        writeUInt16(20),
        writeUInt16(20),
        writeUInt16(0),
        writeUInt16(8),
        writeUInt16(dosTime),
        writeUInt16(dosDate),
        writeUInt32(checksum),
        writeUInt32(compressed.length),
        writeUInt32(raw.length),
        writeUInt16(nameBuffer.length),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt16(0),
        writeUInt32(0),
        writeUInt32(offset),
        nameBuffer
      ])
    );

    offset += localHeader.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.concat([
    writeUInt32(0x06054b50),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(centralParts.length),
    writeUInt16(centralParts.length),
    writeUInt32(centralDirectory.length),
    writeUInt32(offset),
    writeUInt16(0)
  ]);

  const zip = Buffer.concat([...fileParts, centralDirectory, endRecord]);
  const tempFile = `${outputFile}.tmp`;
  fs.writeFileSync(tempFile, zip);
  fs.renameSync(tempFile, outputFile);
  return { outputFile, bytes: zip.length, files: centralParts.length };
}

if (require.main === module) {
  const result = buildExtensionZip();
  console.log(`[extension] Wrote ${result.outputFile} (${result.files} files, ${result.bytes} bytes)`);
}

module.exports = { buildExtensionZip };
