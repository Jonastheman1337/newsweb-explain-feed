/** Manual article length targets count lead + body, including paragraph breaks. */
export function noticeLengthBand(target: number) {
  return { min: Math.round(target * 0.85), max: Math.round(target * 1.1) };
}

export function noticeArticleChars(article: { lead: string; body: string[] }): number {
  return [article.lead, ...article.body].join("\n\n").length;
}
