export class SectionBoundaryNavigator {
  constructor({ threshold = 72, cooldown = 650, maxInterval = 240 } = {}) {
    this.threshold = threshold
    this.cooldown = cooldown
    this.maxInterval = maxInterval
    this.reset()
  }

  reset() {
    this.accumulated = 0
    this.direction = 0
    this.lastTime = 0
    this.lockedUntil = 0
  }

  push({ delta, atStart, atEnd, now = Date.now() }) {
    if (!Number.isFinite(delta) || delta === 0 || now < this.lockedUntil) return 0

    const direction = Math.sign(delta)
    const atBoundary = direction > 0 ? atEnd : atStart
    if (!atBoundary) {
      this.accumulated = 0
      this.direction = direction
      this.lastTime = now
      return 0
    }

    if (direction !== this.direction || now - this.lastTime > this.maxInterval) {
      this.accumulated = 0
    }
    this.direction = direction
    this.lastTime = now
    this.accumulated += Math.abs(delta)

    if (this.accumulated < this.threshold) return 0

    this.accumulated = 0
    this.lockedUntil = now + this.cooldown
    return direction
  }
}
