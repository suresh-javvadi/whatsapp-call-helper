// Runs a task now and then repeatedly, with a fixed pause between runs.
// The next run is only planned after the current one has finished, and a
// "busy" flag guards against overlap, so two browser actions never run at once.
const { log, describeError } = require('./logger');

class Scheduler {
  constructor(task, intervalMs) {
    this.task = task;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.running = false;
    this.busy = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.#tick();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = null;
  }

  async #tick() {
    if (!this.running) return;

    if (this.busy) {
      log.warn('Previous action is still running; skipping this round.');
    } else {
      this.busy = true;
      try {
        await this.task();
      } catch (err) {
        if (this.running) log.error(`${describeError(err)} - will try again next round.`);
      } finally {
        this.busy = false;
      }
    }

    if (this.running) {
      const next = new Date(Date.now() + this.intervalMs).toLocaleTimeString();
      log.info(`Next reminder at ${next}. Press Ctrl+C to stop.`);
      this.timer = setTimeout(() => this.#tick(), this.intervalMs);
    }
  }
}

module.exports = { Scheduler };
