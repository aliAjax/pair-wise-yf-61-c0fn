import { Component, computed, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Store } from '@ngrx/store';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { rollbackBatch } from '../state/release.actions';
import type { ReleaseBatch } from '../state/release.models';

@Component({
  selector: 'app-rollback-panel',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatChipsModule, MatProgressBarModule],
  template: `
    <div class="rollback" *ngIf="record() as rollback">
      <div class="rollback-head">
        <mat-chip [color]="rollback.finishedAt ? 'primary' : 'warn'" highlighted>
          {{ rollback.finishedAt ? '回滚处理完成' : '回滚进行中' }}
        </mat-chip>
        <span>目标版本 <b>{{ rollback.targetVersion }}</b></span>
      </div>
      <mat-progress-bar mode="determinate" [value]="rollbackProgress()"></mat-progress-bar>
      <p class="rollback-stats">
        已回滚 {{ rollback.rolledBack }}/{{ total() }} 台 · 回滚失败 {{ rollback.failed }} 台 · {{ rollbackProgress() }}%
      </p>
      <p class="rollback-meta">
        {{ rollback.startedBy }} 于 {{ rollback.startedAt | date:'MM-dd HH:mm:ss' }} 发起
        <ng-container *ngIf="rollback.finishedAt">，{{ rollback.finishedAt | date:'MM-dd HH:mm:ss' }} 处理结束</ng-container>
      </p>
    </div>
    <button *ngIf="canStart()" mat-flat-button color="warn" (click)="start()">紧急回滚（按已更新 {{ total() }} 台推进）</button>
  `,
  styles: [`
    .rollback { border:1px solid #f0c8bd; border-radius:8px; padding:8px 10px; background:#fdf3f0 }
    .rollback-head { display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:12px; color:#607d86 }
    .rollback-stats { margin:6px 0 2px; font-size:13px; color:#5d4037 }
    .rollback-meta { margin:0; font-size:12px; color:#8a9ba2 }
  `]
})
export class RollbackPanelComponent {
  private readonly store = inject(Store);
  readonly batch = input.required<ReleaseBatch>();

  readonly record = computed(() => this.batch().rollback);
  readonly total = computed(() => this.batch().downloaded);
  readonly rollbackProgress = computed(() => {
    const total = this.total();
    const rolledBack = this.record()?.rolledBack ?? 0;
    return total ? Math.round(rolledBack / total * 100) : 0;
  });

  /** 仅已发布（出现过已更新设备、且未进入回滚）的批次开放回滚入口；草稿/已审批不开放。 */
  canStart(): boolean {
    const batch = this.batch();
    return batch.downloaded > 0 && batch.status !== 'rolling_back' && batch.status !== 'rolled_back';
  }

  start(): void {
    this.store.dispatch(rollbackBatch({ id: this.batch().id, actor: '发布负责人' }));
  }
}
