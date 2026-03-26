import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-report-dialog',
  imports: [MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>{{ data.name }}</h2>
    <mat-dialog-content>
      <pre class="report-content">{{ data.content }}</pre>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Chiudi</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .report-content {
      white-space: pre-wrap;
      word-break: break-word;
      font-family: 'Courier New', monospace;
      font-size: 13px;
      max-height: 70vh;
      overflow-y: auto;
    }
  `]
})
export class ReportDialogComponent {
  constructor(@Inject(MAT_DIALOG_DATA) public data: { name: string; content: string }) {}
}
