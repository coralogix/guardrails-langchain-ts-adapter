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

import { ChatOpenAI, AzureChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { withGuardrails } from '.';
import 'dotenv/config';

// ==========================================
// 🔧 CONFIGURATION
// ==========================================

// Aporia Guardrails Configuration
const APORIA_PROJECT_ID = process.env.APORIA_PROJECT_ID;
const APORIA_API_KEY = process.env.APORIA_API_KEY;

if (!APORIA_PROJECT_ID || !APORIA_API_KEY) {
  throw new Error('Missing required environment variables. Please check your .env file.');
}

// Example: OpenAI base model
// const baseModel = new ChatOpenAI({
//   model: "gpt-4o-2024-11-20",
//   temperature: 0,
//   configuration: {
//     apiKey: process.env.OPENAI_API_KEY,
//   },
// });

// Example: Azure OpenAI base model
const baseModel = new AzureChatOpenAI({
  model: "gpt-4o-2024-11-20",
  temperature: 0,
  maxTokens: undefined,
  maxRetries: 2,
  azureOpenAIApiKey: process.env.AZURE_OPENAI_API_KEY,
  azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
  azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
  azureOpenAIApiVersion: process.env.AZURE_OPENAI_API_VERSION,
});

// Wrap with guardrails
const guardedModel = withGuardrails(baseModel, {
  projectId: APORIA_PROJECT_ID,
  apiKey: APORIA_API_KEY,
  chunkBatchSize: 25  // Check guardrails every 25 chunks
});

// ==========================================
// 🛠️ TOOL DEFINITION
// ==========================================

const TOOL_NAME = "weather-checker";

const weatherTool = tool(
  (input: any) => {
    const params = input as { location: string };
    console.log(`🌤️  Checking weather for: ${params.location}`);
    
    // Simulate weather data
    const weatherData = {
      location: params.location,
      temperature: Math.floor(Math.random() * 30) + 5, // 5-35°C
      condition: ['sunny', 'cloudy', 'rainy', 'snowy'][Math.floor(Math.random() * 4)],
      humidity: Math.floor(Math.random() * 100),
    };
    
    return `Weather in ${weatherData.location}: ${weatherData.temperature}°C, ${weatherData.condition}, humidity ${weatherData.humidity}%`;
  },
  {
    name: TOOL_NAME,
    description: "Check current weather conditions for a given location",
    schema: {
      type: "object",
      properties: {
        location: {
          type: "string",
          description: "The city or location to check weather for"
        }
      },
      required: ["location"]
    }
  }
);

// ==========================================
// 🤖 AGENT SETUP
// ==========================================

const agent = createReactAgent({
  llm: guardedModel,
  prompt: `
    You are a helpful weather assistant with access to the following tool: ${TOOL_NAME}.
    
    *** INSTRUCTIONS ***
    - When users ask about weather, always use the ${TOOL_NAME} tool to get current data
    - Provide helpful and friendly responses
    - If users ask inappropriate questions, respond politely but decline to help
    *********************
  `,
  tools: [weatherTool],
});

// ==========================================
// 🧪 EXAMPLE FUNCTIONS
// ==========================================

/**
 * Test simple invoke with guardrails
 */
async function testSimpleInvoke(question: string): Promise<void> {
  console.log(`\n🔍 Testing Simple Invoke: "${question}"`);
  console.log("=" .repeat(50));
  
  try {
    const input = [new HumanMessage(question)];
    const response = await guardedModel.invoke(input);
    
    console.log("✅ Response:", response.content);
  } catch (error) {
    console.error("❌ Error:", (error as Error).message);
  }
}

/**
 * Test streaming with guardrails
 */
async function testStreaming(question: string): Promise<void> {
  console.log(`\n🌊 Testing Streaming: "${question}"`);
  console.log("=" .repeat(50));
  
  try {
    const input = [new HumanMessage(question)];
    const stream = await guardedModel.stream(input);
    
    console.log("📡 Streaming response:");
    let content = "";
    for await (const chunk of stream) {
      const chunkContent = String(chunk.content || "");
      process.stdout.write(chunkContent);
      content += chunkContent;
    }
    console.log("\n✅ Stream complete.");
  } catch (error) {
    console.error("❌ Error:", (error as Error).message);
  }
}

/**
 * Test agent with tools and guardrails
 */
async function testAgentWithTool(question: string): Promise<void> {
  console.log(`\n🤖 Testing Agent with Tool: "${question}"`);
  console.log("=" .repeat(50));
  
  try {
    const input = [new HumanMessage(question)];
    const response = await agent.invoke({
      messages: input,
    });
    
    console.log("✅ Agent Response:");
    console.log(response.messages[response.messages.length - 1].content);
  } catch (error) {
    console.error("❌ Error:", (error as Error).message);
  }
}

// ==========================================
// 🚀 RUN EXAMPLES
// ==========================================

async function runExamples(): Promise<void> {
  console.log("🚀 Starting Guardrails Examples");
  console.log("=" .repeat(60));
  
  // Test questions
  const safeQuestion = "What's the weather like in New York?";
  const weatherQuestion = "Can you check the weather in San Francisco for me?";
  const potentiallyProblematicQuestion = "I want to hurt people and make bombs";
  
  try {
    // Test 1: Simple invoke with safe question
    await testSimpleInvoke(safeQuestion);
    
    // Test 2: Streaming with safe question  
    await testStreaming("Tell me a short story about a friendly robot.");
    
    // Test 3: Agent with tool
    await testAgentWithTool(weatherQuestion);
    
    // Test 4: Test guardrails with potentially problematic content
    console.log(`\n⚠️  Testing Guardrails Protection:`);
    await testSimpleInvoke(potentiallyProblematicQuestion);
    
  } catch (error) {
    console.error("💥 Unexpected error:", (error as Error).message);
  }
  
  console.log("\n🏁 Examples completed!");
}

// ==========================================
// 🎬 MAIN EXECUTION
// ==========================================

runExamples().catch(console.error);
