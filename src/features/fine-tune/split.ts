/**
 * @hilbras/fine-tune — Data Splitting
 *
 * Split training data into train/validation/test sets.
 */

import type { TrainingExample, DataSplitOptions, DataSplit } from "./types.js";

/**
 * Split training examples into train/validation/test sets.
 *
 * @example
 * ```typescript
 * const split = splitData(examples, {
 *   trainRatio: 0.8,
 *   valRatio: 0.1,
 *   testRatio: 0.1,
 *   seed: 42,
 * });
 * console.log(split.train.length);  // 80
 * console.log(split.validation.length); // 10
 * ```
 */
export function splitData(
  examples: TrainingExample[],
  options: DataSplitOptions = {}
): DataSplit {
  const {
    trainRatio = 0.8,
    valRatio = 0.1,
    testRatio = 0.1,
    seed = 42,
  } = options;

  const total = trainRatio + valRatio + testRatio;
  if (Math.abs(total - 1) > 0.001) {
    throw new Error(`Ratios must sum to 1, got ${total}`);
  }

  // Shuffle with seeded random
  const shuffled = [...examples];
  let s = seed;
  for (let i = shuffled.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    const j = Math.abs(s) % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const trainEnd = Math.floor(shuffled.length * trainRatio);
  const valEnd = trainEnd + Math.floor(shuffled.length * valRatio);

  return {
    train: shuffled.slice(0, trainEnd),
    validation: shuffled.slice(trainEnd, valEnd),
    test: shuffled.slice(valEnd),
  };
}
