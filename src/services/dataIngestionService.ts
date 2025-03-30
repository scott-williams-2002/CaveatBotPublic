import * as vscode from 'vscode';
import { ChatGroq } from '@langchain/groq';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { SessionData } from '../models/interfaces';
import * as fs from 'fs';
// Update Groq import to use require syntax
const Groq = require('groq-sdk');
// Import the vectorDB service
import { storeSessionData } from './vectorDB';

// Load environment variables from a .env file in a custom directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Function to encode an image file to base64
function encodeImageToBase64(imagePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        fs.readFile(imagePath, (err, data) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(data.toString('base64'));
        });
    });
}

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



export async function beginWorkflow(sessionData: SessionData | null): Promise<void> {
    if (!sessionData) {
        vscode.window.showErrorMessage('No session data available for processing.');
        return;
    }
    
    vscode.window.showInformationMessage(`Starting data ingestion for session: ${sessionData.name}!`);
    
    // Array to collect processed action results
    const processedResults: any[] = [];
    
    // Process actions sequentially with progress bar
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Processing session: ${sessionData.name}`,
        cancellable: false
    }, async (progress) => {
        const total = sessionData.actions.length;
        let completed = 0;
        
        for (const action of sessionData.actions) {
            try {
                const result = await handleAction(action);
                if (result) {
                    processedResults.push({
                        type: action.type,
                        result
                    });
                }
                
                completed++;
                progress.report({ 
                    increment: 100 / total, 
                    message: `${completed}/${total} actions (${action.type})`
                });
            } catch (error) {
                vscode.window.showErrorMessage(`Error processing action of type ${action.type}`);
                completed++;
            }
        }
        
        return new Promise<void>(resolve => {
            setTimeout(() => {
                resolve();
                vscode.window.showInformationMessage(`Completed processing ${completed}/${total} actions`);
            }, 500);
        });
    });
    
    // Generate summary from processed actions
    if (processedResults.length > 0) {
        try {
            const summary = await generateSessionSummary(processedResults, sessionData);
            
            // Save the summary to a JSON file
            const summaryDir = path.join(__dirname, '../../../summaries');
            
            // Create the directory if it doesn't exist
            if (!fs.existsSync(summaryDir)) {
                fs.mkdirSync(summaryDir, { recursive: true });
            }
            
            // Create a sanitized filename from session name
            const sanitizedName = sessionData.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `${sanitizedName}_${timestamp}.json`;
            const filePath = path.join(summaryDir, filename);
            
            // Write the summary to the file
            fs.writeFileSync(filePath, JSON.stringify(summary, null, 2));
            
            // Show a message with a button to open the file
            vscode.window.showInformationMessage(
                `Session summary saved to: ${filePath}`,
                'Open File'
            ).then(selection => {
                if (selection === 'Open File') {
                    vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath));
                }
            });
            
        } catch (error) {
            vscode.window.showErrorMessage('Error generating session summary');
        }
    }
}

// Modify handleAction to return the parsed results
export async function handleAction(action: any): Promise<any> {
    if (action.type === 'note') {
        try {
            const llm = new ChatGroq({
                model: "llama-3.3-70b-versatile",
                temperature: 0,
                maxTokens: undefined,
                maxRetries: 2,
            });
            
            const prompt = [
                {
                    role: "system",
                    content: "Extract the key information from the provided note. Return your analysis as a JSON object with these fields: 'actionSummary' (string describing a distilled description of the note), 'mainIdeas' (array of key concepts), 'codeSnippets' (array of any code found), 'commands' (array of any command-line instructions), and 'links' (array of any URLs or references)."
                },
                { role: "user", content: `Analyze the following note and extract key information: ${action.note}` },
            ];
            
            const response = await llm.invoke(prompt, {
                response_format: { type: "json_object" }
            });
            
            let parsedResponse;
            try {
                parsedResponse = JSON.parse(response.content.toString());
                vscode.window.showInformationMessage('Note processed successfully');
                return parsedResponse;
            } catch (error) {
                vscode.window.showErrorMessage('Failed to process note content');
            }
        } catch (error) {
            vscode.window.showErrorMessage('Error analyzing note content');
        }
    }
    else if (action.type === 'command') {
        try {
            const llm = new ChatGroq({
                model: "llama-3.3-70b-versatile",
                temperature: 0,
                maxTokens: undefined,
                maxRetries: 2,
            });
            
            const prompt = [
                {
                    role: "system",
                    content: "Analyze the provided command and output and extract key information. Return your analysis as a JSON object with these fields: 'actionSummary' (string describing a distilled description of what the command and output achieved), 'mainIdeas' (array of key concepts), 'codeSnippets' (array of any code found), 'commands' (array of any command-line instructions), and 'links' (array of any URLs or references)."
                },
                { role: "user", content: `Analyze the following command and extract key information. Command: ${action.command} Command Output: ${action.output}. The command was: ${action.success}`  },
            ];
            
            const response = await llm.invoke(prompt, {
                response_format: { type: "json_object" }
            });
            
            let parsedResponse;
            try {
                parsedResponse = JSON.parse(response.content.toString());
                
                // Add the original command data to the response
                parsedResponse.originalCommand = action.command;
                parsedResponse.originalOutput = action.output;
                parsedResponse.success = action.success;
                
                
                return parsedResponse;
            } catch (error) {
                vscode.window.showErrorMessage('Failed to process command content');
            }
        } catch (error) {
            vscode.window.showErrorMessage('Error analyzing command content');
        }
    }
    else if (action.type === 'codeChange') {
        try {
            const llm = new ChatGroq({
                model: "llama-3.3-70b-versatile",
                temperature: 0,
                maxTokens: undefined,
                maxRetries: 2,
            });
            
            const prompt = [
                {
                    role: "system",
                    content: "Analyze the provided code change and extract key information. Return your analysis as a JSON object with these fields: 'actionSummary' (string describing a distilled description of what the code change achieved), 'mainIdeas' (array of key concepts), 'codeSnippets' (array of any code found that is unique. Don't record any boilerplate), 'commands' (array of any command-line instructions), and 'links' (array of any URLs or references)."
                },
                { role: "user", content: `Analyze the following code change and extract key information. Code Changes: ${action.code_change}` },
            ];
            
            const response = await llm.invoke(prompt, {
                response_format: { type: "json_object" }
            });
            
            let parsedResponse;
            try {
                parsedResponse = JSON.parse(response.content.toString());
                
                // Add the original code change data
                parsedResponse.originalCodeChange = action.code_change;
                
                vscode.window.showInformationMessage('Code change processed successfully');
                return parsedResponse;
            } catch (error) {
                vscode.window.showErrorMessage('Failed to process code change content');
            }
        } catch (error) {
            vscode.window.showErrorMessage('Error analyzing code change content');
        }
    }
    else if (action.type === 'screenshot') {
        let attempts = 0;
        const maxAttempts = 3;
        
        while (attempts < maxAttempts) {
            attempts++;
            try {
                // Fix: Use the correct property path and add fallbacks
                const imagePath = action.path || action.screenshot;
                
                if (!imagePath) {
                    vscode.window.showErrorMessage(`Screenshot path is missing in the action data`);
                    return;
                }
                
                // Check if file exists
                if (!fs.existsSync(imagePath)) {
                    vscode.window.showErrorMessage(`Screenshot file not found: ${imagePath}`);
                    
                    // Try normalizing the path before giving up
                    const normalizedPath = path.normalize(imagePath);
                    if (normalizedPath !== imagePath && fs.existsSync(normalizedPath)) {
                        const base64Image = await encodeImageToBase64(normalizedPath);
                        // Continue processing with normalized path
                    } else {
                        return;
                    }
                }
                
                const base64Image = await encodeImageToBase64(imagePath);
                
                // Initialize Groq client directly using require style
                const groq = new Groq({
                    apiKey: process.env.GROQ_API_KEY
                });
                
                const response = await groq.chat.completions.create({
                    messages: [
                        {
                            role: "user",
                            content: [
                                { 
                                    type: "text", 
                                    text: "Analyze this screenshot and extract key information. Return your analysis as a JSON object with these fields: 'actionSummary' (string describing what is shown), 'mainIdeas' (array of key concepts), 'codeSnippets' (array of any code found), 'commands' (array of command-line instructions), and 'links' (array of URLs/references)." 
                                },
                                {
                                    type: "image_url",
                                    image_url: {
                                        url: `data:image/jpeg;base64,${base64Image}`,
                                        detail: "auto" // Add detail parameter for vision processing
                                    }
                                }
                            ]
                        }
                    ],
                    model: "llama-3.2-90b-vision-preview",
                    temperature: 0,
                    max_completion_tokens: 1024,
                    top_p: 1,
                    stream: false,
                    stop: null,
                    response_format: { type: "json_object" }
                });
                
                let parsedResponse;
                try {
                    if (response.choices[0].message.content) {
                        parsedResponse = JSON.parse(response.choices[0].message.content);
                        // Add the screenshot path to the response
                        parsedResponse.screenshotPath = imagePath;
                        vscode.window.showInformationMessage('Screenshot analyzed successfully');
                        return parsedResponse;
                    } else {
                        throw new Error('Response content is null');
                    }
                } catch (error) {
                    if (attempts >= maxAttempts) {
                        vscode.window.showErrorMessage('Failed to process screenshot content after multiple attempts');
                    }
                }
            } catch (error) {
                if (attempts >= maxAttempts) {
                    vscode.window.showErrorMessage('Error analyzing screenshot after multiple attempts');
                    return;
                }
                
                // Add a small delay before retrying
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }
    
    return null; // Return null if no valid response was generated
}

// New function to generate a session summary from processed action results
export async function generateSessionSummary(processedResults: any[], sessionData: SessionData): Promise<any> {
    // Step 1: Extract and organize all action data by type
    const commandActions = processedResults.filter(r => r.type === 'command' && r.result);
    const codeChangeActions = processedResults.filter(r => r.type === 'codeChange' && r.result);
    const noteActions = processedResults.filter(r => r.type === 'note' && r.result);
    const screenshotActions = processedResults.filter(r => r.type === 'screenshot' && r.result);
    
    // Step 2: Extract all command data with their analysis
    const commandsData = commandActions.map(ca => ({
        command: ca.result.originalCommand,
        output: ca.result.originalOutput || '',
        success: ca.result.success || false,
        summary: ca.result.actionSummary || '',
        mainIdeas: ca.result.mainIdeas || [],
        codeSnippets: ca.result.codeSnippets || [],
        commands: ca.result.commands || [],
        links: ca.result.links || [],
        directory: extractDirectoryFromCommand(ca.result.originalCommand)
    }));
    
    // Step 3: Extract all code changes with their analysis
    const codeChangesData = codeChangeActions.map(cc => ({
        mainIdeas: cc.result.mainIdeas || [],
        codeSnippets: cc.result.codeSnippets || [],
        actionSummary: cc.result.actionSummary || '',
        commands: cc.result.commands || [],
        links: cc.result.links || []
    }));
    
    // Step 4: Extract all notes with their analysis
    const notesData = noteActions.map(n => ({
        actionSummary: n.result.actionSummary || '',
        mainIdeas: n.result.mainIdeas || [],
        codeSnippets: n.result.codeSnippets || [],
        commands: n.result.commands || [],
        links: n.result.links || []
    }));
    
    // Step 5: Extract all screenshots with their analysis including paths
    const screenshotsData = screenshotActions.map(s => ({
        actionSummary: s.result.actionSummary || '',
        mainIdeas: s.result.mainIdeas || [],
        codeSnippets: s.result.codeSnippets || [],
        commands: s.result.commands || [],
        links: s.result.links || [],
        path: s.result.screenshotPath || ''  // Include the screenshot path
    }));
    
    // Step 6: Pre-process command statistics
    const commandStats = preprocessCommandStats(commandsData);
    
    // Step 7: Use LangChain to generate the comprehensive summary
    const llm = new ChatGroq({
        model: "llama-3.3-70b-versatile",
        temperature: 0,
        maxTokens: 1500,
        maxRetries: 2,
    });
    
    // Final summary generation with workflow patterns
    const finalPrompt = [
        {
            role: "system",
            content: `You're an expert at analyzing development workflows and patterns. Generate a comprehensive summary 
                     with the following structure exactly:
                     {
                       "totalActions": <number>,
                       "uniqueCommands": <number>,
                       "commandBreakdown": [
                         {
                           "command": <command name>,
                           "frequency": <number>,
                           "commonDirectories": [<directory strings>],
                           "associatedCode": [<example command strings>],
                           "contextExamples": [<usage context strings>]
                         }
                       ],
                       "workflowPatterns": [
                         [<pattern string>, <frequency>],
                         ...
                       ],
                       "keyConcepts": [<strings>],
                       "sessionSummary": <string>,
                       "screenshots": [
                         {
                           "path": <string>,
                           "summary": <string>,
                           "keyElements": [<strings>]
                         }
                       ]
                     }`
        },
        { 
            role: "user", 
            content: `Generate a comprehensive summary for a development session titled "${sessionData.name}" 
                     with description "${sessionData.description}".
                     
                     Command data (${commandsData.length} items):
                     ${JSON.stringify(commandStats, null, 2)}
                     
                     Code changes (${codeChangesData.length} items):
                     ${JSON.stringify({
                         summaries: codeChangesData.map(c => c.actionSummary),
                         mainIdeas: flattenAndDeduplicate(codeChangesData.map(c => c.mainIdeas)),
                         codeSnippets: flattenAndDeduplicate(codeChangesData.map(c => c.codeSnippets)),
                         commands: flattenAndDeduplicate(codeChangesData.map(c => c.commands)),
                     }, null, 2)}
                     
                     Notes (${notesData.length} items):
                     ${JSON.stringify({
                         summaries: notesData.map(n => n.actionSummary),
                         mainIdeas: flattenAndDeduplicate(notesData.map(n => n.mainIdeas)),
                         codeSnippets: flattenAndDeduplicate(notesData.map(n => n.codeSnippets)),
                         commands: flattenAndDeduplicate(notesData.map(n => n.commands))
                     }, null, 2)}
                     
                     Screenshots (${screenshotsData.length} items):
                     ${JSON.stringify({
                         details: screenshotsData.map(s => ({
                             path: s.path,
                             summary: s.actionSummary,
                             mainIdeas: s.mainIdeas
                         })),
                         allMainIdeas: flattenAndDeduplicate(screenshotsData.map(s => s.mainIdeas)),
                         allCodeSnippets: flattenAndDeduplicate(screenshotsData.map(s => s.codeSnippets)),
                         allCommands: flattenAndDeduplicate(screenshotsData.map(s => s.commands))
                     }, null, 2)}
                     
                     Format the response exactly according to the JSON schema in your system instructions.
                     Be sure to include the screenshots array with path, summary, and keyElements for each screenshot.`
        },
    ];
    
    const finalResponse = await llm.invoke(finalPrompt, {
        response_format: { type: "json_object" }
    });
    
    try {
        const sessionSummary = JSON.parse(finalResponse.content.toString());
        
        // If the model didn't generate screenshots array, create it manually
        if (!sessionSummary.screenshots && screenshotsData.length > 0) {
            sessionSummary.screenshots = screenshotsData.map(s => ({
                path: s.path,
                summary: s.actionSummary,
                keyElements: s.mainIdeas
            }));
        }
        
        // Add metadata to the summary
        const finalSummary = {
            ...sessionSummary,
            metadata: {
                sessionName: sessionData.name,
                sessionDescription: sessionData.description,
                generatedAt: new Date().toISOString(),
                totalProcessedActions: processedResults.length
            }
        };
        
        // Store the session data in the vector database
        await storeSessionData(finalSummary);
        
        return finalSummary;
    } catch (error) {
        // Provide a fallback summary with screenshots included
        const fallbackSummary = {
            error: "Failed to parse session summary",
            rawContent: finalResponse.content.toString(),
            screenshots: screenshotsData.map(s => ({
                path: s.path,
                summary: s.actionSummary,
                keyElements: s.mainIdeas
            })),
            metadata: {
                sessionName: sessionData.name,
                sessionDescription: sessionData.description,
                generatedAt: new Date().toISOString(),
                totalProcessedActions: processedResults.length
            }
        };
        
        // Still try to store the fallback session data
        await storeSessionData(fallbackSummary);
        
        return fallbackSummary;
    }
}

// Helper function to extract directory from command
function extractDirectoryFromCommand(command: string): string | null {
    // Look for cd commands
    const cdMatch = command.match(/^cd\s+(.+)/i);
    if (cdMatch) {
        return cdMatch[1].trim();
    }
    
    // Look for paths in other commands
    const pathMatch = command.match(/\s(\/[a-zA-Z0-9_\/.~-]+|[a-zA-Z]:\\[a-zA-Z0-9_\\.\s-]+|~\/[a-zA-Z0-9_\/.~-]+)/);
    if (pathMatch) {
        return pathMatch[1].trim();
    }
    
    return null;
}

// Helper function to preprocess command statistics
function preprocessCommandStats(commandsData: any[]): any {
    // Extract base commands (e.g., "npm" from "npm install")
    const baseCommands = commandsData.map(cmd => {
        const parts = cmd.command.trim().split(' ');
        const baseCmd = parts[0];
        return {
            fullCommand: cmd.command,
            baseCommand: baseCmd,
            args: parts.slice(1).join(' '),
            success: cmd.success,
            summary: cmd.summary,
            mainIdeas: cmd.mainIdeas,
            directory: cmd.directory,
            codeSnippets: cmd.codeSnippets
        };
    });
    
    // Group by base command
    const commandGroups: Record<string, any[]> = {};
    baseCommands.forEach(cmd => {
        if (!commandGroups[cmd.baseCommand]) {
            commandGroups[cmd.baseCommand] = [];
        }
        commandGroups[cmd.baseCommand].push(cmd);
    });
    
    // Create command statistics
    const stats = Object.keys(commandGroups).map(baseCmd => {
        const commands = commandGroups[baseCmd];
        const directories = commands
            .map(c => c.directory)
            .filter(d => d !== null && d !== undefined);
        
        return {
            baseCommand: baseCmd,
            frequency: commands.length,
            examples: commands.map(c => c.fullCommand).slice(0, 5), // Limit to 5 examples
            successRate: commands.filter(c => c.success).length / commands.length,
            summaries: commands.map(c => c.summary).filter(Boolean),
            mainIdeas: flattenAndDeduplicate(commands.map(c => c.mainIdeas)),
            directories: [...new Set(directories)],
            codeSnippets: flattenAndDeduplicate(commands.map(c => c.codeSnippets))
        };
    });
    
    // Look for command sequences
    const commandSequences = findCommandSequences(commandsData.map(cmd => cmd.command));
    
    return {
        totalCommands: commandsData.length,
        uniqueBaseCommands: Object.keys(commandGroups).length,
        commandStats: stats,
        possibleSequences: commandSequences
    };
}

// Helper function to flatten and deduplicate arrays
function flattenAndDeduplicate<T>(arrays: T[][]): T[] {
    const flattened = arrays.flat().filter(Boolean);
    return [...new Set(flattened)];
}

// Helper function to find command sequences
function findCommandSequences(commands: string[]): [string, number][] {
    if (commands.length < 2) {
        return [];
    }
    
    const simplifiedCommands = commands.map(cmd => {
        const parts = cmd.trim().split(' ');
        return parts[0]; // Just take the base command
    });
    
    // Look for pairs and triplets of commands
    const pairs: Record<string, number> = {};
    const triplets: Record<string, number> = {};
    
    // Find pairs
    for (let i = 0; i < simplifiedCommands.length - 1; i++) {
        const pair = `${simplifiedCommands[i]} -> ${simplifiedCommands[i+1]}`;
        pairs[pair] = (pairs[pair] || 0) + 1;
    }
    
    // Find triplets
    for (let i = 0; i < simplifiedCommands.length - 2; i++) {
        const triplet = `${simplifiedCommands[i]} -> ${simplifiedCommands[i+1]} -> ${simplifiedCommands[i+2]}`;
        triplets[triplet] = (triplets[triplet] || 0) + 1;
    }
    
    // Combine and sort sequences by frequency
    const sequences: [string, number][] = [
        ...Object.entries(pairs),
        ...Object.entries(triplets)
    ].sort((a, b) => b[1] - a[1]);
    
    // Return top 10 sequences
    return sequences.slice(0, 10);
}