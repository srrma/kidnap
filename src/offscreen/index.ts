/**
 * The offscreen document. It exists so an assembly keeps running when the panel
 * is closed, which is the normal case for a long stream.
 *
 * Firefox has no offscreen document. There, the panel page loads this same
 * module, so the fallback is the import below rather than a second
 * implementation.
 */
import { post } from '../bus/protocol';
import { startAssembling } from './assemble';

startAssembling();

/*
 * Creating the document returns before its script has run, so anything posted
 * straight afterwards arrives before there is a listener for it. Saying hello
 * once both are installed is what lets the background wait rather than hope.
 */
post('offscreen:ready', undefined);
