/**
 * The three decisions that are waiting on the T020 window, declared as types
 * that cannot be satisfied by accident.
 *
 * CLAUDE.md, working rule 4: what is waiting on data gets marked in the code
 * with a **required parameter and no default** — never with a provisional
 * value. A default is how a decision that was never taken becomes permanent:
 * nobody revisits it because nothing is broken.
 *
 * So each of these is a union with no fallback member. Any component that
 * needs one has to be handed it, and the call site is then a visible place
 * where somebody chose — or a compile error until they do.
 *
 * All three get resolved on **2026-09-21** with the six measured points of
 * `pnpm analyse:window`, not with an opinion. What is known so far is recorded
 * beside each one, because a first reading is worth more than nothing and less
 * than a week.
 */

/**
 * How Eldorado appears in a ranking (`tasks.md` T025, `[NECESITA DECISIÓN]`).
 *
 * It is the only provider with a payment-method dimension: 4 rows per bracket
 * and direction where everyone else has 1. Ranking its best method compares
 * "the best of four" against "the only one" others have, which Art. III.3
 * forbids — a comparison has to be between comparable things.
 *
 * Measured 2026-09-14, 3 runs: the four methods do **not** collapse. 14 of 24
 * cells differ, up to 10.5% apart buying at the 1 USD bracket. So trimming the
 * list would erase real differences, and this decision matters more, not less.
 */
export type EldoradoPolicy =
  /** One row, the best-priced method, with the method named in the row. */
  | 'best-method'
  /** All four rows. Honest, but Eldorado occupies 4 of every 11 positions. */
  | 'all-methods'
  /** One row, a fixed method chosen by us. Even, but the choice is ours. */
  | 'fixed-method';

/**
 * Whether the bracket selector is featured or tucked away (HU-04).
 *
 * Measured 2026-09-14, 3 runs: selling, the leader **changes** with the
 * bracket; buying, it never does. The asymmetry between directions was not
 * anticipated and is the thing that decides this.
 */
export type BracketEmphasis =
  /** The selector is the main control: the leader changes and that is the product. */
  | 'featured'
  /** Present but quiet: the leader rarely moves, so it would oversell itself. */
  | 'secondary';

/**
 * Whether the interface explains the Binance P2P cross (RF-11c).
 *
 * The cross is: at some brackets, selling yields more pesos than buying costs.
 * Measured 2026-09-14: 3 of 9 cells, concentrated in the large brackets — 2 of
 * 3 at 500, 0 of 3 at 100.
 */
export type CrossExplanation =
  /** Frequent and systematic enough that a row must say why. */
  | 'explain'
  /** Rare enough that explaining it would draw attention it does not deserve. */
  | 'silent';

/**
 * The three, together. There is intentionally **no default export of a
 * populated object**: importing this gives you the shape, never the answer.
 */
export type PendingDecisions = {
  eldorado: EldoradoPolicy;
  bracket: BracketEmphasis;
  cross: CrossExplanation;
};

/** The date the window closes and these stop being pending. */
export const DECIDE_ON = '2026-09-21';
