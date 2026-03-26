import { Component, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-env',
  imports: [FormsModule, MatCardModule, MatButtonModule, MatSnackBarModule],
  template: `
    <div class="page">
      <h2>Variabili d'Ambiente (.env)</h2>
      <mat-card>
        <mat-card-content>
          <textarea class="editor" [(ngModel)]="envContent" rows="20"></textarea>
        </mat-card-content>
        <mat-card-actions align="end">
          <button mat-raised-button color="primary" (click)="save()" [disabled]="saving()">Salva</button>
        </mat-card-actions>
      </mat-card>
      <p class="hint">⚠️ Dopo aver modificato il .env, riavvia il server per applicare le modifiche.</p>
    </div>
  `,
  styles: [`
    .page { padding: 24px; }
    .editor {
      width: 100%;
      font-family: 'Courier New', monospace;
      font-size: 14px;
      padding: 12px;
      border: 1px solid #ccc;
      border-radius: 4px;
      resize: vertical;
      box-sizing: border-box;
    }
    .hint { color: #888; font-size: 13px; margin-top: 12px; }
  `]
})
export class EnvPage implements OnInit {
  envContent = '';
  saving = signal(false);

  constructor(private api: ApiService, private snack: MatSnackBar) {}

  async ngOnInit() {
    this.envContent = await this.api.getEnvConfig();
  }

  async save() {
    this.saving.set(true);
    await this.api.saveEnvConfig(this.envContent);
    this.saving.set(false);
    this.snack.open('.env salvato', 'OK', { duration: 2000 });
  }
}
