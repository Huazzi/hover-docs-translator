/**
 * Returns the supplied value for the current reader.
 * @param value The value to return without modification.
 * @returns The original `value`.
 * @example
 * identityValue<string>("reader");
 */
function identityValue<T>(value: T): T { return value; }

identityValue<string>("reader");
