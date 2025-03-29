import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface Action {
    type: string;
    timestamp: string;
    [key: string]: any;
}

export class ActionManager {
    private actionsFilePath: string;
    private actions: Action[] = [];

    constructor() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            throw new Error('No workspace folder found');
        }
        
        // Store actions in a separate file in the .caveatbot directory
        const caveatbotDir = path.join(workspaceFolders[0].uri.fsPath, '.caveatbot');
        if (!fs.existsSync(caveatbotDir)) {
            fs.mkdirSync(caveatbotDir, { recursive: true });
        }
        
        this.actionsFilePath = path.join(caveatbotDir, 'actions.json');
        this.loadActions();
    }

    private loadActions(): void {
        try {
            if (fs.existsSync(this.actionsFilePath)) {
                const content = fs.readFileSync(this.actionsFilePath, 'utf8');
                this.actions = JSON.parse(content);
            }
        } catch (error) {
            console.error('Failed to load actions:', error);
            this.actions = [];
        }
    }

    private saveActions(): void {
        try {
            fs.writeFileSync(this.actionsFilePath, JSON.stringify(this.actions, null, 2), 'utf8');
        } catch (error) {
            console.error('Failed to save actions:', error);
        }
    }

    public addAction(action: Action): void {
        this.actions.push(action);
        this.saveActions();
    }

    public getActions(): Action[] {
        return [...this.actions];
    }

    public clearActions(): void {
        this.actions = [];
        this.saveActions();
    }
}
