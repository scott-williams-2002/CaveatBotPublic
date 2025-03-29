import * as vscode from 'vscode';
import { SessionTreeProvider } from './Session';

// Terminal Monitor class to automatically track terminal commands
export class TerminalMonitor {
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
                        
                         //Get output using clipboard if possible
                        let output = "";
                        try {
                            output = await this.captureTerminalOutput(event.terminal);
                        } catch (error) {
                            console.error('Failed to capture terminal output:', error);
                        }
                        
                        // Add the command to our session
                        //this.sessionProvider.addAction('command', pendingCommand.command, event.exitCode === 0, pendingCommand.timestamp, output);
                        
                        // Add the output as a consequence
                        const success = event.exitCode === 0;
                        if (output) {
                            this.sessionProvider.addAction('command', pendingCommand.command, success, pendingCommand.timestamp, output);
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
        
        //Capture output
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