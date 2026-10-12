import { describe, expect, it } from 'vitest';
import { createChrome } from './helpers/chrome';

/*
 * src/platform.ts binds the API at import time, so the fake must exist first.
 *
 * These go through chrome.runtime.onMessage rather than calling handlers
 * directly. Nothing else covers the listener itself, and a defect in the
 * envelope check drops every message in the extension while every other test
 * still passes.
 */
const chrome = createChrome();
const bus = await import('../src/bus/protocol');

describe('message bus', () => {
  it('delivers an envelope to its handler', async () => {
    const seen: string[] = [];
    bus.on('hook:media', (payload) => {
      seen.push(payload.url);
    });

    const reply = await chrome.dispatch({
      to: 'hook:media',
      payload: { url: 'https://a.example/b.jpg' },
    });

    expect(seen).toEqual(['https://a.example/b.jpg']);
    expect(reply).toEqual({ ok: true });
  });

  it('carries a reply back to the sender', async () => {
    bus.on('addons:markers', () => ({ markers: ['<script id="x">'] }));

    const reply = await chrome.dispatch({ to: 'addons:markers', payload: {} });

    expect(reply).toEqual({ ok: true, value: { markers: ['<script id="x">'] } });
  });

  it('delivers a message that travels with no payload', async () => {
    let called = 0;
    bus.on('addons:list', () => {
      called += 1;
      return { builtin: [], user: [] };
    });

    /* Four messages are declared `req: void` and travel with the key absent.
       Rejecting those took the panel's settings read with it. */
    const reply = await chrome.dispatch({ to: 'addons:list' });

    expect(called).toBe(1);
    expect(reply).toEqual({ ok: true, value: { builtin: [], user: [] } });
  });

  it('reports a failure to the sender instead of throwing', async () => {
    bus.on('settings:get', () => {
      throw new Error('boom');
    });

    const reply = await chrome.dispatch({ to: 'settings:get', payload: {} });

    expect(reply).toMatchObject({ ok: false });
  });

  it('drops a message that is not an envelope', async () => {
    const reply = await chrome.dispatch({ to: 'hook:media', payload: 'not-an-object' });

    expect(reply).toEqual({ ok: false, error: 'no listener' });
  });

  it('drops a message naming a handler this build does not have', async () => {
    const reply = await chrome.dispatch({ to: 'no:such:message', payload: {} });

    expect(reply).toEqual({ ok: false, error: 'no listener' });
  });
});
