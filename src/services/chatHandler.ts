import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

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
                            typingDiv.innerHTML = '<div class="message bot-message">CaveatBot is thinking...</div>';
                            chatContainer.appendChild(typingDiv);
                            chatContainer.scrollTop = chatContainer.scrollHeight;
                            
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
                            }
                        });
                        
                        // Focus the input field
                        messageInput.focus();
                    }())
                </script>
            </body>
            </html>`;
    }

    // Simplified handle chat message that just logs and returns the input
    private async handleChatMessage(userMessage: string, panel: vscode.WebviewPanel): Promise<void> {
        // Log the message to the console
        console.log(`User message: ${userMessage}`);
        
        // Very simple response - just echo back what the user said with a timestamp
        const response = `I received your message: "${userMessage}"
        
Timestamp: ${new Date().toLocaleTimeString()}`;
        
        // Send the response back to the webview
        if (panel) {
            panel.webview.postMessage({
                type: 'response',
                text: response
            });
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
