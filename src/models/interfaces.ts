// Recording session data structures
export interface SessionData {
    id: string;
    name: string;
	description: string;
    startTime: string;
    actions: ActionData[];
    notes: string;
}

export interface ActionData {
    type: 'command' | 'consequence' | 'note' | 'codeChange';
    command: string;
    code_change: string;
    output: string;
    timestamp: string;
    success?: boolean;
}

// Terminal data structure
export interface TerminalCommand {
    command: string;
    terminalId: string;
    timestamp: string;
}
