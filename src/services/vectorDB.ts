import * as vscode from 'vscode';
import { Pinecone } from '@pinecone-database/pinecone';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { OpenAIEmbeddings } from "@langchain/openai";
import { ChatGroq } from '@langchain/groq';

// Load environment variables from a .env file in a custom directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Define available indices as constants
export const AVAILABLE_INDICES = {
  SCREENSHOTS: 'screenshots',
  COMMANDS: 'commands',
  KEY_CONCEPTS: 'key-concepts'
};

// Initialize Pinecone client
const pc = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY || (() => { throw new Error("PINECONE_API_KEY is not defined in the environment variables."); })()
})

// Structure data for Pinecone insertion
const prepareRecords = (data: any) => {
  const records: {
      screenshots: { id: string; values: number[]; metadata: { path: string; summary: string; keyElements: string; session: string; embedText: string } }[];
      commands: { id: string; values: number[]; metadata: { command: string; frequency: number; examples: string; associatedCode: string[]; directories: string[] } }[];
      keyConcepts: { id: string; values: number[]; metadata: { concept: string; relatedSession: string; workflowPatterns: string } }[];
    } = {
      screenshots: [],
      commands: [],
      keyConcepts: []
    };

  // Process screenshots
  if (data.screenshots && Array.isArray(data.screenshots)) {
    data.screenshots.forEach((screenshot: any, index: number) => {
      // Join key elements into a single string for embedding
      const keyElementsText = Array.isArray(screenshot.keyElements) ? screenshot.keyElements.join(', ') : '';
      
      records.screenshots.push({
        id: `screenshot-${index}-${Date.now()}`,
        values: [], // To be replaced with actual embeddings
        metadata: {
          path: screenshot.path,
          summary: screenshot.summary,
          keyElements: keyElementsText,
          session: data.metadata?.sessionName || 'unknown',
          embedText: keyElementsText // This is the field we'll embed
        }
      });
    });
  }

  // Process commands
  if (data.commandBreakdown && Array.isArray(data.commandBreakdown)) {
    data.commandBreakdown.forEach((command: any, index: number) => {
      records.commands.push({
        id: `command-${index}-${command.command}-${Date.now()}`,
        values: [], // To be replaced with actual embeddings
        metadata: {
          command: command.command,
          frequency: command.frequency,
          examples: Array.isArray(command.contextExamples) ? command.contextExamples.join(' | ') : '',
          associatedCode: Array.isArray(command.associatedCode) ? command.associatedCode : [],
          directories: Array.isArray(command.commonDirectories) ? command.commonDirectories : []
        }
      });
    });
  }

  // Process key concepts
  if (data.keyConcepts && Array.isArray(data.keyConcepts)) {
    data.keyConcepts.forEach((concept: any, index: number) => {
      records.keyConcepts.push({
        id: `concept-${index}-${Date.now()}`,
        values: [], // To be replaced with actual embeddings
        metadata: {
          concept: concept,
          relatedSession: data.metadata?.sessionName || 'unknown',
          workflowPatterns: Array.isArray(data.workflowPatterns)
            ? data.workflowPatterns.map(([pattern]: [string, any]) => pattern).join(', ')
            : ''
        }
      });
    });
  }

  return records;
};

// Generate embeddings using OpenAI - processing one item at a time
async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  return await vscode.window.withProgress({
    location: vscode.ProgressLocation.Window,
    title: 'Generating embeddings',
    cancellable: false
  }, async (progress) => {
    try {
      if (!texts.length) return [];
      
      const embeddings = new OpenAIEmbeddings({
        model: "text-embedding-3-small",
        batchSize: 1 // Process one item at a time
      });
      
      // Process texts serially, one at a time
      const embeddingsArray: number[][] = [];
      const totalTexts = texts.length;

      for (let i = 0; i < totalTexts; i++) {
        const text = texts[i];
        // Update progress
        const percentComplete = Math.round(((i) / totalTexts) * 100);
        progress.report({ 
          message: `Processing ${i + 1}/${totalTexts} (${percentComplete}%)`,
          increment: 100 / totalTexts 
        });
        
        // Generate embedding for a single text
        const embedding = await embeddings.embedQuery(text);
        embeddingsArray.push(embedding);
      }
      
      return embeddingsArray;
      
    } catch (error) {
      console.error('Error generating embeddings:', error);
      // Fallback: Return random vectors with 1536 dimensions
      return texts.map(() => Array.from({ length: 1536 }, () => Math.random() * 2 - 1));
    }
  });
}

