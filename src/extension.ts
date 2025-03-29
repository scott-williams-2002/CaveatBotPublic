import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { FileWatcherService } from './services/fileWatcherService';
import { ActionManager } from './services/actionManager';
import { SessionData, ActionData, TerminalCommand } from './models/interfaces';
import { TerminalMonitor } from './services/TerminalMonitor';
import { SessionTreeProvider, SessionItem } from './services/Session';



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
    
    const setActiveSessionDisposable = vscode.commands.registerCommand('caveatbot.setActiveSession', (item: SessionItem) => {
        if (item.contextValue === 'session') {
            sessionTreeProvider.setActiveSession(item.id);
        }
    });
    
    const closeSessionDisposable = vscode.commands.registerCommand('caveatbot.closeSession', () => {
        sessionTreeProvider.closeCurrentSession();
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
    
    // Initialize action manager and file watcher
    const actionManager = new ActionManager();
    const fileWatcherService = new FileWatcherService(actionManager);
    fileWatcherService.start();
    
    // Add the services to context.subscriptions to ensure proper disposal
    context.subscriptions.push({
        dispose: () => {
            fileWatcherService.stop();
        }
    });
    
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
        }
    );
}

// This method is called when your extension is deactivated
export function deactivate() {}
