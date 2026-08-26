/** Marker block module. */

/**
 * Rule blocks carry their own paired end marker rather than sharing one global
 * terminator. The skill bootstrap block predates this and closes with a fixed
 * `memmy:end`; a second block sharing that terminator would let a removal chew
 * through everything between two unrelated blocks.
 */
export function ruleStartMarker(ruleId: string): string {
  return `<!-- memmy:rule:${ruleId} v=1 -->`;
}

/** Returns the closing marker paired with {@link ruleStartMarker}. */
export function ruleEndMarker(ruleId: string): string {
  return `<!-- /memmy:rule:${ruleId} -->`;
}

/** Renders a rule body as a complete, self-delimiting block. */
export function renderRuleBlock(ruleId: string, body: string): string {
  return `${ruleStartMarker(ruleId)}\n${body.trim()}\n${ruleEndMarker(ruleId)}\n`;
}

/** Reads back the body of a rule block, or null when the block is absent. */
export function extractRuleBlock(document: string, ruleId: string): string | null {
  const match = blockPattern(ruleId).exec(document);
  return match ? (match[1] ?? "").trim() : null;
}

/** Inserts or replaces a rule block, leaving everything around it untouched. */
export function upsertRuleBlock(document: string, ruleId: string, body: string): string {
  const block = renderRuleBlock(ruleId, body);
  const pattern = blockPattern(ruleId);
  if (pattern.test(document)) {
    return document.replace(pattern, block);
  }

  const separator = document.length > 0 && !document.endsWith("\n") ? "\n" : "";
  const spacer = document.trim().length > 0 ? "\n" : "";
  return `${document}${separator}${spacer}${block}`;
}

/** Removes a rule block if present. Returns the document unchanged otherwise. */
export function removeRuleBlock(document: string, ruleId: string): string {
  return document.replace(blockPattern(ruleId), "").replace(/\n{3,}/g, "\n\n");
}

/** Lists the rule ids that currently have a block in the document. */
export function listRuleBlockIds(document: string): string[] {
  const ids: string[] = [];
  const pattern = /<!-- memmy:rule:([A-Za-z0-9._-]+) v=1 -->/g;
  let match = pattern.exec(document);
  while (match) {
    const id = match[1];
    if (id && !ids.includes(id)) {
      ids.push(id);
    }
    match = pattern.exec(document);
  }

  return ids;
}

function blockPattern(ruleId: string): RegExp {
  return new RegExp(`${escapeRegExp(ruleStartMarker(ruleId))}\\n([\\s\\S]*?)${escapeRegExp(ruleEndMarker(ruleId))}\\n?`, "m");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
