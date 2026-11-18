// Made by video/experiments/voice_lines.py from the ElevenLabs timings: one take per line, a breath
// between lines. Film frames at 24 fps.
export type Word = { w: string; from: number; to: number };
export type Chunk = { text: string; from: number; to: number; words: Word[] };
export const CAPTIONS: Chunk[] = [
 {
  "text": "Pluto was found",
  "from": 24,
  "to": 53,
  "words": [
   {
    "w": "Pluto",
    "from": 24,
    "to": 38
   },
   {
    "w": "was",
    "from": 40,
    "to": 43
   },
   {
    "w": "found",
    "from": 45,
    "to": 51
   }
  ]
 },
 {
  "text": "by blinking two photos.",
  "from": 53,
  "to": 116,
  "words": [
   {
    "w": "by",
    "from": 53,
    "to": 56
   },
   {
    "w": "blinking",
    "from": 59,
    "to": 75
   },
   {
    "w": "two",
    "from": 77,
    "to": 86
   },
   {
    "w": "photos.",
    "from": 87,
    "to": 108
   }
  ]
 },
 {
  "text": "Slowsky: pick a star,",
  "from": 132,
  "to": 193,
  "words": [
   {
    "w": "Slow",
    "from": 132,
    "to": 141
   },
   {
    "w": "sky:",
    "from": 143,
    "to": 158
   },
   {
    "w": "pick",
    "from": 166,
    "to": 171
   },
   {
    "w": "a",
    "from": 172,
    "to": 173
   },
   {
    "w": "star,",
    "from": 174,
    "to": 189
   }
  ]
 },
 {
  "text": "and watch the sky change.",
  "from": 193,
  "to": 251,
  "words": [
   {
    "w": "and",
    "from": 193,
    "to": 197
   },
   {
    "w": "watch",
    "from": 199,
    "to": 207
   },
   {
    "w": "the",
    "from": 209,
    "to": 211
   },
   {
    "w": "sky",
    "from": 213,
    "to": 225
   },
   {
    "w": "change.",
    "from": 227,
    "to": 243
   }
  ]
 },
 {
  "text": "NASA's SPHEREx maps the sky",
  "from": 266,
  "to": 323,
  "words": [
   {
    "w": "NASA's",
    "from": 266,
    "to": 278
   },
   {
    "w": "SPHEREx",
    "from": 279,
    "to": 294
   },
   {
    "w": "maps",
    "from": 297,
    "to": 304
   },
   {
    "w": "the",
    "from": 306,
    "to": 308
   },
   {
    "w": "sky",
    "from": 309,
    "to": 321
   }
  ]
 },
 {
  "text": "in 102 infrared colours.",
  "from": 323,
  "to": 396,
  "words": [
   {
    "w": "in",
    "from": 323,
    "to": 325
   },
   {
    "w": "a",
    "from": 326,
    "to": 327
   },
   {
    "w": "hundred",
    "from": 330,
    "to": 339
   },
   {
    "w": "and",
    "from": 341,
    "to": 343
   },
   {
    "w": "two",
    "from": 345,
    "to": 354
   },
   {
    "w": "infrared",
    "from": 357,
    "to": 372
   },
   {
    "w": "colours.",
    "from": 374,
    "to": 388
   }
  ]
 },
 {
  "text": "These are real SPHEREx pixels.",
  "from": 413,
  "to": 478,
  "words": [
   {
    "w": "These",
    "from": 413,
    "to": 418
   },
   {
    "w": "are",
    "from": 419,
    "to": 423
   },
   {
    "w": "real",
    "from": 427,
    "to": 434
   },
   {
    "w": "SPHEREx",
    "from": 436,
    "to": 451
   },
   {
    "w": "pixels.",
    "from": 453,
    "to": 470
   }
  ]
 },
 {
  "text": "Volunteers found over 3,000",
  "from": 494,
  "to": 551,
  "words": [
   {
    "w": "Volunteers",
    "from": 494,
    "to": 511
   },
   {
    "w": "found",
    "from": 513,
    "to": 519
   },
   {
    "w": "over",
    "from": 520,
    "to": 524
   },
   {
    "w": "three",
    "from": 527,
    "to": 534
   },
   {
    "w": "thousand",
    "from": 536,
    "to": 549
   }
  ]
 },
 {
  "text": "brown dwarf candidates.",
  "from": 551,
  "to": 597,
  "words": [
   {
    "w": "brown",
    "from": 551,
    "to": 560
   },
   {
    "w": "dwarf",
    "from": 562,
    "to": 570
   },
   {
    "w": "candidates.",
    "from": 571,
    "to": 589
   }
  ]
 },
 {
  "text": "Now anyone can join the hunt.",
  "from": 612,
  "to": 668,
  "words": [
   {
    "w": "Now",
    "from": 612,
    "to": 617
   },
   {
    "w": "anyone",
    "from": 620,
    "to": 633
   },
   {
    "w": "can",
    "from": 634,
    "to": 637
   },
   {
    "w": "join",
    "from": 639,
    "to": 645
   },
   {
    "w": "the",
    "from": 646,
    "to": 648
   },
   {
    "w": "hunt.",
    "from": 650,
    "to": 660
   }
  ]
 }
];
