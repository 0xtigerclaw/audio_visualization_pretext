// Minimal ID3v2 tag reader for MP3 files
// Extracts: title (TIT2), artist (TPE1), album (TALB), embedded lyrics (USLT)

export async function readID3Tags(file) {
  const result = { title: '', artist: '', album: '', lyrics: '' }

  try {
    // Read the first 128KB — enough for ID3v2 header + common tags
    const slice = file.slice(0, 131072)
    const buffer = await slice.arrayBuffer()
    const view = new DataView(buffer)
    const bytes = new Uint8Array(buffer)

    // Check for ID3v2 header: "ID3"
    if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) {
      // Try ID3v1 at end of file (last 128 bytes)
      return await tryID3v1(file, result)
    }

    const version = bytes[3] // 3 = ID3v2.3, 4 = ID3v2.4
    const flags = bytes[5]
    const hasExtHeader = (flags & 0x40) !== 0

    // Tag size (syncsafe integer)
    const tagSize = decodeSyncsafe(view, 6)
    let offset = 10

    // Skip extended header if present
    if (hasExtHeader) {
      const extSize = version === 4
        ? decodeSyncsafe(view, offset)
        : view.getUint32(offset)
      offset += extSize
    }

    const tagEnd = Math.min(10 + tagSize, buffer.byteLength)

    // Parse frames
    while (offset + 10 < tagEnd) {
      const frameId = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])

      // Stop if we hit padding (null bytes)
      if (frameId[0] === '\0') break

      const frameSize = version === 4
        ? decodeSyncsafe(view, offset + 4)
        : view.getUint32(offset + 4)

      if (frameSize <= 0 || offset + 10 + frameSize > tagEnd) break

      const frameData = bytes.slice(offset + 10, offset + 10 + frameSize)

      switch (frameId) {
        case 'TIT2':
          result.title = decodeTextFrame(frameData)
          break
        case 'TPE1':
          result.artist = decodeTextFrame(frameData)
          break
        case 'TALB':
          result.album = decodeTextFrame(frameData)
          break
        case 'USLT':
          result.lyrics = decodeUSLTFrame(frameData)
          break
      }

      offset += 10 + frameSize
    }
  } catch (e) {
    console.warn('ID3 parse error:', e)
  }

  // If no title, use filename
  if (!result.title) {
    result.title = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')
  }

  return result
}

function decodeSyncsafe(view, offset) {
  return (
    ((view.getUint8(offset) & 0x7f) << 21) |
    ((view.getUint8(offset + 1) & 0x7f) << 14) |
    ((view.getUint8(offset + 2) & 0x7f) << 7) |
    (view.getUint8(offset + 3) & 0x7f)
  )
}

function decodeTextFrame(data) {
  if (data.length < 2) return ''
  const encoding = data[0]
  const textBytes = data.slice(1)

  switch (encoding) {
    case 0: // ISO-8859-1
      return decodeLatin1(textBytes)
    case 1: // UTF-16 with BOM
      return decodeUTF16(textBytes)
    case 2: // UTF-16BE
      return decodeUTF16BE(textBytes)
    case 3: // UTF-8
      return new TextDecoder('utf-8').decode(textBytes)
    default:
      return decodeLatin1(textBytes)
  }
}

function decodeUSLTFrame(data) {
  if (data.length < 5) return ''
  const encoding = data[0]
  // Skip language (3 bytes) and content descriptor (variable, null-terminated)
  let offset = 4 // encoding + 3 bytes language

  // Skip content descriptor (null terminated)
  if (encoding === 0 || encoding === 3) {
    while (offset < data.length && data[offset] !== 0) offset++
    offset++ // skip null
  } else {
    // UTF-16: look for double-null
    while (offset + 1 < data.length && !(data[offset] === 0 && data[offset + 1] === 0)) offset += 2
    offset += 2
  }

  const textBytes = data.slice(offset)
  switch (encoding) {
    case 0: return decodeLatin1(textBytes)
    case 1: return decodeUTF16(textBytes)
    case 2: return decodeUTF16BE(textBytes)
    case 3: return new TextDecoder('utf-8').decode(textBytes)
    default: return decodeLatin1(textBytes)
  }
}

function decodeLatin1(bytes) {
  let str = ''
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) break
    str += String.fromCharCode(bytes[i])
  }
  return str
}

function decodeUTF16(bytes) {
  if (bytes.length < 2) return ''
  // Check BOM
  const bom = (bytes[0] << 8) | bytes[1]
  const le = bom === 0xfffe
  const start = (bom === 0xfeff || bom === 0xfffe) ? 2 : 0
  let str = ''
  for (let i = start; i + 1 < bytes.length; i += 2) {
    const code = le ? (bytes[i + 1] << 8) | bytes[i] : (bytes[i] << 8) | bytes[i + 1]
    if (code === 0) break
    str += String.fromCharCode(code)
  }
  return str
}

function decodeUTF16BE(bytes) {
  let str = ''
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = (bytes[i] << 8) | bytes[i + 1]
    if (code === 0) break
    str += String.fromCharCode(code)
  }
  return str
}

async function tryID3v1(file, result) {
  if (file.size < 128) return result
  const slice = file.slice(file.size - 128)
  const buffer = await slice.arrayBuffer()
  const bytes = new Uint8Array(buffer)

  // Check "TAG" marker
  if (bytes[0] !== 0x54 || bytes[1] !== 0x41 || bytes[2] !== 0x47) {
    result.title = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')
    return result
  }

  result.title = decodeLatin1(bytes.slice(3, 33)).trim()
  result.artist = decodeLatin1(bytes.slice(33, 63)).trim()
  result.album = decodeLatin1(bytes.slice(63, 93)).trim()

  if (!result.title) {
    result.title = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')
  }

  return result
}
