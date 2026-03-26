import { Component, signal, OnInit } from '@angular/core';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { DatePipe } from '@angular/common';
import { ApiService } from '../../services/api.service';
import { ReportDialogComponent } from './report-dialog';

interface ReportFile {
  name: string;
  size: number;
  modified: string;
}

@Component({
  selector: 'app-reports',
  imports: [MatTableModule, MatButtonModule, MatIconModule, MatDialogModule, MatSnackBarModule, DatePipe],
  template: `
    <div class="page">
      <h2>Report di Analisi</h2>
      @if (reports().length === 0) {
        <p class="hint">Nessun report disponibile. Lancia il workflow di analisi per generarne uno.</p>
      } @else {
        <table mat-table [dataSource]="reports()" class="full-width">
          <ng-container matColumnDef="name">
            <th mat-header-cell *matHeaderCellDef>Nome</th>
            <td mat-cell *matCellDef="let r">{{ r.name }}</td>
          </ng-container>
          <ng-container matColumnDef="modified">
            <th mat-header-cell *matHeaderCellDef>Data</th>
            <td mat-cell *matCellDef="let r">{{ r.modified | date:'dd/MM/yyyy HH:mm' }}</td>
          </ng-container>
          <ng-container matColumnDef="actions">
            <th mat-header-cell *matHeaderCellDef>Azioni</th>
            <td mat-cell *matCellDef="let r">
              <button mat-icon-button color="primary" (click)="viewReport(r.name)" matTooltip="Visualizza">
                <mat-icon>visibility</mat-icon>
              </button>
              <button mat-icon-button color="warn" (click)="deleteReport(r.name)" matTooltip="Elimina">
                <mat-icon>delete</mat-icon>
              </button>
            </td>
          </ng-container>
          <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
          <tr mat-row *matRowDef="let row; columns: displayedColumns;"></tr>
        </table>
      }
    </div>
  `,
  styles: [`
    .page { padding: 24px; }
    .full-width { width: 100%; }
    .hint { color: #888; }
  `]
})
export class ReportsPage implements OnInit {
  reports = signal<ReportFile[]>([]);
  displayedColumns = ['name', 'modified', 'actions'];

  constructor(private api: ApiService, private dialog: MatDialog, private snack: MatSnackBar) {}

  async ngOnInit() {
    await this.loadReports();
  }

  async loadReports() {
    this.reports.set(await this.api.listAnalysisReports());
  }

  async viewReport(filename: string) {
    const content = await this.api.getAnalysisReport(filename);
    this.dialog.open(ReportDialogComponent, {
      data: { name: filename, content },
      width: '80vw',
      maxHeight: '90vh',
    });
  }

  async deleteReport(filename: string) {
    if (!confirm(`Eliminare ${filename}?`)) return;
    await this.api.deleteAnalysisReport(filename);
    this.snack.open('Report eliminato', 'OK', { duration: 2000 });
    await this.loadReports();
  }
}
