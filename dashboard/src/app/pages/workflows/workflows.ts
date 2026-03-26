import { Component, signal, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-workflows',
  imports: [MatCardModule, MatButtonModule, MatIconModule, MatProgressBarModule],
  template: `
    <div class="page">
      <h2>Workflows</h2>
      <div class="cards">
        <mat-card>
          <mat-card-header>
            <mat-icon mat-card-avatar>send</mat-icon>
            <mat-card-title>Generation</mat-card-title>
            <mat-card-subtitle>Scrape + genera + pubblica post</mat-card-subtitle>
          </mat-card-header>
          <mat-card-actions>
            <button mat-raised-button color="primary"
              (click)="run('generation')"
              [disabled]="running()">
              @if (running() && activeWorkflow() === 'generation') {
                In esecuzione...
              } @else {
                Lancia Generation
              }
            </button>
          </mat-card-actions>
        </mat-card>

        <mat-card>
          <mat-card-header>
            <mat-icon mat-card-avatar>analytics</mat-icon>
            <mat-card-title>Analysis</mat-card-title>
            <mat-card-subtitle>Analizza canale Telegram</mat-card-subtitle>
          </mat-card-header>
          <mat-card-actions>
            <button mat-raised-button color="accent"
              (click)="run('analysis')"
              [disabled]="running()">
              @if (running() && activeWorkflow() === 'analysis') {
                In esecuzione...
              } @else {
                Lancia Analysis
              }
            </button>
          </mat-card-actions>
        </mat-card>
      </div>

      @if (running()) {
        <mat-progress-bar mode="indeterminate" class="progress"></mat-progress-bar>
      }

      @if (logs().length > 0) {
        <div class="log-container">
          <div class="log-header">
            <h3>Log</h3>
            <button mat-button (click)="clearLogs()">Pulisci</button>
          </div>
          <pre class="log-output" #logOutput>{{ logs().join('') }}</pre>
        </div>
      }
    </div>
  `,
  styles: [`
    .page { padding: 24px; }
    .cards { display: flex; gap: 24px; margin-bottom: 24px; }
    .cards mat-card { flex: 1; }
    .progress { margin-bottom: 16px; }
    .log-container { margin-top: 16px; }
    .log-header { display: flex; align-items: center; justify-content: space-between; }
    .log-output {
      background: #1e1e1e;
      color: #d4d4d4;
      padding: 16px;
      border-radius: 8px;
      max-height: 500px;
      overflow-y: auto;
      font-family: 'Courier New', monospace;
      font-size: 13px;
      white-space: pre-wrap;
      word-break: break-all;
    }
  `]
})
export class WorkflowsPage implements OnInit, OnDestroy {
  running = signal(false);
  activeWorkflow = signal<string | null>(null);
  logs = signal<string[]>([]);
  private eventSource: EventSource | null = null;

  constructor(private api: ApiService, private cdr: ChangeDetectorRef) {}

  async ngOnInit() {
    const status = await this.api.getWorkflowStatus();
    this.running.set(status.running);
    this.activeWorkflow.set(status.workflow);
  }

  ngOnDestroy() {
    this.eventSource?.close();
  }

  run(workflow: 'generation' | 'analysis') {
    this.running.set(true);
    this.activeWorkflow.set(workflow);
    this.logs.set([]);

    this.eventSource = this.api.runWorkflow(workflow);

    this.eventSource.addEventListener('log', (e: MessageEvent) => {
      this.logs.update(l => [...l, JSON.parse(e.data)]);
      this.cdr.detectChanges();
    });

    this.eventSource.addEventListener('error', (e: MessageEvent) => {
      if ((e as any).data) {
        this.logs.update(l => [...l, `❌ ${JSON.parse((e as any).data)}`]);
        this.cdr.detectChanges();
      }
    });

    this.eventSource.addEventListener('done', (e: MessageEvent) => {
      this.logs.update(l => [...l, `\n✅ ${JSON.parse(e.data)}\n`]);
      this.running.set(false);
      this.activeWorkflow.set(null);
      this.eventSource?.close();
      this.eventSource = null;
      this.cdr.detectChanges();
    });
  }

  clearLogs() {
    this.logs.set([]);
  }
}
