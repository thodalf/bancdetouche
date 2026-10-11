import { Routes } from '@angular/router';
import { gameGuard } from './core/guards/game.guard';

export const routes: Routes = [
  { path: '', title: 'Banc de touche', loadComponent: () => import('./features/home/home.component').then((m) => m.HomeComponent) },
  {
    path: 'nouvelle-partie',
    title: 'Choix du club — Banc de touche',
    loadComponent: () => import('./features/club-select/club-select.component').then((m) => m.ClubSelectComponent),
  },
  {
    path: 'jeu',
    canActivate: [gameGuard],
    loadComponent: () => import('./features/shell/shell.component').then((m) => m.ShellComponent),
    children: [
      { path: '', title: 'Tableau de bord', loadComponent: () => import('./features/hub/hub.component').then((m) => m.HubComponent) },
      { path: 'effectif', title: 'Effectif', loadComponent: () => import('./features/squad/squad.component').then((m) => m.SquadComponent) },
      { path: 'tactique', title: 'Tactique', loadComponent: () => import('./features/tactics/tactics.component').then((m) => m.TacticsComponent) },
      { path: 'transferts', title: 'Transferts', loadComponent: () => import('./features/transfers/transfers.component').then((m) => m.TransfersComponent) },
      { path: 'competitions', title: 'Compétitions', loadComponent: () => import('./features/competition/competition.component').then((m) => m.CompetitionComponent) },
      { path: 'semaine', title: 'Semaine', loadComponent: () => import('./features/week/week.component').then((m) => m.WeekComponent) },
      { path: 'staff', title: 'Staff', loadComponent: () => import('./features/staff/staff.component').then((m) => m.StaffComponent) },
      { path: 'boosters', title: 'Boosters', loadComponent: () => import('./features/boosters/boosters.component').then((m) => m.BoostersComponent) },
      { path: 'club', title: 'Club', loadComponent: () => import('./features/club/club.component').then((m) => m.ClubComponent) },
      { path: 'finances', title: 'Finances', loadComponent: () => import('./features/finances/finances.component').then((m) => m.FinancesComponent) },
      { path: 'match', title: 'Jour de match', loadComponent: () => import('./features/match/match.component').then((m) => m.MatchComponent) },
    ],
  },
  { path: '**', redirectTo: '' },
];
