import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SessionData, ActionData, TerminalCommand } from '../models/interfaces';
import { TerminalMonitor } from './TerminalMonitor';

// Session Tree Provider class
export class SessionTreeProvider implements vscode.TreeDataProvider<SessionItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<SessionItem | undefined | null> = new vscode.EventEmitter<SessionItem | undefined | null>();
    readonly onDidChangeTreeData: vscode.Event<SessionItem | undefined | null> = this._onDidChangeTreeData.event;
    
    private sessions: Map<string, SessionData> = new Map();
    private sessionItems: Map<string, SessionItem> = new Map();
    private currentSession: string | null = null;
    private sessionsStoragePath: string;
    private terminalMonitor: TerminalMonitor | null = null;
    
    constructor(private context: vscode.ExtensionContext) {
        this.sessionsStoragePath = path.join(context.globalStorageUri.fsPath, 'recording-sessions');
        
        // Ensure the sessions directory exists
        if (!fs.existsSync(this.sessionsStoragePath)) {
            fs.mkdirSync(this.sessionsStoragePath, { recursive: true });
        }
        
        // Load existing sessions
        this.loadSessions();
    }
    
    setTerminalMonitor(monitor: TerminalMonitor): void {
        this.terminalMonitor = monitor;
    }
    
    refresh(): void {
        this._onDidChangeTreeData.fire(null);
    }
    
    getTreeItem(element: SessionItem): vscode.TreeItem {
        return element;
    }
    
    getChildren(element?: SessionItem): Thenable<SessionItem[]> {
        if (element) {
            const sessionId = element.id;
            const session = this.sessions.get(sessionId);
            
            if (session) {
                return Promise.resolve(
                    session.actions.map((action, index) => {
                        const item = new SessionItem(
                            `${sessionId}-action-${index}`,
                            action.content.substring(0, 50) + (action.content.length > 50 ? '...' : ''),
                            vscode.TreeItemCollapsibleState.None
                        );
                        item.description = new Date(action.timestamp).toLocaleTimeString();
                        item.iconPath = this.getIconForAction(action);
                        item.contextValue = action.type;
                        return item;
                    })
                );
            }
            return Promise.resolve([]);
        } else {
            // Return root items (sessions)
            return Promise.resolve(Array.from(this.sessionItems.values()));
        }
    }
    
    private getIconForAction(action: ActionData): vscode.ThemeIcon {
        switch(action.type) {
            case 'command':
                return new vscode.ThemeIcon('terminal');
            case 'consequence':
                return action.success 
                    ? new vscode.ThemeIcon('check') 
                    : new vscode.ThemeIcon('error');
            case 'note':
                return new vscode.ThemeIcon('pencil');
            default:
                return new vscode.ThemeIcon('circle-outline');
        }
    }
    
    // Start a new recording session
    async startSession(): Promise<void> {
        // Use an InputBox with multiline support for the session description
        const sessionDescription = await vscode.window.showInputBox({
            prompt: 'Describe what you are working on',
            placeHolder: 'Enter a description of the task or project you are working on...',
            ignoreFocusOut: true,
            // Make the input box taller
            validateInput: (text) => {
                if (!text || text.trim().length === 0) {
                    return 'Please enter a description';
                }
                return null;
            }
        });
        
        if (sessionDescription) {
            // Extract first two words as session name
            // SESSIONNAMEHERE - Modify this logic to change how the session name is generated
            const words = sessionDescription.trim().split(/\s+/);
            const sessionName = words.slice(0, 2).join(' ');
            
            const sessionId = `session-${Date.now()}`;
            const newSession: SessionData = {
                id: sessionId,
                name: sessionName,
                description: sessionDescription,
                startTime: new Date().toISOString(),
                actions: [],
                notes: sessionDescription // Save the full description as notes
            };
            
            this.sessions.set(sessionId, newSession);
            
            // Create a tree item for this session
            const sessionItem = new SessionItem(
                sessionId,
                sessionName,
                vscode.TreeItemCollapsibleState.Expanded
            );
            sessionItem.description = new Date(newSession.startTime).toLocaleString();
            sessionItem.contextValue = 'session';
            sessionItem.tooltip = sessionDescription; // Show full description as tooltip
            
            this.sessionItems.set(sessionId, sessionItem);
            this.currentSession = sessionId;
            
            // Save the session to its own file
            this.saveSession(sessionId);
            
            // Start terminal tracking if we have a terminal monitor
            if (this.terminalMonitor) {
                this.terminalMonitor.updateTrackingState(true);
            }
            
            // Refresh the tree view
            this.refresh();
            
            vscode.window.showInformationMessage(`Recording session "${sessionName}" started with description: "${sessionDescription}". Terminal commands will be tracked automatically.`);
        }
    }
    
    // Add action to current session
    async addAction(type: 'command' | 'consequence' | 'note', content: string, success?: boolean): Promise<void> {
        if (!this.currentSession) {
            const startNew = await vscode.window.showInformationMessage(
                'No active recording session. Start a new one?',
                'Yes',
                'No'
            );
            
            if (startNew === 'Yes') {
                await this.startSession();
                if (!this.currentSession) {
                    return; // User cancelled session creation
                }
            } else {
                return;
            }
        }
        
        const session = this.sessions.get(this.currentSession);
        if (session) {
            const action: ActionData = {
                type,
                content,
                timestamp: new Date().toISOString(),
                success
            };
            
            session.actions.push(action);
            
            // Save the session to its file
            this.saveSession(this.currentSession);
            
            // Refresh the tree view
            this.refresh();
        }
    }
    
    // Add a command action
    async addCommandAction(): Promise<void> {
        const command = await vscode.window.showInputBox({
            placeHolder: 'Enter the command you executed',
            prompt: 'Record a command'
        });
        
        if (command) {
            await this.addAction('command', command);
        }
    }
    
    // Add a consequence action
    async addConsequenceAction(): Promise<void> {
        const result = await vscode.window.showQuickPick(['Success', 'Failure'], {
            placeHolder: 'Was the outcome successful?'
        });
        
        if (result) {
            const content = await vscode.window.showInputBox({
                placeHolder: 'Describe the outcome/consequence',
                prompt: `Record ${result} outcome`
            });
            
            if (content) {
                await this.addAction('consequence', content, result === 'Success');
            }
        }
    }
    
    // Add a note to the session
    async addNoteAction(): Promise<void> {
        const note = await vscode.window.showInputBox({
            placeHolder: 'Enter your note',
            prompt: 'Add a note to the session'
        });
        
        if (note) {
            await this.addAction('note', note);
        }
    }
    
    // Save session to its own file
    private saveSession(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (session) {
            const filePath = path.join(this.sessionsStoragePath, `${sessionId}.json`);
            try {
                fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to save session: ${error}`);
            }
        }
    }
    
    // Load all sessions from the sessions directory
    private loadSessions(): void {
        try {
            if (!fs.existsSync(this.sessionsStoragePath)) {
                return;
            }
            
            const files = fs.readdirSync(this.sessionsStoragePath);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    try {
                        const filePath = path.join(this.sessionsStoragePath, file);
                        const content = fs.readFileSync(filePath, 'utf8');
                        const session: SessionData = JSON.parse(content);
                        
                        this.sessions.set(session.id, session);
                        
                        const sessionItem = new SessionItem(
                            session.id,
                            session.name,
                            vscode.TreeItemCollapsibleState.Collapsed
                        );
                        sessionItem.description = new Date(session.startTime).toLocaleString();
                        sessionItem.contextValue = 'session';
                        
                        this.sessionItems.set(session.id, sessionItem);
                    } catch (error) {
                        console.error(`Failed to load session file ${file}:`, error);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to load sessions:', error);
        }
    }
    
    // Get the current active session ID
    getCurrentSession(): string | null {
        return this.currentSession;
    }
    
    // View session in standardized JSON format
    async viewSessionJson(sessionId: string): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            vscode.window.showErrorMessage('Session not found');
            return;
        }
        
        // Get the JSON representation
        const jsonContent = this.getSessionCommandsJson(sessionId);
        
        try {
            // Create a file path for JSON view
            const jsonFilePath = path.join(this.sessionsStoragePath, `${sessionId}-view.json`);
            
            // Write the JSON data to the file
            fs.writeFileSync(jsonFilePath, jsonContent);
            
            // Open the JSON view
            const document = await vscode.workspace.openTextDocument(jsonFilePath);
            await vscode.window.showTextDocument(document);
            
            // Apply JSON language mode to get formatting
            vscode.languages.setTextDocumentLanguage(document, 'json');
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to show JSON view: ${error}`);
        }
    }
    
    // Get a simplified JSON representation of the session focusing on commands and their outputs
    getSessionCommandsJson(sessionId: string): string {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return '{}';
        }
        
        // Extract commands and consequences (outputs) and pair them
        const commandOutputPairs: {command: string, output: string, success: boolean, timestamp: string}[] = [];
        
        let lastCommand: {content: string, timestamp: string} | null = null;
        
        for (const action of session.actions) {
            if (action.type === 'command') {
                // If there was a previous command without output, add it with empty output
                if (lastCommand) {
                    commandOutputPairs.push({
                        command: lastCommand.content,
                        output: '',
                        success: true,
                        timestamp: lastCommand.timestamp
                    });
                }
                
                // Store this command
                lastCommand = {
                    content: action.content,
                    timestamp: action.timestamp
                };
            } else if (action.type === 'consequence' && lastCommand) {
                // Pair with the last command
                commandOutputPairs.push({
                    command: lastCommand.content,
                    output: action.content,
                    success: action.success || false,
                    timestamp: action.timestamp
                });
                
                // Reset last command to avoid duplicates
                lastCommand = null;
            }
        }
        
        // For any remaining commands with no output, add them with empty output
        if (lastCommand) {
            commandOutputPairs.push({
                command: lastCommand.content,
                output: '',
                success: true,
                timestamp: lastCommand.timestamp
            });
        }
        
        // Create the final representation
        const jsonData = {
            sessionName: session.name,
            sessionDescription: session.description,
            startTime: session.startTime,
            commands: commandOutputPairs
        };
        
        return JSON.stringify(jsonData, null, 2);
    }
    
    // Set a session as the active session
    setActiveSession(sessionId: string): void {
        if (this.sessions.has(sessionId)) {
            this.currentSession = sessionId;
            
            // Update terminal tracking
            if (this.terminalMonitor) {
                this.terminalMonitor.updateTrackingState(true);
            }
            
            vscode.window.showInformationMessage(`Session "${this.sessions.get(sessionId)?.name}" is now active. Terminal commands will be tracked automatically.`);
        }
    }
    
    // Close the current session
    closeCurrentSession(): void {
        if (this.currentSession) {
            const sessionName = this.sessions.get(this.currentSession)?.name;
            this.currentSession = null;
            
            // Stop terminal tracking
            if (this.terminalMonitor) {
                this.terminalMonitor.updateTrackingState(false);
            }
            
            vscode.window.showInformationMessage(`Session "${sessionName}" was closed. Terminal command tracking stopped.`);
        }
    }

    // Delete a session
    async deleteSession(sessionId: string): Promise<void> {
        if (!this.sessions.has(sessionId)) {
            vscode.window.showErrorMessage('Session not found');
            return;
        }
        
        // Get session name for message
        const sessionName = this.sessions.get(sessionId)?.name;
        
        // Confirm deletion
        const confirmation = await vscode.window.showWarningMessage(
            `Are you sure you want to delete the session "${sessionName}"?`,
            { modal: true },
            'Delete',
            'Cancel'
        );
        
        if (confirmation !== 'Delete') {
            return;
        }
        
        // If this is the current session, close it first
        if (this.currentSession === sessionId) {
            this.closeCurrentSession();
        }
        
        // Delete session from memory
        this.sessions.delete(sessionId);
        this.sessionItems.delete(sessionId);
        
        // Delete session file
        const filePath = path.join(this.sessionsStoragePath, `${sessionId}.json`);
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            
            // Also delete any view files
            const viewFilePath = path.join(this.sessionsStoragePath, `${sessionId}-view.json`);
            if (fs.existsSync(viewFilePath)) {
                fs.unlinkSync(viewFilePath);
            }
            
            vscode.window.showInformationMessage(`Session "${sessionName}" deleted.`);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to delete session file: ${error}`);
        }
        
        // Refresh the tree view
        this.refresh();
    }
    
    // Delete an action from a session
    async deleteAction(sessionId: string, actionIndex: number): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            vscode.window.showErrorMessage('Session not found');
            return;
        }
        
        if (actionIndex < 0 || actionIndex >= session.actions.length) {
            vscode.window.showErrorMessage('Action not found');
            return;
        }
        
        // Get action type for message
        const actionType = session.actions[actionIndex].type;
        const actionContent = session.actions[actionIndex].content.substring(0, 20) + 
                            (session.actions[actionIndex].content.length > 20 ? '...' : '');
        
        // Confirm deletion
        const confirmation = await vscode.window.showWarningMessage(
            `Are you sure you want to delete this ${actionType}: "${actionContent}"?`,
            { modal: true },
            'Delete',
            'Cancel'
        );
        
        if (confirmation !== 'Delete') {
            return;
        }
        
        // Remove the action
        session.actions.splice(actionIndex, 1);
        
        // Save the session
        this.saveSession(sessionId);
        
        // Refresh the tree view
        this.refresh();
        
        vscode.window.showInformationMessage(`${actionType} deleted.`);
    }
    
    // Extract action index from item ID
    getActionIndexFromItemId(itemId: string): { sessionId: string, actionIndex: number } | null {
        const match = itemId.match(/^(session-\d+)-action-(\d+)$/);
        if (match) {
            return {
                sessionId: match[1],
                actionIndex: parseInt(match[2], 10)
            };
        }
        return null;
    }
}


// Session item for the tree view
export class SessionItem extends vscode.TreeItem {
    constructor(
        public readonly id: string,
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
        
        // Set context value for command/session items to enable right-click menus
        if (this.id.includes('-action-')) {
            // This is an action item
            this.contextValue = this.id.includes('-action-') ? 
                this.id.split('-action-')[1].split('-')[0] : 'action';
        } else if (this.id.startsWith('session-')) {
            // This is a session item
            this.contextValue = 'session';
            
            // Add JSON view command when clicking on the session
            this.command = {
                title: "View JSON",
                command: "caveatbot.viewSessionJson",
                arguments: [this]
            };
        }
    }
}