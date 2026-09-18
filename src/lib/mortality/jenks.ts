export const JENKS_CLASSES = 5;

export function jenksBreaks(values: number[], classes: number): number[] {
  const data = [...values].sort((a, b) => a - b);
  const n = data.length;
  if (n === 0) return [];
  if (n <= classes) return [...new Set(data)];

  const lowerClassLimits: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(classes + 1).fill(0),
  );
  const varianceCombinations: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(classes + 1).fill(Infinity),
  );
  for (let i = 1; i <= classes; i++) {
    lowerClassLimits[1]![i] = 1;
    varianceCombinations[1]![i] = 0;
  }

  for (let l = 2; l <= n; l++) {
    let sum = 0;
    let sumSquares = 0;
    let w = 0;
    let variance = 0;
    for (let m = 1; m <= l; m++) {
      const lowerLimit = l - m + 1;
      const value = data[lowerLimit - 1] ?? 0;
      w += 1;
      sum += value;
      sumSquares += value * value;
      variance = sumSquares - (sum * sum) / w;
      const previous = lowerLimit - 1;
      if (previous === 0) continue;
      for (let j = 2; j <= classes; j++) {
        const candidate =
          variance + (varianceCombinations[previous]![j - 1] ?? 0);
        if (candidate <= (varianceCombinations[l]![j] ?? Infinity)) {
          lowerClassLimits[l]![j] = lowerLimit;
          varianceCombinations[l]![j] = candidate;
        }
      }
    }
    lowerClassLimits[l]![1] = 1;
    varianceCombinations[l]![1] = variance;
  }

  const breaks = new Array<number>(classes + 1).fill(0);
  breaks[classes] = data[n - 1] ?? 0;
  breaks[0] = data[0] ?? 0;
  let k = n;
  for (let j = classes; j >= 2; j--) {
    const id = (lowerClassLimits[k]![j] ?? 1) - 2;
    breaks[j - 1] = data[id] ?? 0;
    k = (lowerClassLimits[k]![j] ?? 1) - 1;
  }
  return breaks;
}
