import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { FileWatcherService } from './services/fileWatcherService';
import { ActionManager } from './services/actionManager';
import { SessionData, ActionData, TerminalCommand } from './models/interfaces';
import { TerminalMonitor } from './services/TerminalMonitor';
import { SessionTreeProvider, SessionItem } from './services/Session';
import { exec } from 'child_process';
import * as os from 'os';
import { beginWorkflow } from './services/dataIngestionService';

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "caveatbot" is now active!');
    
    // Create our session tree provider
    const sessionTreeProvider = new SessionTreeProvider(context);
    
    // Create terminal monitor
    const terminalMonitor = new TerminalMonitor(sessionTreeProvider);
    
    // Connect terminal monitor to session provider
    sessionTreeProvider.setTerminalMonitor(terminalMonitor);
    
    // Initialize file watcher service in the session provider
    sessionTreeProvider.initializeFileWatcherService();
    
    // Register the tree view
    const sessionTreeView = vscode.window.createTreeView('caveatbotSessionExplorer', {
        treeDataProvider: sessionTreeProvider
    });
    
    // Register session recording commands
    const startRecordingDisposable = vscode.commands.registerCommand('caveatbot.startRecording', async () => {
        await sessionTreeProvider.startSession();
        vscode.commands.executeCommand('setContext', 'caveatbot.isRecording', true);
        statusBarItem.text = '$(pulse) CaveatBot Recording';
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
    const startCaptureDisposable = vscode.commands.registerCommand('caveatbot.startCapture', async (item?: SessionItem) => {
        if (item && item.contextValue === 'session') {
            // If we're called with a specific session item, set it as active
            sessionTreeProvider.setActiveSession(item.id);
        } else if (!sessionTreeProvider.isActiveSession()) {
            // If no specific session and no active session, start a new one
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
    
    
    const addNoteDisposable = vscode.commands.registerCommand('caveatbot.addNote', async () => {
        await sessionTreeProvider.addNoteAction();
    });
    
    const setActiveSessionDisposable = vscode.commands.registerCommand('caveatbot.setActiveSession', (item: SessionItem) => {
        if (item.contextValue === 'session') {
            sessionTreeProvider.setActiveSession(item.id);
        }
    });
    
    const closeSessionDisposable = vscode.commands.registerCommand('caveatbot.closeSession', () => {
        sessionTreeProvider.closeCurrentSession();
        // Setting the context here again to ensure it's properly updated
        vscode.commands.executeCommand('setContext', 'caveatbot.isRecording', false);
        statusBarItem.text = '$(record) CaveatBot';
    });
    
    // Register the view JSON command
    const viewSessionJsonDisposable = vscode.commands.registerCommand('caveatbot.viewSessionJson', async (item: SessionItem) => {
        if (item.contextValue === 'session') {
            await sessionTreeProvider.viewSessionJson(item.id);
        }
    });

    // Register delete session command
    const deleteSessionDisposable = vscode.commands.registerCommand('caveatbot.deleteSession', async (item: SessionItem) => {
        if (item.contextValue === 'session') {
            await sessionTreeProvider.deleteSession(item.id);
        }
    });
    
    // Register delete action command
    const deleteActionDisposable = vscode.commands.registerCommand('caveatbot.deleteAction', async (item: SessionItem) => {
        const actionInfo = sessionTreeProvider.getActionIndexFromItemId(item.id);
        if (actionInfo) {
            await sessionTreeProvider.deleteAction(actionInfo.sessionId, actionInfo.actionIndex);
        }
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
    
    // Add the services to context.subscriptions to ensure proper disposal
    context.subscriptions.push({
        dispose: () => {
            sessionTreeProvider.dispose();
        }
    });
    
    // Add our disposables to the context subscriptions
    context.subscriptions.push(
        startRecordingDisposable,
        toggleTerminalTrackingDisposable,
        startCaptureDisposable,
        stopCaptureDisposable,
        manualRecordCommandDisposable,
        addNoteDisposable,
        setActiveSessionDisposable,
        closeSessionDisposable,
        captureTerminalOutputDisposable,
        viewSessionJsonDisposable,
        deleteSessionDisposable,
        deleteActionDisposable,
        statusBarItem,
        terminalStatusBarItem,
        sessionTreeView,
        {
            dispose: () => {
                terminalMonitor.dispose();
            }
        },
    );

    // This ensures the recording status is correctly initialized on startup
    context.subscriptions.push(
        vscode.commands.registerCommand('caveatbot.checkSessionStatus', () => {
            const isRecording = sessionTreeProvider.isActiveSession();
            vscode.commands.executeCommand('setContext', 'caveatbot.isRecording', isRecording);
            statusBarItem.text = isRecording ? '$(pulse) CaveatBot Recording' : '$(record) CaveatBot';
            return isRecording;
        })
    );
    
    // Check session status on activation
    vscode.commands.executeCommand('caveatbot.checkSessionStatus');
    
    // Initialize terminal tracking context (ensure it's set to false by default)
    vscode.commands.executeCommand('setContext', 'caveatbot.terminalTracking', false);

    // Register command for data ingestion
    const ingestDataDisposable = vscode.commands.registerCommand('caveatbot.ingestData', async () => {
        beginWorkflow();
    });

    context.subscriptions.push(ingestDataDisposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
