import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
  classifyQueryType, 
  extractKeywordsFromMessage, 
  searchScreenshotsIndex,
  searchCommandsIndex,
  searchKeyConceptsIndex
} from './vectorDB';
import { generatePolishedResponse } from './finalResponseGen';

// Chat handler class
export class ChatHandler {
    private context: vscode.ExtensionContext;
    private chatPanel: vscode.WebviewPanel | undefined;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    // Open custom chat interface in a webview panel
    public openChatInterface(): void {
        try {
            // If we already have a panel, show it
            if (this.chatPanel) {
                this.chatPanel.reveal(vscode.ViewColumn.One);
                return;
            }

            // Create and show a new webview panel
            this.chatPanel = vscode.window.createWebviewPanel(
                'caveatbotChat', // Identifies the type of the webview
                'CaveatBot Chat', // Title of the panel displayed to the user
                vscode.ViewColumn.One, // Editor column to show the panel in
                {
                    // Enable JavaScript in the webview
                    enableScripts: true,
                    // Restrict the webview to only loading content from our extension's directory
                    localResourceRoots: [vscode.Uri.file(path.join(this.context.extensionPath))],
                    // Retain the context when hidden
                    retainContextWhenHidden: true
                }
            );

            // Handle panel disposal
            this.chatPanel.onDidDispose(() => {
                this.chatPanel = undefined;
            }, null, this.context.subscriptions);

            // Handle messages from the webview
            this.chatPanel.webview.onDidReceiveMessage(
                async (message) => {
                    switch (message.command) {
                        case 'sendMessage':
                            await this.handleChatMessage(message.text, this.chatPanel!);
                            break;
                        case 'openScreenshot':
                            await this.openScreenshotInVSCode(message.path);
                            break;
                    }
                },
                undefined,
                this.context.subscriptions
            );

            // Set the webview's HTML content
            this.chatPanel.webview.html = this.getChatHtml(this.chatPanel.webview);
            
        } catch (error) {
            console.error('Error opening chat interface:', error);
            vscode.window.showErrorMessage('Failed to open CaveatBot chat interface.');
        }
    }

    // Generate the HTML for the webview panel
    private getChatHtml(webview: vscode.Webview): string {
        // Create and return the HTML
        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>CaveatBot Chat</title>
                <style>
                    :root {
                        --container-padding: 20px;
                        --input-padding-vertical: 6px;
                        --input-padding-horizontal: 4px;
                        --input-margin-vertical: 4px;
                        --input-margin-horizontal: 0;
                    }

                    body {
                        padding: 0 var(--container-padding);
                        color: var(--vscode-foreground);
                        font-size: var(--vscode-font-size);
                        font-weight: var(--vscode-font-weight);
                        font-family: var(--vscode-font-family);
                        background-color: var(--vscode-editor-background);
                        display: flex;
                        flex-direction: column;
                        height: 100vh;
                        margin: 0;
                    }

                    ol, ul {
                        padding-left: var(--container-padding);
                    }

                    .chat-container {
                        flex: 1;
                        overflow-y: auto;
                        margin-bottom: 10px;
                        padding: 10px;
                    }

                    .message-container {
                        margin-bottom: 15px;
                        display: flex;
                        flex-direction: column;
                    }

                    .message {
                        padding: 8px 12px;
                        border-radius: 6px;
                        max-width: 80%;
                        word-break: break-word;
                    }

                    .user-message-container {
                        align-items: flex-end;
                    }

                    .bot-message-container {
                        align-items: flex-start;
                    }

                    .user-message {
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                    }

                    .bot-message {
                        background-color: var(--vscode-editor-inactiveSelectionBackground);
                    }

                    .input-container {
                        display: flex;
                        padding: 10px 0;
                        border-top: 1px solid var(--vscode-panel-border);
                    }

                    #message-input {
                        flex: 1;
                        background-color: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border: 1px solid var(--vscode-input-border);
                        padding: var(--input-padding-vertical) var(--input-padding-horizontal);
                        border-radius: 2px;
                        min-height: 28px;
                        resize: vertical;
                    }

