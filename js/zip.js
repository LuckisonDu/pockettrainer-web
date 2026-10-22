// 手写的最简 zip（"存储"模式，不压缩）：给 Export 用。文件格式：每个文件 = 本地头 + 数据；最后是中央目录。
import { crc32 } from './util.js';
export function makeZip(files) {   // files: [{path, data: Uint8Array}]
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  const u16 = n => [n & 255, (n >> 8) & 255], u32 = n => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  for (const f of files) {
    const name = enc.encode(f.path), crc = crc32(f.data), size = f.data.length;
    const head = new Uint8Array([0x50, 0x4b, 3, 4, 20, 0, 0, 8, 0, 0, 0, 0, 33, 0, ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), 0, 0]); // bit 11: UTF-8 名字
    parts.push(head, name, f.data);
    central.push(new Uint8Array([0x50, 0x4b, 1, 2, 20, 0, 20, 0, 0, 8, 0, 0, 0, 0, 33, 0, ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...u32(offset)]), name);
    offset += head.length + name.length + size;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new Uint8Array([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), 0, 0]);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
export function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
