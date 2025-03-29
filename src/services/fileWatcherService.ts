import * as vscode from 'vscode';
import * as fs from 'fs';
import { diffLines } from 'diff';
import { ActionManager } from './actionManager';
import { SessionTreeProvider } from './Session';

export class FileWatcherService {
    private fileWatcher: vscode.FileSystemWatcher | undefined;
    private fileContents: Map<string, string> = new Map();
    private actionManager: ActionManager;
    private sessionTreeProvider?: SessionTreeProvider;

    constructor(actionManager: ActionManager, sessionTreeProvider?: SessionTreeProvider) {
        this.actionManager = actionManager;
        this.sessionTreeProvider = sessionTreeProvider;
    }

    public start(): void {
        // Watch all files in the workspace
        this.fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');
        
        // Cache initial content of open documents
        vscode.workspace.textDocuments.forEach(doc => {
            const filePath = doc.uri.fsPath;
            this.fileContents.set(filePath, doc.getText());
        });

        // Listen for document opens to cache their content
        vscode.workspace.onDidOpenTextDocument(doc => {
            const filePath = doc.uri.fsPath;
            this.fileContents.set(filePath, doc.getText());
        });

        // Listen for document saves to detect changes
        vscode.workspace.onDidSaveTextDocument(doc => {
            this.handleFileSave(doc);
        });
    }

    private handleFileSave(document: vscode.TextDocument): void {
        const filePath = document.uri.fsPath;
        const newContent = document.getText();
        const oldContent = this.fileContents.get(filePath);

        // Skip if we don't have the previous content
        if (oldContent === undefined) {
            this.fileContents.set(filePath, newContent);
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

        // Update stored content
        this.fileContents.set(filePath, newContent);
    }
    
    private showDiffDialog(changes: Array<{type: string, value: string}>, filePath: string): void {
        // Get the first change and its first line
        if (changes.length > 0) {
            const firstChange = changes[0];
            const firstLine = firstChange.value.split('\n')[0].trim();
            const changeType = firstChange.type === 'addition' ? 'Added' : 'Removed';
            
            // Get filename from path
            const fileName = filePath.split(/[\\/]/).pop() || filePath;
            
            // Show information message with the first line of the diff
            vscode.window.showInformationMessage(
                `${fileName}: ${changeType} "${firstLine}"`,
                'Save to Session'
            ).then(selection => {
                if (selection === 'Save to Session') {
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
                    if (this.sessionTreeProvider) {
                        this.sessionTreeProvider.addNoteAction(
                            `Changed ${fileName}: ${changeType} "${firstLine}"`,
                            { codeChange: codeChangeDetails }
                        );
                    } else {
                        vscode.commands.executeCommand(
                            'caveatbot.addNote',
                            `Changed ${fileName}: ${changeType} "${firstLine}"`
                        );
                    }
                }
            });
        }
    }

    public stop(): void {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }
    }
}