                    #send-button {
                        margin-left: 10px;
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        padding: 0 15px;
                        border-radius: 2px;
                        cursor: pointer;
                    }

                    #send-button:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }

                    #message-input:focus {
                        outline: 1px solid var(--vscode-focusBorder);
                        border-color: var(--vscode-focusBorder);
                    }
                    
                    .message pre {
                        background-color: var(--vscode-textCodeBlock-background);
                        padding: 8px;
                        border-radius: 4px;
                        overflow-x: auto;
                    }
                    
                    .message code {
                        font-family: var(--vscode-editor-font-family);
                        font-size: var(--vscode-editor-font-size);
                    }
                    
                    .assistant-tag {
                        font-size: small;
                        opacity: 0.8;
                        margin-bottom: 2px;
                    }
                    
                    .screenshots-container {
                        margin-top: 15px;
                        border-top: 1px solid var(--vscode-panel-border);
                        padding-top: 10px;
                    }
                    
                    .screenshots-heading {
                        font-weight: bold;
                        margin-bottom: 10px;
                    }
                    
                    .screenshot-item {
                        margin-bottom: 20px;
                        background-color: var(--vscode-editor-inactiveSelectionBackground);
                        padding: 10px;
                        border-radius: 6px;
                    }
                    
                    .screenshot-image {
                        max-width: 100%;
                        margin-top: 8px;
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 4px;
                    }
                    
                    .screenshot-path {
                        font-family: var(--vscode-editor-font-family);
                        font-size: 12px;
                        opacity: 0.7;
                        margin-bottom: 5px;
                        word-break: break-all;
                    }
                    
                    .screenshot-summary {
                        margin-bottom: 8px;
                    }
                    
                    .screenshot-view-btn {
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        padding: 5px 10px;
                        border-radius: 2px;
                        cursor: pointer;
                        margin-top: 10px;
                        display: inline-block;
                    }
                    
                    .screenshot-view-btn:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }
                    
                    .screenshot-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: flex-start;
                        margin-bottom: 5px;
                    }
                </style>
            </head>
            <body>
                <h2>CaveatBot Assistant</h2>
                <div class="chat-container" id="chat-container">
                    <div class="message-container bot-message-container">
                        <div class="assistant-tag">CaveatBot</div>
                        <div class="message bot-message">
                            Hello! I'm your CaveatBot Assistant. I can help you recall information from your recording sessions. 
                            What would you like to know?
                        </div>
                    </div>
                </div>
                <div id="screenshots-container" class="screenshots-container" style="display: none;">
                    <div class="screenshots-heading">Here are some relevant screenshots you took along with their description:</div>
                    <div id="screenshots-list"></div>
                </div>
                <div class="input-container">
                    <textarea id="message-input" placeholder="Type your message..." rows="2"></textarea>
                    <button id="send-button">Send</button>
                </div>
                <script>
                    (function() {
                        // Get the VS Code API
                        const vscode = acquireVsCodeApi();
                        
                        // DOM Elements
                        const chatContainer = document.getElementById('chat-container');
                        const messageInput = document.getElementById('message-input');
                        const sendButton = document.getElementById('send-button');
                        const screenshotsContainer = document.getElementById('screenshots-container');
                        const screenshotsList = document.getElementById('screenshots-list');
                        
                        // Function to add a message to the chat
                        function addMessage(text, isUser = false) {
                            const messageDiv = document.createElement('div');
                            messageDiv.className = isUser ? 
                                'message-container user-message-container' : 
                                'message-container bot-message-container';
                            
                            if (!isUser) {
                                const tagDiv = document.createElement('div');
                                tagDiv.className = 'assistant-tag';
                                tagDiv.textContent = 'CaveatBot';
                                messageDiv.appendChild(tagDiv);
                            }
                            
                            const textDiv = document.createElement('div');
                            textDiv.className = isUser ? 'message user-message' : 'message bot-message';
                            
                            // For bot messages, support markdown-like formatting for code blocks
                            if (!isUser) {
                                // Convert markdown code blocks
                                let formattedText = text.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, 
                                    (match, code) => '<pre><code>' + code + '</code></pre>');
                                
                                // Convert inline code
                                formattedText = formattedText.replace(/\`([^\\n]+?)\`/g, 
                                    (match, code) => '<code>' + code + '</code>');
                                
                                // Handle line breaks
                                formattedText = formattedText.replace(/\\n/g, '<br>');
                                
                                textDiv.innerHTML = formattedText;
                            } else {
                                textDiv.textContent = text;
                            }
                            
                            messageDiv.appendChild(textDiv);
                            chatContainer.appendChild(messageDiv);
                            
                            // Scroll to bottom
                            chatContainer.scrollTop = chatContainer.scrollHeight;
                        }
                        
                        // Function to display screenshots
                        function displayScreenshots(screenshots) {
                            // Clear previous screenshots
                            screenshotsList.innerHTML = '';
                            
                            // If no screenshots, hide the container
                            if (!screenshots || screenshots.length === 0) {
                                screenshotsContainer.style.display = 'none';
                                return;
                            }
                            
                            // Show and populate screenshots
                            screenshotsContainer.style.display = 'block';
                            
                            screenshots.forEach(screenshot => {
                                const item = document.createElement('div');
                                item.className = 'screenshot-item';
                                
                                const header = document.createElement('div');
                                header.className = 'screenshot-header';
                                
                                const pathDiv = document.createElement('div');
                                pathDiv.className = 'screenshot-path';
                                pathDiv.textContent = screenshot.path;
                                
                                const viewBtn = document.createElement('button');
                                viewBtn.className = 'screenshot-view-btn';
                                viewBtn.textContent = 'View in VS Code';
                                viewBtn.addEventListener('click', () => {
                                    vscode.postMessage({
                                        command: 'openScreenshot',
                                        path: screenshot.path
                                    });
                                });
                                
                                header.appendChild(pathDiv);
                                header.appendChild(viewBtn);
                                
                                const summary = document.createElement('div');
                                summary.className = 'screenshot-summary';
                                summary.textContent = screenshot.summary;
                                
                                // Try to display the image from the file path
                                const img = document.createElement('img');
                                img.className = 'screenshot-image';
                                img.alt = 'Screenshot';
                                img.src = vscode.Uri.file(screenshot.path).with({ scheme: 'vscode-resource' }).toString();
                                img.onerror = () => {
                                    img.alt = 'Could not load screenshot';
                                    img.style.display = 'none';
                                    console.error('Failed to load image:', screenshot.path);
                                };
                                
                                item.appendChild(header);
                                item.appendChild(summary);
                                item.appendChild(img);
                                
                                screenshotsList.appendChild(item);
                            });
                        }
                        
                        // Function to update the typing indicator with a new status
                        function updateTypingStatus(status) {
                            const typingIndicator = document.querySelector('.typing-indicator .bot-message');
                            if (typingIndicator) {
                                typingIndicator.textContent = status;
                                chatContainer.scrollTop = chatContainer.scrollHeight;
                            }
                        }
                        
                        // Function to send a message
                        function sendMessage() {
                            const text = messageInput.value.trim();
                            if (!text) return;
                            
                            // Add user message to chat
                            addMessage(text, true);
                            
                            // Clear input
                            messageInput.value = '';
                            
                            // Add typing indicator
                            const typingDiv = document.createElement('div');
                            typingDiv.className = 'message-container bot-message-container typing-indicator';
                            typingDiv.innerHTML = '<div class="message bot-message">Processing your request...</div>';
                            chatContainer.appendChild(typingDiv);
                            chatContainer.scrollTop = chatContainer.scrollHeight;
                            
                            // Hide screenshots when a new query is made
                            screenshotsContainer.style.display = 'none';
                            
                            // Send message to extension
                            vscode.postMessage({
                                command: 'sendMessage',
                                text: text
                            });
                        }
                        
                        // Event listeners
                        sendButton.addEventListener('click', sendMessage);
                        
                        messageInput.addEventListener('keydown', (e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                sendMessage();
                            }
                        });
                        
                        // Handle messages from the extension
                        window.addEventListener('message', event => {
                            const message = event.data;
                            
                            switch (message.type) {
                                case 'response':
                                    // Remove typing indicator
                                    const typingIndicator = document.querySelector('.typing-indicator');
                                    if (typingIndicator) {
                                        typingIndicator.remove();
                                    }
                                    
                                    // Add bot response
                                    addMessage(message.text);
                                    break;
                                case 'status':
                                    // Update typing indicator with status
                                    updateTypingStatus(message.text);
                                    break;
                                case 'screenshots':
                                    // Display screenshots
                                    displayScreenshots(message.screenshots);
                                    break;
                            }
                        });
                        
                        // Focus the input field
                        messageInput.focus();
                    }())
                </script>
            </body>
            </html>`;
    }

    // Modified handle chat message to provide screenshot viewing options
    private async handleChatMessage(userMessage: string, panel: vscode.WebviewPanel): Promise<void> {
        // Log the message to the console
        console.log(`User message: ${userMessage}`);
        
        // Send status updates as processing happens
        panel.webview.postMessage({
            type: 'status',
            text: 'Analyzing your query...'
        });
        
        const queryType = await classifyQueryType(userMessage);
        console.log(`Query Type: ${queryType}`);
        
        panel.webview.postMessage({
            type: 'status',
            text: 'Query classified as ' + queryType.type + '. Processing...'
        });
        
        let response: string;
        let screenshotsToShow: any[] = [];

        if (queryType.type === 'technical') {
            panel.webview.postMessage({
                type: 'status',
                text: 'Extracting keywords from technical query...'
            });
            
            const keywords = await extractKeywordsFromMessage(userMessage);
            console.log('Extracted keywords:', keywords);
            
            panel.webview.postMessage({
                type: 'status',
                text: `Found ${keywords.length} keywords. Searching vector database...`
            });
            
            // Search all indexes in parallel for better performance
            panel.webview.postMessage({
                type: 'status',
                text: 'Searching screenshots index...'
            });
            const screenshotsResults = await searchScreenshotsIndex(keywords);
            
            // Log screenshot paths if available
            if (screenshotsResults && screenshotsResults.length > 0) {
                console.log('Found screenshots:');
                screenshotsResults.forEach(result => {
                    console.log(`Screenshot path: ${result.path}`);
                });
                
                // Save screenshots for display
                screenshotsToShow = screenshotsResults.map(result => ({
                    path: path.normalize(result.path),  // Normalize the path
                    summary: result.summary,
                    score: result.score
                }));
            } else {
                console.log('No screenshots found in the search index.');
            }
            
            panel.webview.postMessage({
                type: 'status',
                text: 'Searching commands index...'
            });
            const commandsResults = await searchCommandsIndex(keywords);
            
            panel.webview.postMessage({
                type: 'status',
                text: 'Searching key concepts index...'
            });
            const conceptsResults = await searchKeyConceptsIndex(keywords);
            
            panel.webview.postMessage({
                type: 'status',
                text: 'Generating comprehensive response with Groq LLM...'
            });
            
            // Generate a polished response using Groq and LangChain
            response = await generatePolishedResponse(
                userMessage,
                keywords, 
                screenshotsResults, 
                commandsResults, 
                conceptsResults
            );
        } else {
            response = "This appears to be a non-technical query. I'm designed to help with technical questions related to your recorded coding sessions. Please try asking about code, commands, or technical concepts.";
        }

        // Send the response back to the webview
        if (panel) {
            panel.webview.postMessage({
                type: 'response',
                text: response
            });
            
            // Send screenshots if available
            if (screenshotsToShow.length > 0) {
                panel.webview.postMessage({
                    type: 'screenshots',
                    screenshots: screenshotsToShow
                });
                
                // Show a notification with option to open screenshots in VS Code
                if (screenshotsToShow.length === 1) {
                    vscode.window.showInformationMessage(
                        `Found 1 relevant screenshot. Do you want to open it in VS Code?`,
                        'Open Screenshot'
                    ).then(selection => {
                        if (selection === 'Open Screenshot') {
                            this.openScreenshotInVSCode(screenshotsToShow[0].path);
                        }
                    });
                } else {
                    vscode.window.showInformationMessage(
                        `Found ${screenshotsToShow.length} relevant screenshots. Do you want to open them in VS Code?`,
                        'Open First', 'Open All', 'Choose Screenshot'
                    ).then(async selection => {
                        if (selection === 'Open First') {
                            this.openScreenshotInVSCode(screenshotsToShow[0].path);
                        } else if (selection === 'Open All') {
                            for (const screenshot of screenshotsToShow) {
                                await this.openScreenshotInVSCode(screenshot.path);
                            }
                        } else if (selection === 'Choose Screenshot') {
                            const options = screenshotsToShow.map((ss, index) => ({
                                label: `Screenshot ${index + 1}`,
                                description: ss.summary.substring(0, 60) + (ss.summary.length > 60 ? '...' : ''),
                                path: ss.path
                            }));
                            
                            const selected = await vscode.window.showQuickPick(options, {
                                placeHolder: 'Select a screenshot to open'
                            });
                            
                            if (selected) {
                                this.openScreenshotInVSCode(selected.path);
                            }
                        }
                    });
                }
            }
        }
    }

    // Opens a screenshot in a new VS Code window
    private async openScreenshotInVSCode(screenshotPath: string): Promise<void> {
        try {
            if (!fs.existsSync(screenshotPath)) {
                console.error(`Screenshot not found: ${screenshotPath}`);
                vscode.window.showErrorMessage(`Screenshot not found: ${screenshotPath}`);
                return;
            }
            
            // Open the screenshot using VS Code's document viewing functionality
            const uri = vscode.Uri.file(screenshotPath);
            await vscode.commands.executeCommand('vscode.open', uri);
            console.log(`Opened screenshot: ${screenshotPath}`);
        } catch (error) {
            console.error(`Failed to open screenshot: ${error}`);
            vscode.window.showErrorMessage(`Failed to open screenshot: ${error}`);
        }
    }

    // For cleanup
    dispose() {
        if (this.chatPanel) {
            this.chatPanel.dispose();
            this.chatPanel = undefined;
        }
    }
}
