import * as vscode from 'vscode';
import { ChatGroq } from '@langchain/groq';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from a .env file in a custom directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });


export async function generateNameFromDescription(description: string): Promise<string> {
    const model = new ChatGroq({
        model: 'llama-3.2-1b-preview',
        temperature: 0.2,
        maxTokens: 250,
    })
    
    const prompt = [
        {
            role: "system",
            content: "You are an expert at generating short, impactful names. Extract only the most essential words from the given description to form a name that is 2 to 3 words long. Be concise, clear, and relevant. Return your response as a JSON object with a 'name' field containing the generated name.",
        },
        { role: "user", content: `Generate a 2-3 word name by extracting the most essential words from this description: ${description}` },
    ];
    
    const aiMsg = await model.invoke(prompt, {
        response_format: { type: "json_object" }
    });
    
    try {
        const responseJson = JSON.parse(aiMsg.content.toString());
        return responseJson.name || aiMsg.content.toString().trim();
    } catch (error) {
        // Fallback to raw response if JSON parsing fails
        return aiMsg.content.toString().trim();
    }
}



export async function beginWorkflow() {
    vscode.window.showInformationMessage('Starting data ingestion!');
    // Add your data ingestion workflow logic here
}