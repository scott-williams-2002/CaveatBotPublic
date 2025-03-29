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
    type: 'command' | 'consequence' | 'note';
    content: string;
    timestamp: string;
    success?: boolean;
    output?: string;
}

// Terminal data structure
export interface TerminalCommand {
    command: string;
    terminalId: string;
    timestamp: string;
}
