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
    type: 'terminal' | 'screenshot'| 'command'| 'consequence' | 'note' | 'codeChange'; // Add 'screenshot' to the types
    command: string;
    code_change: string;
    output: string;
    timestamp: string;
    success?: boolean;
    
    // Properties specific to screenshot actions
    path?: string;
    filename?: string;
    description?: string;
}

// Terminal data structure
export interface TerminalCommand {
    command: string;
    terminalId: string;
    timestamp: string;
}
