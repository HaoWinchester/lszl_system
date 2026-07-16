// 学习包 ZIP（STORE 模式，移植自 legacy/src/21-home-package-service.js，无外部依赖）

const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[i] = c >>> 0 }
  return t
})()

function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const u16 = (v: number): number[] => [v & 255, (v >>> 8) & 255]
const u32 = (v: number): number[] => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]
const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

/** 将多个文本条目打包成 ZIP Blob（STORE 无压缩，与 legacy 一致） */
export function makeZip(entries: { name: string; data: string }[]): Blob {
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const now = new Date()
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2)
  const dosDate = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
  for (const e of entries) {
    const name = enc(e.name), data = enc(e.data), crc = crc32(data)
    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime), ...u16(dosDate),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0),
    ])
    parts.push(local, name, data)
    central.push(new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime), ...u16(dosDate),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0), ...u32(offset),
    ]), name)
    offset += local.length + name.length + data.length
  }
  let centralSize = 0
  central.forEach((p) => (centralSize += p.length))
  const end = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length),
    ...u32(centralSize), ...u32(offset), ...u16(0),
  ])
  return new Blob([...parts, ...central, end] as unknown as BlobPart[], { type: 'application/zip' })
}

/** 解析 STORE ZIP，返回 { 文件名: 文本内容 } */
export async function readZip(file: File): Promise<Record<string, string>> {
  const buf = new Uint8Array(await file.arrayBuffer())
  const result: Record<string, string> = {}
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 5 && buf[i + 3] === 6) { eocd = i; break }
  }
  if (eocd < 0) return result
  const ru16 = (o: number) => buf[o] | (buf[o + 1] << 8)
  const ru32 = (o: number) => (buf[o] | (buf[o + 1] << 8) | (buf[o + 2] << 16) | (buf[o + 3] << 24)) >>> 0
  const count = ru16(eocd + 10)
  let p = ru32(eocd + 16)
  for (let i = 0; i < count; i++) {
    if (!(buf[p] === 0x50 && buf[p + 1] === 0x4b && buf[p + 2] === 1 && buf[p + 3] === 2)) break
    const method = ru16(p + 10)
    const compSize = ru32(p + 20)
    const uncompSize = ru32(p + 24)
    const nameLen = ru16(p + 28)
    const extraLen = ru16(p + 30)
    const commentLen = ru16(p + 32)
    const localOff = ru32(p + 42)
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen))
    if (method === 0 && uncompSize > 0) {
      const lhNameLen = ru16(localOff + 26)
      const lhExtraLen = ru16(localOff + 28)
      const start = localOff + 30 + lhNameLen + lhExtraLen
      result[name] = new TextDecoder().decode(buf.subarray(start, start + compSize))
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  return result
}
