import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule],
  template: `
    <div class="login-container">
      <mat-card class="login-card">
        <mat-card-header>
          <mat-card-title>Agentic Workflow</mat-card-title>
          <mat-card-subtitle>Dashboard Login</mat-card-subtitle>
        </mat-card-header>
        <mat-card-content>
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Username</mat-label>
            <input matInput [(ngModel)]="username" (keyup.enter)="login()">
          </mat-form-field>
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Password</mat-label>
            <input matInput type="password" [(ngModel)]="password" (keyup.enter)="login()">
          </mat-form-field>
          @if (error()) {
            <p class="error">Credenziali non valide</p>
          }
        </mat-card-content>
        <mat-card-actions align="end">
          <button mat-raised-button color="primary" (click)="login()" [disabled]="loading()">
            @if (loading()) { Accesso... } @else { Accedi }
          </button>
        </mat-card-actions>
      </mat-card>
    </div>
  `,
  styles: [`
    .login-container {
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      background: #f5f5f5;
    }
    .login-card { width: 360px; padding: 16px; }
    .full-width { width: 100%; }
    .error { color: #f44336; font-size: 14px; margin: 0; }
  `]
})
export class LoginPage {
  username = '';
  password = '';
  error = signal(false);
  loading = signal(false);

  constructor(private auth: AuthService, private router: Router) {}

  async login() {
    this.error.set(false);
    this.loading.set(true);
    const ok = await this.auth.login(this.username, this.password);
    this.loading.set(false);
    if (ok) {
      this.router.navigate(['/workflows']);
    } else {
      this.error.set(true);
    }
  }
}
