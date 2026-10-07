/** Removes <think>…</think> reasoning blocks from a streamed text, across arbitrary chunk boundaries. */
export class ThinkStripper {
  #inThink = false;
  #buf = "";
  static readonly OPEN = "<think>";
  static readonly CLOSE = "</think>";

  feed(chunk: string): string {
    this.#buf += chunk;
    let out = "";
    for (;;) {
      if (!this.#inThink) {
        const i = this.#buf.indexOf(ThinkStripper.OPEN);
        if (i >= 0) {
          out += this.#buf.slice(0, i);
          this.#buf = this.#buf.slice(i + ThinkStripper.OPEN.length);
          this.#inThink = true;
          continue;
        }
        const hold = this.#partialSuffix(this.#buf, ThinkStripper.OPEN);
        out += this.#buf.slice(0, this.#buf.length - hold);
        this.#buf = this.#buf.slice(this.#buf.length - hold);
        return out;
      }
      const j = this.#buf.indexOf(ThinkStripper.CLOSE);
      if (j >= 0) {
        this.#buf = this.#buf.slice(j + ThinkStripper.CLOSE.length).replace(/^\s+/, "");
        this.#inThink = false;
        continue;
      }
      const hold = this.#partialSuffix(this.#buf, ThinkStripper.CLOSE);
      this.#buf = this.#buf.slice(this.#buf.length - hold);
      return out;
    }
  }

  flush(): string {
    const rest = this.#inThink ? "" : this.#buf;
    this.#buf = "";
    this.#inThink = false;
    return rest;
  }

  #partialSuffix(s: string, tag: string): number {
    for (let n = Math.min(tag.length - 1, s.length); n > 0; n--) if (tag.startsWith(s.slice(s.length - n))) return n;
    return 0;
  }
}