// Helper functions
async function createIndex(name: string, dimension: number = 1536) {
  try {
    const indexList = await pc.listIndexes();
    const exists = (indexList.indexes ?? []).some((idx) => idx.name === name);
    
    if (!exists) {
      await pc.createIndex({
        name,
        dimension,
        metric: 'cosine',
        spec: {
          serverless: {
            cloud: 'aws',
            region: 'us-east-1'
          }
        }
      });
      vscode.window.showInformationMessage(`Created Pinecone index: ${name}`);
    }
  } catch (error: any) {
    vscode.window.showWarningMessage(`Failed to create index ${name}: ${error.message}`);
    console.error(`Error creating index ${name}:`, error);
  }
}

async function upsertWithEmbeddings(indexName: string, records: any[], textField: string) {
  try {
    if (records.length === 0) return;
    
    const index = pc.index(indexName);
    const batchSize = 20; // Process in smaller batches
    
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      
      // Extract text for embeddings
      const texts = batch.map(r => r.metadata[textField] || '');
      // For screenshots: This embeds the 'embedText' field - which contains the keyElements
      // For commands: This embeds the 'examples' field - examples of how the command is used in context
      // For key concepts: This embeds the 'concept' field - the text describing the key concept
      
      // Generate embeddings
      const embeddings = await generateEmbeddings(texts);
      
      // Combine records with embeddings
      const vectors = batch.map((record, idx) => ({
        ...record,
        values: embeddings[idx] || Array(1536).fill(0) // Updated fallback dimension to 1536
      }));
      
      // Upsert to Pinecone
      await index.upsert(vectors);
      
      vscode.window.showInformationMessage(
        `Stored ${batch.length} vectors in Pinecone index '${indexName}' (batch ${Math.ceil((i+1)/batchSize)}/${Math.ceil(records.length/batchSize)})`
      );
    }
  } catch (error: any) {
    vscode.window.showErrorMessage(`Failed to upsert data to ${indexName}: ${error.message}`);
    console.error(`Error upserting to ${indexName}:`, error);
  }
}

// Main insertion function
export async function storeSessionData(jsonData: any): Promise<void> {
  vscode.window.showInformationMessage('Starting to store session data in vector database...');
  
  try {
    // Create indexes if they don't exist with 1536 dimensions
    await createIndex('screenshots', 1536);
    await createIndex('commands', 1536); 
    await createIndex('key-concepts', 1536);

    // Prepare records
    const records = prepareRecords(jsonData);
    
    // Show progress
    vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'Storing session data in vector database',
      cancellable: false
    }, async (progress) => {
      progress.report({ increment: 0 });
      
      // Batch upsert operations
      if (records.screenshots.length > 0) {
        progress.report({ increment: 20, message: 'Processing screenshots...' });
        await upsertWithEmbeddings('screenshots', records.screenshots, 'embedText'); // Use embedText for screenshots
      }
      
      if (records.commands.length > 0) {
        progress.report({ increment: 40, message: 'Processing commands...' });
        await upsertWithEmbeddings('commands', records.commands, 'examples');
      }
      
      if (records.keyConcepts.length > 0) {
        progress.report({ increment: 40, message: 'Processing key concepts...' });
        await upsertWithEmbeddings('key-concepts', records.keyConcepts, 'concept');
      }
      
      return new Promise<void>(resolve => {
        setTimeout(() => {
          vscode.window.showInformationMessage('Session data successfully stored in vector database');
          resolve();
        }, 1000);
      });
    });
  } catch (error: any) {
    vscode.window.showErrorMessage(`Error storing session data: ${error.message}`);
    console.error('Error inserting data:', error);
  }
}

