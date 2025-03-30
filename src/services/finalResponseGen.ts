import { ChatGroq } from "@langchain/groq";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// Define the search result types
interface ScreenshotResult {
  session: string;
  summary: string;
  keyElements?: string[];
  path: string;
}

interface CommandResult {
  command: string;
  frequency: number;
  examples?: string[];
  directories?: string[];
}

interface ConceptResult {
  concept: string;
  relatedSession: string;
  workflowPatterns?: string[];
}

// Function to generate local file URI for VS Code
function getLocalFileUri(filePath: string): string {
  // Create a VS Code URI for the file
  const uri = vscode.Uri.file(filePath);
  return uri.toString();
}

// Function to convert search results to a structured format for the LLM
function prepareSearchResultsForLLM(
  userQuery: string,
  keywords: string[],
  screenshots: ScreenshotResult[],
  commands: CommandResult[],
  concepts: ConceptResult[]
): string {
  // Convert screenshot paths to VS Code URIs for linking
  const screenshotsWithUris = screenshots.map(screenshot => {
    return {
      ...screenshot,
      uri: getLocalFileUri(screenshot.path)
    };
  });

  // Create a structured JSON representation of all results
  const structuredResults = {
    query: userQuery,
    keywords: keywords,
    screenshots: screenshotsWithUris,
    commands: commands,
    concepts: concepts
  };

  // Convert to JSON string and remove all special characters and formatting
  const jsonString = JSON.stringify(structuredResults);
  return jsonString.replace(/[\n\r\t\"\\{}[\]]/g, '');
}

// Function to generate final response using Groq LLM
export async function generatePolishedResponse(
  userQuery: string, 
  keywords: string[], 
  screenshots: ScreenshotResult[], 
  commands: CommandResult[], 
  concepts: ConceptResult[]
): Promise<string> {
  // Check if we have any results
  const hasResults = screenshots.length > 0 || commands.length > 0 || concepts.length > 0;
  if (!hasResults) {
    return `I couldn't find any information related to your query with keywords: ${keywords.join(', ')}. Could you please try rephrasing your question or using different terms?`;
  }

  // Prepare results in a structured format for the LLM
  const structuredData = prepareSearchResultsForLLM(
    userQuery, 
    keywords, 
    screenshots, 
    commands, 
    concepts
  );
  
  // Initialize Groq LLM
  const llm = new ChatGroq({
    apiKey: process.env.GROQ_API_KEY || "", // Get API key from environment variables
    model: "llama-3.3-70b-versatile", // Use Llama 3 model
  });

  // Create a chat prompt template - fixed to remove template interpolation errors
  const prompt = ChatPromptTemplate.fromMessages([
    ["system", 
     `You are CaveatBot, an assistant specializing in helping users recall information from their coding sessions. Your task is to generate a clear and informative response to the user's query using the structured search results provided.
    
    Follow these steps when creating your response:
    
    1. **Direct Answer**: Begin with a direct and concise answer to the user's query.  
    2. **Relevant Screenshots**: Include screenshots related to the query, along with a brief description for each. Use Markdown to format links to any link sources. Don't link images.  
    3. **Relevant Commands**: List any relevant commands, along with examples and contextual information (e.g., common directories or usage patterns).  
    4. **Key Concepts**: Summarize any concepts that are relevant to the query, providing clear explanations and context.  
    
    ### Formatting Instructions:
    - Use Markdown for readability.
    - Include links to screenshots using the 'uri' field in the data.
    - Be concise but thorough, ensuring that your response directly addresses the user's query.
    - DO NOT include raw JSON in the response; transform the data into a user-friendly format.
    `
    ],
    ["human", `User query: ${userQuery} Search results: ${structuredData}. Make it look polished and like any other technical tutorial. No hashtags or asterics. No weird spacing. Code blocks and command blocks are needed. Don't add any useless and excessive workflow pattern diagrams with arrows in output. `],
  ]);

  // Create the chain (prompt + LLM + output parser)
  const chain = prompt
    .pipe(llm)
    .pipe(new StringOutputParser());

  // Implement retry logic
  const maxRetries = 3;
  let retries = 0;
  let lastError = null;

  while (retries < maxRetries) {
    try {
      // Run the chain to generate the response
      const response = await chain.invoke({
        query: userQuery,
        results: structuredData,
      });
      
      return response;
    } catch (error) {
      lastError = error;
      console.error(`Error generating response with Groq (attempt ${retries + 1}/${maxRetries}):`, error);
      retries++;
      
      // Add exponential backoff
      if (retries < maxRetries) {
        const backoffTime = Math.pow(2, retries) * 500; // 1s, 2s, 4s...
        await new Promise(resolve => setTimeout(resolve, backoffTime));
      }
    }
  }

  // If we've exhausted all retries, return an error message
  console.error('All retries failed when generating response with Groq:', lastError);
  return `I'm sorry, I encountered an issue while processing your query. Please try again later or rephrase your question. (Error: Unable to generate response after ${maxRetries} attempts)`;
}
