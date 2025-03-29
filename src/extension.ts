import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// Recording session data structures
interface SessionData {
    id: string;
    name: string;
    startTime: string;
    actions: ActionData[];
    notes: string;
}

interface ActionData {
    type: 'command' | 'consequence' | 'note';
    content: string;
    timestamp: string;
    success?: boolean;
    output?: string;
}

// Terminal data structure
interface TerminalCommand {
    command: string;
    terminalId: string;
    timestamp: string;
}

// Terminal Monitor class to automatically track terminal commands
class TerminalMonitor {
    private terminals: Map<string, vscode.Terminal> = new Map();
    private terminalStartListener: vscode.Disposable | undefined;
    private terminalEndListener: vscode.Disposable | undefined;
    private isTracking: boolean = false;
    private outputBuffer: Map<string, string> = new Map();
    private pendingCommands: Map<string, {command: string, timestamp: string}> = new Map();
    
    constructor(private sessionProvider: SessionTreeProvider) { }
    
    private getTerminalId(terminal: vscode.Terminal): string {
        return `terminal-${terminal.processId || Math.random().toString(36).substring(2, 15)}`;
    }
    
    // Start tracking terminal commands
    startTracking(): void {
        this.isTracking = true;
        
        // Setup shell integration listeners
        this.setupShellIntegration();
        
        // Create a terminal capture button if needed
        this.createTerminalCaptureButton();
        
        vscode.window.showInformationMessage('Terminal command tracking started.');
    }
    
    // Stop tracking terminal commands
    stopTracking(): void {
        this.isTracking = false;
        
        // Dispose terminal data listeners
        this.disposeListeners();
        
        vscode.window.showInformationMessage('Terminal command tracking stopped.');
    }
    
    private disposeListeners(): void {
        if (this.terminalStartListener) {
            this.terminalStartListener.dispose();
            this.terminalStartListener = undefined;
        }
        
        if (this.terminalEndListener) {
            this.terminalEndListener.dispose();
            this.terminalEndListener = undefined;
        }
    }
    
    // Setup shell integration to track terminal commands
    private setupShellIntegration(): void {
        // Clean up any existing listeners
        this.disposeListeners();
        
        // Only set up if tracking is enabled
        if (!this.isTracking) {
            return;
        }
        
        try {
            // Set up command start listener if available
            if ('onDidStartTerminalShellExecution' in vscode.window) {
                this.terminalStartListener = vscode.window.onDidStartTerminalShellExecution((event) => {
                    if (this.isTracking && this.sessionProvider.getCurrentSession()) {
                        // Track the command start
                        const terminalId = this.getTerminalId(event.terminal);
                        const command = event.execution.commandLine;
						const cmdVal = event.execution.commandLine.value;
                        const timestamp = new Date().toISOString();
                        
                        console.log(`Command started: ${command} (${terminalId})`);
                        
                        // Store as pending until we get the result
                        this.pendingCommands.set(terminalId, {
                            command: cmdVal,
                            timestamp
                        });
                    }
                });
                
                console.log('Terminal shell integration start listener registered');
            }
            
            // Set up command end listener if available
            if ('onDidEndTerminalShellExecution' in vscode.window) {
                this.terminalEndListener = vscode.window.onDidEndTerminalShellExecution(async (event) => {
                    if (this.isTracking && this.sessionProvider.getCurrentSession()) {
                        // Get terminal ID
						// DO NOT use event.execution.terminal this doesn't work use event.terminal only
                        const terminalId = this.getTerminalId(event.terminal);
                        
                        // Get the command info
                        const pendingCommand = this.pendingCommands.get(terminalId);
                        if (!pendingCommand) {
                            return;
                        }
                        
                        // Get output using clipboard if possible
                        let output = "";
                        try {
                            output = await this.captureTerminalOutput(event.terminal);
                        } catch (error) {
                            console.error('Failed to capture terminal output:', error);
                        }
                        
                        // Add the command to our session
                        this.sessionProvider.addAction('command', pendingCommand.command);
                        
                        // Add the output as a consequence
                        const success = event.exitCode === 0;
                        if (output) {
                            const truncatedOutput = output.length > 500 ? output.substring(0, 500) + '...' : output;
                            this.sessionProvider.addAction('consequence', 
                                `Exit code: ${event.exitCode}\n${truncatedOutput}`, 
                                success);
                        }
                        
                        // Remove from pending
                        this.pendingCommands.delete(terminalId);
                    }
                });
                
                console.log('Terminal shell integration end listener registered');
            }
            
        } catch (error) {
            console.error('Failed to register shell integration listeners:', error);
        }
    }
    
