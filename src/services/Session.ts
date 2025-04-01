import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { diffLines } from 'diff';
import { SessionData, ActionData, TerminalCommand } from '../models/interfaces';
import { TerminalMonitor } from './TerminalMonitor';
import { FileWatcherService } from './fileWatcherService';
import { ActionManager } from './actionManager';
import {generateNameFromDescription, beginWorkflow} from './dataIngestionService';

// Session Tree Provider class
export class SessionTreeProvider implements vscode.TreeDataProvider<SessionItem>, vscode.TreeDragAndDropController<SessionItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<SessionItem | undefined | null> = new vscode.EventEmitter<SessionItem | undefined | null>();
    readonly onDidChangeTreeData: vscode.Event<SessionItem | undefined | null> = this._onDidChangeTreeData.event;
    
    // Add new dropMimeTypes property for drag and drop
    dropMimeTypes = ['application/vnd.code.tree.caveatbot'];
    dragMimeTypes = ['application/vnd.code.tree.caveatbot'];
    
    private sessions: Map<string, SessionData> = new Map();
    private sessionItems: Map<string, SessionItem> = new Map();
    private currentSession: string | null = null;
    private isSessionActive: boolean = false; // New state tracking variable
    private sessionsStoragePath: string;
    private terminalMonitor: TerminalMonitor | null = null;
    private fileWatcherService: FileWatcherService | null = null;
    private actionManager: ActionManager;
    
    constructor(private context: vscode.ExtensionContext) {
        this.sessionsStoragePath = path.join(context.globalStorageUri.fsPath, 'recording-sessions');
        console.log(`Sessions will be stored in: ${this.sessionsStoragePath}`);
        this.actionManager = new ActionManager();
        
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
    
    initializeFileWatcherService(): void {
        this.fileWatcherService = new FileWatcherService(this.actionManager, this);
        this.fileWatcherService.start();
    }
    
    getFileWatcherService(): FileWatcherService | null {
        return this.fileWatcherService;
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
                        const item = new ActionItem(
                            `${sessionId}-action-${index}`,
                            action.command.substring(0, 50) + (action.command.length > 50 ? '...' : ''),
                            vscode.TreeItemCollapsibleState.None,
                            action.type
                        );
                        item.description = new Date(action.timestamp).toLocaleTimeString();
                        item.contextValue = `action-${action.type}`;
                        // Add draggable property to enable drag and drop
                        item.draggable = true;
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
            const sessionName = await generateNameFromDescription(sessionDescription);
            
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
            sessionItem.draggable = false; // Enable drag and drop for this session item
            
            this.sessionItems.set(sessionId, sessionItem);
            this.currentSession = sessionId;
            this.isSessionActive = true; // Set active state // Enable drag and drop for this session item
            
            // Save the session to its own file
            this.saveSession(sessionId);
            
            // Start terminal tracking if we have a terminal monitor
            if (this.terminalMonitor) {
                this.terminalMonitor.updateTrackingState(true);
            }
            
            // Start file tracking if we have a file watcher
            if (this.fileWatcherService) {
                this.fileWatcherService.startTracking();
            }
            
            // Refresh the tree view
            this.refresh();
            
            vscode.window.showInformationMessage(`Recording session "${sessionName}" started with description: "${sessionDescription}". Terminal commands will be tracked automatically.`);
        }
    }
    
    // Add action to current session
    async addAction(type: 'command' | 'consequence' | 'note' | 'codeChange', content: string, success?: boolean, codeChange?: string, output?: string): Promise<void> {
        if (!this.currentSession) {
            vscode.window.showInformationMessage('No active recording session.');
            return;
        }
    
        const session = this.sessions.get(this.currentSession);
        if (session) {
            const action: ActionData = {
                type: type,
                command: type === 'codeChange' ? '' : content,
                code_change: codeChange || '',
                output: output || '',
                success: success !== undefined ? success : true,
                timestamp: new Date().toISOString()
            };
    
            if (session.actions) {
                session.actions.push(action);
            } else {
                session.actions = [action];
            }
    
            // Save the session to its file
            this.saveSession(this.currentSession);
    
            // Refresh the tree view
            this.refresh();
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
                await this.addAction('consequence', content, result === 'Success', undefined, content);
            }
        }
    }
    
    // Add a note to the session
    public async addNoteAction(noteText?: string, additionalData?: any): Promise<void> {
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
        
        if (!noteText) {
            noteText = await vscode.window.showInputBox({
                prompt: 'Enter a note for this session',
                placeHolder: 'e.g., "Found a bug in the authentication module"'
            });
        }
        
        if (noteText) {
            let codeChange = undefined;
            if (additionalData && additionalData.codeChange) {
                codeChange = JSON.stringify(additionalData.codeChange);
                await this.addAction('codeChange', noteText, undefined, codeChange);
            } else {
                await this.addAction('note', noteText);
            }
        }
    }
    
    /**
     * Adds a screenshot as an action to the current session
     * @param screenshotPath Path to the screenshot file
     */
    public async addScreenshotAction(screenshotPath: string): Promise<void> {
        if (!this.isActiveSession()) {
            vscode.window.showWarningMessage('No active session to add screenshot to');
            return;
        }
        
        try {
            // Ask user if they want to add the screenshot to the session
            const result = await vscode.window.showInformationMessage(
                `New screenshot detected: ${path.basename(screenshotPath)}`, 
                'Add to Session', 
                'Ignore'
            );
            
            // Only proceed if user clicked "Add to Session"
            if (result !== 'Add to Session') {
                return;
            }
            
            // Get the current session
            const session = this.sessions.get(this.currentSession!);
            if (!session) {
                vscode.window.showErrorMessage('Session not found');
                return;
            }
            
            // Normalize the path to ensure consistent format
            const normalizedPath = path.normalize(screenshotPath);
            
            // Create a screenshot action - make sure all path properties are set
            const screenshotAction: ActionData = {
                type: 'screenshot',
                timestamp: new Date().toISOString(),
                path: normalizedPath, // Add this for backwards compatibility
                filename: path.basename(normalizedPath),
                description: `Screenshot captured: ${path.basename(normalizedPath)}`,
                command: "",
                code_change: "",
                output: ""
            };
            
            // Add action to session
            session.actions.push(screenshotAction);
            
            // Save updated session
            this.saveSession(this.currentSession!);
            
            // Refresh view
            this.refresh();
            
            vscode.window.showInformationMessage(`Screenshot added to session "${session.name}"`);
            
        } catch (error) {
            console.error('Error adding screenshot action:', error);
            vscode.window.showErrorMessage(`Failed to add screenshot: ${error}`);
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
                        sessionItem.draggable = false;
                        
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
        return this.currentSession ?? null;
    }
    
    // Check if a session is active
    isActiveSession(): boolean {
        return this.isSessionActive;
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
    
        // Use the session's actions directly
        const jsonData = {
            sessionName: session.name,
            sessionDescription: session.description,
            startTime: session.startTime,
            actions: session.actions // Use the actions array from the session
        };
    
        return JSON.stringify(jsonData, null, 2);
    }
    
    // Get the complete session data for data ingestion
    getFullSessionData(sessionId: string): SessionData | null {
        const session = this.sessions.get(sessionId);
        return session || null;
    }

    initiateDataIngest(): void {
        const sessionId = this.getCurrentSession();
        if (sessionId) {
            const sessionData = this.getFullSessionData(sessionId);
            if (sessionData) {
                beginWorkflow(sessionData);
            }
        } else {
            vscode.window.showErrorMessage('No active session to begin workflow with.');
        }

    }
    
    // Set a session as the active session
    setActiveSession(sessionId: string): void {
        if (this.sessions.has(sessionId)) {
            this.currentSession = sessionId;
            this.isSessionActive = true; // Set active state
            
            // Update terminal tracking
            if (this.terminalMonitor) {
                this.terminalMonitor.updateTrackingState(true);
            }
            
            // Update file tracking
            if (this.fileWatcherService) {
                this.fileWatcherService.startTracking();
            }
            
            // Update context to show recording is active
            vscode.commands.executeCommand('setContext', 'caveatbot.isRecording', true);
            
            vscode.window.showInformationMessage(`Session "${this.sessions.get(sessionId)?.name}" is now active. Terminal commands will be tracked automatically.`);
        }
    }
    
    // Close the current session
    closeCurrentSession(): void {
        if (this.currentSession) {
            const sessionName = this.sessions.get(this.currentSession)?.name;
            this.currentSession = null;
            this.isSessionActive = false; // Clear active state
            
            // Stop terminal tracking
            if (this.terminalMonitor) {
                this.terminalMonitor.updateTrackingState(false);
            }
            
            // Stop file tracking
            if (this.fileWatcherService) {
                this.fileWatcherService.updateTrackingState(false);
            }
            
            // Update context to show recording is inactive
            vscode.commands.executeCommand('setContext', 'caveatbot.isRecording', false);
            
            vscode.window.showInformationMessage(`Session "${sessionName}" was closed. Terminal command tracking stopped.`);
            
            // Refresh the tree view to reflect changes
            this.refresh();
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
            // This will set isSessionActive to false
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
        const actionContent = session.actions[actionIndex].command.substring(0, 20) + 
                            (session.actions[actionIndex].command.length > 20 ? '...' : '');
        
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

    // Handle file save event from FileWatcherService
    public handleFileSave(document: vscode.TextDocument, oldContent: string | undefined): void {
        // Skip processing if no active session
        if (!this.isSessionActive || !this.terminalMonitor?.isTrackingEnabled()) {
            return;
        }
        
        const filePath = document.uri.fsPath;
        const newContent = document.getText();
        
        // Skip if we don't have the previous content
        if (oldContent === undefined) {
            return;
        }

        // Generate diff
        const differences = diffLines(oldContent, newContent);
        
        // If there are changes, save them as an action and show dialog
        if (differences.some(part => part.added || part.removed)) {
            const changes = differences
                .filter(part => part.added || part.removed)
                .map(part => ({
                    type: part.added ? 'addition' : 'removal',
                    value: part.value
                }));
                
            const codeChangeAction = {
                type: 'code-change',
                timestamp: new Date().toISOString(),
                file: filePath,
                changes
            };
            
            // Store the action
            this.actionManager.addAction(codeChangeAction);
            
            // Show dialog with first line of diff
            this.showDiffDialog(changes, filePath);
        }
    }
    
    // Show diff dialog and offer to save to session
    private showDiffDialog(changes: Array<{type: string, value: string}>, filePath: string): void {
        // Only proceed if there's an active session
        if (!this.isSessionActive) {
            return;
        }
        
        // Get the first change and its first line
        if (changes.length > 0) {
            // Get filename from path
            const fileName = filePath.split(/[\\/]/).pop() || filePath;
            
            const firstChange = changes[0];
            const firstLine = firstChange.value.split('\n')[0].trim();
            const changeType = firstChange.type === 'addition' ? 'Added' : 'Removed';
            
            // Show information message with the first line of the diff
            vscode.window.showInformationMessage(
                `${fileName}: ${changeType} "${firstLine}"`,
                'Save to Session'
            ).then(selection => {
                // Check again before adding to session (in case session was closed while dialog was open)
                if (selection === 'Save to Session' && this.isSessionActive) {
                    // Create a detailed code change object
                    const codeChangeDetails = {
                        filename: fileName,
                        fullPath: filePath,
                        changes: changes.map(change => ({
                            type: change.type,
                            content: change.value
                        }))
                    };
                    
                    // Add the diff as a note to the current session with the code change details
                    this.addNoteAction(
                        `Changed ${fileName}: ${changeType} "${firstLine}"`,
                        { codeChange: codeChangeDetails }
                    );
                }
            });
        }
    }

    // Implement drag and drop functions
    
    // Handle drag events
    public handleDrag(source: readonly SessionItem[], dataTransfer: vscode.DataTransfer): void {
        // Only proceed if we have items to drag
        if (!source.length) {
            return;
        }
        
        // Filter out only action items, sessions cannot be dragged
        const actionItems = source.filter(item => item instanceof ActionItem);
        if (!actionItems.length) {
            return;
        }
        
        // Create payload with action IDs
        const payload = actionItems.map(item => item.id);
        dataTransfer.set('application/vnd.code.tree.caveatbot', new vscode.DataTransferItem(payload));
    }
    
    // Handle drop events
    public async handleDrop(target: SessionItem | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
        // Get the dragged action IDs
        const transferItem = dataTransfer.get('application/vnd.code.tree.caveatbot');
        if (!transferItem) {
            return;
        }
        
        const draggedActionIds: string[] = transferItem.value;
        if (!draggedActionIds.length) {
            return;
        }
        
        // Determine target session and position
        let targetSessionId: string;
        let targetIndex: number = -1;
        
        if (target) {
            if (target instanceof ActionItem) {
                // Dropped on an action - extract session ID and index
                const actionInfo = this.getActionIndexFromItemId(target.id);
                if (actionInfo) {
                    targetSessionId = actionInfo.sessionId;
                    targetIndex = actionInfo.actionIndex;
                } else {
                    return;
                }
            } else {
                // Dropped on a session - add at the end
                targetSessionId = target.id;
                
                // Get the session actions length to append at the end
                const targetSession = this.sessions.get(targetSessionId);
                if (targetSession) {
                    targetIndex = targetSession.actions.length;
                } else {
                    return;
                }
            }
        } else {
            // Dropped on empty space - ignore
            return;
        }
        
        // Process each dragged action
        for (const actionId of draggedActionIds) {
            const actionInfo = this.getActionIndexFromItemId(actionId);
            if (actionInfo) {
                await this.moveAction(
                    actionInfo.sessionId, 
                    actionInfo.actionIndex, 
                    targetSessionId, 
                    targetIndex
                );
                
                // If we're moving to the same session and the target index is after the source index,
                // we need to decrement the target index since we've removed an item
                if (actionInfo.sessionId === targetSessionId && targetIndex > actionInfo.actionIndex) {
                    targetIndex--;
                }
                
                // Increment target index for the next action to be placed after this one
                targetIndex++;
            }
        }
        
        // Refresh the tree view
        this.refresh();
    }
    
    // Helper method to move an action from one session to another or within the same session
    private async moveAction(
        sourceSessionId: string, 
        sourceActionIndex: number, 
        targetSessionId: string, 
        targetActionIndex: number
    ): Promise<void> {
        // Get source and target sessions
        const sourceSession = this.sessions.get(sourceSessionId);
        const targetSession = this.sessions.get(targetSessionId);
        
        if (!sourceSession || !targetSession) {
            vscode.window.showErrorMessage('Session not found');
            return;
        }
        
        // Validate source action index
        if (sourceActionIndex < 0 || sourceActionIndex >= sourceSession.actions.length) {
            vscode.window.showErrorMessage('Source action not found');
            return;
        }
        
        // Validate target action index
        if (targetActionIndex < 0 || targetActionIndex > targetSession.actions.length) {
            vscode.window.showErrorMessage('Invalid target position');
            return;
        }
        
        // Remove the action from the source session
        const [action] = sourceSession.actions.splice(sourceActionIndex, 1);
        
        // Insert the action at the target position
        targetSession.actions.splice(targetActionIndex, 0, action);
        
        // Save both sessions
        this.saveSession(sourceSessionId);
        if (sourceSessionId !== targetSessionId) {
            this.saveSession(targetSessionId);
        }
        
        vscode.window.showInformationMessage('Action moved successfully');
    }
    
    // Add a new method to reorder actions within a session
    public async reorderActions(sessionId: string, oldIndex: number, newIndex: number): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            vscode.window.showErrorMessage('Session not found');
            return;
        }
        
        // Validate indices
        if (oldIndex < 0 || oldIndex >= session.actions.length || 
            newIndex < 0 || newIndex >= session.actions.length) {
            vscode.window.showErrorMessage('Invalid action index');
            return;
        }
        
        // Remove the action from its old position
        const [action] = session.actions.splice(oldIndex, 1);
        
        // Insert at new position
        session.actions.splice(newIndex, 0, action);
        
        // Save the session
        this.saveSession(sessionId);
        
        // Refresh the tree view
        this.refresh();
    }
    
    dispose(): void {
        if (this.fileWatcherService) {
            this.fileWatcherService.stop();
        }
    }
}