// Search function for future use
export async function searchVectorDB(query: string, indexName: string, limit: number = 5): Promise<any[]> {
  try {
    // Generate embedding for query
    const [queryEmbedding] = await generateEmbeddings([query]);
    
    // Query the index
    const index = pc.index(indexName);
    const results = await index.query({
      vector: queryEmbedding,
      topK: limit,
      includeMetadata: true,
    });
    
    return results.matches;
  } catch (error: any) {
    vscode.window.showErrorMessage(`Search failed: ${error.message}`);
    console.error('Search error:', error);
    return [];
  }
}

// Search Screenshots index
export async function searchScreenshotsIndex(keywords: string[], limit: number = 3): Promise<any[]> {
  try {
    // Join keywords for better semantic search
    const query = keywords.join(' ');
    const results = await searchVectorDB(query, 'screenshots', limit);
    
    // Format results for easy consumption
    return results.map(match => ({
      type: 'screenshot',
      score: match.score,
      path: match.metadata?.path || 'Unknown path',
      summary: match.metadata?.summary || 'No summary available',
      keyElements: match.metadata?.keyElements?.split(', ') || [],
      session: match.metadata?.session || 'Unknown session'
    }));
  } catch (error) {
    console.error('Error searching screenshots index:', error);
    return [];
  }
}

// Search Commands index
export async function searchCommandsIndex(keywords: string[], limit: number = 3): Promise<any[]> {
  try {
    // Join keywords for better semantic search
    const query = keywords.join(' ');
    const results = await searchVectorDB(query, 'commands', limit);
    
    // Format results for easy consumption
    return results.map(match => ({
      type: 'command',
      score: match.score,
      command: match.metadata?.command || 'Unknown command',
      frequency: match.metadata?.frequency || 0,
      examples: match.metadata?.examples?.split(' | ') || [],
      associatedCode: match.metadata?.associatedCode || [],
      directories: match.metadata?.directories || []
    }));
  } catch (error) {
    console.error('Error searching commands index:', error);
    return [];
  }
}

// Search Key Concepts index
export async function searchKeyConceptsIndex(keywords: string[], limit: number = 3): Promise<any[]> {
  try {
    // Join keywords for better semantic search
    const query = keywords.join(' ');
    const results = await searchVectorDB(query, 'key-concepts', limit);
    
    // Format results for easy consumption
    return results.map(match => ({
      type: 'concept',
      score: match.score,
      concept: match.metadata?.concept || 'Unknown concept',
      relatedSession: match.metadata?.relatedSession || 'Unknown session',
      workflowPatterns: match.metadata?.workflowPatterns?.split(', ') || []
    }));
  } catch (error) {
    console.error('Error searching key concepts index:', error);
    return [];
  }
}

