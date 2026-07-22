const BOUNDARY_PHRASES = (
  "不想说|不方便说|不太方便|跳过|换一个|不聊这个|不记得|想不起来|记不清|忘了"
).split("|");

export function shouldShowDetailNudge(
  isSubstantive: boolean,
  answer: string,
): boolean {
  if (isSubstantive) return false;
  return !BOUNDARY_PHRASES.some((phrase) => answer.includes(phrase));
}

export function shouldOfferWrite(
  readinessReady: boolean,
  suggestedAction: string,
): boolean {
  return readinessReady && suggestedAction === "write_chapter";
}
