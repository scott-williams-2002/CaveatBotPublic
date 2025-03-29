import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// Terminal command data structure
interface CommandData {
    command: string;
    output: string;
    timestamp: string;
    workspaceFolder?: string;
    exitCode?: number;
}

// Command storage provider class
class CommandTreeProvider implements vscode.TreeDataProvider<CommandItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<CommandItem | undefined | null> = new vscode.EventEmitter<CommandItem | undefined | null>();
    readonly onDidChangeTreeData: vscode.Event<CommandItem | undefined | null> = this._onDidChangeTreeData.event;
    
    private commands: CommandItem[] = [];
    private terminalCommands: CommandData[] = [];
    private isTracking = false;
    private jsonStoragePath: string;
    
    constructor(private context: vscode.ExtensionContext) {
        this.jsonStoragePath = path.join(context.globalStorageUri.fsPath, 'terminal-commands.json');
        
        // Ensure the directory exists
        if (!fs.existsSync(path.dirname(this.jsonStoragePath))) {
            fs.mkdirSync(path.dirname(this.jsonStoragePath), { recursive: true });
        }
        
        // Initialize with empty JSON file if it doesn't exist
        if (!fs.existsSync(this.jsonStoragePath)) {
            this.saveCommandsToFile(this.jsonStoragePath);
        }
    }
    
    refresh(): void {
        this._onDidChangeTreeData.fire(null);
    }
    
    getTreeItem(element: CommandItem): vscode.TreeItem {
        return element;
    }
    
    getChildren(element?: CommandItem): Thenable<CommandItem[]> {
        if (element) {
            return Promise.resolve([]);
        } else {
            return Promise.resolve(this.commands);
        }
    }
    
    // Add a terminal command to our storage
    addTerminalCommand(data: CommandData): void {
        this.terminalCommands.push(data);
        
        // Create a tree item for this command
        const cmdItem = new CommandItem(
            data.command,
            `${data.command} (${new Date(data.timestamp).toLocaleTimeString()})`,
            vscode.TreeItemCollapsibleState.None
        );
        cmdItem.tooltip = `Command: ${data.command}\nOutput: ${data.output.substring(0, 100)}${data.output.length > 100 ? '...' : ''}`;
        cmdItem.description = new Date(data.timestamp).toLocaleTimeString();
        
        this.commands.push(cmdItem);
        
        // Store in global state for persistence
        this.context.globalState.update('terminalCommands', this.terminalCommands);
        
        // If tracking is enabled, immediately save to the JSON file
        if (this.isTracking) {
            this.saveCommandsToFile(this.jsonStoragePath);
        }
        
        // Update the view
        this.refresh();
    }
    
    // Save terminal commands to a JSON file
    saveCommandsToFile(filePath: string): Thenable<void> {
        return new Promise((resolve, reject) => {
            try {
                const jsonData = JSON.stringify(this.terminalCommands, null, 2);
                fs.writeFileSync(filePath, jsonData);
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    }
    
    // Load previously stored commands
    loadStoredCommands(): void {
        this.terminalCommands = this.context.globalState.get('terminalCommands', []);
        this.commands = this.terminalCommands.map(data => {
            const cmdItem = new CommandItem(
                data.command,
                `${data.command} (${new Date(data.timestamp).toLocaleTimeString()})`,
                vscode.TreeItemCollapsibleState.None
            );
            cmdItem.tooltip = `Command: ${data.command}\nOutput: ${data.output.substring(0, 100)}${data.output.length > 100 ? '...' : ''}`;
            cmdItem.description = new Date(data.timestamp).toLocaleTimeString();
            return cmdItem;
        });
        this.refresh();
    }
    
    // Clear all stored commands
    clearCommands(): void {
        this.terminalCommands = [];
        this.commands = [];
        this.context.globalState.update('terminalCommands', []);
        this.refresh();
    }
    
    // Toggle command tracking
    toggleTracking(): boolean {
        this.isTracking = !this.isTracking;
        return this.isTracking;
    }
    
    // Get tracking status
    getTrackingStatus(): boolean {
        return this.isTracking;
    }
    
    // Get the path to the JSON storage file
    getJsonStoragePath(): string {
        return this.jsonStoragePath;
    }
}

class CommandItem extends vscode.TreeItem {
    constructor(
        public readonly id: string,
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(label, collapsibleState);
    }
}

// Terminal command tracker
class TerminalTracker {
    private terminals: Map<string, vscode.Terminal> = new Map();
    private outputBuffer: Map<string, string> = new Map();
    private commandBuffer: Map<string, string> = new Map();
    private terminalDataEventDisposables: vscode.Disposable[] = [];
    
    constructor(private provider: CommandTreeProvider) {
        // Set up initial listeners
        this.setupListeners();
    }
    
    private setupListeners(): void {
        // Watch for terminal creation
        vscode.window.onDidOpenTerminal(terminal => {
            // Check if it's not our tracked terminal or a terminal we've already seen
            if (!terminal.name.startsWith('CaveatBot:') && !this.terminals.has(this.getTerminalId(terminal))) {
                this.trackTerminal(terminal);
            }
        });
        
        // Watch for terminal closing
        vscode.window.onDidCloseTerminal(terminal => {
            const terminalId = this.getTerminalId(terminal);
            this.terminals.delete(terminalId);
            this.outputBuffer.delete(terminalId);
            this.commandBuffer.delete(terminalId);
        });
        
        // Attach to any existing terminals
        vscode.window.terminals.forEach(terminal => {
            if (!terminal.name.startsWith('CaveatBot:')) {
                this.trackTerminal(terminal);
            }
        });
    }
    
    // Add method to handle recording a command
    async recordCommand(): Promise<void> {
        const command = await vscode.window.showInputBox({
            placeHolder: 'Enter the command you executed',
            prompt: 'Record a terminal command'
        });
        
        if (command) {
            const output = await vscode.window.showInputBox({
                placeHolder: 'Enter the command output (optional)',
                prompt: 'Command output'
            });
            
            this.provider.addTerminalCommand({
                command,
                output: output || '',
                timestamp: new Date().toISOString(),
                workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
            });
            
            vscode.window.showInformationMessage(`Command "${command}" recorded.`);
        }
    }
    
    private getTerminalId(terminal: vscode.Terminal): string {
        return `terminal-${terminal.processId || Math.random().toString(36).substring(2, 10)}`;
    }
    
    private trackTerminal(terminal: vscode.Terminal): void {
        const terminalId = this.getTerminalId(terminal);
        this.terminals.set(terminalId, terminal);
        this.outputBuffer.set(terminalId, '');
        this.commandBuffer.set(terminalId, '');
        
        // For demonstration purposes only - real terminal output capture would require different approach
        vscode.window.showInformationMessage(`Terminal "${terminal.name}" is now being tracked. Use the "Record Command" button to manually add commands.`);
        
        // Note: VS Code doesn't provide a direct way to capture terminal input/output through the extension API
        // We'll use the manual recording approach instead
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "caveatbot" is now active!');
    
    // Create our command tree provider
    const commandTreeProvider = new CommandTreeProvider(context);
    
    // Create terminal tracker
    const terminalTracker = new TerminalTracker(commandTreeProvider);
    
    // Register the tree view
    const treeView = vscode.window.createTreeView('caveatbotCommandExplorer', {
        treeDataProvider: commandTreeProvider
    });
    
    // Register the save commands button action 
    const saveCommandsDisposable = vscode.commands.registerCommand('caveatbot.saveCommands', async () => {
        const options: vscode.SaveDialogOptions = {
            defaultUri: vscode.Uri.file(path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', 'terminal-commands.json')),
            filters: {
                'JSON files': ['json']
            }
        };
        
        const fileUri = await vscode.window.showSaveDialog(options);
        if (fileUri) {
            try {
                await commandTreeProvider.saveCommandsToFile(fileUri.fsPath);
                vscode.window.showInformationMessage(`Terminal commands saved to ${fileUri.fsPath}`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to save commands: ${error}`);
            }
        }
    });
    
    // Register the clear commands button action
    const clearCommandsDisposable = vscode.commands.registerCommand('caveatbot.clearCommands', async () => {
        const result = await vscode.window.showWarningMessage(
            'Are you sure you want to clear all saved terminal commands?',
            { modal: true },
            'Yes',
            'No'
        );
        
        if (result === 'Yes') {
            commandTreeProvider.clearCommands();
            vscode.window.showInformationMessage('Terminal commands cleared.');
        }
    });
    
    // Register the record command button (properly now)
    const recordCommandDisposable = vscode.commands.registerCommand('caveatbot.recordCommand', async () => {
        await terminalTracker.recordCommand();
    });
    
    // Register the hello world command for demonstration
    const buttonActionDisposable = vscode.commands.registerCommand('caveatbot.buttonAction', () => {
        vscode.window.showInformationMessage('Terminal command tracking is active!');
    });
    
    // Register the toggle tracking button action
    const toggleTrackingDisposable = vscode.commands.registerCommand('caveatbot.toggleTracking', () => {
        const isTracking = commandTreeProvider.toggleTracking();
        const statusMessage = isTracking 
            ? 'Command tracking is now ON. Commands will be automatically saved.'
            : 'Command tracking is now OFF.';
        vscode.window.showInformationMessage(statusMessage);
        
        // Update status bar if we have one
        updateStatusBar(isTracking);
    });
    
    // Register the view JSON button action
    const viewJsonDisposable = vscode.commands.registerCommand('caveatbot.viewJson', async () => {
        const jsonPath = commandTreeProvider.getJsonStoragePath();
        
        try {
            // Check if file exists
            if (!fs.existsSync(jsonPath)) {
                await commandTreeProvider.saveCommandsToFile(jsonPath);
            }
            
            // Open the file in a new editor
            const document = await vscode.workspace.openTextDocument(jsonPath);
            await vscode.window.showTextDocument(document);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open JSON file: ${error}`);
        }
    });
    
    // Create a status bar item
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'caveatbot.toggleTracking';
    statusBarItem.text = '$(terminal) CaveatBot: OFF';
    statusBarItem.tooltip = 'Toggle terminal command tracking';
    statusBarItem.show();
    
    // Function to update status bar based on tracking state
    function updateStatusBar(isTracking: boolean): void {
        statusBarItem.text = isTracking 
            ? '$(terminal) CaveatBot: ON'
            : '$(terminal) CaveatBot: OFF';
    }
    
    // Load any previously stored commands when the extension loads
    commandTreeProvider.loadStoredCommands();
    
    // Add our new disposables to the context subscriptions
    context.subscriptions.push(toggleTrackingDisposable);
    context.subscriptions.push(viewJsonDisposable);
    context.subscriptions.push(statusBarItem);
    context.subscriptions.push(saveCommandsDisposable);
    context.subscriptions.push(clearCommandsDisposable);
    context.subscriptions.push(recordCommandDisposable);
    context.subscriptions.push(buttonActionDisposable);
    context.subscriptions.push(treeView);
}

// This method is called when your extension is deactivated
export function deactivate() {}
