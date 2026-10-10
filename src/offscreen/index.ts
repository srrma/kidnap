/**
 * The offscreen document. It exists so an assembly keeps running when the panel
 * is closed, which is the normal case for a long stream.
 *
 * Firefox has no offscreen document. There, the panel page loads this same
 * module, so the fallback is the import below rather than a second
 * implementation.
 */
import { startAssembling } from './assemble';

startAssembling();
