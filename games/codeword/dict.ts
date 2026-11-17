// Code Word's dictionary (server only). Secret words come from ANSWERS (everyday words);
// guesses may be any real five-letter word, using the big list Word Ladder ships.

import { COMMON5, EXTRA5 } from "../ladder/words";
import { ANSWERS } from "./words";

let answers: string[] | null = null;
let accept: Set<string> | null = null;

export function answerList(): string[] {
  if (!answers) answers = ANSWERS.split(" ").filter(Boolean);
  return answers;
}

export function isGuessWord(w: string): boolean {
  if (!accept) {
    accept = new Set([...COMMON5.split(" "), ...EXTRA5.split(" "), ...answerList()]);
    accept.delete("");
  }
  return accept.has(w);
}

/** `count` different secret words picked with `random`, avoiding `recent` when it can. */
export function pickAnswers(count: number, random: () => number, recent: Set<string>): string[] {
  const list = answerList();
  const out: string[] = [];
  for (let k = 0; k < count; k++) {
    let w = list[0];
    for (let attempt = 0; attempt < 200; attempt++) {
      w = list[Math.min(list.length - 1, Math.floor(random() * list.length))];
      if (!out.includes(w) && (attempt >= 150 || !recent.has(w))) break;
    }
    out.push(w);
  }
  return out;
}