// Function to classify if a query is technical (code-related) or non-technical
export async function classifyQueryType(message: string): Promise<{ type: 'technical' | 'non-technical', confidence: number }> {
  try {
    const llm = new ChatGroq({
      model: "llama-3.1-8b-instant",
      temperature: 0.1,
      maxTokens: 100,
    });
    
    const prompt = [
      {
        role: "system",
        content: "You are an advanced query classifier designed to identify technical queries. Analyze the input query and determine whether it is 'technical' (related to code, programming, software development, or technical tools) or 'non-technical'. Provide your response as a JSON object with two fields: 'type' (either 'technical' or 'non-technical') and 'confidence' (a numeric value between 0 and 1 indicating your certainty in the classification). Ensure accuracy and clarity in your classification."
      },
      { role: "user", content: `Classify this query: ${message}` },
    ];
    
    const aiMsg = await llm.invoke(prompt, {
      response_format: { type: "json_object" }
    });
    
    try {
      const responseJson = JSON.parse(aiMsg.content.toString());
      
      if (responseJson && responseJson.type && typeof responseJson.confidence === 'number') {
        return {
          type: responseJson.type === 'technical' ? 'technical' : 'non-technical',
          confidence: Math.max(0, Math.min(1, responseJson.confidence)) // Ensure confidence is between 0 and 1
        };
      }
      
      // Default fallback if response format is incorrect
      return {
        type: message.match(/\b(code|function|api|error|bug|class|variable|method|compiler|programming|developer|syntax|library|framework|package|module|typescript|javascript|python|java|c\+\+|html|css)\b/i) 
          ? 'technical' 
          : 'non-technical',
        confidence: 0.7 // Medium confidence for fallback heuristic
      };
      
    } catch (error) {
      console.error('Failed to parse query classification response:', error);
      // Fallback to keyword-based classification
      const technicalTerms = [
        'code', 'function', 'api', 'error', 'bug', 'class', 'variable', 
        'method', 'compiler', 'programming', 'developer', 'syntax', 'library',
        'framework', 'package', 'module', 'typescript', 'javascript', 'python',
        'java', 'c++', 'html', 'css', 'command', 'terminal', 'git', 'build'
      ];
      
      const technicalWordCount = technicalTerms.filter(term => 
        message.toLowerCase().includes(term.toLowerCase())
      ).length;
      
      return {
        type: technicalWordCount > 0 ? 'technical' : 'non-technical',
        confidence: Math.min(0.5 + (technicalWordCount * 0.1), 0.9) // Scale confidence based on matches
      };
    }
  } catch (error) {
    console.error('Error classifying query:', error);
    // Default fallback in case of error
    return { 
      type: 'technical', // Default to technical to err on the side of caution
      confidence: 0.5 
    };
  }
}

// Helper function to extract keywords from a chat message
export async function extractKeywordsFromMessage(message: string): Promise<string[]> {
  try {
    const llm = new ChatGroq({
      model: "llama-3.1-8b-instant", // Using smaller model for keyword extraction
      temperature: 0.1,
      maxTokens: 250,
    });
    
    const prompt = [
      {
        role: "system",
        content: "You are a technical assistant specializing in software development and programming concepts. Extract 3-7 precise and relevant technical keywords or phrases from the input. The keywords should be actionable, specific, and useful for searching in a vector database of code and command-related knowledge. Return your response as a JSON array of strings."

      },
      { role: "user", content: `Extract search keywords from this query: ${message}` },
    ];
    
    const aiMsg = await llm.invoke(prompt, {
      response_format: { type: "json_object" }
    });
    
    try {
      const responseJson = JSON.parse(aiMsg.content.toString());
      
      // Handle different possible formats the model might return
      if (Array.isArray(responseJson)) {
        return responseJson;
      } else if (responseJson.keywords && Array.isArray(responseJson.keywords)) {
        return responseJson.keywords;
      } else if (typeof responseJson === 'object') {
        // Find any array property in the object
        const arrayProp = Object.values(responseJson).find(val => Array.isArray(val));
        if (arrayProp && Array.isArray(arrayProp)) {
          return arrayProp;
        }
      }
      
      // Fallback to using the message itself as a keyword
      return [message];
      
    } catch (error) {
      console.error('Failed to parse keywords response:', error);
      // Fallback to using the message itself split by spaces
      const fallbackKeywords = message.split(' ')
        .filter(word => word.length > 3)  // Only words longer than 3 chars
        .slice(0, 5);                     // Take at most 5 words
      
      return fallbackKeywords.length ? fallbackKeywords : [message];
    }
  } catch (error) {
    console.error('Error extracting keywords:', error);
    return [message]; // Fallback to the original message
  }
}
