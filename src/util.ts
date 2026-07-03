// Small pure helpers with no plugin-specific dependencies.

/**
 * Numeric comparator that is Infinity-safe. A plain `a - b` returns NaN when both
 * are Infinity (e.g. two unpriced or two non-favorite rows), which makes `sort`
 * behave unpredictably; this always returns -1/0/1.
 */
export const compareNumbers = (a: number, b: number): number => (a === b ? 0 : a < b ? -1 : 1)

/** Resolve after `ms` milliseconds. */
export const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
