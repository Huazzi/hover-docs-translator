import { EventEmitter } from 'node:events';
/**
 * Return a greeting for the supplied name.
 *
 * The original name is preserved.
 */
function greet(name) { return `Hello ${name}`; }

greet('Ada');
new EventEmitter();