    // Try to capture terminal output via clipboard
    private async captureTerminalOutput(terminal: vscode.Terminal): Promise<string> {
        try {
            // Store original clipboard content
            const originalClipboard = await vscode.env.clipboard.readText();
            
            // Select all terminal content and copy - this approach might be limited by VSCode API
            terminal.show();
            
            // Use keyboard shortcuts to simulate Ctrl+A and Ctrl+C
            // Note: This approach is not reliable across all platforms and terminal types
            await vscode.commands.executeCommand('workbench.action.terminal.selectAll');
            await new Promise(resolve => setTimeout(resolve, 200));
            await vscode.commands.executeCommand('workbench.action.terminal.copySelection');
            await new Promise(resolve => setTimeout(resolve, 200));
            
            // Get clipboard content
            const output = await vscode.env.clipboard.readText();
            
            // Restore original clipboard
            vscode.env.clipboard.writeText(originalClipboard);
            
            return output;
        } catch (error) {
            console.error('Error capturing terminal output:', error);
            return "";
        }
    }
    
    // Create a button near the terminal for capturing output
    private createTerminalCaptureButton(): void {
        // Register the command for the button
        vscode.commands.executeCommand('setContext', 'caveatbot.terminalTracking', true);
    }
    
    // Allow manual recording of commands when automatic detection fails
    async manualRecordCommand(): Promise<void> {
        const command = await vscode.window.showInputBox({
            placeHolder: 'Enter the command you executed',
            prompt: 'Record Terminal Command'
        });
        
        if (command && command.trim()) {
            await this.sessionProvider.addAction('command', command);
            
            // Try to capture current terminal output
            try {
                const output = await this.captureCurrentTerminalOutput();
                if (output) {
                    await this.sessionProvider.addAction('consequence', output, true);
                }
            } catch (error) {
                console.error('Failed to capture terminal output:', error);
            }
        }
    }
    
    // Capture output from the current active terminal
    private async captureCurrentTerminalOutput(): Promise<string> {
        if (!vscode.window.activeTerminal) {
            return "";
        }
        
        return await this.captureTerminalOutput(vscode.window.activeTerminal);
    }
    
    // Capture output from the current terminal and add it to the session
    async captureTerminalOutputCommand(): Promise<void> {
        if (!vscode.window.activeTerminal) {
            vscode.window.showErrorMessage('No active terminal found.');
            return;
        }
        
        // Capture output
        const output = await this.captureTerminalOutput(vscode.window.activeTerminal);
        
        if (output) {
            // Add to session
            await this.sessionProvider.addAction('consequence', output, true);
            vscode.window.showInformationMessage('Terminal output captured.');
        } else {
            vscode.window.showErrorMessage('Unable to capture terminal output.');
        }
    }
    
    // Check if we are currently tracking commands
    isTrackingEnabled(): boolean {
        return this.isTracking;
    }
    
    // Set terminal tracking to match session state
    updateTrackingState(hasActiveSession: boolean): void {
        if (hasActiveSession && !this.isTracking) {
            this.startTracking();
        } else if (!hasActiveSession && this.isTracking) {
            this.stopTracking();
        }
    }
    
    // Dispose of resources
    dispose(): void {
        this.disposeListeners();
    }
}

