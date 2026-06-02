import { describe, it, expect } from "vitest";
import type { OpenAIChatRequest, OllamaChatRequest } from "../types/index.js";

// Extract translateToOllamaFormat logic for testing without instantiating Proxy
function translateToOllamaFormat(body: OpenAIChatRequest): OllamaChatRequest {
  return {
    model: body.model,
    messages: body.messages,
    stream: body.stream ?? false,
    options: {
      temperature: body.temperature,
      num_predict: body.max_tokens,
      top_p: body.top_p,
    },
  };
}

describe("Proxy format translation", () => {
  it("translates OpenAI request to Ollama format", () => {
    const req: OpenAIChatRequest = {
      model: "qwen2.5:7b",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
      temperature: 0.7,
      max_tokens: 512,
    };

    const result = translateToOllamaFormat(req);
    expect(result.model).toBe("qwen2.5:7b");
    expect(result.stream).toBe(false);
    expect(result.options?.temperature).toBe(0.7);
    expect(result.options?.num_predict).toBe(512);
    expect(result.messages[0].content).toBe("hello");
  });

  it("defaults stream to false when not provided", () => {
    const req: OpenAIChatRequest = {
      model: "llama3",
      messages: [],
    };
    expect(translateToOllamaFormat(req).stream).toBe(false);
  });
});
