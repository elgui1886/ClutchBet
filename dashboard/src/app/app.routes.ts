import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./pages/login/login').then(m => m.LoginPage) },
  { path: 'config', loadComponent: () => import('./pages/config/config').then(m => m.ConfigPage), canActivate: [authGuard] },
  { path: 'env', loadComponent: () => import('./pages/env/env').then(m => m.EnvPage), canActivate: [authGuard] },
  { path: 'prompts', loadComponent: () => import('./pages/prompts/prompts').then(m => m.PromptsPage), canActivate: [authGuard] },
  { path: 'workflows', loadComponent: () => import('./pages/workflows/workflows').then(m => m.WorkflowsPage), canActivate: [authGuard] },
  { path: 'reports', loadComponent: () => import('./pages/reports/reports').then(m => m.ReportsPage), canActivate: [authGuard] },
  { path: '', redirectTo: 'workflows', pathMatch: 'full' },
  { path: '**', redirectTo: 'workflows' },
];
