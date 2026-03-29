// Beat detection + audio-to-lyric mapping engine
// Tracks energy history to detect transients (beats) in real time

export class BeatDetector {
  constructor() {
    this.energyHistory = []
    this.historySize = 43 // ~1 second at 60fps
    this.beatCooldown = 0
    this.lastBeatTime = 0
    this.beatIntensity = 0 // 0..1, decays after beat
    this.beatCount = 0

    // Per-band beat detection
    this.bassHistory = []
    this.midHistory = []
    this.trebleHistory = []
    this.bassBeat = 0
    this.midBeat = 0
    this.trebleBeat = 0

    // Motion state for text manipulation
    this.prevOverall = 0
    this.prevBass = 0
    this.surge = 0
    this.release = 0
    this.pressure = 0
    this.impact = 0
    this.trebleShimmer = 0
    this.splitPulse = 0
  }

  update(metrics, dt) {
    const { bass, mid, treble, overall } = metrics

    // Push to histories
    this.energyHistory.push(overall)
    this.bassHistory.push(bass)
    this.midHistory.push(mid)
    this.trebleHistory.push(treble)

    if (this.energyHistory.length > this.historySize) this.energyHistory.shift()
    if (this.bassHistory.length > this.historySize) this.bassHistory.shift()
    if (this.midHistory.length > this.historySize) this.midHistory.shift()
    if (this.trebleHistory.length > this.historySize) this.trebleHistory.shift()

    // Detect beats per band
    this.bassBeat = Math.max(0, this.bassBeat - dt * 4)
    this.midBeat = Math.max(0, this.midBeat - dt * 5)
    this.trebleBeat = Math.max(0, this.trebleBeat - dt * 6)
    this.beatIntensity = Math.max(0, this.beatIntensity - dt * 3)
    this.beatCooldown = Math.max(0, this.beatCooldown - dt)
    this.surge = Math.max(0, this.surge - dt * 2.8)
    this.release = Math.max(0, this.release - dt * 2.4)
    this.trebleShimmer = Math.max(0, this.trebleShimmer - dt * 5)
    this.splitPulse = Math.max(0, this.splitPulse - dt * 3.4)

    const overallDelta = overall - this.prevOverall
    const bassDelta = bass - this.prevBass
    const rise = Math.max(0, overallDelta * 7 + bassDelta * 5)
    const drop = Math.max(0, -overallDelta * 6 - bassDelta * 2)
    const targetPressure = overall * 0.55 + bass * 0.45

    this.surge = Math.max(this.surge, rise)
    this.release = Math.max(this.release, drop)
    this.pressure += (targetPressure - this.pressure) * Math.min(1, dt * 6)

    if (this.bassHistory.length >= 10) {
      const avg = average(this.bassHistory)
      if (bass > avg * 1.4 && bass > 0.25 && this.beatCooldown <= 0) {
        this.bassBeat = 1
        this.beatIntensity = Math.min(1, bass / 0.6)
        this.surge = Math.max(this.surge, 0.45 + bass * 0.8)
        this.splitPulse = Math.max(this.splitPulse, 0.55 + bass * 0.9)
        this.beatCooldown = 0.15
        this.beatCount++
        this.lastBeatTime = performance.now() / 1000
      }
    }

    if (this.midHistory.length >= 10) {
      const avg = average(this.midHistory)
      if (mid > avg * 1.3 && mid > 0.15) {
        this.midBeat = Math.min(1, mid / 0.4)
      }
    }

    if (this.trebleHistory.length >= 10) {
      const avg = average(this.trebleHistory)
      if (treble > avg * 1.3 && treble > 0.1) {
        this.trebleBeat = Math.min(1, treble / 0.3)
        this.trebleShimmer = Math.max(this.trebleShimmer, this.trebleBeat)
      }
    }

    this.impact = Math.max(
      this.beatIntensity,
      this.surge * 0.9 + this.pressure * 0.25,
      this.trebleShimmer * 0.45,
    )

    this.prevOverall = overall
    this.prevBass = bass
  }

  // Map a word index to a frequency band intensity
  // Words at different positions get driven by different bands
  getWordEnergy(wordIndex, totalWords) {
    if (totalWords <= 1) return this.beatIntensity
    const t = wordIndex / (totalWords - 1) // 0..1 across the line
    // Left words → bass, middle → mid, right → treble
    const bassWeight = Math.max(0, 1 - t * 2.5)
    const midWeight = 1 - Math.abs(t - 0.5) * 2.5
    const trebleWeight = Math.max(0, t * 2.5 - 1.5)
    const total = bassWeight + midWeight + trebleWeight
    return (bassWeight * this.bassBeat + midWeight * this.midBeat + trebleWeight * this.trebleBeat) / Math.max(total, 0.01)
  }

  // Map a character index to a frequency bin directly
  getCharFrequency(charIndex, totalChars, frequencyData) {
    if (!frequencyData || frequencyData.length === 0) return 0
    const binIndex = Math.floor((charIndex / totalChars) * frequencyData.length * 0.3)
    return (frequencyData[Math.min(binIndex, frequencyData.length - 1)] || 0) / 255
  }
}

function average(arr) {
  let sum = 0
  for (let i = 0; i < arr.length; i++) sum += arr[i]
  return sum / arr.length
}
