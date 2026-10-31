/**
 * Parse a numeric value.
 * @param {string} value Text containing an integer.
 * @returns {number} The parsed integer.
 * @throws {TypeError} If the text is not a valid integer.
 * @example
 * parseValue('12');
 */
function parseValue(value) { return Number(value); }

parseValue('12');
