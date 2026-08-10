import type { OpenAIReasoningEffort } from "./openai-responses.js";

export function routeOpenAIModel({
  mainModel,
  hardModel,
  reasoningEffort
}: {
  mainModel: string;
  hardModel: string;
  reasoningEffort: OpenAIReasoningEffort;
}): string {
  return reasoningEffort === "xhigh" || reasoningEffort === "max"
    ? hardModel
    : mainModel;
}
