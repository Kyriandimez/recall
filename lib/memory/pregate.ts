export interface PregateResult {
  extract: boolean;
  reason: string;
}

const GREETING =
  /^(?:hello|hi|hey|yo|thanks|thank you|thx|ty|lol|lmao|ok|okay|cool|nice|great|bye|good (?:morning|night|evening))[\s!.,]*$/i;

const FIRST_PERSON =
  /\b(?:i|i'm|im|i've|ive|i'd|i'll|my|mine|we|our|let's)\b/i;

const CUES: RegExp[] = [
  /\bmy\s+(?:favorite|preferred|usual)\s+\w+\b/i,
  /\bmy name is\b/i,

  /\b(?:i'm|i am|im)\s+(?:a|an|the|building|learning|working|trying|studying|from|based|going|planning|developing|creating|making|using|into|currently|now|new|still)\b/i,

  /\bi\s+(?:use|prefer|like|love|hate|enjoy|moved|live|work|switched|started|stopped|quit|study|speak|own|drive|play|code|write|build|am|have|want|will|plan|intend|hope)\b/i,

  /\bi\s+(?:don't|do not|no longer|never)\b/i,

  /\b(?:i'm|i am|im)\s+going\s+to\b/i,

  /\bgoing\s+to\s+(?:build|make|create|use|learn|study|work|develop|visit|travel|cook|start|take|buy|move|join|attend|launch)\b/i,

  /\b(?:i\s+)?(?:plan|plans|planning)\s+to\b/i,

  /\b(?:i\s+)?intend\s+to\b/i,

  /\b(?:i\s+)?(?:hope|want|would like)\s+to\b/i,

  /\bi\s+(?:will|'ll|shall)\b/i,

  /\b(?:tomorrow|tonight|this weekend|next week|next month|next year|in \d+\s+(?:days?|weeks?|months?|years?)|long term|long-term|eventually)\b/i,

  /\blet's\s+(?:start|build|make|create|use|learn|work)\b/i,

  /\b(?:actually|no longer|not anymore|anymore)\b/i,

  /\bremember\b/i,
];

export function pregate(message: string): PregateResult {
  const text = message.trim();

  if (!text) {
    return { extract: false, reason: "empty" };
  }

  if (GREETING.test(text)) {
    return { extract: false, reason: "greeting_or_filler" };
  }

  if (text.split(/\s+/).length <= 2) {
    return { extract: false, reason: "too_short" };
  }

  if (!FIRST_PERSON.test(text)) {
    return { extract: false, reason: "no_first_person" };
  }

  if (CUES.some((re) => re.test(text))) {
    return { extract: true, reason: "personal_or_future_intent_cue" };
  }

  return { extract: false, reason: "no_cue" };
}

