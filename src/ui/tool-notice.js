// The private tool result notice (decision Q69): when I use a tool that tells ME alone something
// (Göz, Terazi, Sayaç, Kaydır, Mermi Çevir), my device shows the result for TOOL_NOTICE_MS in the
// shot notice's place: the tool's name, the result as a big word and its scope, with "Yalnız sen
// görüyorsun". The effects strip keeps the small result line as the permanent reference.
//
// Pure, and built from nothing new: detectionResults (tool-model.js) reads only MY private
// receipts (private events `by` me and `to` me) of the update. Another device never receives
// these events, so it can never build this notice.

import { TEXT } from './messages.js';
import { detectionResults, resultText } from './tool-model.js';
import { toolName } from './tools.js';

export const TOOL_NOTICE_MS = 3000;

// The scope line from the strip's text (" · şu anki mermi " -> "şu anki mermi").
const scopeOf = (text) => text.replace(/^\s*·\s*/, '').trim();

/**
 * The notice for my latest private tool result in one update's events, or null.
 * @param {object[]} events the events of one update, as this device received them
 * @param {string} viewerId my seat id
 * @returns {null | { tool: string, name: string, word: string, scope: string, durationMs: number }}
 */
export function toolNotice(events, viewerId) {
  const results = detectionResults(events, viewerId);
  if (results.length === 0) return null;
  const result = results[results.length - 1];
  const text = resultText(result);
  const last = result.tool === 'probe' && result.result === 'noNext';
  return {
    tool: result.tool,
    name: toolName(result.tool),
    word: last ? TEXT.toolNoticeLast : text.strong,
    scope: scopeOf(text.text),
    durationMs: TOOL_NOTICE_MS,
  };
}
