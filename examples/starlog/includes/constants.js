/**
 * Shared constants for the starlog example. Included files are plain JS evaluated at compile
 * time, which is one of the things the regex parser deliberately cannot see.
 */
const FAINTEST_NAKED_EYE_MAGNITUDE = 6;
const DEFAULT_CATALOGUE = "MESSIER";

module.exports = { FAINTEST_NAKED_EYE_MAGNITUDE, DEFAULT_CATALOGUE };
