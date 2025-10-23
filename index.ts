// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//         http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { BaseChatModel as BaseChatModelRuntime } from "@langchain/core/language_models/chat_models";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import type { BaseMessage } from "@langchain/core/messages";
import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import { _convertMessagesToOpenAIParams } from "@langchain/openai";
import { BasePromptValueInterface } from "@langchain/core/prompt_values";
import { z } from "zod";

// Default values
const DEFAULT_CHUNK_BATCH_SIZE = 200;
const DEFAULT_BASE_URL = "https://gr-prd.aporia.com";

export interface AporiaGuardrailsConfig {
  projectId: string;
  apiKey: string;
  chunkBatchSize?: number;
  baseUrl?: string;
}

/**
 * Configurable conditions and overrides for user prompt and response.
 * Each condition receives the array of BaseMessage objects representing the prompt.
 */
export const createPromptCondition = (projectId: string, apiKey: string, baseUrl: string = DEFAULT_BASE_URL) => async (
  messages: BaseMessage[]
): Promise<{ shouldBlock: boolean; overrideResponse?: string }> => {
  const response = await validateWithGuardrails(projectId, apiKey, messages, "", "prompt", baseUrl)

  // Check if the action indicates we should block or modify
  const shouldBlock = response.action === "block" || response.action === "modify" || response.action === "rephrase";
  const overrideResponse = response.revised_response ?? undefined;

  return { shouldBlock, overrideResponse };
};
export const PROMPT_OVERRIDE = "[Prompt intercepted: custom response]";

export const createResponseCondition = (projectId: string, apiKey: string, baseUrl: string = DEFAULT_BASE_URL) => async (
  response: AIMessage,
  messages: BaseMessage[]
): Promise<{ shouldBlock: boolean; overrideResponse?: string }> => {
  const guardrailsResponse = await validateWithGuardrails(projectId, apiKey, messages, response.content as string, "response", baseUrl);
  
  // Check if the action indicates we should block or modify
  const shouldBlock = guardrailsResponse.action === "block" || guardrailsResponse.action === "modify" || guardrailsResponse.action === "rephrase";
  const overrideResponse = guardrailsResponse.revised_response ?? undefined;

  return { shouldBlock, overrideResponse };
};
export const RESPONSE_OVERRIDE = "[Response intercepted: custom override]";

// Zod schema for guardrails response
export const GuardrailsResponseSchema = z.looseObject({
  action: z.enum(["modify", "passthrough", "block", "rephrase"]),
  revised_response: z.string().nullable(),
}); // Allow other fields to be present without validation

export type GuardrailsResponse = z.infer<typeof GuardrailsResponseSchema>;

/**
 * Call Aporia Guardrails validation endpoint.
 */
export async function validateWithGuardrails(
  projectId: string,
  apiKey: string,
  messages: BaseMessage[],
  response: string,
  target: "prompt" | "response"
  , baseUrl: string = DEFAULT_BASE_URL
  ): Promise<GuardrailsResponse> {
  // Trim trailing slash on baseUrl to avoid double slashes
  const trimmedBase = baseUrl.replace(/\/+$/, "");
  const apiUrl = `${trimmedBase}/${projectId}/validate`;
  const payload = {
    messages: _convertMessagesToOpenAIParams(messages),
    response,
    validation_target: target,
  };
  const res = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-APORIA-API-KEY": apiKey },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Guardrails validation failed: ${res.status} ${res.statusText}`);
  }

  const rawResponse = await res.json();
  return GuardrailsResponseSchema.parse(rawResponse);
}

/**
 * Wraps any LangChain BaseChatModel to allow interception of prompts and responses with guardrails.
 */
export function withGuardrails<
  T extends BaseChatModel<any, AIMessageChunk>
