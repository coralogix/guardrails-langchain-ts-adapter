# LangChain Aporia Guardrails Integration

A TypeScript wrapper that adds Aporia Guardrails to any LangChain `BaseChatModel`, enabling real-time content filtering and safety controls for both prompts and responses.

## Installation

```bash
npm install
```

## Configuration

### Environment Variables

Create a `.env` file in the project root with your API keys:

```bash
# Aporia Guardrails Configuration
APORIA_PROJECT_ID=your_project_id_here
APORIA_API_KEY=your_api_key_here

# OpenAI API Key
OPENAI_API_KEY=your_openai_api_key_here
```

You'll need:
- **Aporia Project ID**: Your Aporia guardrails project identifier
- **Aporia API Key**: Authentication key for the Aporia service
- **OpenAI API Key**: Your OpenAI API key for the language model

## Quick Start

After setting up your `.env` file, you can run the examples:

```bash
# Run the basic example
npm run example

# Run the evaluation tool
npm run eval
```

## Usage

### Basic Example

```typescript
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import { withGuardrails } from "./guardrails";

// Create your base model
const model = new ChatOpenAI({
  model: "gpt-4o-2024-11-20",
  temperature: 0,
  configuration: {
    apiKey: "your-openai-api-key"
  }
});

// Wrap with guardrails
const guardedModel = withGuardrails(model, {
  projectId: "your-aporia-project-id",
  apiKey: "your-aporia-api-key"
});

// Use the model normally - guardrails are applied automatically
const response = await guardedModel.invoke([
  new HumanMessage("Hello, how can you help me today?")
]);

console.log(response.content);
```

### Streaming Example

```typescript
const guardedModel = withGuardrails(model, {
  projectId: "your-aporia-project-id",
  apiKey: "your-aporia-api-key",
  chunkBatchSize: 25  // Check guardrails every 25 chunks (default: 50)
});

const stream = await guardedModel.stream([
  new HumanMessage("Tell me a story about space exploration")
]);

for await (const chunk of stream) {
  process.stdout.write(chunk.content);
}
```

### Advanced Configuration

```typescript
import type { AporiaGuardrailsConfig } from "./guardrails";

const config: AporiaGuardrailsConfig = {
  projectId: "your-project-id",
  apiKey: "your-api-key",
  chunkBatchSize: 100  // Optional: check every 100 chunks instead of default 50
};

const guardedModel = withGuardrails(model, config);
```

## Configuration Options

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `projectId` | `string` | ✅ | - | Your Aporia guardrails project ID |
| `apiKey` | `string` | ✅ | - | Your Aporia API key |
| `chunkBatchSize` | `number` | ❌ | `50` | How often to check guardrails during streaming (every N chunks) |

## How It Works

1. **Prompt Validation**: Before sending to the model, user prompts are validated against your guardrail policies
2. **Response Validation**: Model responses are checked before being returned to the user
3. **Streaming Validation**: During streaming, content is validated in configurable batches
4. **Action Handling**: Based on guardrail responses, content can be:
   - `passthrough` - Allow content unchanged
   - `block` - Block content with override message
   - `modify` - Replace with suggested alternative
   - `rephrase` - Replace with rephrased version

## Evaluation & Testing

This repository includes a comprehensive evaluation tool (`eval.tsx`) that compares performance between models with and without guardrails:

```bash
# Run the evaluation
npm run eval
```

The evaluation tool:
- Tests multiple prompts in parallel
- Measures latency differences
- Compares responses side-by-side
- Provides performance metrics

## Error Handling

The wrapper handles guardrail API failures gracefully:
- Network errors are thrown as exceptions
- Invalid responses are validated with Zod schemas
- Failed guardrail checks return override messages

## Types

```typescript
interface AporiaGuardrailsConfig {
  projectId: string;
  apiKey: string;
  chunkBatchSize?: number;
}

type GuardrailsResponse = {
  action: "modify" | "passthrough" | "block" | "rephrase";
  revised_response: string | null;
  // ... other fields allowed
}
```
