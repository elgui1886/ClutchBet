import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private http: HttpClient) {}

  // --- Config ---
  getChannelsConfig(): Promise<string> {
    return firstValueFrom(this.http.get<{ content: string }>('/api/config/channels')).then(r => r.content);
  }
  saveChannelsConfig(content: string): Promise<void> {
    return firstValueFrom(this.http.put<void>('/api/config/channels', { content }));
  }
  getAnalysisConfig(): Promise<string> {
    return firstValueFrom(this.http.get<{ content: string }>('/api/config/analysis')).then(r => r.content);
  }
  saveAnalysisConfig(content: string): Promise<void> {
    return firstValueFrom(this.http.put<void>('/api/config/analysis', { content }));
  }
  getEnvConfig(): Promise<string> {
    return firstValueFrom(this.http.get<{ content: string }>('/api/config/env')).then(r => r.content);
  }
  saveEnvConfig(content: string): Promise<void> {
    return firstValueFrom(this.http.put<void>('/api/config/env', { content }));
  }

  // --- Prompts ---
  listPrompts(): Promise<string[]> {
    return firstValueFrom(this.http.get<{ files: string[] }>('/api/prompts')).then(r => r.files);
  }
  getPrompt(name: string): Promise<string> {
    return firstValueFrom(this.http.get<{ content: string }>(`/api/prompts/${name}`)).then(r => r.content);
  }
  savePrompt(name: string, content: string): Promise<void> {
    return firstValueFrom(this.http.put<void>(`/api/prompts/${name}`, { content }));
  }

  // --- Analysis reports ---
  listAnalysisReports(): Promise<{ name: string; size: number; modified: string }[]> {
    return firstValueFrom(this.http.get<{ files: { name: string; size: number; modified: string }[] }>('/api/analysis')).then(r => r.files);
  }
  getAnalysisReport(filename: string): Promise<string> {
    return firstValueFrom(this.http.get<{ content: string }>(`/api/analysis/${filename}`)).then(r => r.content);
  }
  deleteAnalysisReport(filename: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/analysis/${filename}`));
  }

  // --- Workflows ---
  getWorkflowStatus(): Promise<{ running: boolean; workflow: string | null }> {
    return firstValueFrom(this.http.get<{ running: boolean; workflow: string | null }>('/api/workflows/status'));
  }

  runWorkflow(workflow: 'generation' | 'analysis'): EventSource {
    const token = localStorage.getItem('token');
    const es = new EventSource(`/api/workflows/${workflow}?token=${token}`);
    return es;
  }
}
