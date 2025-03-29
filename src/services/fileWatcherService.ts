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
    private isTracking: boolean = false;

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
        // Skip processing if tracking is disabled
        if (!this.isTracking) {
            // Still update the stored content
            this.fileContents.set(document.uri.fsPath, document.getText());
            return;
        }
        
        const filePath = document.uri.fsPath;
        const oldContent = this.fileContents.get(filePath);
        const newContent = document.getText();
        
        // Pass to session provider for processing if it exists
        if (this.sessionTreeProvider) {
            this.sessionTreeProvider.handleFileSave(document, oldContent);
        }

        // Update stored content regardless
        this.fileContents.set(filePath, newContent);
    }

    public stop(): void {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }
        
        this.stopTracking();
    }
    
    // Start tracking file changes
    public startTracking(): void {
        this.isTracking = true;
    }
    
    // Stop tracking file changes
    public stopTracking(): void {
        this.isTracking = false;
    }
    
    // Check if we are currently tracking file changes
    public isTrackingEnabled(): boolean {
        return this.isTracking;
    }
    
    // Update tracking state based on session state
    public updateTrackingState(hasActiveSession: boolean): void {
        if (hasActiveSession && !this.isTracking) {
            this.startTracking();
        } else if (!hasActiveSession && this.isTracking) {
            this.stopTracking();
        }
    }
}