>(model: T, config: AporiaGuardrailsConfig): T {
  const { projectId, apiKey, chunkBatchSize = DEFAULT_CHUNK_BATCH_SIZE, baseUrl = DEFAULT_BASE_URL } = config;

  const PROMPT_CONDITION = createPromptCondition(projectId, apiKey, baseUrl);
  const RESPONSE_CONDITION = createResponseCondition(projectId, apiKey, baseUrl);

  return new Proxy(model, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);

      // Helper to extract prompt messages from any input
      const extractMessages = (
        input: BaseLanguageModelInput
      ): BaseMessage[] => {
        const promptValue = (BaseChatModelRuntime as any)._convertInputToPromptValue(
          input
        ) as BasePromptValueInterface;
        return promptValue.toChatMessages();
      };

      
      // Intercept single-call invoke()
      if (prop === "invoke" && typeof orig === "function") {
        return async (
          input: BaseLanguageModelInput,
          options?: any
        ): Promise<AIMessage> => {
          const promptMsgs = extractMessages(input);
          // Pre-prompt guardrail
          const promptCheck = await PROMPT_CONDITION(promptMsgs);
          if (promptCheck.shouldBlock) {
            return new AIMessage(promptCheck.overrideResponse || PROMPT_OVERRIDE);
          }

          // Call underlying model
          let result: AIMessage;

          try {
            result = (await orig.call(
              target,
              input,
              options
            )) as AIMessage;

            // Post-response guardrail
            const responseCheck = await RESPONSE_CONDITION(result, promptMsgs);
            if (responseCheck.shouldBlock) {
              return new AIMessage(responseCheck.overrideResponse || RESPONSE_OVERRIDE);
            }
          } catch (e: any) {
            if (e && e.code === "content_filter") {
              result = new AIMessage("I'm sorry, but I can't assist with that request.")
            } else {
              throw e
            }
          }

          return result;
        };
      }

      // Intercept streaming stream()
      if (prop === "stream" && typeof orig === "function") {
        return async function* (
          input: BaseLanguageModelInput,
          options?: any
        ): AsyncGenerator<AIMessageChunk> {
          const promptMsgs = extractMessages(input);

          // Pre-prompt guardrail
          const promptCheck = await PROMPT_CONDITION(promptMsgs);
          if (promptCheck.shouldBlock) {
            yield new AIMessageChunk({ content: promptCheck.overrideResponse || PROMPT_OVERRIDE });
            return;
          }

          // Forward to underlying stream
          const streamIter = (await orig.call(
            target,
            input,
            options
          )) as AsyncGenerator<AIMessageChunk>;

          let chunkCount = 0;
          let lastChunk: AIMessageChunk | null = null;
          let accumulatedContent = "";
          
          for await (const chunk of streamIter) {
            chunkCount++;
            lastChunk = chunk;
            accumulatedContent += chunk.content || "";
            
            // Per-chunk guardrail - check based on configurable batch size
            if (chunkCount % chunkBatchSize === 0) {
              const accumulatedMessage = new AIMessage({ content: accumulatedContent });
              const responseCheck = await RESPONSE_CONDITION(accumulatedMessage, promptMsgs);
              if (responseCheck.shouldBlock) {
                yield new AIMessageChunk({ content: responseCheck.overrideResponse || RESPONSE_OVERRIDE });
                break;
              }
            }
            yield chunk;
          }
          
          // Check the final accumulated content if we haven't checked it in the current batch
          if (lastChunk && chunkCount % chunkBatchSize !== 0) {
            const finalMessage = new AIMessage({ content: accumulatedContent });
            const responseCheck = await RESPONSE_CONDITION(finalMessage, promptMsgs);
            if (responseCheck.shouldBlock) {
              yield new AIMessageChunk({ content: responseCheck.overrideResponse || RESPONSE_OVERRIDE });
            }
          }
        };
      }

      // Intercept bindTools to ensure new instances are also proxied
      if (prop === "bindTools" && typeof orig === "function") {
        return (...args: any[]) => {
          // Call the original bindTools to get the new model instance
          const newModel = orig.call(target, ...args);
          // Wrap the new model instance with guardrails
          return withGuardrails(newModel, { projectId, apiKey, chunkBatchSize, baseUrl });
        };
      }

      // Intercept withConfig to ensure new instances are also proxied
      if (prop === "withConfig" && typeof orig === "function") {
        return (cfg: any) => {
          // Call the original withConfig to get the new model instance
          const newModel = orig.call(target, cfg);
          // Wrap the new model instance with guardrails
          return withGuardrails(newModel, { projectId, apiKey, chunkBatchSize, baseUrl });
        };
      }

      // Fallback to original behavior
      return typeof orig === "function" ? orig.bind(target) : orig;
    },
  });
}
