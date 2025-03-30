import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, ChildProcess, exec } from 'child_process';
import Groq from 'groq-sdk';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

export class AudioHandler {
    private isRecording: boolean = false;
    private recordingProcess: ChildProcess | null = null;
    private groqClient: any;
    private storageBasePath: string;
    private statusBarItem: vscode.StatusBarItem;
    private recordingTimer: NodeJS.Timeout | null = null;
    private recordingStartTime: number = 0;
    private recordingDurationSeconds: number = 0;
    private disposables: vscode.Disposable[] = [];
    private currentAudioFilePath: string | null = null;
    
    constructor() {
        // Initialize the Groq client with API key from environment
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
            console.warn('GROQ_API_KEY not found in environment variables. Voice transcription may not work properly.');
        }
        this.groqClient = new Groq({ apiKey });
        
        // Set a default storage path - will be properly set when initialize is called
        this.storageBasePath = path.join(__dirname, '..', '..', 'recordings');
        
        // Create the status bar item
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.command = 'caveatbot.stopVoiceMemo';
        this.statusBarItem.tooltip = "Click to stop recording";
    }
    
    // Initialize with extension context to get proper storage paths
    initialize(context: vscode.ExtensionContext): void {
        this.storageBasePath = path.join(context.globalStorageUri.fsPath, 'recordings');
        
        // Create directory if it doesn't exist
        if (!fs.existsSync(this.storageBasePath)) {
            fs.mkdirSync(this.storageBasePath, { recursive: true });
        }
        
        // Register the stop command
        const stopRecordingCommand = vscode.commands.registerCommand('caveatbot.stopVoiceMemo', async () => {
            if (this.isRecording) {
                await this.stopRecording();
            }
        });
        
        this.disposables.push(stopRecordingCommand);
        context.subscriptions.push(stopRecordingCommand);
    }
    
    async startRecording(sessionId: string): Promise<{ success: boolean, transcript?: string, error?: string }> {
        if (this.isRecording) {
            return { success: false, error: 'Recording already in progress' };
        }
        
        try {
            this.isRecording = true;
            
            // Create output directory for recordings if it doesn't exist
            if (!fs.existsSync(this.storageBasePath)) {
                fs.mkdirSync(this.storageBasePath, { recursive: true });
            }
            
            // Create unique filename for this recording
            const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
            const outputFilePath = path.join(this.storageBasePath, `${sessionId}-${timestamp}.wav`);
            this.currentAudioFilePath = outputFilePath;
            
            // Start recording duration timer
            this.recordingStartTime = Date.now();
            this.recordingDurationSeconds = 0;
            this.recordingTimer = setInterval(() => {
                this.recordingDurationSeconds = Math.floor((Date.now() - this.recordingStartTime) / 1000);
                this.updateStatusBarText();
            }, 1000);
            
            // Show status bar recording indicator
            this.updateStatusBarText();
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            this.statusBarItem.show();
            
            // Check if required audio tools are available
            const hasRequiredTools = await this.checkAudioToolsAvailability();
            if (!hasRequiredTools) {
                // Show installation instructions
                this.showInstallationInstructions();
                this.cleanupRecording();
                return { 
                    success: false, 
                    error: 'Required audio recording tools not found. Please see installation instructions.' 
                };
            }
            
            // Start platform-specific recording process
            await this.startPlatformSpecificRecording(outputFilePath);
            
            // Show notification with options to control recording
            vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: "Recording voice memo",
                    cancellable: true
                },
                async (progress, token) => {
                    // Create a promise that resolves when recording is stopped
                    token.onCancellationRequested(() => {
                        if (this.isRecording) {
                            this.stopRecording();
                        }
                    });
                    
                    // Update progress every second
                    const intervalToken = setInterval(() => {
                        progress.report({ message: `Recording for ${this.formatDuration(this.recordingDurationSeconds)}` });
                    }, 1000);
                    
                    // Return a promise that never resolves until recording stops
                    return new Promise<void>(resolve => {
                        const checkIfStoppedInterval = setInterval(() => {
                            if (!this.isRecording) {
                                clearInterval(intervalToken);
                                clearInterval(checkIfStoppedInterval);
                                resolve();
                            }
                        }, 500);
                    });
                }
            );
            
            // Create a promise that resolves when stopRecording is called
            const recordingPromise = new Promise<{ success: boolean, transcript?: string, error?: string }>(resolve => {
                this._resolveRecordingPromise = resolve;
            });
            
            return recordingPromise;
            
        } catch (error) {
            this.isRecording = false;
            this.statusBarItem.hide();
            if (this.recordingTimer) {
                clearInterval(this.recordingTimer);
                this.recordingTimer = null;
            }
            return { success: false, error: `Failed to start recording: ${error}` };
        }
    }

    // Check if required audio tools are installed and available
    private async checkAudioToolsAvailability(): Promise<boolean> {
        const platform = os.platform();
        let command: string;
        
        if (platform === "win32" || platform === "darwin") {
            command = "sox";
        } else if (platform === "linux") {
            command = "arecord";
        } else {
            return false; // Unsupported platform
        }
        
        try {
            // Check if command exists
            return new Promise<boolean>((resolve) => {
                if (platform === "win32") {
                    // On Windows, use 'where' command
                    exec(`where ${command}`, (error) => {
                        resolve(!error);
                    });
                } else {
                    // On Unix-like systems, use 'which' command
                    exec(`which ${command}`, (error) => {
                        resolve(!error);
                    });
                }
            });
        } catch (error) {
            return false;
        }
    }
    
    // Show installation instructions for audio tools
    private showInstallationInstructions(): void {
        const platform = os.platform();
        let instructions: string;
        
        if (platform === "win32") {
            instructions = `
To record audio, you need to install SoX:
1. Download SoX from https://sourceforge.net/projects/sox/files/sox/
2. Install it and make sure it's added to your PATH
3. Restart VS Code after installation`;
        } else if (platform === "darwin") {
            instructions = `
To record audio, you need to install SoX:
1. Install Homebrew if not installed: /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
2. Run: brew install sox
3. Restart VS Code after installation`;
        } else if (platform === "linux") {
            instructions = `
To record audio, you need to install ALSA tools:
1. Run: sudo apt-get update && sudo apt-get install alsa-utils
2. Restart VS Code after installation`;
        } else {
            instructions = "Your platform is not supported for audio recording.";
        }
        
        // Create a webview panel with installation instructions
        const panel = vscode.window.createWebviewPanel(
            'audioToolsInstallation',
            'Audio Recording Setup',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );
        
        panel.webview.html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Audio Recording Setup</title>
                <style>
                    body {
                        font-family: var(--vscode-font-family);
                        padding: 20px;
                        color: var(--vscode-editor-foreground);
                    }
                    h1 {
                        color: var(--vscode-editorLink-activeForeground);
                    }
                    pre {
                        background-color: var(--vscode-editor-background);
                        padding: 10px;
                        border-radius: 5px;
                        overflow-x: auto;
                    }
                    .note {
                        background-color: var(--vscode-inputValidation-infoBackground);
                        border: 1px solid var(--vscode-inputValidation-infoBorder);
                        padding: 10px;
                        margin: 10px 0;
                        border-radius: 3px;
                    }
                </style>
            </head>
            <body>
                <h1>Audio Recording Setup Required</h1>
                <p>CaveatBot requires additional software to record audio on your system.</p>
                
                <div class="note">
                    <p>Follow these instructions to set up audio recording:</p>
                    <pre>${instructions}</pre>
                </div>
                
                <p>After installation, you'll be able to record voice memos in CaveatBot.</p>
            </body>
            </html>
        `;
    }

    // Start platform-specific recording process
    private async startPlatformSpecificRecording(outputFilePath: string): Promise<void> {
        const platform = os.platform();
        let recordCommand: string;
        let args: string[];

        if (platform === "win32") {
            recordCommand = "sox";
            args = ["-t", "waveaudio", "default", "-b", "16", "-c", "1", "-r", "16000", outputFilePath];
        } else if (platform === "darwin") {
            recordCommand = "sox";
            args = ["-d", "-b", "16", "-c", "1", "-r", "16000", outputFilePath];
        } else if (platform === "linux") {
            recordCommand = "arecord";
            args = ["-f", "cd", "-t", "wav", "-c", "1", "-r", "16000", outputFilePath];
        } else {
            throw new Error("Unsupported platform for audio recording");
        }

        try {
            this.recordingProcess = spawn(recordCommand, args);
            
            // Handle process events
            this.recordingProcess.on('error', (err) => {
                const errorMessage = `Recording error: ${err.message}`;
                console.error(errorMessage);
                
                // For ENOENT errors, provide more specific guidance
                if (err.code === 'ENOENT') {
                    const toolName = platform === 'linux' ? 'arecord' : 'sox';
                    vscode.window.showErrorMessage(`${toolName} command not found. Please install the required audio tools.`, 'Show Installation Instructions')
                        .then(selection => {
                            if (selection === 'Show Installation Instructions') {
                                this.showInstallationInstructions();
                            }
                        });
                } else {
                    vscode.window.showErrorMessage(errorMessage);
                }
                
                if (this._resolveRecordingPromise) {
                    this._resolveRecordingPromise({
                        success: false,
                        error: errorMessage
                    });
                }
                this.cleanupRecording();
            });
            
            this.recordingProcess.stderr?.on('data', (data) => {
                console.log(`Recording stderr: ${data}`);
            });
            
            this.recordingProcess.on('close', (code) => {
                if (code !== 0 && code !== null) {
                    console.log(`Recording process exited with code ${code}`);
                }
            });
        } catch (error) {
            throw new Error(`Failed to start recording process: ${error}`);
        }
    }
    
    // Private storage for the current recording session
    private _resolveRecordingPromise: ((value: { success: boolean, transcript?: string, error?: string }) => void) | null = null;
    
    // Format duration in MM:SS
    private formatDuration(seconds: number): string {
        const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
        const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
        return `${mins}:${secs}`;
    }
    
    // Update status bar text with current recording duration
    private updateStatusBarText(): void {
        this.statusBarItem.text = `$(record) Recording ${this.formatDuration(this.recordingDurationSeconds)}`;
    }
    
    // Stop the recording process
    async stopRecording(): Promise<{ success: boolean, transcript?: string, error?: string }> {
        if (!this.isRecording || !this.recordingProcess || !this._resolveRecordingPromise) {
            return { success: false, error: 'No recording in progress' };
        }
        
        try {
            // Kill the recording process
            if (this.recordingProcess) {
                this.recordingProcess.kill('SIGTERM');
                this.recordingProcess = null;
            }
            
            // Wait a moment to ensure file is properly closed
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Stop the recording timer
            if (this.recordingTimer) {
                clearInterval(this.recordingTimer);
                this.recordingTimer = null;
            }
            
            // Hide the status bar item
            this.statusBarItem.hide();
            
            // Set recording state to false
            this.isRecording = false;
            
            // Check if file exists and has content
            if (!this.currentAudioFilePath || !fs.existsSync(this.currentAudioFilePath)) {
                if (this._resolveRecordingPromise) {
                    this._resolveRecordingPromise({
                        success: false,
                        error: 'Audio file not found after recording'
                    });
                }
                return { success: false, error: 'Audio file not found after recording' };
            }
            
            const fileStats = fs.statSync(this.currentAudioFilePath);
            if (fileStats.size === 0) {
                fs.unlinkSync(this.currentAudioFilePath); // Delete empty file
                if (this._resolveRecordingPromise) {
                    this._resolveRecordingPromise({
                        success: false,
                        error: 'Recording produced an empty file'
                    });
                }
                return { success: false, error: 'Recording produced an empty file' };
            }
            
            // Process the audio file
            vscode.window.showInformationMessage('Processing audio...');
            let transcriptionResult;
            try {
                transcriptionResult = await this.processAudioWithGroq(this.currentAudioFilePath);
            } catch (transcriptError) {
                console.error('Error during transcription:', transcriptError);
                transcriptionResult = 'Transcription failed';
            }
            
            // Return the result
            const result = { 
                success: true,
                transcript: transcriptionResult
            };
            
            // Resolve the promise from startRecording
            if (this._resolveRecordingPromise) {
                this._resolveRecordingPromise(result);
                this._resolveRecordingPromise = null;
            }
            
            // Reset the current recording
            this.currentAudioFilePath = null;
            
            return result;
            
        } catch (err) {
            this.cleanupRecording();
            
            const errorMessage = `Error stopping recording: ${err}`;
            
            // Resolve the promise from startRecording with error
            if (this._resolveRecordingPromise) {
                this._resolveRecordingPromise({ 
                    success: false, 
                    error: errorMessage 
                });
                this._resolveRecordingPromise = null;
            }
            
            return { 
                success: false, 
                error: errorMessage 
            };
        }
    }
    
    // Helper method to clean up recording resources
    private cleanupRecording(): void {
        if (this.recordingProcess) {
            try {
                this.recordingProcess.kill('SIGTERM');
            } catch (e) {
                console.error('Error killing recording process:', e);
            }
            this.recordingProcess = null;
        }
        
        if (this.recordingTimer) {
            clearInterval(this.recordingTimer);
            this.recordingTimer = null;
        }
        
        this.isRecording = false;
        this.statusBarItem.hide();
    }
    
    // Check if recording is currently active
    isRecordingActive(): boolean {
        return this.isRecording;
    }
    
    // Dispose of resources
    dispose(): void {
        if (this.isRecording) {
            this.stopRecording();
        }
        
        this.statusBarItem.dispose();
        
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
    }
    
    async processAudioWithGroq(audioFilePath: string): Promise<string> {
        try {
            // Create a transcription job
            const transcription = await this.groqClient.audio.transcriptions.create({
                file: fs.createReadStream(audioFilePath),
                model: "whisper-large-v3-turbo",
                prompt: "VSCode programming context",
                response_format: "verbose_json",
                timestamp_granularities: ["word", "segment"],
                language: "en",
                temperature: 0.0,
            });
            
            // Store the full transcription data alongside the audio file
            const transcriptionDataPath = audioFilePath.replace('.wav', '-transcription.json');
            fs.writeFileSync(transcriptionDataPath, JSON.stringify(transcription, null, 2));
            
            // Return just the text for immediate use
            return transcription.text;
        } catch (error) {
            console.error('Error transcribing audio:', error);
            throw error;
        }
    }
    
    async processAudioData(audioData: Uint8Array, sessionId: string | null): Promise<void> {
        // Legacy method for compatibility - simplified to just log
        console.log(`Received ${audioData.length} bytes of audio data for session ${sessionId}`);
    }
}