// Session Tree Provider class
class SessionTreeProvider implements vscode.TreeDataProvider<SessionItem> {
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
        const sessionName = await vscode.window.showInputBox({
            placeHolder: 'Enter a name for this recording session',
            prompt: 'New Recording Session'
        });
        
        if (sessionName) {
            const sessionId = `session-${Date.now()}`;
            const newSession: SessionData = {
                id: sessionId,
                name: sessionName,
                startTime: new Date().toISOString(),
                actions: [],
                notes: ''
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
            
            vscode.window.showInformationMessage(`Recording session "${sessionName}" started. Terminal commands will be tracked automatically.`);
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
    
    // Export session to file
    async exportSession(sessionId: string): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            vscode.window.showErrorMessage('Session not found');
            return;
        }
        
        const options: vscode.SaveDialogOptions = {
            defaultUri: vscode.Uri.file(path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', `${session.name.replace(/\s+/g, '-')}.json`)),
            filters: {
                'JSON files': ['json']
            }
        };
        
        const fileUri = await vscode.window.showSaveDialog(options);
        if (fileUri) {
            try {
                fs.writeFileSync(fileUri.fsPath, JSON.stringify(session, null, 2));
                vscode.window.showInformationMessage(`Session exported to ${fileUri.fsPath}`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to export session: ${error}`);
            }
        }
    }
    
    // View session file in editor
    async viewSessionFile(sessionId: string): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            vscode.window.showErrorMessage('Session not found');
            return;
        }
        
        const filePath = path.join(this.sessionsStoragePath, `${sessionId}.json`);
        try {
            // Check if file exists, create if not
            if (!fs.existsSync(filePath)) {
                this.saveSession(sessionId);
            }
            
            // Open the file in a new editor
            const document = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(document);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open session file: ${error}`);
        }
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
}

// Session item for the tree view
class SessionItem extends vscode.TreeItem {
    constructor(
        public readonly id: string,
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "caveatbot" is now active!');
    
    // Create our session tree provider
    const sessionTreeProvider = new SessionTreeProvider(context);
    
    // Create terminal monitor
    const terminalMonitor = new TerminalMonitor(sessionTreeProvider);
    
    // Connect terminal monitor to session provider
    sessionTreeProvider.setTerminalMonitor(terminalMonitor);
    
    // Register the tree view
    const sessionTreeView = vscode.window.createTreeView('caveatbotSessionExplorer', {
        treeDataProvider: sessionTreeProvider
    });
    
    // Register session recording commands
    const startRecordingDisposable = vscode.commands.registerCommand('caveatbot.startRecording', async () => {
        await sessionTreeProvider.startSession();
    });
    
    // Register terminal output capture command
    const captureTerminalOutputDisposable = vscode.commands.registerCommand('caveatbot.captureTerminalOutput', async () => {
        await terminalMonitor.captureTerminalOutputCommand();
    });
    
    // Register terminal command tracking commands
    const toggleTerminalTrackingDisposable = vscode.commands.registerCommand('caveatbot.toggleTerminalTracking', () => {
        if (terminalMonitor.isTrackingEnabled()) {
            terminalMonitor.stopTracking();
            vscode.commands.executeCommand('caveatbot.updateTerminalStatusBar', false);
            vscode.commands.executeCommand('setContext', 'caveatbot.terminalTracking', false);
        } else {
            terminalMonitor.startTracking();
            vscode.commands.executeCommand('caveatbot.updateTerminalStatusBar', true);
            vscode.commands.executeCommand('setContext', 'caveatbot.terminalTracking', true);
        }
    });
    
    // Specific command to start capture
    const startCaptureDisposable = vscode.commands.registerCommand('caveatbot.startCapture', async () => {
        if (!sessionTreeProvider.getCurrentSession()) {
            // If no session is active, start one
            await sessionTreeProvider.startSession();
        }
        
        // Start terminal tracking
        terminalMonitor.startTracking();
        vscode.commands.executeCommand('caveatbot.updateTerminalStatusBar', true);
        vscode.commands.executeCommand('setContext', 'caveatbot.terminalTracking', true);
    });
    
    // Specific command to stop capture
    const stopCaptureDisposable = vscode.commands.registerCommand('caveatbot.stopCapture', () => {
        terminalMonitor.stopTracking();
        vscode.commands.executeCommand('caveatbot.updateTerminalStatusBar', false);
        vscode.commands.executeCommand('setContext', 'caveatbot.terminalTracking', false);
    });
    
    const manualRecordCommandDisposable = vscode.commands.registerCommand('caveatbot.manualRecordCommand', async () => {
        await terminalMonitor.manualRecordCommand();
    });
    
    const addCommandDisposable = vscode.commands.registerCommand('caveatbot.addCommand', async () => {
        await sessionTreeProvider.addCommandAction();
    });
    
    const addConsequenceDisposable = vscode.commands.registerCommand('caveatbot.addConsequence', async () => {
        await sessionTreeProvider.addConsequenceAction();
    });
    
    const addNoteDisposable = vscode.commands.registerCommand('caveatbot.addNote', async () => {
        await sessionTreeProvider.addNoteAction();
    });
    
    const exportSessionDisposable = vscode.commands.registerCommand('caveatbot.exportSession', async (item: SessionItem) => {
        if (item.contextValue === 'session') {
            await sessionTreeProvider.exportSession(item.id);
        }
    });
    
    const viewSessionDisposable = vscode.commands.registerCommand('caveatbot.viewSession', async (item: SessionItem) => {
        if (item.contextValue === 'session') {
            await sessionTreeProvider.viewSessionFile(item.id);
        }
    });
    
    const setActiveSessionDisposable = vscode.commands.registerCommand('caveatbot.setActiveSession', (item: SessionItem) => {
        if (item.contextValue === 'session') {
            sessionTreeProvider.setActiveSession(item.id);
        }
    });
    
    const closeSessionDisposable = vscode.commands.registerCommand('caveatbot.closeSession', () => {
        sessionTreeProvider.closeCurrentSession();
    });
    
    // Create a status bar item
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'caveatbot.startRecording';
    statusBarItem.text = '$(record) CaveatBot';
    statusBarItem.tooltip = 'Start a new recording session';
    statusBarItem.show();
    
    // Create a status bar item for terminal monitoring status
    const terminalStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    terminalStatusBarItem.command = 'caveatbot.toggleTerminalTracking';
    terminalStatusBarItem.text = '$(terminal) Terminal Tracking: OFF';
    terminalStatusBarItem.tooltip = 'Toggle terminal command tracking';
    terminalStatusBarItem.show();
    
    // Update status bar when tracking state changes
    function updateTerminalStatusBar(isTracking: boolean): void {
        terminalStatusBarItem.text = isTracking 
            ? '$(terminal) Terminal Tracking: ON'
            : '$(terminal) Terminal Tracking: OFF';
    }
    
    // Event handler to update status bar
    context.subscriptions.push(
        vscode.commands.registerCommand('caveatbot.updateTerminalStatusBar', (isTracking: boolean) => {
            updateTerminalStatusBar(isTracking);
        })
    );
    
    // Add our disposables to the context subscriptions
    context.subscriptions.push(
        startRecordingDisposable,
        toggleTerminalTrackingDisposable,
        startCaptureDisposable,
        stopCaptureDisposable,
        manualRecordCommandDisposable,
        addCommandDisposable,
        addConsequenceDisposable,
        addNoteDisposable,
        exportSessionDisposable,
        viewSessionDisposable,
        setActiveSessionDisposable,
        closeSessionDisposable,
        captureTerminalOutputDisposable,
        statusBarItem,
        terminalStatusBarItem,
        sessionTreeView,
        {
            dispose: () => {
                terminalMonitor.dispose();
            }
        }
    );
}

// This method is called when your extension is deactivated
export function deactivate() {}