// Session item for the tree view
export class SessionItem extends vscode.TreeItem {
    // Make draggable property available for all items
    draggable?: boolean;
    
    constructor(
        public readonly id: string,
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
        
        // Set context value for command/session items to enable right-click menus
        if (this.id.includes('-action-')) {
            // This is an action item - don't set contextValue here, it will be set in getChildren
            // The contextValue will be set in getChildren to ensure consistency
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



export class ActionItem extends vscode.TreeItem {
    actionTypeIcon: any;
    iconPath!: vscode.ThemeIcon | string | { light: string; dark: string };
    // Add draggable property
    draggable?: boolean;
    
    constructor(
        public readonly id: string,
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState, 
        public readonly actionType: string
    ) {
        super(label, collapsibleState);
        
        // Set context value for action items to enable right-click menus
        this.contextValue = 'action';
    
        // Use the static method ThemeIcon.from() instead of constructor
        this.iconPath = this.getIconForActionType(this.actionType);
    }

    private getIconForActionType(actionType: string): vscode.ThemeIcon {
        switch (actionType) {
            case 'command':
                return new vscode.ThemeIcon('terminal');
            case 'note':
                return new vscode.ThemeIcon('pencil');
            case 'screenshot':
                return new vscode.ThemeIcon('device-camera');
            case 'consequence':
                return new vscode.ThemeIcon('check');
            case 'codeChange':
                return new vscode.ThemeIcon('edit');
            default:
                return new vscode.ThemeIcon('circle-outline');
        }
    }
}
