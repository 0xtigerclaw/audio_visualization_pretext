// LRC (timed lyrics) file parser
// Supports standard LRC format: [mm:ss.xx] lyric text
// Also supports enhanced LRC with word-level timing: [mm:ss.xx] <mm:ss.xx> word <mm:ss.xx> word

/**
 * Parse an LRC file string into timed lyrics array
 * Returns: [{ time: seconds, text: string, emphasis: boolean, words?: [{time, text}] }]
 */
export function parseLRC(lrcText) {
  const lines = lrcText.split('\n')
  const lyrics = []
  const metadata = {}

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // Parse metadata tags: [ti:Title], [ar:Artist], [al:Album], [offset:+/-ms]
    const metaMatch = trimmed.match(/^\[(\w+):(.+)\]$/)
    if (metaMatch && !trimmed.match(/^\[\d/)) {
      metadata[metaMatch[1].toLowerCase()] = metaMatch[2].trim()
      continue
    }

    // Parse timed lines: [00:12.34] lyrics text
    // Multiple timestamps can prefix the same line: [00:12.34][01:45.67] lyrics
    const timeRegex = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g
    const timestamps = []
    let match
    while ((match = timeRegex.exec(trimmed)) !== null) {
      const min = parseInt(match[1])
      const sec = parseInt(match[2])
      const ms = parseLrcFraction(match[3])
      timestamps.push(min * 60 + sec + ms / 1000)
    }

    if (timestamps.length === 0) continue

    // Extract the text part (everything after the last timestamp bracket)
    const textPart = trimmed.replace(/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g, '').trim()

    // Check for enhanced LRC word-level timing: <00:12.34> word
    const wordTimingRegex = /<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>\s*([^<]*)/g
    const wordTimings = []
    let wordMatch
    while ((wordMatch = wordTimingRegex.exec(textPart)) !== null) {
      const wMin = parseInt(wordMatch[1])
      const wSec = parseInt(wordMatch[2])
      const wMs = parseLrcFraction(wordMatch[3])
      wordTimings.push({
        time: wMin * 60 + wSec + wMs / 1000,
        text: wordMatch[4].trim(),
      })
    }

    // Clean text (remove word timing tags)
    const cleanText = textPart.replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, '').trim()
    const emphasisMatch = cleanText.match(/^([*_])(.+)\1$/)
    const displayText = emphasisMatch ? emphasisMatch[2].trim() : cleanText

    // Detect emphasis: lines in ALL CAPS, or surrounded by * or _
    const isEmphasis = Boolean(emphasisMatch)
      || (displayText === displayText.toUpperCase() && displayText.length > 3 && /[A-Z]/.test(displayText))

    for (const time of timestamps) {
      const entry = {
        time,
        text: displayText,
        emphasis: isEmphasis,
      }
      if (wordTimings.length > 0) {
        entry.words = wordTimings
      }
      lyrics.push(entry)
    }
  }

  // Sort by time
  lyrics.sort((a, b) => a.time - b.time)

  // Apply offset if specified in metadata
  if (metadata.offset) {
    const offsetMs = parseInt(metadata.offset)
    if (!isNaN(offsetMs)) {
      const offsetSec = offsetMs / 1000
      for (const l of lyrics) {
        l.time = Math.max(0, l.time + offsetSec)
      }
    }
  }

  return { lyrics, metadata }
}

function parseLrcFraction(value) {
  if (!value) return 0
  if (value.length === 1) return parseInt(value, 10) * 100
  if (value.length === 2) return parseInt(value, 10) * 10
  return parseInt(value.slice(0, 3), 10)
}

/**
 * Parse plain text lyrics (one line per line) and distribute evenly across duration
 */
export function parsePlainLyrics(text, audioDuration) {
  const rawLines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  if (rawLines.length === 0) return []

  const interval = audioDuration / (rawLines.length + 1)
  const lyrics = [{ time: 0, text: '', emphasis: false }]

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]
    const isEmphasis = line.startsWith('*') && line.endsWith('*')
    lyrics.push({
      time: (i + 1) * interval,
      text: isEmphasis ? line.slice(1, -1) : line,
      emphasis: isEmphasis,
    })
  }

  lyrics.push({ time: audioDuration - 0.5, text: '', emphasis: false })
  return lyrics
}

/**
 * Detect file type and parse accordingly
 */
export function parseLyricsFile(content, filename, audioDuration) {
  if (filename.toLowerCase().endsWith('.lrc')) {
    const { lyrics, metadata } = parseLRC(content)
    return { lyrics, metadata }
  }
  // Plain text fallback
  const lyrics = parsePlainLyrics(content, audioDuration || 180)
  return { lyrics, metadata: {} }
}
