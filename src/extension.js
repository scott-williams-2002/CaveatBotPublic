"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
// Command storage provider class
class CommandTreeProvider {
    context;
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    commands = [];
    constructor(context) {
        this.context = context;
    }
    refresh() {
        this._onDidChangeTreeData.fire(null);
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (element) {
            return Promise.resolve([]);
        }
        else {
            return Promise.resolve(this.commands);
        }
    }
    async storeCommands() {
        // Get all commands
        const allCommands = await vscode.commands.getCommands(true);
        // Filter out internal commands starting with _ or having special characters
        const filteredCommands = allCommands.filter(cmd => !cmd.startsWith('_') &&
            !cmd.includes('-') &&
            !cmd.includes('.') &&
            cmd.length > 1);
        // Create command items
        this.commands = filteredCommands.map(cmd => new CommandItem(cmd, cmd, vscode.TreeItemCollapsibleState.None));
        // Store in global storage
        this.context.globalState.update('storedCommands', filteredCommands);
        // Update the view
        this.refresh();
        return filteredCommands.length;
    }
    getStoredCommands() {
        return this.context.globalState.get('storedCommands', []);
    }
}
class CommandItem extends vscode.TreeItem {
    label;
    commandId;
    collapsibleState;
    constructor(label, commandId, collapsibleState) {
        super(label, collapsibleState);
        this.label = label;
        this.commandId = commandId;
        this.collapsibleState = collapsibleState;
        this.tooltip = `${this.label}`;
        this.description = commandId;
        this.command = {
            command: 'caveatbot.executeCommand',
            title: 'Execute Command',
            arguments: [this.commandId]
        };
    }
}
function activate(context) {
    console.log('Congratulations, your extension "caveatbot" is now active!');
    // Create our command tree provider
    const commandTreeProvider = new CommandTreeProvider(context);
    // Register the tree view
    const treeView = vscode.window.createTreeView('caveatbotCommandExplorer', {
        treeDataProvider: commandTreeProvider
    });
    // Register the command to store commands
    const storeCommandsDisposable = vscode.commands.registerCommand('caveatbot.storeCommands', async () => {
        try {
            // Show a progress notification
            const count = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Storing commands...",
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 50 });
                const count = await commandTreeProvider.storeCommands();
                progress.report({ increment: 50 });
                return count;
            });
            vscode.window.showInformationMessage(`Stored ${count} commands in global storage.`);
        }
        catch (error) {
            console.error("Error executing storeCommands:", error);
            vscode.window.showErrorMessage(`Failed to store commands: ${error}`);
        }
    });
    // Register command to execute a specific command
    const executeCommandDisposable = vscode.commands.registerCommand('caveatbot.executeCommand', (commandId) => {
        try {
            vscode.commands.executeCommand(commandId);
        }
        catch (error) {
            console.error(`Error executing command ${commandId}:`, error);
            vscode.window.showErrorMessage(`Failed to execute command: ${error}`);
        }
    });
    // Register the hello world command for backward compatibility
    const helloDisposable = vscode.commands.registerCommand('caveatbot.helloWorld', () => {
        vscode.window.showInformationMessage('Hello World from caveatbot!');
    });
    // Load any previously stored commands when the extension loads
    Promise.resolve(vscode.commands.executeCommand('caveatbot.storeCommands'))
        .then(() => console.log('Initial commands loaded'))
        .catch((err) => console.error('Failed to load initial commands:', err));
    // Add our disposables to the context subscriptions
    context.subscriptions.push(storeCommandsDisposable);
    context.subscriptions.push(executeCommandDisposable);
    context.subscriptions.push(helloDisposable);
    context.subscriptions.push(treeView);
}
// This method is called when your extension is deactivated
function deactivate() { }
//# sourceMappingURL=extension.js.map