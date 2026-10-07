export function clip(value: string, max: number): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length <= max ? cleaned : `${cleaned.slice(0, max - 3)}...`;
}

export function firstLine(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "";
}

export function firstSemanticUserLine(value: string): string {
  const userQuery = value.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/i)?.[1];
  const candidate = userQuery ?? value
    .replace(/<timestamp>[\s\S]*?<\/timestamp>/gi, "\n")
    .replace(/<system_notification>[\s\S]*?<\/system_notification>/gi, "\n")
    .replace(/<system_reminder>[\s\S]*?<\/system_reminder>/gi, "\n")
    .replace(/<image_files>[\s\S]*?<\/image_files>/gi, "\n");
  return firstLine(candidate.replace(/<\/?[a-z_][^>]*>/gi, "\n"));
}

const CJK_CHAR = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g;

/**
 * unicode61 has no word breaking for CJK: a sentence without spaces is one token, so a
 * query only matches a stored run it repeats in full. Indexing one character per token
 * turns any quoted CJK term into a phrase match on an arbitrary substring, ranked by BM25.
 * Index text and query terms must both pass through here.
 */
export function spaceCjkForFts(text: string): string {
  return text.replace(CJK_CHAR, " $& ");
}
